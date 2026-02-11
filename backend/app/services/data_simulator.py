"""
Data Simulator for GCS Digital Twin

Generates realistic sensor data for testing when no Modbus device is available.
Simulates a 3-stage reciprocating compressor with gas engine.
"""
import math
import random
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from datetime import datetime


@dataclass
class SimulatorConfig:
    """Configuration for simulated compressor operation"""
    # Engine
    engine_rpm_base: float = 1200.0
    engine_rpm_variance: float = 5.0
    engine_rated_hp: float = 1500.0
    
    # Compressor stages (typical 3-stage)
    num_stages: int = 3
    
    # Design pressures (PSIG)
    stage1_suction_design: float = 85.0
    stage1_discharge_design: float = 327.0
    stage2_discharge_design: float = 510.0
    stage3_discharge_design: float = 1050.0
    
    # Design temperatures (°F)
    suction_temp_design: float = 80.0
    interstage_approach: float = 15.0  # Cooler approach temperature
    
    # Gas properties
    k: float = 1.28  # Specific heat ratio
    
    # Engine state (8 = RUNNING)
    engine_state: int = 8


class DataSimulator:
    """
    Generates realistic time-varying sensor data for testing.
    Includes small variations, trends, and occasional anomalies.
    """
    
    def __init__(self, config: Optional[SimulatorConfig] = None):
        self.config = config or SimulatorConfig()
        self.start_time = time.time()
        self._hour_meter_start = 14523.7  # Start with existing hours
        self._trend_offset = 0.0  # Slow trend for simulation
    
    def _add_noise(self, value: float, variance: float) -> float:
        """Add Gaussian noise to a value"""
        return value + random.gauss(0, variance)
    
    def _slow_trend(self) -> float:
        """Generate slow sinusoidal trend (simulates process changes)"""
        elapsed = time.time() - self.start_time
        return math.sin(elapsed / 300) * 2  # 5-minute period, ±2 units
    
    def _calculate_stage_discharge_temp(
        self,
        suction_temp: float,
        ratio: float,
        k: float,
        efficiency: float = 0.82
    ) -> float:
        """Calculate discharge temp from isentropic relations + inefficiency"""
        # Ideal discharge temp (Rankine)
        t_s_r = suction_temp + 459.67
        t_d_ideal_r = t_s_r * (ratio ** ((k - 1) / k))
        t_d_ideal = t_d_ideal_r - 459.67
        
        # Actual temp is higher due to inefficiency
        delta_t_ideal = t_d_ideal - suction_temp
        delta_t_actual = delta_t_ideal / efficiency
        
        return suction_temp + delta_t_actual
    
    def generate_snapshot(self) -> Dict:
        """
        Generate a complete snapshot of all sensor values.
        Returns a dictionary mimicking Modbus register data structure.
        """
        c = self.config
        trend = self._slow_trend()
        
        # Engine RPM
        engine_rpm = self._add_noise(c.engine_rpm_base + trend, c.engine_rpm_variance)
        
        # Hour meter (increments in real-time)
        elapsed_hours = (time.time() - self.start_time) / 3600
        hour_meter = self._hour_meter_start + elapsed_hours
        
        # === STAGE 1 ===
        stg1_suction_press = self._add_noise(c.stage1_suction_design + trend * 0.5, 1.0)
        stg1_discharge_press = self._add_noise(c.stage1_discharge_design + trend, 2.0)
        stg1_ratio = (stg1_discharge_press + 14.696) / (stg1_suction_press + 14.696)
        
        stg1_suction_temp = self._add_noise(c.suction_temp_design, 1.0)
        stg1_discharge_temp = self._calculate_stage_discharge_temp(
            stg1_suction_temp, stg1_ratio, c.k, 0.82
        )
        stg1_discharge_temp = self._add_noise(stg1_discharge_temp, 2.0)
        
        # === STAGE 2 ===
        stg2_suction_press = stg1_discharge_press - self._add_noise(5.0, 0.5)  # Piping loss
        stg2_discharge_press = self._add_noise(c.stage2_discharge_design + trend * 1.5, 3.0)
        stg2_ratio = (stg2_discharge_press + 14.696) / (stg2_suction_press + 14.696)
        
        stg2_suction_temp = stg1_discharge_temp - c.interstage_approach + self._add_noise(0, 2.0)
        stg2_discharge_temp = self._calculate_stage_discharge_temp(
            stg2_suction_temp, stg2_ratio, c.k, 0.80
        )
        stg2_discharge_temp = self._add_noise(stg2_discharge_temp, 2.0)
        
        # === STAGE 3 ===
        stg3_suction_press = stg2_discharge_press - self._add_noise(5.0, 0.5)
        stg3_discharge_press = self._add_noise(c.stage3_discharge_design + trend * 2, 5.0)
        stg3_ratio = (stg3_discharge_press + 14.696) / (stg3_suction_press + 14.696)
        
        stg3_suction_temp = stg2_discharge_temp - c.interstage_approach + self._add_noise(0, 2.0)
        stg3_discharge_temp = self._calculate_stage_discharge_temp(
            stg3_suction_temp, stg3_ratio, c.k, 0.78
        )
        stg3_discharge_temp = self._add_noise(stg3_discharge_temp, 3.0)
        
        # === COMPRESSOR CYLINDER TEMPS ===
        cyl1_temp = self._add_noise(stg1_discharge_temp, 3.0)
        cyl2_temp = self._add_noise(stg1_discharge_temp + 2, 3.0)
        cyl3_temp = self._add_noise(stg2_discharge_temp, 3.0)
        cyl4_temp = self._add_noise(stg3_discharge_temp, 4.0)
        
        # === ENGINE VITALS ===
        engine_oil_press = self._add_noise(65.0, 2.0)
        engine_oil_temp = self._add_noise(185.0 + trend * 0.5, 2.0)
        comp_oil_press = self._add_noise(55.0, 1.5)
        comp_oil_temp = self._add_noise(145.0 + trend * 0.5, 2.0)
        jacket_water_temp = self._add_noise(175.0, 2.0)
        
        # === EXHAUST TEMPS (6 cylinders L/R) ===
        base_exhaust = 950.0 + trend * 2
        exhaust_temps = {
            "cyl1_left": self._add_noise(base_exhaust, 15.0),
            "cyl1_right": self._add_noise(base_exhaust + 10, 15.0),
            "cyl2_left": self._add_noise(base_exhaust + 5, 15.0),
            "cyl2_right": self._add_noise(base_exhaust + 15, 15.0),
            "cyl3_left": self._add_noise(base_exhaust - 10, 15.0),
            "cyl3_right": self._add_noise(base_exhaust + 5, 15.0),
            "cyl4_left": self._add_noise(base_exhaust + 20, 15.0),
            "cyl4_right": self._add_noise(base_exhaust + 8, 15.0),
            "cyl5_left": self._add_noise(base_exhaust - 5, 15.0),
            "cyl5_right": self._add_noise(base_exhaust + 12, 15.0),
            "cyl6_left": self._add_noise(base_exhaust + 2, 15.0),
            "cyl6_right": self._add_noise(base_exhaust + 18, 15.0),
        }
        exhaust_list = list(exhaust_temps.values())
        exhaust_spread = max(exhaust_list) - min(exhaust_list)
        exhaust_avg = sum(exhaust_list) / len(exhaust_list)
        
        # Turbo temps
        pre_turbo_left = self._add_noise(900.0, 20.0)
        pre_turbo_right = self._add_noise(910.0, 20.0)
        post_turbo_left = self._add_noise(750.0, 15.0)
        post_turbo_right = self._add_noise(755.0, 15.0)
        
        # === BEARING TEMPS ===
        base_bearing = 165.0
        bearing_temps = [
            self._add_noise(base_bearing, 3.0),      # Bearing 1
            self._add_noise(base_bearing + 2, 3.0),  # Bearing 2
            self._add_noise(base_bearing - 1, 3.0),  # Bearing 3
            self._add_noise(base_bearing + 5, 3.0),  # Bearing 4
            self._add_noise(base_bearing + 3, 3.0),  # Bearing 5
            self._add_noise(base_bearing + 1, 3.0),  # Bearing 6
            self._add_noise(base_bearing + 4, 3.0),  # Bearing 7
            self._add_noise(base_bearing + 2, 3.0),  # Bearing 8
            self._add_noise(base_bearing + 6, 3.0),  # Bearing 9
        ]
        
        # === GAS DETECTORS ===
        gas_detector_comp = self._add_noise(0.5, 0.2)  # %LEL
        gas_detector_engine = self._add_noise(0.3, 0.15)
        
        # === CONTROL OUTPUTS ===
        suction_valve_pct = self._add_noise(75.0, 1.0)
        speed_control_pct = self._add_noise(80.0, 2.0)
        recycle_valve_pct = self._add_noise(15.0, 2.0)
        
        # === BUILD SNAPSHOT ===
        return {
            "timestamp": datetime.now().isoformat(),
            "engine_state": c.engine_state,
            "engine_state_label": "RUNNING",
            "hour_meter": round(hour_meter, 1),
            "fault_code": 255,  # No fault
            
            # Engine
            "engine_rpm": round(engine_rpm, 1),
            "engine_oil_press": round(engine_oil_press, 1),
            "engine_oil_temp": round(engine_oil_temp, 1),
            "jacket_water_temp": round(jacket_water_temp, 1),
            
            # Compressor oil
            "comp_oil_press": round(comp_oil_press, 1),
            "comp_oil_temp": round(comp_oil_temp, 1),
            
            # Stage 1
            "stg1_suction_press": round(stg1_suction_press, 1),
            "stg1_discharge_press": round(stg1_discharge_press, 1),
            "stg1_suction_temp": round(stg1_suction_temp, 1),
            "stg1_discharge_temp": round(stg1_discharge_temp, 1),
            "stg1_ratio": round(stg1_ratio, 3),
            
            # Stage 2
            "stg2_suction_press": round(stg2_suction_press, 1),
            "stg2_discharge_press": round(stg2_discharge_press, 1),
            "stg2_suction_temp": round(stg2_suction_temp, 1),
            "stg2_discharge_temp": round(stg2_discharge_temp, 1),
            "stg2_ratio": round(stg2_ratio, 3),
            
            # Stage 3
            "stg3_suction_press": round(stg3_suction_press, 1),
            "stg3_discharge_press": round(stg3_discharge_press, 1),
            "stg3_suction_temp": round(stg3_suction_temp, 1),
            "stg3_discharge_temp": round(stg3_discharge_temp, 1),
            "stg3_ratio": round(stg3_ratio, 3),
            
            # Cylinder discharge temps
            "cyl1_discharge_temp": round(cyl1_temp, 1),
            "cyl2_discharge_temp": round(cyl2_temp, 1),
            "cyl3_discharge_temp": round(cyl3_temp, 1),
            "cyl4_discharge_temp": round(cyl4_temp, 1),
            
            # Exhaust
            "exhaust_temps": {k: round(v, 1) for k, v in exhaust_temps.items()},
            "exhaust_spread": round(exhaust_spread, 1),
            "exhaust_avg": round(exhaust_avg, 1),
            "pre_turbo_left": round(pre_turbo_left, 1),
            "pre_turbo_right": round(pre_turbo_right, 1),
            "post_turbo_left": round(post_turbo_left, 1),
            "post_turbo_right": round(post_turbo_right, 1),
            
            # Bearings
            "bearing_temps": [round(t, 1) for t in bearing_temps],
            
            # Gas detectors
            "gas_detector_comp": round(gas_detector_comp, 2),
            "gas_detector_engine": round(gas_detector_engine, 2),
            
            # Control outputs
            "suction_valve_pct": round(suction_valve_pct, 1),
            "speed_control_pct": round(speed_control_pct, 1),
            "recycle_valve_pct": round(recycle_valve_pct, 1),
        }


# Global simulator instance
_simulator: Optional[DataSimulator] = None


def get_simulator() -> DataSimulator:
    """Get or create the global simulator instance"""
    global _simulator
    if _simulator is None:
        _simulator = DataSimulator()
    return _simulator
