"""
GCS Digital Twin - FastAPI Backend v3.2
Complete integration: Database, Alarm Engine, Multi-Unit, Extended Physics
Added: Modbus Config API, Alarm Setpoints API, Site Conditions API
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api.routes import (
    dashboard, diagrams, auth, trends, config, alarms, 
    units_api, modbus_config, alarm_setpoints, site_conditions, alarm_history
)
from app.services.modbus_poller import init_modbus_poller_with_callback
from app.services.redis_cache import init_redis_cache, get_redis_cache
from app.services.influxdb_writer import get_influx_writer
from app.services.alarm_engine import get_alarm_engine, AlarmSetpoint
from app.services.unit_manager import get_unit_manager, UnitConfig
from app.services.extended_physics import get_extended_physics_engine

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

settings = get_settings()


def _build_influx_payload(values: dict) -> dict:
    """Normalize Modbus poll values into the Influx writer payload shape."""
    stages = []
    for i in (1, 2, 3):
        stages.append({
            "stage": i,
            "suction_press": float(values.get(f"stg{i}_suction_pressure", 0.0)),
            "discharge_press": float(values.get(f"stg{i}_discharge_pressure", 0.0)),
            "suction_temp": float(values.get(f"stg{i}_suction_temp", 0.0)),
            "discharge_temp": float(values.get(f"stg{i}_discharge_temp", 0.0)),
            "ratio": float(values.get(f"stg{i}_ratio", 0.0)),
            "isentropic_eff": float(values.get(f"stg{i}_isentropic_eff", 0.0)),
            "volumetric_eff": float(values.get(f"stg{i}_volumetric_eff", 0.0)),
        })

    return {
        "engine_rpm": float(values.get("engine_rpm", 0.0)),
        "engine_oil_press": float(values.get("engine_oil_press", values.get("engine_oil_pressure", 0.0))),
        "engine_oil_temp": float(values.get("engine_oil_temp", 0.0)),
        "jacket_water_temp": float(values.get("jacket_water_temp", 0.0)),
        "engine_state": int(values.get("engine_state", 0)),
        "comp_oil_press": float(values.get("comp_oil_press", values.get("comp_oil_pressure", 0.0))),
        "comp_oil_temp": float(values.get("comp_oil_temp", 0.0)),
        "overall_ratio": float(values.get("overall_ratio", 0.0)),
        "total_bhp": float(values.get("total_bhp", 0.0)),
        "stages": stages,
        "exhaust_temps": {k: float(v) for k, v in values.items() if k.startswith("exh_")},
        "bearing_temps": [float(values.get(f"main_bearing_{i}", 0.0)) for i in range(1, 10)],
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events for startup and shutdown."""
    
    logger.info("🚀 GCS Digital Twin Backend v3.2 starting...")
    logger.info(f"   Modbus enabled: {settings.MODBUS_ENABLED}")
    
    # Initialize database (optional - graceful failure)
    try:
        from app.db.database import init_db, close_db
        from app.db.seed import seed_database
        await init_db()
        await seed_database()
        logger.info("   ✅ PostgreSQL connected")
    except Exception as e:
        logger.warning(f"   PostgreSQL not available: {e}")
    
    # Initialize Redis
    try:
        await init_redis_cache()
        logger.info("   ✅ Redis connected")
    except Exception as e:
        logger.warning(f"   Redis not available: {e}")
    
    # Initialize InfluxDB
    try:
        influx = get_influx_writer()
        influx.connect()
        logger.info("   ✅ InfluxDB connected")
    except Exception as e:
        logger.warning(f"   InfluxDB not available: {e}")
    
    # Initialize Unit Manager with default unit
    try:
        manager = get_unit_manager()
        logger.info(f"   ✅ Unit Manager initialized ({len(manager.units)} units)")
    except Exception as e:
        logger.warning(f"   Unit Manager error: {e}")
    
    # Initialize Alarm Engine with default setpoints
    try:
        alarm_engine = get_alarm_engine()
        default_setpoints = [
            AlarmSetpoint("engine_oil_press", ll_value=30, l_value=40, is_shutdown=True),
            AlarmSetpoint("engine_oil_temp", h_value=220, hh_value=240, is_shutdown=True),
            AlarmSetpoint("jacket_water_temp", h_value=200, hh_value=210, is_shutdown=True),
            AlarmSetpoint("stg1_discharge_temp", h_value=350, hh_value=375),
            AlarmSetpoint("stg2_discharge_temp", h_value=350, hh_value=375),
            AlarmSetpoint("stg3_discharge_temp", h_value=350, hh_value=375),
        ]
        alarm_engine.load_setpoints(default_setpoints)
        logger.info(f"   ✅ Alarm Engine initialized ({len(default_setpoints)} setpoints)")
    except Exception as e:
        logger.warning(f"   Alarm Engine error: {e}")
    
    # Initialize Modbus poller if enabled
    poller = None
    if settings.MODBUS_ENABLED:
        try:
            async def _on_modbus_poll(values: dict):
                unit_id = "GCS-001"
                manager = get_unit_manager()
                manager.update_live_data(unit_id, values)

                try:
                    alarm_engine = get_alarm_engine()
                    await alarm_engine.evaluate(unit_id, values)
                except Exception as e:
                    logger.warning(f"Alarm evaluation failed: {e}")

                try:
                    influx = get_influx_writer()
                    if influx and influx.connected:
                        influx.write_live_data(unit_id, _build_influx_payload(values))
                except Exception as e:
                    logger.warning(f"Influx write failed: {e}")

            poller = await init_modbus_poller_with_callback(_on_modbus_poll)
            logger.info("   ✅ Modbus Poller started")
        except Exception as e:
            logger.warning(f"   Modbus Poller not started: {e}")
    
    logger.info("✅ GCS Digital Twin Backend v3.2 ready!")
    
    yield
    
    # Shutdown
    logger.info("🛑 GCS Digital Twin Backend shutting down...")
    
    if poller:
        await poller.stop()
    
    try:
        redis = get_redis_cache()
        await redis.close()
    except:
        pass
    
    try:
        from app.db.database import close_db
        await close_db()
    except:
        pass


app = FastAPI(
    title="GCS Digital Twin API",
    description="Real-time compressor monitoring with physics engine",
    version="3.2.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(diagrams.router)
app.include_router(trends.router)
app.include_router(config.router)
app.include_router(alarms.router)
app.include_router(units_api.router)
app.include_router(modbus_config.router)
app.include_router(alarm_setpoints.router)
app.include_router(site_conditions.router)
app.include_router(alarm_history.router)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "version": "3.2.0",
        "features": {
            "modbus": settings.MODBUS_ENABLED,
            "influxdb": True,
            "postgres": True,
            "redis": True,
            "multi_unit": True,
            "alarm_engine": True,
            "physics_engine": True,
            "modbus_config_api": True,
            "alarm_setpoints_api": True,
            "site_conditions_api": True
        }
    }


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "GCS Digital Twin API",
        "version": "3.2.0",
        "docs": "/docs"
    }
