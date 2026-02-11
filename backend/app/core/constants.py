"""
Constants for GCS Digital Twin
Gas properties, data quality levels, and physical constants.
"""

from enum import Enum
from dataclasses import dataclass


class DataQuality(str, Enum):
    """Data quality levels for resolved values."""
    LIVE = "live"
    CALCULATED = "calculated"
    MANUAL = "manual"
    STALE = "stale"  # Value unchanged for too long (frozen sensor)
    BAD = "bad"
    UNKNOWN = "unknown"


class EngineState(int, Enum):
    """Engine operating states."""
    STOPPED = 0
    PRE_LUBE = 1
    CRANKING = 2
    IDLE_WARMUP = 3
    LOADING = 4
    RUNNING = 8
    UNLOADING = 16
    COOLDOWN = 32
    SHUTDOWN = 64
    FAULT = 255


ENGINE_STATES = {
    0: "STOPPED", 1: "PRE_LUBE", 2: "CRANKING", 3: "IDLE_WARMUP",
    4: "LOADING", 8: "RUNNING", 16: "UNLOADING", 32: "COOLDOWN",
    64: "SHUTDOWN", 255: "FAULT"
}


class AlarmLevel(str, Enum):
    """Alarm severity levels."""
    OK = "ok"
    LOW_LOW = "ll"
    LOW = "l"
    HIGH = "h"
    HIGH_HIGH = "hh"


# Physical Constants
GAS_CONSTANT_R = 10.73  # psia·ft³/(lbmol·°R)
ATMOSPHERIC_PRESSURE = 14.696  # psia
FAHRENHEIT_TO_RANKINE = 459.67  # Add to °F to get °R


@dataclass
class GasProperties:
    """Gas properties for thermodynamic calculations."""
    name: str = "Natural Gas"
    specific_gravity: float = 0.65
    molecular_weight: float = 18.85
    k_suction: float = 1.28
    k_discharge: float = 1.25
    z_suction: float = 0.98
    z_discharge: float = 0.95


DEFAULT_GAS = GasProperties()


def f_to_r(fahrenheit: float) -> float:
    return fahrenheit + FAHRENHEIT_TO_RANKINE

def r_to_f(rankine: float) -> float:
    return rankine - FAHRENHEIT_TO_RANKINE

def psig_to_psia(psig: float, p_atm: float = ATMOSPHERIC_PRESSURE) -> float:
    return psig + p_atm

def psia_to_psig(psia: float, p_atm: float = ATMOSPHERIC_PRESSURE) -> float:
    return psia - p_atm
