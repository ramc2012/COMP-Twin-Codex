"""
Extended Physics Engine
Adds power, rod load, gas horsepower, and volumetric flow calculations.
"""
import math
from dataclasses import dataclass
from typing import Dict, Optional, List
import logging

logger = logging.getLogger(__name__)

# Constants
GAS_CONSTANT_R = 1545.35  # ft-lbf/(lbmol·°R)
GRAVITY = 32.174  # ft/s²


@dataclass
class StageGeometry:
    """Cylinder geometry for a compression stage."""
    stage_num: int
    bore_inches: float = 8.0
    stroke_inches: float = 5.0
    rod_diameter_inches: float = 2.0
    clearance_pct_he: float = 12.0  # Head end
    clearance_pct_ce: float = 15.0  # Crank end
    
    @property
    def bore_area_sqin(self) -> float:
        return math.pi * (self.bore_inches / 2) ** 2
    
    @property
    def rod_area_sqin(self) -> float:
        return math.pi * (self.rod_diameter_inches / 2) ** 2
    
    @property
    def displacement_cuft_he(self) -> float:
        """Head end displacement in cubic feet."""
        return (self.bore_area_sqin * self.stroke_inches) / 1728
    
    @property
    def displacement_cuft_ce(self) -> float:
        """Crank end displacement in cubic feet."""
        return ((self.bore_area_sqin - self.rod_area_sqin) * self.stroke_inches) / 1728


@dataclass
class GasProperties:
    """Gas properties for calculations."""
    k: float = 1.28  # Isentropic exponent
    z_suction: float = 0.98
    z_discharge: float = 0.95
    molecular_weight: float = 18.5
    specific_gravity: float = 0.65


@dataclass
class OperatingConditions:
    """Current operating conditions for a stage."""
    p_suction_psia: float
    p_discharge_psia: float
    t_suction_f: float
    t_discharge_f: float
    speed_rpm: float


