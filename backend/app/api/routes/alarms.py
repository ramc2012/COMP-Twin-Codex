"""
Alarm API routes.
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Optional
from pydantic import BaseModel
from datetime import datetime

from ...services.alarm_engine import get_alarm_engine, AlarmSetpoint
from ..routes.auth import get_current_user, require_engineer

router = APIRouter(prefix="/api/units", tags=["alarms"])


class AlarmSetpointRequest(BaseModel):
    parameter: str
    ll_value: Optional[float] = None
    l_value: Optional[float] = None
    h_value: Optional[float] = None
    hh_value: Optional[float] = None
    deadband: float = 1.0
    delay_seconds: int = 5
    is_shutdown: bool = False
    is_latching: bool = False
    is_enabled: bool = True


class AcknowledgeRequest(BaseModel):
    alarm_key: str  # e.g. "stg1_discharge_temp:HH"


@router.get("/{unit_id}/alarms/active")
async def get_active_alarms(unit_id: str, current_user: dict = Depends(get_current_user)) -> Dict:
    """Get all currently active alarms for a unit."""
    engine = get_alarm_engine()
    
    return {
        "unit_id": unit_id,
        "timestamp": datetime.now().isoformat(),
        "active_alarms": engine.get_active_alarms(),
        "pending_count": engine.get_pending_count(),
        "shutdown_active": engine.get_shutdown_active(),
        "total_active": len(engine.active_alarms)
    }


@router.post("/{unit_id}/alarms/acknowledge")
async def acknowledge_alarm(
    unit_id: str, 
    request: AcknowledgeRequest,
    current_user: dict = Depends(get_current_user)
) -> Dict:
    """Acknowledge an active alarm."""
    engine = get_alarm_engine()
    
    success = engine.acknowledge(request.alarm_key, current_user.get("username", "unknown"))
    
    if not success:
        raise HTTPException(status_code=404, detail=f"Alarm {request.alarm_key} not found")
    
    return {
        "status": "acknowledged",
        "alarm_key": request.alarm_key,
        "acknowledged_by": current_user.get("username"),
        "acknowledged_at": datetime.now().isoformat()
    }


@router.get("/{unit_id}/alarms/setpoints")
async def get_alarm_setpoints(unit_id: str, current_user: dict = Depends(get_current_user)) -> Dict:
    """Get configured alarm setpoints for a unit."""
    engine = get_alarm_engine()
    
    setpoints = [
        {
            "parameter": sp.parameter,
            "ll_value": sp.ll_value,
            "l_value": sp.l_value,
            "h_value": sp.h_value,
            "hh_value": sp.hh_value,
            "deadband": sp.deadband,
            "delay_seconds": sp.delay_seconds,
            "is_shutdown": sp.is_shutdown,
            "is_latching": sp.is_latching,
            "is_enabled": sp.is_enabled
        }
        for sp in engine.setpoints.values()
    ]
    
    return {
        "unit_id": unit_id,
        "setpoints": setpoints,
        "count": len(setpoints)
    }


@router.post("/{unit_id}/alarms/setpoints")
async def update_alarm_setpoint(
    unit_id: str,
    request: AlarmSetpointRequest,
    current_user: dict = Depends(require_engineer)
) -> Dict:
    """Create or update an alarm setpoint."""
    engine = get_alarm_engine()
    
    setpoint = AlarmSetpoint(
        parameter=request.parameter,
        ll_value=request.ll_value,
        l_value=request.l_value,
        h_value=request.h_value,
        hh_value=request.hh_value,
        deadband=request.deadband,
        delay_seconds=request.delay_seconds,
        is_shutdown=request.is_shutdown,
        is_latching=request.is_latching,
        is_enabled=request.is_enabled
    )
    
    engine.add_setpoint(setpoint)
    
    return {
        "status": "updated",
        "parameter": request.parameter,
        "setpoint": {
            "ll": request.ll_value,
            "l": request.l_value,
            "h": request.h_value,
            "hh": request.hh_value
        }
    }


@router.get("/{unit_id}/alarms/summary")
async def get_alarm_summary(unit_id: str) -> Dict:
    """Get alarm summary (no auth required for dashboard display)."""
    engine = get_alarm_engine()
    
    active = engine.get_active_alarms()
    
    # Group by level
    by_level = {"LL": 0, "L": 0, "H": 0, "HH": 0}
    for alarm in active:
        by_level[alarm["level"]] = by_level.get(alarm["level"], 0) + 1
    
    # Get most critical
    critical = [a for a in active if a["is_shutdown"]]
    
    return {
        "unit_id": unit_id,
        "timestamp": datetime.now().isoformat(),
        "total_active": len(active),
        "by_level": by_level,
        "shutdown_active": len(critical) > 0,
        "critical_alarms": critical,
        "most_recent": active[0] if active else None
    }
