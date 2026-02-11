"""
Alarm History API - In-memory storage for alarm events
"""

from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Optional
from pydantic import BaseModel
from datetime import datetime, timedelta
from collections import defaultdict

from ..routes.auth import get_current_user

router = APIRouter(prefix="/api/alarms", tags=["Alarm History"])

_alarm_events: Dict[str, List[Dict]] = defaultdict(list)
_event_id_counter = 1


class AlarmEventCreate(BaseModel):
    parameter: str
    level: str
    value: float
    setpoint: float
    is_shutdown: bool = False


class AlarmAcknowledge(BaseModel):
    notes: Optional[str] = None


@router.get("/{unit_id}/history")
async def get_alarm_history(
    unit_id: str,
    limit: int = 100,
    hours: int = 24,
    active_only: bool = False,
    current_user: dict = Depends(get_current_user)
) -> Dict:
    """Get alarm history for a unit."""
    since = datetime.utcnow() - timedelta(hours=hours)
    events = _alarm_events.get(unit_id, [])
    filtered = [e for e in events if datetime.fromisoformat(e['triggered_at']) >= since]
    if active_only:
        filtered = [e for e in filtered if e.get('cleared_at') is None]
    filtered = sorted(filtered, key=lambda x: x['triggered_at'], reverse=True)[:limit]
    return {"unit_id": unit_id, "events": filtered, "count": len(filtered), "hours_queried": hours}


@router.post("/{unit_id}/events")
async def create_alarm_event(unit_id: str, event: AlarmEventCreate) -> Dict:
    """Record a new alarm event."""
    global _event_id_counter
    new_event = {
        "id": _event_id_counter,
        "parameter": event.parameter,
        "level": event.level,
        "value": event.value,
        "setpoint": event.setpoint,
        "is_shutdown": event.is_shutdown,
        "triggered_at": datetime.utcnow().isoformat(),
        "cleared_at": None,
        "acknowledged_at": None,
        "acknowledged_by": None,
        "notes": None
    }
    _event_id_counter += 1
    _alarm_events[unit_id].append(new_event)
    return {"status": "created", "id": new_event["id"], "parameter": event.parameter}


@router.post("/{unit_id}/events/{event_id}/acknowledge")
async def acknowledge_alarm(
    unit_id: str,
    event_id: int,
    ack: AlarmAcknowledge,
    current_user: dict = Depends(get_current_user)
) -> Dict:
    """Acknowledge an alarm event."""
    events = _alarm_events.get(unit_id, [])
    event = next((e for e in events if e['id'] == event_id), None)
    if not event:
        raise HTTPException(status_code=404, detail="Alarm event not found")
    if event.get('acknowledged_at'):
        raise HTTPException(status_code=400, detail="Alarm already acknowledged")
    event['acknowledged_at'] = datetime.utcnow().isoformat()
    event['acknowledged_by'] = current_user.get("username", "unknown")
    event['notes'] = ack.notes
    return {"status": "acknowledged", "id": event_id}


@router.post("/{unit_id}/events/{event_id}/clear")
async def clear_alarm(unit_id: str, event_id: int) -> Dict:
    """Clear an alarm event."""
    events = _alarm_events.get(unit_id, [])
    event = next((e for e in events if e['id'] == event_id), None)
    if not event:
        raise HTTPException(status_code=404, detail="Alarm event not found")
    if event.get('cleared_at'):
        return {"status": "already_cleared", "id": event_id}
    event['cleared_at'] = datetime.utcnow().isoformat()
    return {"status": "cleared", "id": event_id}


@router.get("/{unit_id}/summary")
async def get_alarm_summary(unit_id: str) -> Dict:
    """Get alarm summary statistics."""
    from app.services.alarm_engine import get_alarm_engine
    now = datetime.utcnow()
    last_24h = now - timedelta(hours=24)
    events = _alarm_events.get(unit_id, [])
    active_events = [e for e in events if e.get('cleared_at') is None]
    daily_events = [e for e in events if datetime.fromisoformat(e['triggered_at']) >= last_24h]
    level_counts = {'LL': 0, 'L': 0, 'H': 0, 'HH': 0}
    for e in daily_events:
        level = e.get('level', '')
        if level in level_counts:
            level_counts[level] += 1
    try:
        alarm_engine = get_alarm_engine()
        shutdown_active = alarm_engine.get_shutdown_active()
    except:
        shutdown_active = False
    return {
        "unit_id": unit_id,
        "active_count": len(active_events),
        "unacknowledged_count": sum(1 for e in active_events if not e.get('acknowledged_at')),
        "shutdown_active": shutdown_active,
        "last_24h_count": len(daily_events),
        "by_level": level_counts,
        "timestamp": now.isoformat()
    }
