"""
Data Resolver Service V2
Simplified two-state fallback: Modbus (LIVE) → Manual (OVERRIDE)
Stale data detection for frozen sensor values.
"""

import logging
from typing import Dict, Any, Optional, List
from datetime import datetime
from enum import Enum

logger = logging.getLogger(__name__)


class DataSource(Enum):
    LIVE = "LIVE"      # From Modbus/SCADA
    MANUAL = "MANUAL"  # User override


class DataQuality(Enum):
    GOOD = "GOOD"
    STALE = "STALE"
    OVERRIDE = "OVERRIDE"
    BAD = "BAD"


DYNAMIC_KEYWORDS = ["temp", "pressure", "pres", "flow", "rpm", "speed", "vibration", "vib", "amp", "current", "power", "load"]


class StaleDataTracker:
    """Tracks value changes to detect frozen/zombie sensors."""
    
    def __init__(self, staleness_minutes: float = 5.0, change_threshold: float = 0.01):
        self.staleness_minutes = staleness_minutes
        self.change_threshold = change_threshold
        self.last_values: Dict[str, float] = {}
        self.last_change_times: Dict[str, datetime] = {}
    
    def is_dynamic(self, parameter: str) -> bool:
        return any(kw in parameter.lower() for kw in DYNAMIC_KEYWORDS)
    
    def check_staleness(self, parameter: str, value: float) -> DataQuality:
        """Check if a value is stale (unchanged for too long)."""
        if not self.is_dynamic(parameter):
            return DataQuality.GOOD
        
        now = datetime.now()
        
        if parameter not in self.last_values:
            self.last_values[parameter] = value
            self.last_change_times[parameter] = now
            return DataQuality.GOOD
        
        if abs(value - self.last_values[parameter]) >= self.change_threshold:
            self.last_values[parameter] = value
            self.last_change_times[parameter] = now
            return DataQuality.GOOD
        
        elapsed = (now - self.last_change_times[parameter]).total_seconds() / 60.0
        return DataQuality.STALE if elapsed >= self.staleness_minutes else DataQuality.GOOD
    
    def get_stale_duration(self, parameter: str) -> Optional[float]:
        if parameter not in self.last_change_times:
            return None
        return (datetime.now() - self.last_change_times[parameter]).total_seconds() / 60.0


class TwoStateDataResolver:
    """
    Simplified two-state data resolver.
    Priority: Modbus (LIVE) → Manual Override
    """
    
    def __init__(self):
        self.stale_tracker = StaleDataTracker(staleness_minutes=5.0, change_threshold=0.01)
        self.manual_values: Dict[str, Dict[str, Dict[str, Any]]] = {}
    
    def set_manual_value(self, unit_id: str, parameter: str, value: float, expires_at: datetime = None):
        """Set a manual override for a parameter."""
        if unit_id not in self.manual_values:
            self.manual_values[unit_id] = {}
        self.manual_values[unit_id][parameter] = {
            'value': value,
            'set_at': datetime.now(),
            'expires_at': expires_at
        }
        logger.debug(f"Manual override set: {unit_id}.{parameter} = {value}")
    
    def clear_manual_value(self, unit_id: str, parameter: str):
        """Clear a manual override."""
        unit_manual = self.manual_values.get(unit_id, {})
        if parameter in unit_manual:
            del unit_manual[parameter]
            logger.debug(f"Manual override cleared: {unit_id}.{parameter}")
    
    def get_manual_value(self, unit_id: str, parameter: str) -> Optional[float]:
        """Get manual override if valid."""
        unit_manual = self.manual_values.get(unit_id, {})
        if parameter not in unit_manual:
            return None
        
        manual = unit_manual[parameter]
        expires = manual.get('expires_at')
        
        if expires and expires <= datetime.now():
            del unit_manual[parameter]
            return None
        
        return manual['value']
    
    def resolve(self, unit_id: str, parameter: str, live_value: Optional[float]) -> Dict[str, Any]:
        """
        Resolve a single parameter value.
        Returns: {value, source, quality, timestamp}
        """
        result = {
            'parameter': parameter,
            'value': None,
            'source': DataSource.LIVE.value,
            'quality': DataQuality.BAD.value,
            'timestamp': datetime.now().isoformat()
        }
        
        # Check for manual override first (explicit user intent)
        manual_value = self.get_manual_value(unit_id, parameter)
        if manual_value is not None:
            result['value'] = manual_value
            result['source'] = DataSource.MANUAL.value
            result['quality'] = DataQuality.OVERRIDE.value
            return result
        
        # Use live (Modbus) value
        if live_value is not None:
            result['value'] = live_value
            result['source'] = DataSource.LIVE.value
            quality = self.stale_tracker.check_staleness(parameter, live_value)
            result['quality'] = quality.value
            return result
        
        # No data available
        result['quality'] = DataQuality.BAD.value
        return result
    
    def resolve_all(self, unit_id: str, live_data: Dict[str, float], parameters: List[str] = None) -> Dict[str, Dict]:
        """
        Resolve all parameters.
        If parameters not specified, resolve all keys in live_data plus any manual overrides.
        """
        unit_manual = self.manual_values.get(unit_id, {})
        if parameters is None:
            parameters = list(set(live_data.keys()) | set(unit_manual.keys()))
        
        results = {}
        sources = {}
        
        for param in parameters:
            resolved = self.resolve(unit_id, param, live_data.get(param))
            results[param] = resolved['value']
            sources[param] = resolved['source']
        
        return {
            'values': results,
            'sources': sources,
            'timestamp': datetime.now().isoformat()
        }


# Global singleton
_resolver: Optional[TwoStateDataResolver] = None


def get_data_resolver() -> TwoStateDataResolver:
    global _resolver
    if _resolver is None:
        _resolver = TwoStateDataResolver()
    return _resolver
