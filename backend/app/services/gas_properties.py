"""
Gas Properties Service using CoolProp
Provides accurate thermodynamic calculations using Equation of State (EOS).
Supports: Natural Gas, CO2, Hydrogen, Nitrogen, Methane.
"""

import logging
from typing import Dict, Any, Optional
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)

# Try to import CoolProp, fall back to simplified calculations
try:
    import CoolProp.CoolProp as CP
    from CoolProp.CoolProp import PropsSI
    COOLPROP_AVAILABLE = True
    logger.info("CoolProp library loaded successfully")
except ImportError:
    COOLPROP_AVAILABLE = False
    logger.warning("CoolProp not available, using simplified gas property calculations")


class GasType(str, Enum):
    NATURAL_GAS = "natural_gas"  # Approximated as Methane-rich mixture
    METHANE = "methane"
    CO2 = "co2"
    HYDROGEN = "hydrogen"
    NITROGEN = "nitrogen"


# CoolProp fluid identifiers
GAS_FLUID_MAP = {
    GasType.NATURAL_GAS: "Methane",  # Approximate natural gas as methane
    GasType.METHANE: "Methane",
    GasType.CO2: "CarbonDioxide",
    GasType.HYDROGEN: "Hydrogen",
    GasType.NITROGEN: "Nitrogen",
}

# Fallback constants when CoolProp unavailable
FALLBACK_PROPERTIES = {
    GasType.NATURAL_GAS: {"k": 1.28, "z": 0.98, "mw": 18.85, "sg": 0.65},
    GasType.METHANE: {"k": 1.32, "z": 0.998, "mw": 16.04, "sg": 0.55},
    GasType.CO2: {"k": 1.29, "z": 0.995, "mw": 44.01, "sg": 1.52},
    GasType.HYDROGEN: {"k": 1.41, "z": 1.001, "mw": 2.02, "sg": 0.07},
    GasType.NITROGEN: {"k": 1.40, "z": 1.0, "mw": 28.01, "sg": 0.97},
}


@dataclass
class GasState:
    """Thermodynamic state of a gas."""
    temperature_R: float  # Rankine
    pressure_psia: float  # Absolute
    gas_type: GasType = GasType.NATURAL_GAS


@dataclass
class GasPropertiesResult:
    """Results from gas property calculation."""
    # Input state
    temperature_R: float
    pressure_psia: float
    gas_type: str
    
    # Calculated properties
    z_factor: float  # Compressibility factor
    k_value: float   # Isentropic exponent (Cp/Cv)
    cp: float        # Specific heat at constant pressure (BTU/lb-R)
    cv: float        # Specific heat at constant volume (BTU/lb-R)
    density: float   # Density (lb/ft³)
    viscosity: float # Dynamic viscosity (cP)
    molecular_weight: float
    specific_gravity: float
    
    # Source indicator
    source: str  # "coolprop" or "fallback"


