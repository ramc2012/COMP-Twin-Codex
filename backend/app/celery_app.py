"""
Celery Application Configuration
Background tasks for physics calculations, alarm processing, and data aggregation.
"""
import os
from celery import Celery
from celery.schedules import crontab
import logging

logger = logging.getLogger(__name__)

# Redis connection URL
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

# Create Celery app
celery_app = Celery(
    "gcs_digital_twin",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[]
)

# Celery configuration
celery_app.conf.update(
    # Task settings
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    
    # Task execution
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    
    # Result backend
    result_expires=3600,  # 1 hour
    
    # Worker settings
    worker_prefetch_multiplier=1,
    worker_concurrency=4,
    
    # Beat schedule for periodic tasks
    beat_schedule={
        "poll-all-units": {
            "task": "app.tasks.data_tasks.poll_all_units",
            "schedule": 1.0,  # Every 1 second
        },
        "evaluate-alarms": {
            "task": "app.tasks.alarm_tasks.evaluate_all_alarms",
            "schedule": 2.0,  # Every 2 seconds
        },
        "calculate-physics": {
            "task": "app.tasks.physics_tasks.calculate_all_physics",
            "schedule": 5.0,  # Every 5 seconds
        },
        "aggregate-data-1min": {
            "task": "app.tasks.data_tasks.aggregate_minute_data",
            "schedule": 60.0,  # Every 1 minute
        },
        "cleanup-old-alarms": {
            "task": "app.tasks.alarm_tasks.cleanup_old_alarms",
            "schedule": crontab(hour=0, minute=0),  # Daily at midnight
        },
    },
)


# ============ TASK DEFINITIONS ============

@celery_app.task(name="app.tasks.data_tasks.poll_all_units")
def poll_all_units():
    """Poll Modbus data for all registered units."""
    from app.services.unit_manager import get_unit_manager
    
    manager = get_unit_manager()
    units = manager.get_all_units()
    
    for unit in units:
        if unit["is_active"] and unit["has_modbus"]:
            poll_unit.delay(unit["unit_id"])
    
    return {"polled_units": len(units)}


@celery_app.task(name="app.tasks.data_tasks.poll_unit")
def poll_unit(unit_id: str):
    """Poll Modbus data for a specific unit."""
    # In production, this would call the ModbusPoller
    logger.info(f"Polling unit: {unit_id}")
    return {"unit_id": unit_id, "status": "polled"}


@celery_app.task(name="app.tasks.alarm_tasks.evaluate_all_alarms")
def evaluate_all_alarms():
    """Evaluate alarms for all units."""
    from app.services.unit_manager import get_unit_manager
    from app.services.alarm_engine import get_alarm_engine
    
    manager = get_unit_manager()
    alarm_engine = get_alarm_engine()
    
    triggered = 0
    for unit in manager.get_all_units():
        if unit["is_active"]:
            data = manager.get_live_data(unit["unit_id"])
            # This would be async in production
            # new_alarms = await alarm_engine.evaluate(unit["unit_id"], data)
            # triggered += len(new_alarms)
    
    return {"evaluated_units": len(manager.get_all_units()), "triggered": triggered}


@celery_app.task(name="app.tasks.physics_tasks.calculate_all_physics")
def calculate_all_physics():
    """Run physics calculations for all units."""
    from app.services.unit_manager import get_unit_manager
    
    manager = get_unit_manager()
    results = {}
    
    for unit in manager.get_all_units():
        if unit["is_active"]:
            results[unit["unit_id"]] = manager.get_physics_results(unit["unit_id"])
    
    return results


@celery_app.task(name="app.tasks.alarm_tasks.cleanup_old_alarms")
def cleanup_old_alarms(days: int = 30):
    """Clean up alarm history older than specified days."""
    # Would delete old AlarmHistory records from PostgreSQL
    logger.info(f"Cleaning up alarms older than {days} days")
    return {"deleted": 0}


@celery_app.task(name="app.tasks.data_tasks.aggregate_minute_data")
def aggregate_minute_data():
    """Aggregate 1-second data into 1-minute averages in InfluxDB."""
    # Would run InfluxDB aggregation query
    logger.info("Aggregating minute data")
    return {"status": "aggregated"}


@celery_app.task(name="app.tasks.data_tasks.write_to_influx")
def write_to_influx(unit_id: str, data: dict):
    """Write data point to InfluxDB."""
    from app.services.influxdb_writer import get_influx_writer
    
    writer = get_influx_writer()
    if writer and writer.client:
        writer.write_live_data(unit_id, data)
        return {"status": "written"}
    return {"status": "influx_not_available"}
