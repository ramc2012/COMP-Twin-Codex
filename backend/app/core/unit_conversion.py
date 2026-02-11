"""
Unit Conversion Utilities for GCS Digital Twin
"""

from .constants import FAHRENHEIT_TO_RANKINE, ATMOSPHERIC_PRESSURE


def f_to_r(fahrenheit: float) -> float:
    """Convert Fahrenheit to Rankine."""
    return fahrenheit + FAHRENHEIT_TO_RANKINE


def r_to_f(rankine: float) -> float:
    """Convert Rankine to Fahrenheit."""
    return rankine - FAHRENHEIT_TO_RANKINE


def c_to_f(celsius: float) -> float:
    """Convert Celsius to Fahrenheit."""
    return (celsius * 9/5) + 32


def f_to_c(fahrenheit: float) -> float:
    """Convert Fahrenheit to Celsius."""
    return (fahrenheit - 32) * 5/9


def psig_to_psia(psig: float, p_atm: float = ATMOSPHERIC_PRESSURE) -> float:
    """Convert PSIG to PSIA."""
    return psig + p_atm


def psia_to_psig(psia: float, p_atm: float = ATMOSPHERIC_PRESSURE) -> float:
    """Convert PSIA to PSIG."""
    return psia - p_atm


def bar_to_psi(bar: float) -> float:
    """Convert bar to PSI."""
    return bar * 14.5038


def psi_to_bar(psi: float) -> float:
    """Convert PSI to bar."""
    return psi / 14.5038


def kpa_to_psi(kpa: float) -> float:
    """Convert kPa to PSI."""
    return kpa * 0.145038


def cfm_to_m3h(cfm: float) -> float:
    """Convert CFM to m³/h."""
    return cfm * 1.699


def hp_to_kw(hp: float) -> float:
    """Convert horsepower to kilowatts."""
    return hp * 0.7457


def kw_to_hp(kw: float) -> float:
    """Convert kilowatts to horsepower."""
    return kw / 0.7457
