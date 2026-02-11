"""
PV and PT diagram API routes
Enhanced with Model vs Measured distinction and deviation analysis.
"""
from fastapi import APIRouter
from typing import Dict, List, Optional
from datetime import datetime
import math

from ...services.physics_engine import PhysicsEngine
from ...services.data_simulator import get_simulator
from ...core.unit_conversion import psig_to_psia

router = APIRouter(prefix="/api/units", tags=["diagrams"])


def calculate_ideal_discharge_temp(t_suction_f: float, p_suction_psig: float, 
                                    p_discharge_psig: float, k: float = 1.28) -> float:
    """Calculate ideal isentropic discharge temperature."""
    t_s_r = t_suction_f + 459.67  # Convert to Rankine
    p_s_psia = psig_to_psia(p_suction_psig)
    p_d_psia = psig_to_psia(p_discharge_psig)
    
    ratio = p_d_psia / p_s_psia if p_s_psia > 0 else 1
    t_d_ideal_r = t_s_r * (ratio ** ((k - 1) / k))
    return t_d_ideal_r - 459.67  # Back to Fahrenheit


def calculate_deviation_metrics(actual_temp: float, ideal_temp: float, 
                                 t_suction: float) -> Dict:
    """
    Calculate deviation between actual and ideal discharge temperatures.
    Returns metrics useful for valve health assessment.
    """
    deviation_f = actual_temp - ideal_temp
    deviation_pct = abs(deviation_f) / (ideal_temp - t_suction) * 100 if (ideal_temp - t_suction) > 0 else 0
    
    # Valve health indicators based on deviation
    # Higher than ideal = valve leakage or late closing
    # Lower than ideal = early closing or gas bypass
    if deviation_pct < 5:
        health_status = "GOOD"
        health_color = "green"
    elif deviation_pct < 15:
        health_status = "MARGINAL"
        health_color = "yellow"
    else:
        health_status = "POOR"
        health_color = "red"
    
    return {
        "deviation_f": round(deviation_f, 1),
        "deviation_pct": round(deviation_pct, 1),
        "health_status": health_status,
        "health_color": health_color,
        "assessment": "Higher than ideal - possible valve leakage" if deviation_f > 5 
                      else "Lower than ideal - possible early closing" if deviation_f < -5
                      else "Within normal range"
    }


