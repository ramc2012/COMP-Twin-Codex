"""Dashboard API routes - Live data endpoints"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from typing import List, Dict
import asyncio
import logging
from datetime import datetime

from ...services.modbus_poller import get_modbus_poller
from ...services.physics_engine import PhysicsEngine, StageInput
from ...core.constants import ENGINE_STATES
from ...config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/units", tags=["dashboard"])

# Store connected WebSocket clients
connected_clients: List[WebSocket] = []
LIVE_STALE_SECONDS = 5.0


@router.get("/{unit_id}/live")
async def get_live_data(unit_id: str) -> Dict:
    """
    Get current live data snapshot for the unit.
    Includes sensor values and calculated physics.
    """
    settings = get_settings()
    from app.services.unit_manager import get_unit_manager

    manager = get_unit_manager()
    if not manager.get_unit(unit_id):
        await manager.load_unit_config(unit_id)
    unit = manager.get_unit(unit_id)
    if not unit:
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")

    data = manager.get_live_data(unit_id) or {}

    # GCS-001 is polled from Modbus; keep manager cache in sync for all package-aware routes.
    if settings.MODBUS_ENABLED and unit_id == "GCS-001":
        poller_data = get_modbus_poller().get_data()
        if poller_data:
            data = poller_data
            manager.update_live_data(unit_id, poller_data)

    if not data or len(data) < 5:
        raise HTTPException(status_code=503, detail=f"No live data available for {unit_id}")

    age_seconds = manager.get_live_data_age_seconds(unit_id)
    if age_seconds is None or age_seconds > LIVE_STALE_SECONDS:
        raise HTTPException(
            status_code=503,
            detail=f"Live data stale for {unit_id} (age={age_seconds if age_seconds is not None else 'unknown'}s)"
        )

    # Basic defaults with alias support to prevent crash if data missing
    def get_val(*keys: str, default=0.0):
        for key in keys:
            if key in data and data.get(key) is not None:
                return data.get(key)
        return default

    # Run physics calculations
    physics = PhysicsEngine()
    
    default_stage_values = {
        1: (85.0, 330.0, 80.0, 285.0),
        2: (320.0, 510.0, 270.0, 360.0),
        3: (505.0, 1050.0, 345.0, 520.0),
    }
    stages = []
    overall_ratio = 1.0
    for i in range(1, max(1, unit.stage_count) + 1):
        d_suction, d_discharge, d_suction_t, d_discharge_t = default_stage_values.get(i, (50.0, 200.0, 80.0, 200.0))
        suction = float(get_val(f"stg{i}_suction_pressure", f"stg{i}_suction_press", default=d_suction))
        discharge = float(get_val(f"stg{i}_discharge_pressure", f"stg{i}_discharge_press", default=d_discharge))
        suction_t = float(get_val(f"stg{i}_suction_temp", default=d_suction_t))
        discharge_t = float(get_val(f"stg{i}_discharge_temp", default=d_discharge_t))

        calc = physics.calculate_stage(StageInput(
            suction_pressure_psig=suction,
            discharge_pressure_psig=discharge,
            suction_temp_f=suction_t,
            discharge_temp_f=discharge_t
        ))
        overall_ratio *= max(calc.compression_ratio, 1e-6)
        stages.append({
            "stage": i,
            "suction_press": suction,
            "discharge_press": discharge,
            "suction_temp": suction_t,
            "discharge_temp": discharge_t,
            "ratio": calc.compression_ratio,
            "isentropic_eff": calc.isentropic_efficiency,
            "volumetric_eff": calc.volumetric_efficiency,
            "ideal_temp": calc.isentropic_temp_f
        })
    
    # Engine state
    state_code = int(get_val("engine_state", default=8))
    
    return {
        "unit_id": unit_id,
        "timestamp": datetime.now().isoformat(),
        
        # Engine state
        "engine_state": state_code,
        "engine_state_label": ENGINE_STATES.get(state_code, "UNKNOWN"),
        "hour_meter": float(get_val("hour_meter", default=get_val("hour_meter_low", default=145230) / 10.0)),
        "fault_code": int(get_val("fault_code", default=255)),
        
        # Engine vitals
        "engine_rpm": get_val("engine_rpm", "Engine RPM", default=0),
        "engine_oil_press": get_val("engine_oil_press", "engine_oil_pressure", "Engine Lube Oil Pressure", default=0),
        "engine_oil_temp": get_val("engine_oil_temp", "ENGINE OIL TEMP", default=0),
        "jacket_water_temp": get_val("jacket_water_temp", "ENGINE JACKET WATER TEMP", default=0),
        
        # Compressor vitals
        "comp_oil_press": get_val("comp_oil_press", "comp_oil_pressure", "Compressor Lube Oil Pressure", default=0),
        "comp_oil_temp": get_val("comp_oil_temp", "COMPRESSOR OIL TEMP", default=0),
        
        # Stages with physics
        "stages": stages,
        
        # Overall metrics
        "overall_ratio": round(overall_ratio, 2),
        "total_bhp": round(float(get_val("total_bhp", default=(float(get_val("engine_rpm", default=0)) / 1000.0) * 1247.5)), 1),
        
        # Cylinder temps (placeholders)
        "cylinder_temps": [0, 0, 0, 0],
        
        # Exhaust
        "exhaust_temps": {
            "cyl1_left": get_val("exh_cyl1_left", 0),
            "cyl1_right": get_val("exh_cyl1_right", 0),
            "cyl2_left": get_val("exh_cyl2_left", 0),
            "cyl2_right": get_val("exh_cyl2_right", 0),
            "cyl3_left": get_val("exh_cyl3_left", 0),
            "cyl3_right": get_val("exh_cyl3_right", 0),
            "cyl4_left": get_val("exh_cyl4_left", 0),
            "cyl4_right": get_val("exh_cyl4_right", 0),
            "cyl5_left": get_val("exh_cyl5_left", 0), 
            "cyl5_right": get_val("exh_cyl5_right", 0),
            "cyl6_left": get_val("exh_cyl6_left", 0),
            "cyl6_right": get_val("exh_cyl6_right", 0),
        },
        "exhaust_spread": 0,
        "exhaust_avg": 0,
        "pre_turbo_left": get_val("pre_turbo_left", 0),
        "pre_turbo_right": get_val("pre_turbo_right", 0),
        "post_turbo_left": get_val("post_turbo_left", 0),
        "post_turbo_right": get_val("post_turbo_right", 0),
        
        # Bearings
        "bearing_temps": [
            get_val("main_bearing_1", 0),
            get_val("main_bearing_2", 0),
            get_val("main_bearing_3", 0),
            get_val("main_bearing_4", 0),
            get_val("main_bearing_5", 0),
            get_val("main_bearing_6", 0),
            get_val("main_bearing_7", 0),
            get_val("main_bearing_8", 0),
            get_val("main_bearing_9", 0),
        ],
        
        # Gas detectors
        "gas_detector_comp": get_val("gas_detector_compressor", 0),
        "gas_detector_engine": get_val("gas_detector_engine", 0),
        
        # Control outputs
        "suction_valve_pct": get_val("suction_valve_pct", "suction_valve_position", default=0),
        "speed_control_pct": get_val("speed_control_pct", "speed_control_output", default=0),
        "recycle_valve_pct": get_val("recycle_valve_pct", "recycle_valve_position", default=0),
        
        # Active alarms
        "active_alarms": []
    }


@router.get("/{unit_id}/state")
async def get_engine_state(unit_id: str) -> Dict:
    """Get engine state and hour meter"""
    settings = get_settings()
    data = {}
    if settings.MODBUS_ENABLED:
        poller = get_modbus_poller()
        data = poller.get_data()
        
    state = int(data.get("engine_state", 0))
    
    return {
        "unit_id": unit_id,
        "state": state,
        "state_label": ENGINE_STATES.get(state, "UNKNOWN"),
        "hour_meter": data.get("hour_meter_low", 0) / 10.0,
        "fault_code": int(data.get("fault_code", 255))
    }


@router.websocket("/ws/{unit_id}")
async def websocket_endpoint(websocket: WebSocket, unit_id: str):
    """
    WebSocket endpoint for real-time data streaming.
    Sends live data snapshot every second.
    """
    await websocket.accept()
    connected_clients.append(websocket)
    
    try:
        while True:
            try:
                data = await get_live_data(unit_id)
                await websocket.send_json({
                    "type": "LIVE_DATA",
                    "unit_id": unit_id,
                    "data": data
                })
            except HTTPException as e:
                await websocket.send_json({
                    "type": "LIVE_DATA",
                    "unit_id": unit_id,
                    "data": None,
                    "error": e.detail
                })
            
            # Wait 1 second
            await asyncio.sleep(1)
            
    except WebSocketDisconnect:
        connected_clients.remove(websocket)
    except Exception as e:
        if websocket in connected_clients:
            connected_clients.remove(websocket)
        logger.error(f"WebSocket error: {e}")
