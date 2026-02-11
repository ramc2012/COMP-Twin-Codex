"""
Database seed script - creates default data for GCS-001.
Run once on first startup.
"""
import asyncio
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession

from .database import async_session_factory, init_db
from .models import Unit, EquipmentSpec, StageConfig, RegisterMapping, AlarmSetpoint, GasProperty, User
from . import crud

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

DEFAULT_UNIT = "GCS-001"


async def seed_database():
    """Seed database with default configuration."""
    await init_db()
    
    async with async_session_factory() as db:
        # Check if already seeded
        existing = await crud.get_unit(db, DEFAULT_UNIT)
        if existing:
            print(f"Unit {DEFAULT_UNIT} already exists, skipping seed")
            return
        
        print("Seeding database...")
        
        # Create default unit
        unit = await crud.create_unit(
            db, 
            unit_id=DEFAULT_UNIT,
            name="Gas Compressor Station 001",
            description="Main compressor unit",
            location="Field Station A"
        )
        
        # Equipment specs
        await crud.upsert_equipment_spec(
            db, DEFAULT_UNIT,
            compressor_manufacturer="Ariel",
            compressor_model="JGK/4",
            compressor_serial="ARK-2024-001",
            frame_type="JGK",
            stage_count=3,
            rated_speed_rpm=1000,
            max_rod_load_lb=42000,
            engine_manufacturer="Caterpillar",
            engine_model="G3516",
            engine_serial="CAT-2024-001",
            engine_cylinders=16,
            rated_hp=2000
        )
        
        # Stage configs
        stage_defaults = [
            {"stage_num": 1, "bore_inches": 8.0, "stroke_inches": 5.0, "clearance_pct_he": 12.0,
             "design_p_suction_psig": 50, "design_p_discharge_psig": 200},
            {"stage_num": 2, "bore_inches": 6.0, "stroke_inches": 5.0, "clearance_pct_he": 15.0,
             "design_p_suction_psig": 195, "design_p_discharge_psig": 600},
            {"stage_num": 3, "bore_inches": 4.5, "stroke_inches": 5.0, "clearance_pct_he": 18.0,
             "design_p_suction_psig": 590, "design_p_discharge_psig": 1200}
        ]
        for stage in stage_defaults:
            await crud.upsert_stage_config(db, DEFAULT_UNIT, **stage)
        
        # Default registers
        default_registers = [
            {"address": 0, "name": "engine_rpm", "scale": 1.0, "category": "engine", "poll_group": "A"},
            {"address": 1, "name": "engine_load", "scale": 0.1, "category": "engine", "poll_group": "A"},
            {"address": 2, "name": "oil_pressure", "scale": 0.1, "category": "engine", "poll_group": "A"},
            {"address": 3, "name": "coolant_temp", "scale": 0.1, "category": "engine", "poll_group": "A"},
            {"address": 10, "name": "stg1_suction_pressure", "scale": 0.1, "category": "stage1", "poll_group": "A"},
            {"address": 11, "name": "stg1_discharge_pressure", "scale": 0.1, "category": "stage1", "poll_group": "A"},
            {"address": 12, "name": "stg1_suction_temp", "scale": 0.1, "category": "stage1", "poll_group": "A"},
            {"address": 13, "name": "stg1_discharge_temp", "scale": 0.1, "category": "stage1", "poll_group": "A"},
            {"address": 20, "name": "stg2_suction_pressure", "scale": 0.1, "category": "stage2", "poll_group": "A"},
            {"address": 21, "name": "stg2_discharge_pressure", "scale": 0.1, "category": "stage2", "poll_group": "A"},
            {"address": 22, "name": "stg2_suction_temp", "scale": 0.1, "category": "stage2", "poll_group": "A"},
            {"address": 23, "name": "stg2_discharge_temp", "scale": 0.1, "category": "stage2", "poll_group": "A"},
            {"address": 30, "name": "stg3_suction_pressure", "scale": 0.1, "category": "stage3", "poll_group": "A"},
            {"address": 31, "name": "stg3_discharge_pressure", "scale": 0.1, "category": "stage3", "poll_group": "A"},
            {"address": 32, "name": "stg3_suction_temp", "scale": 0.1, "category": "stage3", "poll_group": "A"},
            {"address": 33, "name": "stg3_discharge_temp", "scale": 0.1, "category": "stage3", "poll_group": "A"},
        ]
        await crud.bulk_create_registers(db, DEFAULT_UNIT, default_registers)
        
        # Default alarms
        alarm_defaults = [
            {"parameter": "stg1_discharge_temp", "h_value": 300, "hh_value": 350, "deadband": 5, "delay_seconds": 10},
            {"parameter": "stg2_discharge_temp", "h_value": 300, "hh_value": 350, "deadband": 5, "delay_seconds": 10},
            {"parameter": "stg3_discharge_temp", "h_value": 300, "hh_value": 350, "deadband": 5, "delay_seconds": 10},
            {"parameter": "oil_pressure", "l_value": 30, "ll_value": 20, "deadband": 2, "is_shutdown": True},
            {"parameter": "coolant_temp", "h_value": 200, "hh_value": 220, "deadband": 3, "is_shutdown": True},
            {"parameter": "engine_rpm", "h_value": 1100, "hh_value": 1200, "deadband": 10},
        ]
        for alarm in alarm_defaults:
            await crud.upsert_alarm_setpoint(db, DEFAULT_UNIT, **alarm)
        
        # Gas properties
        await crud.upsert_gas_properties(
            db, DEFAULT_UNIT,
            gas_name="Natural Gas",
            specific_gravity=0.65,
            molecular_weight=18.5,
            k_suction=1.28,
            k_discharge=1.25,
            z_suction=0.98,
            z_discharge=0.95,
            methane_pct=85.0,
            ethane_pct=6.0,
            propane_pct=3.0,
            use_coolprop=True
        )
        
        # Default users
        users = [
            {"username": "admin", "password": "admin123", "role": "admin"},
            {"username": "engineer", "password": "eng123", "role": "engineer"},
            {"username": "operator", "password": "op123", "role": "operator"}
        ]
        for u in users:
            password_hash = pwd_context.hash(u["password"])
            await crud.create_user(db, u["username"], password_hash, u["role"])
        
        print(f"Database seeded successfully with unit {DEFAULT_UNIT}")


if __name__ == "__main__":
    asyncio.run(seed_database())
