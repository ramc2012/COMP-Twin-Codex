"""
Configuration API Routes - Database Persistence Enabled
Equipment specs, register mapping, alarm setpoints, gas properties.
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional, Dict, Any
import logging

from app.db.database import get_db
from app.db import crud, models
from app.api.routes.auth import require_engineer, get_current_user
from app.services.modbus_poller import get_modbus_poller
from app.services.unit_manager import get_unit_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/config", tags=["Configuration"])


async def ensure_unit_exists(db: AsyncSession, unit_id: str):
    """Create a unit row on-demand so per-unit config writes do not fail on FK constraints."""
    unit = await crud.get_unit(db, unit_id)
    if unit:
        return unit
    return await crud.create_unit(
        db,
        unit_id=unit_id,
        name=f"Compressor {unit_id}",
        description="Auto-created from configuration workflow"
    )

# ============ Pydantic Models for Request/Response ============

from pydantic import BaseModel

class EquipmentSpecModel(BaseModel):
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    num_stages: Optional[int] = 3
    rated_speed_rpm: Optional[float] = 1200
    rated_bhp: Optional[float] = 1500
    compressor_type: Optional[str] = "Reciprocating"
    frame_rating_hp: Optional[float] = None
    max_rod_load: Optional[float] = None
    
    # Engine specific
    engine_manufacturer: Optional[str] = None
    engine_model: Optional[str] = None
    fuel_type: Optional[str] = None
    engine_cylinders: Optional[int] = None
    engine_rated_bhp: Optional[float] = None
    engine_rated_rpm: Optional[float] = None
    
    # Nested stages (optional, specialized handling might be needed)
    stages: Optional[List[Dict]] = None

class StageConfigModel(BaseModel):
    stage_num: int
    cylinders: int = 1
    bore_diameter: float
    stroke_length: float
    rod_diameter: float
    clearance_he: float
    clearance_ce: float
    design_suction_pressure: float
    design_discharge_pressure: float
    design_suction_temp: float
    suction_press_source: Optional[str] = None
    discharge_press_source: Optional[str] = None
    suction_temp_source: Optional[str] = None
    discharge_temp_source: Optional[str] = None

class AlarmSetpointModel(BaseModel):
    parameter: str
    ll_value: Optional[float] = None
    l_value: Optional[float] = None
    h_value: Optional[float] = None
    hh_value: Optional[float] = None
    deadband: float = 0
    delay_seconds: int = 0
    is_shutdown: bool = False
    is_enabled: bool = True

class GasPropertiesModel(BaseModel):
    name: str = "Natural Gas"
    specific_gravity: float = 0.65
    k_suction: float = 1.28
    k_discharge: float = 1.25
    z_suction: float = 0.98
    z_discharge: float = 0.95

# ============ Equipment Routes ============

@router.get("/equipment/{unit_id}")
async def get_equipment_spec(unit_id: str, db: AsyncSession = Depends(get_db)):
    """Get equipment specification and stages for a unit."""
    spec = await crud.get_equipment_spec(db, unit_id)
    stages = await crud.get_stage_configs(db, unit_id)
    
    if not spec:
        # Return defaults so each package can start with independent settings.
        return {"compressor": {}, "engine": {}, "stages": []}

    # Format for frontend
    response = {
        "compressor": {
            "manufacturer": spec.compressor_manufacturer,
            "model": spec.compressor_model,
            "serialNumber": spec.compressor_serial,
            "numStages": spec.stage_count,
            "compressorType": spec.frame_type or "Reciprocating",
            "frameRatingHP": spec.rated_hp,
            "maxRodLoad": spec.max_rod_load_lb,
            "stages": [
                {
                    "cylinders": 2,
                    "action": "double_acting", # assumed default
                    "boreDiameter": s.bore_inches,
                    "strokeLength": s.stroke_inches,
                    "rodDiameter": s.rod_diameter_inches,
                    "clearanceHE": s.clearance_pct_he,
                    "clearanceCE": s.clearance_pct_ce,
                    "designSuctionPressure": s.design_p_suction_psig,
                    "designDischargePressure": s.design_p_discharge_psig,
                    "designSuctionTemp": s.design_t_suction_f,
                    "suctionPressSource": s.suction_pressure_source,
                    "dischargePressSource": s.discharge_pressure_source,
                    "suctionTempSource": s.suction_temp_source,
                    "dischargeTempSource": s.discharge_temp_source
                } for s in stages
            ]
        },
        "engine": {
            "manufacturer": spec.engine_manufacturer,
            "model": spec.engine_model,
            "fuelType": "Natural Gas",
            "numCylinders": spec.engine_cylinders,
            "ratedBHP": spec.rated_hp,
            "ratedRPM": spec.rated_speed_rpm
        }
    }
    return response

@router.put("/equipment/{unit_id}")
async def update_equipment_spec(
    unit_id: str, 
    config: Dict[str, Any], 
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_engineer)
):
    """Update equipment spec and stages."""
    await ensure_unit_exists(db, unit_id)
    
    # Update Spec
    comp = config.get("compressor", {})
    eng = config.get("engine", {})
    
    await crud.upsert_equipment_spec(
        db, unit_id,
        compressor_manufacturer=comp.get("manufacturer"),
        compressor_model=comp.get("model"),
        compressor_serial=comp.get("serialNumber"),
        stage_count=comp.get("numStages"),
        frame_type=comp.get("compressorType"),
        max_rod_load_lb=comp.get("maxRodLoad"),
        rated_speed_rpm=eng.get("ratedRPM"),
        rated_hp=eng.get("ratedBHP"),
        engine_manufacturer=eng.get("manufacturer"),
        engine_model=eng.get("model"),
        engine_cylinders=eng.get("numCylinders"),
        engine_serial=eng.get("serialNumber")
    )
    
    # Update Stages
    stages = comp.get("stages", [])
    for i, stage in enumerate(stages):
        # stage_num is 1-based usually
        stage_num = i + 1
        await crud.upsert_stage_config(
            db, unit_id, stage_num,
            bore_inches=stage.get("boreDiameter"),
            stroke_inches=stage.get("strokeLength"),
            rod_diameter_inches=stage.get("rodDiameter"),
            clearance_pct_he=stage.get("clearanceHE"),
            clearance_pct_ce=stage.get("clearanceCE"),
            design_p_suction_psig=stage.get("designSuctionPressure"),
            design_p_discharge_psig=stage.get("designDischargePressure"),
            design_t_suction_f=stage.get("designSuctionTemp"),
            suction_pressure_source=stage.get("suctionPressSource"),
            discharge_pressure_source=stage.get("dischargePressSource"),
            suction_temp_source=stage.get("suctionTempSource"),
            discharge_temp_source=stage.get("dischargeTempSource")
        )
    
    # Reload unit manager to pick up changes live
    um = get_unit_manager()
    await um.load_unit_config(unit_id) # Should implement this or restart recommended
    
    return {"status": "updated", "unit_id": unit_id}

# ============ Alarm Routes ============

@router.get("/alarms/{unit_id}/setpoints")
async def get_alarm_setpoints(unit_id: str, db: AsyncSession = Depends(get_db)):
    """Get all alarm setpoints."""
    return await crud.get_alarm_setpoints(db, unit_id)

@router.post("/alarms/{unit_id}/setpoints")
async def update_alarm_setpoint(
    unit_id: str, 
    setpoint: AlarmSetpointModel, 
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_engineer)
):
    """Create or update alarm setpoint."""
    await ensure_unit_exists(db, unit_id)
    await crud.upsert_alarm_setpoint(
        db, unit_id, setpoint.parameter,
        ll_value=setpoint.ll_value,
        l_value=setpoint.l_value,
        h_value=setpoint.h_value,
        hh_value=setpoint.hh_value,
        deadband=setpoint.deadband,
        delay_seconds=setpoint.delay_seconds,
        is_shutdown=setpoint.is_shutdown,
        is_enabled=setpoint.is_enabled
    )
    
    # Reload alarm engine
    from app.services.alarm_engine import get_alarm_engine, AlarmSetpoint as EngineSetpoint
    engine = get_alarm_engine()
    engine.update_setpoint(EngineSetpoint(
        setpoint.parameter, 
        setpoint.l_value, setpoint.ll_value, 
        setpoint.h_value, setpoint.hh_value, 
        setpoint.deadband, setpoint.delay_seconds, 
        setpoint.is_shutdown, setpoint.is_enabled
    ))
    
    return {"status": "updated", "parameter": setpoint.parameter}

# ============ Gas Routes ============

class GasPropsRequest(BaseModel):
    name: str = "Natural Gas"
    specific_gravity: float = 0.65
    k_suction: float = 1.28
    k_discharge: float = 1.25
    z_suction: float = 0.98
    z_discharge: float = 0.95

@router.get("/gas/{unit_id}")
async def get_gas_config(unit_id: str, db: AsyncSession = Depends(get_db)):
    props = await crud.get_gas_properties(db, unit_id)
    if not props:
        return GasPropsRequest()
    return {
        "name": props.gas_name,
        "specific_gravity": props.specific_gravity,
        "k_suction": props.k_suction,
        "k_discharge": props.k_discharge,
        "z_suction": props.z_suction,
        "z_discharge": props.z_discharge
    }

@router.put("/gas/{unit_id}")
async def update_gas_config(
    unit_id: str, 
    props: GasPropsRequest, 
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_engineer)
):
    await ensure_unit_exists(db, unit_id)
    await crud.upsert_gas_properties(
        db, unit_id,
        gas_name=props.name,
        specific_gravity=props.specific_gravity,
        k_suction=props.k_suction,
        k_discharge=props.k_discharge,
        z_suction=props.z_suction,
        z_discharge=props.z_discharge
    )
    return {"status": "updated"}
