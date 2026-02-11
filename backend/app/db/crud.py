"""
CRUD operations for configuration models.
"""
from typing import List, Optional, Dict, Any
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
import logging

from .models import (
    Unit, EquipmentSpec, StageConfig, RegisterMapping,
    AlarmSetpoint, GasProperty, User, AlarmHistory
)

logger = logging.getLogger(__name__)


# ============ UNIT CRUD ============

async def get_units(db: AsyncSession) -> List[Unit]:
    """Get all units."""
    result = await db.execute(
        select(Unit).options(
            selectinload(Unit.equipment_spec),
            selectinload(Unit.stages)
        ).order_by(Unit.unit_id)
    )
    return result.scalars().all()


async def get_unit(db: AsyncSession, unit_id: str) -> Optional[Unit]:
    """Get a single unit with all related data."""
    result = await db.execute(
        select(Unit).options(
            selectinload(Unit.equipment_spec),
            selectinload(Unit.stages),
            selectinload(Unit.gas_properties),
            selectinload(Unit.alarms),
            selectinload(Unit.registers)
        ).where(Unit.unit_id == unit_id)
    )
    return result.scalar_one_or_none()


async def create_unit(db: AsyncSession, unit_id: str, name: str, **kwargs) -> Unit:
    """Create a new unit."""
    unit = Unit(unit_id=unit_id, name=name, **kwargs)
    db.add(unit)
    await db.commit()
    await db.refresh(unit)
    return unit


async def update_unit(db: AsyncSession, unit_id: str, **kwargs) -> Optional[Unit]:
    """Update a unit."""
    await db.execute(
        update(Unit).where(Unit.unit_id == unit_id).values(**kwargs)
    )
    await db.commit()
    return await get_unit(db, unit_id)


async def delete_unit(db: AsyncSession, unit_id: str) -> bool:
    """Delete a unit row."""
    result = await db.execute(delete(Unit).where(Unit.unit_id == unit_id))
    await db.commit()
    return result.rowcount > 0


# ============ EQUIPMENT SPEC CRUD ============

async def get_equipment_spec(db: AsyncSession, unit_id: str) -> Optional[EquipmentSpec]:
    """Get equipment spec for a unit."""
    result = await db.execute(
        select(EquipmentSpec).where(EquipmentSpec.unit_id == unit_id)
    )
    return result.scalar_one_or_none()


async def upsert_equipment_spec(db: AsyncSession, unit_id: str, **kwargs) -> EquipmentSpec:
    """Create or update equipment spec."""
    existing = await get_equipment_spec(db, unit_id)
    if existing:
        for key, value in kwargs.items():
            setattr(existing, key, value)
        await db.commit()
        await db.refresh(existing)
        return existing
    else:
        spec = EquipmentSpec(unit_id=unit_id, **kwargs)
        db.add(spec)
        await db.commit()
        await db.refresh(spec)
        return spec


# ============ STAGE CONFIG CRUD ============

async def get_stage_configs(db: AsyncSession, unit_id: str) -> List[StageConfig]:
    """Get all stage configs for a unit."""
    result = await db.execute(
        select(StageConfig)
        .where(StageConfig.unit_id == unit_id)
        .order_by(StageConfig.stage_num)
    )
    return result.scalars().all()


async def get_stage_config(db: AsyncSession, unit_id: str, stage_num: int) -> Optional[StageConfig]:
    """Get a specific stage config."""
    result = await db.execute(
        select(StageConfig).where(
            StageConfig.unit_id == unit_id,
            StageConfig.stage_num == stage_num
        )
    )
    return result.scalar_one_or_none()


async def upsert_stage_config(db: AsyncSession, unit_id: str, stage_num: int, **kwargs) -> StageConfig:
    """Create or update stage config."""
    existing = await get_stage_config(db, unit_id, stage_num)
    if existing:
        for key, value in kwargs.items():
            setattr(existing, key, value)
        await db.commit()
        await db.refresh(existing)
        return existing
    else:
        stage = StageConfig(unit_id=unit_id, stage_num=stage_num, **kwargs)
        db.add(stage)
        await db.commit()
        await db.refresh(stage)
        return stage


# ============ REGISTER MAPPING CRUD ============

async def get_register_mappings(db: AsyncSession, unit_id: str, category: str = None) -> List[RegisterMapping]:
    """Get register mappings for a unit, optionally filtered by category."""
    query = select(RegisterMapping).where(RegisterMapping.unit_id == unit_id)
    if category:
        query = query.where(RegisterMapping.category == category)
    query = query.order_by(RegisterMapping.address)
    result = await db.execute(query)
    return result.scalars().all()


async def create_register_mapping(db: AsyncSession, unit_id: str, **kwargs) -> RegisterMapping:
    """Create a new register mapping."""
    reg = RegisterMapping(unit_id=unit_id, **kwargs)
    db.add(reg)
    await db.commit()
    await db.refresh(reg)
    return reg