class ExtendedPhysicsEngine:
    """Extended physics calculations for compressor analysis."""
    
    def __init__(self):
        self.stages: Dict[int, StageGeometry] = {}
        self.gas = GasProperties()
    
    def set_stage_geometry(self, stage: StageGeometry):
        """Set geometry for a stage."""
        self.stages[stage.stage_num] = stage
    
    def set_gas_properties(self, gas: GasProperties):
        """Set gas properties."""
        self.gas = gas
    
    def calculate_compression_ratio(self, p_suction: float, p_discharge: float) -> float:
        """Calculate compression ratio."""
        if p_suction <= 0:
            return 0
        return p_discharge / p_suction
    
    def calculate_volumetric_efficiency(self, stage_num: int, ratio: float) -> float:
        """Calculate volumetric efficiency."""
        if stage_num not in self.stages:
            return 0.85
        
        stage = self.stages[stage_num]
        clearance = stage.clearance_pct_he / 100
        
        # Volumetric efficiency: EVol = 1 - c * (r^(1/k) - 1)
        if ratio <= 0:
            return 0
        
        ev = 1 - clearance * (ratio ** (1 / self.gas.k) - 1)
        return max(0, min(1, ev))
    
    def calculate_isentropic_head(self, conditions: OperatingConditions) -> float:
        """
        Calculate isentropic head in ft-lbf/lbm.
        H_is = (Z_avg * R * T1 / MW) * (k/(k-1)) * ((P2/P1)^((k-1)/k) - 1)
        """
        k = self.gas.k
        z_avg = (self.gas.z_suction + self.gas.z_discharge) / 2
        t_suction_r = conditions.t_suction_f + 459.67
        ratio = conditions.p_discharge_psia / conditions.p_suction_psia
        
        exponent = (k - 1) / k
        head = (z_avg * GAS_CONSTANT_R * t_suction_r / self.gas.molecular_weight) * \
               (k / (k - 1)) * (ratio ** exponent - 1)
        
        return head
    
    def calculate_gas_horsepower(self, stage_num: int, conditions: OperatingConditions,
                                  flow_acfm: float) -> float:
        """
        Calculate gas horsepower.
        GHP = (P1 * ACFM * (k/(k-1)) * ((P2/P1)^((k-1)/k) - 1)) / 33000
        """
        k = self.gas.k
        p1 = conditions.p_suction_psia
        ratio = conditions.p_discharge_psia / p1
        
        exponent = (k - 1) / k
        
        ghp = (p1 * flow_acfm * (k / (k - 1)) * (ratio ** exponent - 1)) / 33000
        return ghp
    
    def calculate_actual_flow_acfm(self, stage_num: int, conditions: OperatingConditions) -> float:
        """
        Calculate actual flow in ACFM based on displacement and volumetric efficiency.
        """
        if stage_num not in self.stages:
            return 0
        
        stage = self.stages[stage_num]
        ratio = self.calculate_compression_ratio(
            conditions.p_suction_psia, 
            conditions.p_discharge_psia
        )
        ev = self.calculate_volumetric_efficiency(stage_num, ratio)
        
        # Displacement per minute = displacement * 2 (double-acting) * RPM
        disp_he = stage.displacement_cuft_he
        disp_ce = stage.displacement_cuft_ce
        total_disp = (disp_he + disp_ce) * conditions.speed_rpm
        
        return total_disp * ev
    
    def calculate_rod_load(self, stage_num: int, conditions: OperatingConditions) -> Dict[str, float]:
        """
        Calculate compression and tension rod loads.
        """
        if stage_num not in self.stages:
            return {"compression": 0, "tension": 0, "max": 0}
        
        stage = self.stages[stage_num]
        p_suction = conditions.p_suction_psia
        p_discharge = conditions.p_discharge_psia
        
        # Areas in square inches
        bore_area = stage.bore_area_sqin
        rod_area = stage.rod_area_sqin
        
        # Head end forces
        f_he_compression = p_discharge * bore_area
        f_he_tension = p_suction * bore_area
        
        # Crank end forces (net of rod area)
        f_ce_compression = p_discharge * (bore_area - rod_area)
        f_ce_tension = p_suction * (bore_area - rod_area)
        
        # Maximum compression (HE discharge + CE suction)
        compression = f_he_compression - f_ce_tension
        
        # Maximum tension (HE suction + CE discharge acts in tension)
        tension = f_ce_compression - f_he_tension
        
        # Add inertia correction for dynamic loads (simplified)
        inertia_factor = 0.1 * (conditions.speed_rpm / 1000) ** 2
        
        return {
            "compression_lbf": round(compression * (1 + inertia_factor), 0),
            "tension_lbf": round(abs(tension) * (1 + inertia_factor), 0),
            "max_lbf": round(max(abs(compression), abs(tension)) * (1 + inertia_factor), 0),
            "inertia_factor": round(inertia_factor, 3)
        }
    
    def calculate_power(self, stage_num: int, conditions: OperatingConditions) -> Dict[str, float]:
        """
        Calculate indicated and brake horsepower.
        """
        acfm = self.calculate_actual_flow_acfm(stage_num, conditions)
        ghp = self.calculate_gas_horsepower(stage_num, conditions, acfm)
        
        # Mechanical efficiency (typically 85-95%)
        mech_eff = 0.90
        
        # Indicated HP (gas + friction losses)
        ihp = ghp / mech_eff
        
        # Brake HP (at crankshaft)
        bhp = ihp / 0.95  # Additional drive losses
        
        return {
            "gas_hp": round(ghp, 2),
            "indicated_hp": round(ihp, 2),
            "brake_hp": round(bhp, 2),
            "actual_flow_acfm": round(acfm, 1),
            "mechanical_efficiency": mech_eff
        }
    
    def calculate_all_stages(self, stages_data: List[Dict]) -> List[Dict]:
        """
        Calculate extended physics for all stages.
        stages_data: list of dicts with p_suction, p_discharge, t_suction, t_discharge, rpm
        """
        results = []
        total_power = 0
        
        for i, data in enumerate(stages_data, 1):
            conditions = OperatingConditions(
                p_suction_psia=data.get("p_suction_psia", 50),
                p_discharge_psia=data.get("p_discharge_psia", 200),
                t_suction_f=data.get("t_suction_f", 80),
                t_discharge_f=data.get("t_discharge_f", 200),
                speed_rpm=data.get("rpm", 1000)
            )
            
            ratio = self.calculate_compression_ratio(
                conditions.p_suction_psia, 
                conditions.p_discharge_psia
            )
            ev = self.calculate_volumetric_efficiency(i, ratio)
            rod_load = self.calculate_rod_load(i, conditions)
            power = self.calculate_power(i, conditions)
            head = self.calculate_isentropic_head(conditions)
            
            total_power += power["brake_hp"]
            
            results.append({
                "stage": i,
                "compression_ratio": round(ratio, 3),
                "volumetric_efficiency": round(ev * 100, 1),
                "isentropic_head_ft": round(head, 0),
                "rod_load": rod_load,
                "power": power
            })
        
        return {
            "stages": results,
            "total_brake_hp": round(total_power, 1)
        }


# Singleton instance
_physics_engine: Optional[ExtendedPhysicsEngine] = None


def get_extended_physics_engine() -> ExtendedPhysicsEngine:
    """Get or create extended physics engine."""
    global _physics_engine
    if _physics_engine is None:
        _physics_engine = ExtendedPhysicsEngine()
        # Set default 3-stage geometry
        for i in range(1, 4):
            bore = 8 - (i - 1) * 1.5  # 8, 6.5, 5 inches
            _physics_engine.set_stage_geometry(StageGeometry(
                stage_num=i,
                bore_inches=bore,
                stroke_inches=5.0,
                clearance_pct_he=10 + i * 3  # 13%, 16%, 19%
            ))
    return _physics_engine