@router.get("/{unit_id}/diagrams/pv")
async def get_pv_diagram(unit_id: str, stage: int = 1, include_measured: bool = False) -> Dict:
    """
    Get PV diagram data points for a specific stage.
    
    Returns:
    - Model (synthesized) PV curve based on ideal polytropic compression
    - Measured PV data if high-speed sensors available (future)
    - Deviation metrics for valve health assessment
    """
    simulator = get_simulator()
    data = simulator.generate_snapshot()
    physics = PhysicsEngine()
    
    # Get stage pressures and temps
    stage_data = {
        1: ("stg1_suction_press", "stg1_discharge_press", "stg1_suction_temp", "stg1_discharge_temp"),
        2: ("stg2_suction_press", "stg2_discharge_press", "stg2_suction_temp", "stg2_discharge_temp"),
        3: ("stg3_suction_press", "stg3_discharge_press", "stg3_suction_temp", "stg3_discharge_temp"),
    }
    
    keys = stage_data.get(stage, stage_data[1])
    p_suction = data[keys[0]]
    p_discharge = data[keys[1]]
    t_suction = data[keys[2]]
    t_discharge_actual = data[keys[3]]
    
    p_s_psia = psig_to_psia(p_suction)
    p_d_psia = psig_to_psia(p_discharge)
    
    # Cylinder geometry (should come from config)
    bore = 8.0  # inches
    stroke = 5.0  # inches
    clearance_pct = 12.0
    swept_volume = (3.14159 / 4) * (bore ** 2) * stroke
    
    # Synthesize MODEL PV diagram
    volumes, pressures = physics.synthesize_pv_diagram(
        p_suction_psia=p_s_psia,
        p_discharge_psia=p_d_psia,
        clearance_vol_pct=clearance_pct,
        swept_volume=swept_volume,
        n=1.25,
        num_points=100
    )
    
    # Calculate ideal discharge temp and deviation
    t_discharge_ideal = calculate_ideal_discharge_temp(t_suction, p_suction, p_discharge)
    deviation = calculate_deviation_metrics(t_discharge_actual, t_discharge_ideal, t_suction)
    
    response = {
        "unit_id": unit_id,
        "stage": stage,
        "timestamp": data["timestamp"],
        "source": "MODEL",  # Key distinction
        "model_data": {
            "volumes": volumes,
            "pressures": pressures,
            "description": "Ideal polytropic compression curve (n=1.25)"
        },
        "measured_data": None,  # Placeholder for future high-speed sensors
        "operating_conditions": {
            "suction_pressure_psia": round(p_s_psia, 2),
            "discharge_pressure_psia": round(p_d_psia, 2),
            "suction_temp_f": round(t_suction, 1),
            "discharge_temp_actual_f": round(t_discharge_actual, 1),
            "discharge_temp_ideal_f": round(t_discharge_ideal, 1),
            "compression_ratio": round(p_d_psia / p_s_psia, 2) if p_s_psia > 0 else 0
        },
        "deviation_analysis": deviation,
        "valve_health_proxy": {
            "status": deviation["health_status"],
            "indicator": "🟢" if deviation["health_status"] == "GOOD" 
                        else "🟡" if deviation["health_status"] == "MARGINAL" 
                        else "🔴",
            "temperature_deviation_f": deviation["deviation_f"],
            "note": "Based on discharge temp deviation from ideal. Full valve analysis requires high-speed P sensors."
        },
        "swept_volume_cuin": round(swept_volume, 2)
    }
    
    # If measured data becomes available in future
    if include_measured:
        response["measured_data"] = {
            "available": False,
            "message": "High-speed pressure transducers not configured"
        }
    
    return response


@router.get("/{unit_id}/diagrams/pt")
async def get_pt_diagram(unit_id: str) -> Dict:
    """
    Get PT (Pressure-Temperature) path through all stages.
    Includes both actual and ideal paths for comparison.
    """
    simulator = get_simulator()
    data = simulator.generate_snapshot()
    
    path_points = []
    ideal_path = []
    
    stages = [
        ("Stage 1 Suction", "stg1_suction_press", "stg1_suction_temp", "suction"),
        ("Stage 1 Discharge", "stg1_discharge_press", "stg1_discharge_temp", "discharge"),
        ("After Cooler 1", "stg2_suction_press", "stg2_suction_temp", "cooler"),
        ("Stage 2 Discharge", "stg2_discharge_press", "stg2_discharge_temp", "discharge"),
        ("After Cooler 2", "stg3_suction_press", "stg3_suction_temp", "cooler"),
        ("Stage 3 Discharge", "stg3_discharge_press", "stg3_discharge_temp", "discharge"),
    ]
    
    # Build actual path
    for label, p_key, t_key, point_type in stages:
        path_points.append({
            "label": label,
            "pressure_psig": data[p_key],
            "temperature_f": data[t_key],
            "type": point_type,
            "source": "MEASURED"
        })
    
    # Build ideal path (isentropic compression + perfect cooling)
    k = 1.28
    # Stage 1
    t1_s = data["stg1_suction_temp"]
    p1_s = data["stg1_suction_press"]
    p1_d = data["stg1_discharge_press"]
    t1_d_ideal = calculate_ideal_discharge_temp(t1_s, p1_s, p1_d, k)
    
    ideal_path.append({"label": "Stg1 Suction", "pressure_psig": p1_s, "temperature_f": t1_s})
    ideal_path.append({"label": "Stg1 Discharge (Ideal)", "pressure_psig": p1_d, "temperature_f": round(t1_d_ideal, 1)})
    
    # Stage 2 (assume perfect cooling to suction temp)
    p2_s = data["stg2_suction_press"]
    t2_s = data["stg2_suction_temp"]
    p2_d = data["stg2_discharge_press"]
    t2_d_ideal = calculate_ideal_discharge_temp(t2_s, p2_s, p2_d, k)
    
    ideal_path.append({"label": "After Cooler 1 (Ideal)", "pressure_psig": p2_s, "temperature_f": t2_s})
    ideal_path.append({"label": "Stg2 Discharge (Ideal)", "pressure_psig": p2_d, "temperature_f": round(t2_d_ideal, 1)})
    
    # Stage 3
    p3_s = data["stg3_suction_press"]
    t3_s = data["stg3_suction_temp"]
    p3_d = data["stg3_discharge_press"]
    t3_d_ideal = calculate_ideal_discharge_temp(t3_s, p3_s, p3_d, k)
    
    ideal_path.append({"label": "After Cooler 2 (Ideal)", "pressure_psig": p3_s, "temperature_f": t3_s})
    ideal_path.append({"label": "Stg3 Discharge (Ideal)", "pressure_psig": p3_d, "temperature_f": round(t3_d_ideal, 1)})
    
    return {
        "unit_id": unit_id,
        "timestamp": data["timestamp"],
        "actual_path": path_points,
        "ideal_path": ideal_path,
        "path": path_points,  # Backward compatibility
        "legend": {
            "actual": {"color": "blue", "style": "solid", "label": "Actual (Measured)"},
            "ideal": {"color": "gray", "style": "dashed", "label": "Ideal (Isentropic)"}
        }
    }