async def update_register_mapping(db: AsyncSession, reg_id: int, **kwargs) -> Optional[RegisterMapping]:
    """Update a register mapping."""
    await db.execute(
        update(RegisterMapping).where(RegisterMapping.id == reg_id).values(**kwargs)
    )
    await db.commit()
    result = await db.execute(select(RegisterMapping).where(RegisterMapping.id == reg_id))
    return result.scalar_one_or_none()


async def delete_register_mapping(db: AsyncSession, reg_id: int) -> bool:
    """Delete a register mapping."""
    await db.execute(delete(RegisterMapping).where(RegisterMapping.id == reg_id))
    await db.commit()
    return True


async def bulk_create_registers(db: AsyncSession, unit_id: str, registers: List[Dict]) -> int:
    """Bulk create register mappings."""
    count = 0
    for reg in registers:
        db.add(RegisterMapping(unit_id=unit_id, **reg))
        count += 1
    await db.commit()
    return count


# ============ ALARM SETPOINT CRUD ============

async def get_alarm_setpoints(db: AsyncSession, unit_id: str) -> List[AlarmSetpoint]:
    """Get all alarm setpoints for a unit."""
    result = await db.execute(
        select(AlarmSetpoint)
        .where(AlarmSetpoint.unit_id == unit_id)
        .order_by(AlarmSetpoint.parameter)
    )
    return result.scalars().all()


async def upsert_alarm_setpoint(db: AsyncSession, unit_id: str, parameter: str, **kwargs) -> AlarmSetpoint:
    """Create or update alarm setpoint."""
    result = await db.execute(
        select(AlarmSetpoint).where(
            AlarmSetpoint.unit_id == unit_id,
            AlarmSetpoint.parameter == parameter
        )
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        for key, value in kwargs.items():
            setattr(existing, key, value)
        await db.commit()
        await db.refresh(existing)
        return existing
    else:
        alarm = AlarmSetpoint(unit_id=unit_id, parameter=parameter, **kwargs)
        db.add(alarm)
        await db.commit()
        await db.refresh(alarm)
        return alarm


# ============ GAS PROPERTY CRUD ============

async def get_gas_properties(db: AsyncSession, unit_id: str) -> Optional[GasProperty]:
    """Get gas properties for a unit."""
    result = await db.execute(
        select(GasProperty).where(GasProperty.unit_id == unit_id)
    )
    return result.scalar_one_or_none()


async def upsert_gas_properties(db: AsyncSession, unit_id: str, **kwargs) -> GasProperty:
    """Create or update gas properties."""
    existing = await get_gas_properties(db, unit_id)
    if existing:
        for key, value in kwargs.items():
            setattr(existing, key, value)
        await db.commit()
        await db.refresh(existing)
        return existing
    else:
        gas = GasProperty(unit_id=unit_id, **kwargs)
        db.add(gas)
        await db.commit()
        await db.refresh(gas)
        return gas


# ============ USER CRUD ============

async def get_user_by_username(db: AsyncSession, username: str) -> Optional[User]:
    """Get user by username."""
    result = await db.execute(
        select(User).where(User.username == username)
    )
    return result.scalar_one_or_none()


async def get_users(db: AsyncSession) -> List[User]:
    """Get all users."""
    result = await db.execute(select(User).order_by(User.username))
    return result.scalars().all()


async def create_user(db: AsyncSession, username: str, password_hash: str, role: str = "operator", **kwargs) -> User:
    """Create a new user."""
    user = User(username=username, password_hash=password_hash, role=role, **kwargs)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def update_user(db: AsyncSession, username: str, **kwargs) -> Optional[User]:
    """Update a user."""
    await db.execute(
        update(User).where(User.username == username).values(**kwargs)
    )
    await db.commit()
    return await get_user_by_username(db, username)


async def delete_user(db: AsyncSession, username: str) -> bool:
    """Delete a user by username."""
    result = await db.execute(
        delete(User).where(User.username == username)
    )
    await db.commit()
    return result.rowcount > 0


# ============ ALARM HISTORY CRUD ============

async def log_alarm(db: AsyncSession, unit_id: str, parameter: str, alarm_type: str, 
                    value: float, setpoint: float, is_shutdown: bool = False) -> AlarmHistory:
    """Log a new alarm event."""
    alarm = AlarmHistory(
        unit_id=unit_id,
        parameter=parameter,
        alarm_type=alarm_type,
        value=value,
        setpoint=setpoint,
        is_shutdown=is_shutdown
    )
    db.add(alarm)
    await db.commit()
    await db.refresh(alarm)
    return alarm


async def get_alarm_history(db: AsyncSession, unit_id: str, limit: int = 100) -> List[AlarmHistory]:
    """Get recent alarm history for a unit."""
    result = await db.execute(
        select(AlarmHistory)
        .where(AlarmHistory.unit_id == unit_id)
        .order_by(AlarmHistory.triggered_at.desc())
        .limit(limit)
    )
    return result.scalars().all()
