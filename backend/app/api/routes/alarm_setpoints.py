"""
Alarm Setpoints API - Configure alarm thresholds
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional, Dict
from pydantic import BaseModel
from datetime import datetime

from app.db.database import get_db
from app.db.models import AlarmSetpoint as AlarmSetpointModel
from app.db import crud
from app.services.alarm_engine import get_alarm_engine, AlarmSetpoint
from ..routes.auth import require_engineer

router = APIRouter(prefix="/api/alarms/setpoints", tags=["Alarm Configuration"])


async def _ensure_unit_exists(db: AsyncSession, unit_id: str):
    unit = await crud.get_unit(db, unit_id)
    if unit:
        return unit
    return await crud.create_unit(
        db,
        unit_id=unit_id,
        name=f"Compressor {unit_id}",
        description="Auto-created from alarm configuration workflow"
    )


class AlarmSetpointCreate(BaseModel):
    parameter: str
    ll_value: Optional[float] = None
    l_value: Optional[float] = None
    h_value: Optional[float] = None
    hh_value: Optional[float] = None
    delay_seconds: int = 5
    is_shutdown: bool = False
    enabled: bool = True
    description: Optional[str] = None


class AlarmSetpointUpdate(BaseModel):
    ll_value: Optional[float] = None
    l_value: Optional[float] = None
    h_value: Optional[float] = None
    hh_value: Optional[float] = None
    delay_seconds: Optional[int] = None
    is_shutdown: Optional[bool] = None
    enabled: Optional[bool] = None
    description: Optional[str] = None


@router.get("/")
async def list_alarm_setpoints(
    unit_id: str = "GCS-001",
    db: AsyncSession = Depends(get_db)
) -> Dict:
    """Get all alarm setpoints for a unit."""
    result = await db.execute(
        select(AlarmSetpointModel).where(AlarmSetpointModel.unit_id == unit_id)
    )
    setpoints = result.scalars().all()
    
    return {
        "unit_id": unit_id,
        "setpoints": [
            {
                "id": s.id,
                "parameter": s.parameter,
                "ll_value": s.ll_value,
                "l_value": s.l_value,
                "h_value": s.h_value,
                "hh_value": s.hh_value,
                "delay_seconds": s.delay_seconds,
                "is_shutdown": s.is_shutdown,
                "enabled": s.is_enabled,
                "description": s.description
            }
            for s in setpoints
        ],
        "count": len(setpoints)
    }


@router.post("/")
async def create_alarm_setpoint(
    setpoint: AlarmSetpointCreate,
    unit_id: str = "GCS-001",
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_engineer)
) -> Dict:
    """Create a new alarm setpoint."""
    await _ensure_unit_exists(db, unit_id)
    new_setpoint = AlarmSetpointModel(
        unit_id=unit_id,
        parameter=setpoint.parameter,
        ll_value=setpoint.ll_value,
        l_value=setpoint.l_value,
        h_value=setpoint.h_value,
        hh_value=setpoint.hh_value,
        delay_seconds=setpoint.delay_seconds,
        is_shutdown=setpoint.is_shutdown,
        is_enabled=setpoint.enabled,
        description=setpoint.description
    )
    
    db.add(new_setpoint)
    await db.commit()
    await db.refresh(new_setpoint)
    
    # Reload alarm engine
    await _reload_alarm_engine(unit_id, db)
    
    return {
        "status": "created",
        "id": new_setpoint.id,
        "parameter": new_setpoint.parameter
    }


@router.put("/{setpoint_id}")
async def update_alarm_setpoint(
    setpoint_id: int,
    updates: AlarmSetpointUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_engineer)
) -> Dict:
    """Update an existing alarm setpoint."""
    result = await db.execute(
        select(AlarmSetpointModel).where(AlarmSetpointModel.id == setpoint_id)
    )
    setpoint = result.scalar_one_or_none()
    
    if not setpoint:
        raise HTTPException(status_code=404, detail="Setpoint not found")
    
    for field, value in updates.dict(exclude_unset=True).items():
        target_field = "is_enabled" if field == "enabled" else field
        setattr(setpoint, target_field, value)
    
    await db.commit()
    
    # Reload alarm engine
    await _reload_alarm_engine(setpoint.unit_id, db)
    
    return {"status": "updated", "id": setpoint_id}


@router.delete("/{setpoint_id}")
async def delete_alarm_setpoint(
    setpoint_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_engineer)
) -> Dict:
    """Delete an alarm setpoint."""
    result = await db.execute(
        select(AlarmSetpointModel).where(AlarmSetpointModel.id == setpoint_id)
    )
    setpoint = result.scalar_one_or_none()
    
    if not setpoint:
        raise HTTPException(status_code=404, detail="Setpoint not found")
    
    unit_id = setpoint.unit_id
    await db.delete(setpoint)
    await db.commit()
    
    # Reload alarm engine
    await _reload_alarm_engine(unit_id, db)
    
    return {"status": "deleted", "id": setpoint_id}


@router.post("/reload")
async def reload_alarm_engine(
    unit_id: str = "GCS-001",
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_engineer)
) -> Dict:
    """Manually trigger an alarm engine reload."""
    await _reload_alarm_engine(unit_id, db)
    return {"status": "reloaded", "unit_id": unit_id}


async def _reload_alarm_engine(unit_id: str, db: AsyncSession):
    """Internal function to reload the alarm engine configuration."""
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        # Fetch all setpoints from database
        result = await db.execute(
            select(AlarmSetpointModel).where(
                AlarmSetpointModel.unit_id == unit_id,
                AlarmSetpointModel.is_enabled == True
            )
        )
        db_setpoints = result.scalars().all()
        
        # Convert to AlarmSetpoint objects
        setpoints = [
            AlarmSetpoint(
                parameter=s.parameter,
                ll_value=s.ll_value,
                l_value=s.l_value,
                h_value=s.h_value,
                hh_value=s.hh_value,
                delay_seconds=s.delay_seconds,
                is_shutdown=s.is_shutdown
            )
            for s in db_setpoints
        ]
        
        # Load into alarm engine
        alarm_engine = get_alarm_engine()
        alarm_engine.load_setpoints(setpoints)
        
        logger.info(f"Reloaded alarm engine with {len(setpoints)} setpoints for {unit_id}")
    except Exception as e:
        logger.warning(f"Failed to reload alarm engine: {e}")
