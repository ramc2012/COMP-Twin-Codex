"""
Physics Engine for Gas Compressor Thermodynamic Calculations

Implements all thermodynamic and mechanical calculations from the Master Plan:
- Compression ratios
- Isentropic and polytropic efficiency
- Volumetric efficiency
- Stage power calculations
- Rod load analysis
- PV diagram synthesis
"""
import math
from dataclasses import dataclass
from typing import Optional, Dict, List, Tuple
from ..core.constants import DEFAULT_GAS, FAHRENHEIT_TO_RANKINE
from ..core.unit_conversion import f_to_r, psig_to_psia


@dataclass
class StageInput:
    """Input parameters for a single compression stage"""
    suction_pressure_psig: float
    discharge_pressure_psig: float
    suction_temp_f: float
    discharge_temp_f: float
    
    # Cylinder geometry (optional - for advanced calcs)
    bore_diameter_in: Optional[float] = None
    stroke_length_in: Optional[float] = None
    rod_diameter_in: Optional[float] = None
    clearance_pct: Optional[float] = 10.0  # Clearance volume %
    num_cylinders: int = 1
    double_acting: bool = True
    
    # Gas properties
    k: float = 1.28  # Cp/Cv (specific heat ratio)
    z: float = 0.98  # Compressibility factor


@dataclass
class StageOutput:
    """Calculated results for a single compression stage"""
    compression_ratio: float
    isentropic_temp_f: float
    isentropic_efficiency: float
    volumetric_efficiency: float
    polytropic_exponent: float
    polytropic_efficiency: float
    gas_horsepower: Optional[float] = None
    displacement_cfm: Optional[float] = None


@dataclass
class CompressorOutput:
    """Overall compressor calculation results"""
    stages: List[StageOutput]
    overall_ratio: float
    total_gas_hp: float
    total_bhp: float


