"""
Units API V2 - Multi-unit management endpoints with resolved data.
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Optional
from pydantic import BaseModel
from datetime import datetime

from ..routes.auth import get_current_user, require_engineer
from app.core.constants import ENGINE_STATES
from app.db.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import crud
from app.services.unit_manager import UnitConfig
from app.services.physics_engine import PhysicsEngine, StageInput

router = APIRouter(prefix="/api/units", tags=["units"])


class UnitCreate(BaseModel):
    unit_id: str
    name: str
    stage_count: int = 3
    modbus_host: Optional[str] = None
    modbus_port: int = 502
    modbus_slave_id: int = 1
    description: Optional[str] = None
    location: Optional[str] = None


class UnitUpdate(BaseModel):
    name: Optional[str] = None
    stage_count: Optional[int] = None
    modbus_host: Optional[str] = None
    modbus_port: Optional[int] = None
    is_active: Optional[bool] = None


class ManualOverride(BaseModel):
    parameter: str
    value: float
    expires_minutes: Optional[int] = None  # None = never expires


def _normalize_live_keys(live_data: Dict) -> Dict:
    """Normalize key aliases so frontend receives a stable payload shape."""
    normalized = dict(live_data or {})

    if "engine_oil_pressure" in normalized and "engine_oil_press" not in normalized:
        normalized["engine_oil_press"] = normalized["engine_oil_pressure"]
    if "comp_oil_pressure" in normalized and "comp_oil_press" not in normalized:
        normalized["comp_oil_press"] = normalized["comp_oil_pressure"]

    if "hour_meter_low" in normalized and "hour_meter" not in normalized:
        normalized["hour_meter"] = float(normalized["hour_meter_low"]) / 10.0

    if "engine_state" in normalized and "engine_state_label" not in normalized:
        try:
            state = int(normalized["engine_state"])
        except Exception:
            state = 0
        normalized["engine_state_label"] = ENGINE_STATES.get(state, "UNKNOWN")

    for i in (1, 2, 3):
        press_key = f"stg{i}_suction_press"
        pressure_key = f"stg{i}_suction_pressure"
        if press_key in normalized and pressure_key not in normalized:
            normalized[pressure_key] = normalized[press_key]
        if pressure_key in normalized and press_key not in normalized:
            normalized[press_key] = normalized[pressure_key]

        press_key = f"stg{i}_discharge_press"
        pressure_key = f"stg{i}_discharge_pressure"
        if press_key in normalized and pressure_key not in normalized:
            normalized[pressure_key] = normalized[press_key]
        if pressure_key in normalized and press_key not in normalized:
            normalized[press_key] = normalized[pressure_key]

    return normalized


def _to_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _build_dashboard_payload(unit_id: str, live_data: Dict, stage_count: int) -> Dict:
    """Build a stable, dashboard-ready payload from raw live data."""
    physics = PhysicsEngine()
    default_stage_values = {
        1: (85.0, 330.0, 80.0, 285.0),
        2: (320.0, 510.0, 270.0, 360.0),
        3: (505.0, 1050.0, 345.0, 520.0),
    }

    stages = []
    overall_ratio = 1.0

    for i in range(1, max(1, stage_count) + 1):
        d_suction, d_discharge, d_suction_t, d_discharge_t = default_stage_values.get(i, (50.0, 200.0, 80.0, 200.0))
        suction = _to_float(
            live_data.get(f"stg{i}_suction_pressure", live_data.get(f"stg{i}_suction_press", d_suction)),
            d_suction
        )
        discharge = _to_float(
            live_data.get(f"stg{i}_discharge_pressure", live_data.get(f"stg{i}_discharge_press", d_discharge)),
            d_discharge
        )
        suction_t = _to_float(live_data.get(f"stg{i}_suction_temp", d_suction_t), d_suction_t)
        discharge_t = _to_float(live_data.get(f"stg{i}_discharge_temp", d_discharge_t), d_discharge_t)

        calc = physics.calculate_stage(StageInput(
            suction_pressure_psig=suction,
            discharge_pressure_psig=discharge,
            suction_temp_f=suction_t,
            discharge_temp_f=discharge_t,
        ))

        stages.append({
            "stage": i,
            "suction_press": suction,
            "discharge_press": discharge,
            "suction_temp": suction_t,
            "discharge_temp": discharge_t,
            "ratio": calc.compression_ratio,
            "isentropic_eff": calc.isentropic_efficiency,
            "volumetric_eff": calc.volumetric_efficiency,
            "ideal_temp": calc.isentropic_temp_f,
        })
        overall_ratio *= max(calc.compression_ratio, 1e-6)

    state_code = int(_to_float(live_data.get("engine_state", 8), 8))
    hour_meter = _to_float(
        live_data.get("hour_meter"),
        _to_float(live_data.get("hour_meter_low"), 0.0) / 10.0
    )
    total_bhp = _to_float(
        live_data.get("total_bhp"),
        max(0.0, (_to_float(live_data.get("engine_rpm"), 0.0) / 1000.0) * 1247.5)
    )

    payload = {
        "unit_id": unit_id,
        "timestamp": datetime.now().isoformat(),
        "engine_state": state_code,
        "engine_state_label": ENGINE_STATES.get(state_code, "UNKNOWN"),
        "hour_meter": hour_meter,
        "fault_code": int(_to_float(live_data.get("fault_code", 255), 255)),
        "engine_rpm": _to_float(live_data.get("engine_rpm"), 0.0),
        "engine_oil_press": _to_float(live_data.get("engine_oil_press"), 0.0),
        "engine_oil_temp": _to_float(live_data.get("engine_oil_temp"), 0.0),
        "jacket_water_temp": _to_float(live_data.get("jacket_water_temp"), 0.0),
        "comp_oil_press": _to_float(live_data.get("comp_oil_press"), 0.0),
        "comp_oil_temp": _to_float(live_data.get("comp_oil_temp"), 0.0),
        "stages": stages,
        "overall_ratio": round(overall_ratio, 2),
        "total_bhp": round(total_bhp, 1),
        "exhaust_temps": {k: _to_float(v) for k, v in live_data.items() if str(k).startswith("exh_")},
        "bearing_temps": [_to_float(live_data.get(f"main_bearing_{i}"), 0.0) for i in range(1, 10)],
        "suction_valve_pct": _to_float(live_data.get("suction_valve_pct", live_data.get("suction_valve_position")), 0.0),
        "speed_control_pct": _to_float(live_data.get("speed_control_pct", live_data.get("speed_control_output")), 0.0),
        "recycle_valve_pct": _to_float(live_data.get("recycle_valve_pct", live_data.get("recycle_valve_position")), 0.0),
        "active_alarms": [],
    }

    for stg in stages:
        i = int(stg["stage"])
        payload[f"stg{i}_suction_pressure"] = stg["suction_press"]
        payload[f"stg{i}_discharge_pressure"] = stg["discharge_press"]
        payload[f"stg{i}_suction_temp"] = stg["suction_temp"]
        payload[f"stg{i}_discharge_temp"] = stg["discharge_temp"]

    # Keep normalized raw keys available to existing screens.
    payload.update(live_data)
    return payload


async def _sync_units_from_db(manager, db: AsyncSession):
    """Ensure UnitManager contains persisted units."""
    db_units = await crud.get_units(db)
    active_ids = {u.unit_id for u in db_units if getattr(u, "is_active", True)}

    # Remove inactive/stale units from in-memory manager so deletes are reflected immediately.
    for existing_unit_id in list(manager.units.keys()):
        if existing_unit_id not in active_ids:
            manager.unregister_unit(existing_unit_id)

    for unit in db_units:
        if not getattr(unit, "is_active", True):
            continue

        stage_count = 3
        if getattr(unit, "equipment_spec", None) and getattr(unit.equipment_spec, "stage_count", None):
            stage_count = int(unit.equipment_spec.stage_count)
        elif getattr(unit, "stages", None):
            stage_count = max(1, len(unit.stages))

        existing = manager.get_unit(unit.unit_id)
        if existing and existing.name == unit.name and existing.stage_count == stage_count and existing.is_active == unit.is_active:
            continue
        manager.register_unit(
            UnitConfig(
                unit_id=unit.unit_id,
                name=unit.name,
                stage_count=stage_count,
                modbus_host=existing.modbus_host if existing else None,
                modbus_port=existing.modbus_port if existing else 502,
                modbus_slave_id=existing.modbus_slave_id if existing else 1,
                is_active=unit.is_active
            )
        )


@router.get("/")
async def list_units(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> Dict:
    """List all registered units."""
    from app.services.unit_manager import get_unit_manager
    
    manager = get_unit_manager()
    await _sync_units_from_db(manager, db)
    units = manager.get_all_units()
    
    return {
        "units": units,
        "count": len(units),
        "timestamp": datetime.now().isoformat()
    }


@router.get("/{unit_id}")
async def get_unit(
    unit_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
) -> Dict:
    """Get detailed information for a specific unit."""
    from app.services.unit_manager import get_unit_manager
    
    manager = get_unit_manager()
    await _sync_units_from_db(manager, db)
    unit = manager.get_unit(unit_id)
    
    if not unit:
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")
    
    return {
        "unit_id": unit.unit_id,
        "name": unit.name,
        "stage_count": unit.stage_count,
        "modbus_host": unit.modbus_host,
        "modbus_port": unit.modbus_port,
        "modbus_slave_id": unit.modbus_slave_id,
        "is_active": unit.is_active,
        "equipment_spec": unit.equipment_spec,
        "gas_properties": unit.gas_properties
    }


@router.get("/{unit_id}/live")
async def get_live_data(unit_id: str) -> Dict:
    """Get raw live data from Modbus/SCADA for a unit."""
    from app.services.unit_manager import get_unit_manager
    from app.services.data_simulator import DataSimulator
    
    manager = get_unit_manager()

    unit = manager.get_unit(unit_id)
    if not unit:
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")
    
    live_data = manager.get_live_data(unit_id)
    
    # Fall back to simulator if no Modbus data available
    if not live_data or len(live_data) < 5:
        simulator = DataSimulator()
        live_data = simulator.generate_snapshot()
        # Update the unit manager with simulated data for consistency
        manager.update_live_data(unit_id, live_data)
    live_data = _normalize_live_keys(live_data)

    return _build_dashboard_payload(unit_id, live_data, unit.stage_count)


@router.get("/{unit_id}/resolved")
async def get_resolved_data(
    unit_id: str,
    db: AsyncSession = Depends(get_db)
) -> Dict:
    """
    Get resolved data with quality indicators.
    Returns values with source (LIVE or MANUAL) for each parameter.
    This is the primary endpoint for the Dashboard.
    """
    from app.services.unit_manager import get_unit_manager
    from app.services.data_resolver import get_data_resolver
    
    manager = get_unit_manager()
    
    if not manager.get_unit(unit_id):
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")
    
    # Get raw live data
    live_data = _normalize_live_keys(manager.get_live_data(unit_id))
    if not live_data:
        live_data = {}
    
    # Resolve through the two-state resolver
    resolver = get_data_resolver()
    parameters = None
    try:
        from app.api.routes.modbus_config import get_modbus_config as load_modbus_config
        modbus_config = await load_modbus_config(unit_id=unit_id, db=db)
        configured_registers = modbus_config.get("registers", []) or []
        configured_names = []

        for reg in configured_registers:
            name = reg.get("name")
            if not isinstance(name, str) or not name.strip():
                continue
            name = name.strip()
            configured_names.append(name)

            mode_raw = reg.get("valueMode", reg.get("value_mode", "LIVE"))
            mode = "MANUAL" if str(mode_raw).upper() == "MANUAL" else "LIVE"
            manual_raw = reg.get("manualValue", reg.get("manual_value"))

            if mode == "MANUAL" and manual_raw not in (None, ""):
                try:
                    resolver.set_manual_value(unit_id, name, float(manual_raw))
                except (TypeError, ValueError):
                    resolver.clear_manual_value(unit_id, name)
            else:
                resolver.clear_manual_value(unit_id, name)

        if configured_names:
            parameters = configured_names
    except Exception:
        # Keep endpoint resilient even if config lookup fails.
        parameters = None

    resolved = resolver.resolve_all(unit_id, live_data, parameters)
    
    return {
        "unit_id": unit_id,
        "timestamp": resolved['timestamp'],
        "sources": resolved['sources'],
        **resolved['values']
    }


@router.post("/{unit_id}/manual")
async def set_manual_override(
    unit_id: str,
    override: ManualOverride,
    current_user: dict = Depends(require_engineer)
) -> Dict:
    """
    Set a manual override for a parameter.
    The override will take precedence over live data.
    """
    from app.services.unit_manager import get_unit_manager
    from app.services.data_resolver import get_data_resolver
    from datetime import timedelta
    
    manager = get_unit_manager()
    
    if not manager.get_unit(unit_id):
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")
    
    resolver = get_data_resolver()
    
    expires_at = None
    if override.expires_minutes:
        expires_at = datetime.now() + timedelta(minutes=override.expires_minutes)
    
    resolver.set_manual_value(unit_id, override.parameter, override.value, expires_at)
    
    return {
        "status": "success",
        "parameter": override.parameter,
        "value": override.value,
        "expires_at": expires_at.isoformat() if expires_at else None
    }


@router.delete("/{unit_id}/manual/{parameter}")
async def clear_manual_override(
    unit_id: str,
    parameter: str,
    current_user: dict = Depends(require_engineer)
) -> Dict:
    """Clear a manual override for a parameter."""
    from app.services.unit_manager import get_unit_manager
    from app.services.data_resolver import get_data_resolver
    
    manager = get_unit_manager()
    
    if not manager.get_unit(unit_id):
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")
    
    resolver = get_data_resolver()
    resolver.clear_manual_value(unit_id, parameter)
    
    return {
        "status": "success",
        "parameter": parameter,
        "message": f"Manual override cleared for {parameter}"
    }


@router.post("/")
async def create_unit(
    unit: UnitCreate,
    current_user: dict = Depends(require_engineer),
    db: AsyncSession = Depends(get_db)
) -> Dict:
    """Register a new compressor unit."""
    from app.services.unit_manager import get_unit_manager, UnitConfig
    
    manager = get_unit_manager()

    existing_db = await crud.get_unit(db, unit.unit_id)
    if existing_db or manager.get_unit(unit.unit_id):
        raise HTTPException(status_code=400, detail=f"Unit {unit.unit_id} already exists")

    await crud.create_unit(
        db,
        unit_id=unit.unit_id,
        name=unit.name,
        description=unit.description,
        location=unit.location,
        is_active=True
    )
    await crud.upsert_equipment_spec(
        db,
        unit.unit_id,
        stage_count=unit.stage_count
    )
    
    config = UnitConfig(
        unit_id=unit.unit_id,
        name=unit.name,
        stage_count=unit.stage_count,
        modbus_host=unit.modbus_host,
        modbus_port=unit.modbus_port,
        modbus_slave_id=unit.modbus_slave_id
    )
    
    manager.register_unit(config)
    
    return {
        "status": "created",
        "unit_id": unit.unit_id,
        "message": f"Unit {unit.unit_id} registered successfully"
    }


@router.delete("/{unit_id}")
async def delete_unit(
    unit_id: str,
    current_user: dict = Depends(require_engineer),
    db: AsyncSession = Depends(get_db)
) -> Dict:
    """Unregister a compressor unit."""
    from app.services.unit_manager import get_unit_manager
    
    manager = get_unit_manager()
    
    db_unit = await crud.get_unit(db, unit_id)
    if not db_unit and not manager.get_unit(unit_id):
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")
    
    if db_unit:
        # Soft-delete pattern for safety with FK-linked config rows.
        await crud.update_unit(db, unit_id, is_active=False)
    manager.unregister_unit(unit_id)
    
    return {
        "status": "deleted",
        "unit_id": unit_id
    }


@router.get("/{unit_id}/physics")
async def get_unit_physics(unit_id: str) -> Dict:
    """Get extended physics calculations for a unit."""
    from app.services.unit_manager import get_unit_manager
    
    manager = get_unit_manager()
    
    if not manager.get_unit(unit_id):
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")
    
    results = manager.get_physics_results(unit_id)
    
    return {
        "unit_id": unit_id,
        "timestamp": datetime.now().isoformat(),
        "physics": results
    }


@router.get("/{unit_id}/summary")
async def get_unit_summary(unit_id: str) -> Dict:
    """Get quick summary of unit status."""
    from app.services.unit_manager import get_unit_manager
    from app.services.alarm_engine import get_alarm_engine
    
    manager = get_unit_manager()
    unit = manager.get_unit(unit_id)
    
    if not unit:
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")
    
    live_data = manager.get_live_data(unit_id)
    alarm_engine = get_alarm_engine()
    
    return {
        "unit_id": unit_id,
        "name": unit.name,
        "is_active": unit.is_active,
        "stage_count": unit.stage_count,
        "has_modbus": unit.modbus_host is not None,
        "engine_rpm": live_data.get("engine_rpm", 0),
        "active_alarms": len(alarm_engine.active_alarms),
        "shutdown_active": alarm_engine.get_shutdown_active(),
        "timestamp": datetime.now().isoformat()
    }