@router.get("/{unit_id}/diagrams/valve-health")
async def get_valve_health_summary(unit_id: str) -> Dict:
    """
    Get valve health summary based on temperature deviation analysis.
    This is a proxy using discharge temp deviation until high-speed sensors available.
    """
    simulator = get_simulator()
    data = simulator.generate_snapshot()
    
    stages = []
    for stage in [1, 2, 3]:
        keys = {
            1: ("stg1_suction_press", "stg1_discharge_press", "stg1_suction_temp", "stg1_discharge_temp"),
            2: ("stg2_suction_press", "stg2_discharge_press", "stg2_suction_temp", "stg2_discharge_temp"),
            3: ("stg3_suction_press", "stg3_discharge_press", "stg3_suction_temp", "stg3_discharge_temp"),
        }[stage]
        
        t_suction = data[keys[2]]
        t_discharge = data[keys[3]]
        t_ideal = calculate_ideal_discharge_temp(t_suction, data[keys[0]], data[keys[1]])
        deviation = calculate_deviation_metrics(t_discharge, t_ideal, t_suction)
        
        stages.append({
            "stage": stage,
            "suction_valve_health": deviation["health_status"],
            "discharge_valve_health": deviation["health_status"],
            "indicator": "🟢" if deviation["health_status"] == "GOOD" 
                        else "🟡" if deviation["health_status"] == "MARGINAL" 
                        else "🔴",
            "deviation_f": deviation["deviation_f"],
            "deviation_pct": deviation["deviation_pct"],
            "assessment": deviation["assessment"]
        })
    
    overall = "GOOD" if all(s["suction_valve_health"] == "GOOD" for s in stages) else \
              "MARGINAL" if any(s["suction_valve_health"] == "POOR" for s in stages) == False else "POOR"
    
    return {
        "unit_id": unit_id,
        "timestamp": data["timestamp"],
        "overall_status": overall,
        "overall_indicator": "🟢" if overall == "GOOD" else "🟡" if overall == "MARGINAL" else "🔴",
        "stages": stages,
        "methodology": "Temperature deviation analysis (proxy for valve health)",
        "note": "For accurate valve diagnostics, install high-speed pressure transducers"
    }