class PhysicsEngine:
    """
    Core physics calculations for reciprocating compressors.
    All formulas based on GPSA Engineering Data Book and Ariel Corp guidelines.
    """
    
    def __init__(self, p_atm: float = 14.696, mech_efficiency: float = 0.97):
        self.p_atm = p_atm  # Atmospheric pressure in PSIA
        self.mech_efficiency = mech_efficiency  # Mechanical efficiency
    
    # =========================================================================
    # THERMODYNAMIC CALCULATIONS
    # =========================================================================
    
    def compression_ratio(
        self,
        p_suction_psig: float,
        p_discharge_psig: float
    ) -> float:
        """
        Calculate compression ratio.
        R = P_discharge_abs / P_suction_abs
        """
        p_s = psig_to_psia(p_suction_psig, self.p_atm)
        p_d = psig_to_psia(p_discharge_psig, self.p_atm)
        return p_d / p_s
    
    def isentropic_discharge_temp(
        self,
        t_suction_f: float,
        ratio: float,
        k: float = 1.28
    ) -> float:
        """
        Ideal (isentropic) discharge temperature.
        T_d,isen = T_s × R^((k-1)/k)
        """
        t_s_r = f_to_r(t_suction_f)
        exponent = (k - 1) / k
        t_d_r = t_s_r * (ratio ** exponent)
        return t_d_r - FAHRENHEIT_TO_RANKINE
    
    def isentropic_efficiency(
        self,
        t_suction_f: float,
        t_discharge_actual_f: float,
        t_discharge_ideal_f: float
    ) -> float:
        """
        Isentropic (adiabatic) efficiency.
        η_isen = (T_d,ideal - T_s) / (T_d,actual - T_s)
        """
        delta_t_ideal = t_discharge_ideal_f - t_suction_f
        delta_t_actual = t_discharge_actual_f - t_suction_f
        
        if abs(delta_t_actual) < 0.1:
            return 100.0  # No compression
        
        efficiency = (delta_t_ideal / delta_t_actual) * 100
        return max(0, min(100, efficiency))  # Clamp to 0-100%
    
    def volumetric_efficiency(
        self,
        ratio: float,
        clearance_pct: float = 10.0,
        k: float = 1.28
    ) -> float:
        """
        Volumetric efficiency based on clearance volume.
        η_vol = 1 - c × (R^(1/k) - 1)
        Where c = clearance % / 100
        """
        c = clearance_pct / 100
        exponent = 1 / k
        eta_vol = 1 - c * ((ratio ** exponent) - 1)
        return max(0, min(1, eta_vol)) * 100  # Return as percentage
    
    def polytropic_exponent(
        self,
        t_suction_f: float,
        t_discharge_f: float,
        ratio: float
    ) -> float:
        """
        Calculate polytropic exponent from actual conditions.
        n = ln(R) / ln(T_d/T_s)
        """
        t_s_r = f_to_r(t_suction_f)
        t_d_r = f_to_r(t_discharge_f)
        
        if t_d_r <= t_s_r or ratio <= 1:
            return 1.0
        
        ln_ratio = math.log(ratio)
        ln_temp_ratio = math.log(t_d_r / t_s_r)
        
        if abs(ln_temp_ratio) < 0.0001:
            return 1.0
        
        return ln_ratio / ln_temp_ratio
    
    def polytropic_efficiency(self, k: float, n: float) -> float:
        """
        Polytropic efficiency from k (isentropic) and n (actual) exponents.
        η_poly = ((k-1)/k) / ((n-1)/n)
        """
        if n <= 1:
            return 100.0
        
        k_term = (k - 1) / k
        n_term = (n - 1) / n
        
        if abs(n_term) < 0.0001:
            return 100.0
        
        return (k_term / n_term) * 100
    
    # =========================================================================
    # POWER CALCULATIONS
    # =========================================================================
    
    def stage_power_hp(
        self,
        p_suction_psig: float,
        ratio: float,
        flow_acfm: float,
        k: float = 1.28,
        eta_isen: float = 80.0
    ) -> float:
        """
        Calculate gas horsepower for a single stage.
        W = (P_s × Q × (k/(k-1)) × (R^((k-1)/k) - 1)) / (229.17 × η_isen/100)
        """
        p_s = psig_to_psia(p_suction_psig, self.p_atm)
        
        k_factor = k / (k - 1)
        ratio_term = (ratio ** ((k - 1) / k)) - 1
        
        # 229.17 converts to HP when P is in PSIA and Q is in CFM
        ghp = (p_s * flow_acfm * k_factor * ratio_term) / (229.17 * (eta_isen / 100))
        return ghp
    
    def displacement_cfm(
        self,
        bore_in: float,
        stroke_in: float,
        rpm: float,
        num_cylinders: int = 1,
        double_acting: bool = True,
        rod_diameter_in: float = 0
    ) -> float:
        """
        Calculate cylinder displacement in CFM.
        V_disp = (π/4) × D² × L × N × RPM / 1728 (for single-acting)
        For double-acting: add CE side (D² - d²)
        1728 converts cubic inches to cubic feet
        """
        area_he = (math.pi / 4) * (bore_in ** 2)  # Head end
        
        if double_acting and rod_diameter_in > 0:
            area_ce = (math.pi / 4) * ((bore_in ** 2) - (rod_diameter_in ** 2))
            total_area = area_he + area_ce
        else:
            total_area = area_he
        
        # Volume per revolution in cubic inches
        vol_per_rev = total_area * stroke_in * num_cylinders
        
        # Convert to CFM
        cfm = (vol_per_rev * rpm) / 1728
        return cfm
    
    # =========================================================================
    # MECHANICAL CALCULATIONS
    # =========================================================================
    
    def rod_load_tension(
        self,
        p_suction_psig: float,
        p_discharge_psig: float,
        bore_in: float,
        rod_diameter_in: float
    ) -> float:
        """
        Calculate rod load in tension (crank end discharge).
        F_tension = P_d × A_CE - P_s × A_HE
        """
        p_s = psig_to_psia(p_suction_psig, self.p_atm)
        p_d = psig_to_psia(p_discharge_psig, self.p_atm)
        
        area_he = (math.pi / 4) * (bore_in ** 2)
        area_ce = (math.pi / 4) * ((bore_in ** 2) - (rod_diameter_in ** 2))
        
        return (p_d * area_ce) - (p_s * area_he)
    
    def rod_load_compression(
        self,
        p_suction_psig: float,
        p_discharge_psig: float,
        bore_in: float,
        rod_diameter_in: float
    ) -> float:
        """
        Calculate rod load in compression (head end discharge).
        F_compression = P_d × A_HE - P_s × A_CE
        """
        p_s = psig_to_psia(p_suction_psig, self.p_atm)
        p_d = psig_to_psia(p_discharge_psig, self.p_atm)
        
        area_he = (math.pi / 4) * (bore_in ** 2)
        area_ce = (math.pi / 4) * ((bore_in ** 2) - (rod_diameter_in ** 2))
        
        return (p_d * area_he) - (p_s * area_ce)
    
    def combined_rod_load(
        self,
        rod_tension: float,
        rod_compression: float
    ) -> float:
        """Maximum combined rod load"""
        return max(abs(rod_tension), abs(rod_compression))
    
    def frame_load_percent(
        self,
        combined_load: float,
        frame_rating: float
    ) -> float:
        """Calculate percentage of frame load limit"""
        if frame_rating <= 0:
            return 0
        return (combined_load / frame_rating) * 100
    
    # =========================================================================
    # ENGINE CALCULATIONS
    # =========================================================================
    
    def exhaust_spread(self, exhaust_temps: List[float]) -> float:
        """Calculate exhaust temperature spread (max - min)"""
        if not exhaust_temps:
            return 0
        return max(exhaust_temps) - min(exhaust_temps)
    
    def exhaust_deviation(self, exhaust_temps: List[float]) -> List[float]:
        """Calculate deviation from average for each cylinder"""
        if not exhaust_temps:
            return []
        avg = sum(exhaust_temps) / len(exhaust_temps)
        return [temp - avg for temp in exhaust_temps]
    
    def engine_load_percent(
        self,
        bhp_actual: float,
        bhp_rated: float
    ) -> float:
        """Calculate engine load as percentage of rated power"""
        if bhp_rated <= 0:
            return 0
        return (bhp_actual / bhp_rated) * 100
    
    # =========================================================================
    # FULL STAGE CALCULATION
    # =========================================================================
    
    def calculate_stage(
        self,
        stage_input: StageInput,
        rpm: Optional[float] = None
    ) -> StageOutput:
        """
        Perform all calculations for a single compression stage.
        """
        # Compression ratio
        ratio = self.compression_ratio(
            stage_input.suction_pressure_psig,
            stage_input.discharge_pressure_psig
        )
        
        # Isentropic (ideal) discharge temperature
        t_ideal = self.isentropic_discharge_temp(
            stage_input.suction_temp_f,
            ratio,
            stage_input.k
        )
        
        # Isentropic efficiency
        eta_isen = self.isentropic_efficiency(
            stage_input.suction_temp_f,
            stage_input.discharge_temp_f,
            t_ideal
        )
        
        # Volumetric efficiency
        eta_vol = self.volumetric_efficiency(
            ratio,
            stage_input.clearance_pct or 10.0,
            stage_input.k
        )
        
        # Polytropic exponent and efficiency
        n = self.polytropic_exponent(
            stage_input.suction_temp_f,
            stage_input.discharge_temp_f,
            ratio
        )
        eta_poly = self.polytropic_efficiency(stage_input.k, n)
        
        # Power calculations (if geometry is available)
        ghp = None
        displacement = None
        
        if stage_input.bore_diameter_in and stage_input.stroke_length_in and rpm:
            displacement = self.displacement_cfm(
                stage_input.bore_diameter_in,
                stage_input.stroke_length_in,
                rpm,
                stage_input.num_cylinders,
                stage_input.double_acting,
                stage_input.rod_diameter_in or 0
            )
            
            actual_flow = displacement * (eta_vol / 100)
            
            ghp = self.stage_power_hp(
                stage_input.suction_pressure_psig,
                ratio,
                actual_flow,
                stage_input.k,
                eta_isen
            )
        
        return StageOutput(
            compression_ratio=round(ratio, 3),
            isentropic_temp_f=round(t_ideal, 1),
            isentropic_efficiency=round(eta_isen, 1),
            volumetric_efficiency=round(eta_vol, 1),
            polytropic_exponent=round(n, 3),
            polytropic_efficiency=round(eta_poly, 1),
            gas_horsepower=round(ghp, 1) if ghp else None,
            displacement_cfm=round(displacement, 1) if displacement else None
        )
    
    # =========================================================================
    # PV DIAGRAM SYNTHESIS
    # =========================================================================
    
    def synthesize_pv_diagram(
        self,
        p_suction_psia: float,
        p_discharge_psia: float,
        clearance_vol_pct: float,
        swept_volume: float,  # cubic inches
        n: float = 1.25,  # polytropic exponent
        num_points: int = 100
    ) -> Tuple[List[float], List[float]]:
        """
        Synthesize an ideal PV diagram from operating conditions.
        Returns (volumes, pressures) as point arrays.
        
        The diagram follows: Compression → Discharge → Re-expansion → Suction
        """
        v_clearance = swept_volume * (clearance_vol_pct / 100)
        v_max = swept_volume + v_clearance
        
        volumes = []
        pressures = []
        
        # Point 1: BDC at suction pressure (start of compression)
        volumes.append(v_max)
        pressures.append(p_suction_psia)
        
        # 1→2: Compression (polytropic: PV^n = const)
        C_comp = p_suction_psia * (v_max ** n)
        
        # Find volume at end of compression (when P reaches P_discharge)
        v_comp_end = (C_comp / p_discharge_psia) ** (1/n)
        
        points_12 = num_points // 4
        for i in range(1, points_12 + 1):
            v = v_max - ((v_max - v_comp_end) * i / points_12)
            p = C_comp / (v ** n)
            volumes.append(v)
            pressures.append(p)
        
        # 2→3: Discharge (constant pressure)
        points_23 = num_points // 4
        for i in range(1, points_23 + 1):
            v = v_comp_end - ((v_comp_end - v_clearance) * i / points_23)
            volumes.append(v)
            pressures.append(p_discharge_psia)
        
        # 3→4: Re-expansion (polytropic: PV^n = const)
        C_exp = p_discharge_psia * (v_clearance ** n)
        
        # Find volume at end of re-expansion (when P drops to P_suction)
        v_exp_end = (C_exp / p_suction_psia) ** (1/n)
        
        points_34 = num_points // 4
        for i in range(1, points_34 + 1):
            v = v_clearance + ((v_exp_end - v_clearance) * i / points_34)
            p = C_exp / (v ** n)
            volumes.append(v)
            pressures.append(p)
        
        # 4→1: Suction (constant pressure)
        points_41 = num_points // 4
        for i in range(1, points_41 + 1):
            v = v_exp_end + ((v_max - v_exp_end) * i / points_41)
            volumes.append(v)
            pressures.append(p_suction_psia)
        
        return volumes, pressures
