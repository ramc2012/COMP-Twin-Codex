"""
Alarm Engine - evaluates live values against setpoints.
Handles hysteresis, delays, and alarm state management.
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from enum import Enum
import logging
import asyncio

logger = logging.getLogger(__name__)


class AlarmLevel(str, Enum):
    LL = "LL"  # Low-Low
    L = "L"    # Low
    H = "H"    # High
    HH = "HH"  # High-High


class AlarmState(str, Enum):
    NORMAL = "normal"
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    SHELVED = "shelved"


@dataclass
class AlarmSetpoint:
    """Alarm configuration for a parameter."""
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


@dataclass
class ActiveAlarm:
    """Represents an active alarm."""
    parameter: str
    level: AlarmLevel
    value: float
    setpoint: float
    state: AlarmState = AlarmState.ACTIVE
    triggered_at: datetime = field(default_factory=datetime.now)
    acknowledged_at: Optional[datetime] = None
    acknowledged_by: Optional[str] = None
    is_shutdown: bool = False


@dataclass
class PendingAlarm:
    """Alarm pending delay timer."""
    parameter: str
    level: AlarmLevel
    value: float
    setpoint: float
    started_at: datetime


class AlarmEngine:
    """
    Evaluates live values against alarm setpoints.
    Handles hysteresis, delay timers, and alarm lifecycle.
    """
    
    def __init__(self, redis_cache=None, on_alarm_callback=None):
        self.setpoints: Dict[str, AlarmSetpoint] = {}
        self.active_alarms: Dict[str, ActiveAlarm] = {}  # key: "param:level"
        self.pending_alarms: Dict[str, PendingAlarm] = {}
        self.last_values: Dict[str, float] = {}
        self.redis_cache = redis_cache
        self.on_alarm_callback = on_alarm_callback
    
    def load_setpoints(self, setpoints: List[AlarmSetpoint]):
        """Load alarm setpoints."""
        self.setpoints = {sp.parameter: sp for sp in setpoints}
        logger.info(f"Loaded {len(self.setpoints)} alarm setpoints")
    
    def add_setpoint(self, setpoint: AlarmSetpoint):
        """Add or update a single setpoint."""
        self.setpoints[setpoint.parameter] = setpoint
    
    async def evaluate(self, unit_id: str, values: Dict[str, float]) -> List[Dict]:
        """
        Evaluate all values against setpoints.
        Returns list of newly triggered alarms.
        """
        new_alarms = []
        current_time = datetime.now()
        
        for param, value in values.items():
            if param not in self.setpoints:
                continue
            
            sp = self.setpoints[param]
            if not sp.is_enabled:
                continue
            
            self.last_values[param] = value
            
            # Check each alarm level
            for level, check_value, is_high in [
                (AlarmLevel.HH, sp.hh_value, True),
                (AlarmLevel.H, sp.h_value, True),
                (AlarmLevel.L, sp.l_value, False),
                (AlarmLevel.LL, sp.ll_value, False),
            ]:
                if check_value is None:
                    continue
                
                alarm_key = f"{param}:{level.value}"
                in_alarm = (value >= check_value) if is_high else (value <= check_value)
                
                if in_alarm:
                    # Check if already active
                    if alarm_key in self.active_alarms:
                        continue
                    
                    # Check pending (delay timer)
                    if alarm_key in self.pending_alarms:
                        pending = self.pending_alarms[alarm_key]
                        elapsed = (current_time - pending.started_at).total_seconds()
                        if elapsed >= sp.delay_seconds:
                            # Delay expired, trigger alarm
                            alarm = await self._trigger_alarm(
                                unit_id, param, level, value, check_value, sp.is_shutdown
                            )
                            new_alarms.append(alarm)
                            del self.pending_alarms[alarm_key]
                    else:
                        # Start delay timer
                        self.pending_alarms[alarm_key] = PendingAlarm(
                            parameter=param,
                            level=level,
                            value=value,
                            setpoint=check_value,
                            started_at=current_time
                        )
                else:
                    # Not in alarm - check for clear with hysteresis
                    if alarm_key in self.pending_alarms:
                        del self.pending_alarms[alarm_key]
                    
                    if alarm_key in self.active_alarms:
                        active = self.active_alarms[alarm_key]
                        # Check hysteresis
                        if is_high:
                            clear_threshold = check_value - sp.deadband
                            if value < clear_threshold:
                                await self._clear_alarm(unit_id, alarm_key)
                        else:
                            clear_threshold = check_value + sp.deadband
                            if value > clear_threshold:
                                await self._clear_alarm(unit_id, alarm_key)
        
        return new_alarms
    
    async def _trigger_alarm(self, unit_id: str, param: str, level: AlarmLevel,
                              value: float, setpoint: float, is_shutdown: bool) -> Dict:
        """Trigger a new alarm."""
        alarm_key = f"{param}:{level.value}"
        
        alarm = ActiveAlarm(
            parameter=param,
            level=level,
            value=value,
            setpoint=setpoint,
            is_shutdown=is_shutdown
        )
        self.active_alarms[alarm_key] = alarm
        
        alarm_dict = {
            "unit_id": unit_id,
            "parameter": param,
            "level": level.value,
            "value": round(value, 2),
            "setpoint": round(setpoint, 2),
            "state": AlarmState.ACTIVE.value,
            "triggered_at": alarm.triggered_at.isoformat(),
            "is_shutdown": is_shutdown
        }
        
        logger.warning(f"ALARM TRIGGERED: {param} {level.value} = {value:.2f} (limit: {setpoint})")
        
        # Publish to Redis
        if self.redis_cache:
            await self.redis_cache.publish_update("alarms", alarm_dict)
        
        # Callback for logging/notifications
        if self.on_alarm_callback:
            await self.on_alarm_callback(alarm_dict)
        
        return alarm_dict
    
    async def _clear_alarm(self, unit_id: str, alarm_key: str):
        """Clear an active alarm."""
        if alarm_key not in self.active_alarms:
            return
        
        alarm = self.active_alarms[alarm_key]
        
        # Latching alarms require acknowledgement before clearing
        if self.setpoints.get(alarm.parameter, AlarmSetpoint(alarm.parameter)).is_latching:
            if alarm.state != AlarmState.ACKNOWLEDGED:
                return
        
        del self.active_alarms[alarm_key]
        
        logger.info(f"ALARM CLEARED: {alarm.parameter} {alarm.level.value}")
        
        if self.redis_cache:
            await self.redis_cache.publish_update("alarms", {
                "unit_id": unit_id,
                "parameter": alarm.parameter,
                "level": alarm.level.value,
                "state": "cleared",
                "cleared_at": datetime.now().isoformat()
            })
    
    def acknowledge(self, alarm_key: str, user: str) -> bool:
        """Acknowledge an alarm."""
        if alarm_key not in self.active_alarms:
            return False
        
        alarm = self.active_alarms[alarm_key]
        alarm.state = AlarmState.ACKNOWLEDGED
        alarm.acknowledged_at = datetime.now()
        alarm.acknowledged_by = user
        
        logger.info(f"ALARM ACKNOWLEDGED: {alarm_key} by {user}")
        return True
    
    def get_active_alarms(self) -> List[Dict]:
        """Get all active alarms."""
        return [
            {
                "key": f"{a.parameter}:{a.level.value}",
                "parameter": a.parameter,
                "level": a.level.value,
                "value": a.value,
                "setpoint": a.setpoint,
                "state": a.state.value,
                "triggered_at": a.triggered_at.isoformat(),
                "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
                "acknowledged_by": a.acknowledged_by,
                "is_shutdown": a.is_shutdown
            }
            for a in self.active_alarms.values()
        ]
    
    def get_pending_count(self) -> int:
        """Get count of pending (delayed) alarms."""
        return len(self.pending_alarms)
    
    def get_shutdown_active(self) -> bool:
        """Check if any shutdown alarm is active."""
        return any(a.is_shutdown for a in self.active_alarms.values())


# Global instance
_alarm_engine: Optional[AlarmEngine] = None


def get_alarm_engine() -> AlarmEngine:
    """Get or create alarm engine singleton."""
    global _alarm_engine
    if _alarm_engine is None:
        _alarm_engine = AlarmEngine()
    return _alarm_engine