class GasPropertiesService:
    """
    Service for calculating gas thermodynamic properties.
    Uses CoolProp when available, falls back to constants otherwise.
    """
    
    def __init__(self):
        self.use_coolprop = COOLPROP_AVAILABLE
        logger.info(f"GasPropertiesService initialized (CoolProp: {self.use_coolprop})")
    
    def get_properties(
        self,
        temperature_F: float,
        pressure_psig: float,
        gas_type: GasType = GasType.NATURAL_GAS
    ) -> GasPropertiesResult:
        """
        Calculate gas properties at given temperature and pressure.
        
        Args:
            temperature_F: Temperature in Fahrenheit
            pressure_psig: Pressure in PSIG
            gas_type: Type of gas
            
        Returns:
            GasPropertiesResult with all calculated properties
        """
        # Convert to absolute units
        temp_R = temperature_F + 459.67
        press_psia = pressure_psig + 14.696
        
        if self.use_coolprop:
            return self._calculate_coolprop(temp_R, press_psia, gas_type)
        else:
            return self._calculate_fallback(temp_R, press_psia, gas_type)
    
    def _calculate_coolprop(
        self, temp_R: float, press_psia: float, gas_type: GasType
    ) -> GasPropertiesResult:
        """Calculate properties using CoolProp library."""
        fluid = GAS_FLUID_MAP.get(gas_type, "Methane")
        fallback = FALLBACK_PROPERTIES.get(gas_type, FALLBACK_PROPERTIES[GasType.NATURAL_GAS])
        
        try:
            # Convert to SI units for CoolProp
            temp_K = temp_R / 1.8  # Rankine to Kelvin
            press_Pa = press_psia * 6894.76  # psia to Pascal
            
            # Get properties from CoolProp
            z = PropsSI('Z', 'T', temp_K, 'P', press_Pa, fluid)
            cp_si = PropsSI('Cpmass', 'T', temp_K, 'P', press_Pa, fluid)
            cv_si = PropsSI('Cvmass', 'T', temp_K, 'P', press_Pa, fluid)
            density_si = PropsSI('Dmass', 'T', temp_K, 'P', press_Pa, fluid)
            visc_si = PropsSI('V', 'T', temp_K, 'P', press_Pa, fluid)
            mw = PropsSI('M', fluid) * 1000  # kg/mol to g/mol
            
            # Convert back to US Customary units
            cp = cp_si / 4186.8  # J/kg-K to BTU/lb-R
            cv = cv_si / 4186.8
            k = cp_si / cv_si if cv_si > 0 else fallback["k"]
            density = density_si * 0.0624  # kg/m³ to lb/ft³
            viscosity = visc_si * 1000  # Pa-s to cP
            sg = mw / 28.97  # Relative to air
            
            return GasPropertiesResult(
                temperature_R=temp_R, pressure_psia=press_psia, gas_type=gas_type.value,
                z_factor=round(z, 4), k_value=round(k, 3), cp=round(cp, 4), cv=round(cv, 4),
                density=round(density, 4), viscosity=round(viscosity, 6),
                molecular_weight=round(mw, 2), specific_gravity=round(sg, 3),
                source="coolprop"
            )
            
        except Exception as e:
            logger.warning(f"CoolProp calculation failed: {e}, using fallback")
            return self._calculate_fallback(temp_R, press_psia, gas_type)
    
    def _calculate_fallback(
        self, temp_R: float, press_psia: float, gas_type: GasType
    ) -> GasPropertiesResult:
        """Calculate properties using simplified fallback methods."""
        props = FALLBACK_PROPERTIES.get(gas_type, FALLBACK_PROPERTIES[GasType.NATURAL_GAS])
        
        # Simplified Z-factor correlation (Standing-Katz approximation)
        z_base = props["z"]
        # Adjust Z for pressure (simplified)
        if press_psia > 500:
            z = z_base - 0.0001 * (press_psia - 500)
            z = max(0.7, min(1.0, z))
        else:
            z = z_base
        
        k = props["k"]
        mw = props["mw"]
        sg = props["sg"]
        
        # Simplified ideal gas calculations
        R = 10.73  # psia·ft³/(lbmol·°R)
        density = (press_psia * mw) / (z * R * temp_R) if temp_R > 0 else 0
        
        # Estimate Cp and Cv from k
        # For ideal gas: k = Cp/Cv and Cp - Cv = R/MW
        # Cp = k * R / (MW * (k-1))
        R_mass = 1.986 / mw  # BTU/lb-R
        cv = R_mass / (k - 1) if k > 1 else 0.5
        cp = k * cv
        
        # Viscosity approximation (temperature dependent)
        visc_base = 0.01  # cP at standard conditions
        viscosity = visc_base * (temp_R / 520) ** 0.5
        
        return GasPropertiesResult(
            temperature_R=temp_R, pressure_psia=press_psia, gas_type=gas_type.value,
            z_factor=round(z, 4), k_value=round(k, 3), cp=round(cp, 4), cv=round(cv, 4),
            density=round(density, 4), viscosity=round(viscosity, 6),
            molecular_weight=mw, specific_gravity=sg,
            source="fallback"
        )
    
    def get_z_factor(self, temperature_F: float, pressure_psig: float, 
                     gas_type: GasType = GasType.NATURAL_GAS) -> float:
        """Get compressibility factor (Z) at given conditions."""
        result = self.get_properties(temperature_F, pressure_psig, gas_type)
        return result.z_factor
    
    def get_k_value(self, temperature_F: float, pressure_psig: float,
                    gas_type: GasType = GasType.NATURAL_GAS) -> float:
        """Get isentropic exponent (k = Cp/Cv) at given conditions."""
        result = self.get_properties(temperature_F, pressure_psig, gas_type)
        return result.k_value


# Global singleton
_gas_service: Optional[GasPropertiesService] = None


def get_gas_properties_service() -> GasPropertiesService:
    """Get or create the global gas properties service."""
    global _gas_service
    if _gas_service is None:
        _gas_service = GasPropertiesService()
    return _gas_service
