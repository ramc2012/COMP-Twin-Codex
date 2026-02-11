"""Live data schemas"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict


class SensorValue(BaseModel):
    """Single sensor reading with quality indicator"""
    value: float
    unit: str
    quality: str = "LIVE"  # LIVE, CALCULATED, MANUAL, DEFAULT, BAD


class EngineStateSchema(BaseModel):
    """Engine state information"""
    state_code: int
    state_label: str
    hour_meter: float
    fault_code: int


class StageDataSchema(BaseModel):
    """Per-stage sensor data and calculations"""
    stage_number: int
    suction_pressure: SensorValue
    discharge_pressure: SensorValue
    suction_temp: SensorValue
    discharge_temp: SensorValue
    compression_ratio: float
    isentropic_efficiency: float
    volumetric_efficiency: float


class LiveDataSnapshot(BaseModel):
    """Complete live data snapshot for dashboard"""
    timestamp: str
    unit_id: str = "GCS-001"
    
    # Engine state
    engine_state: EngineStateSchema
    
    # Engine vitals
    engine_rpm: SensorValue
    engine_oil_press: SensorValue
    engine_oil_temp: SensorValue
    jacket_water_temp: SensorValue
    
    # Compressor vitals
    comp_oil_press: SensorValue
    comp_oil_temp: SensorValue
    
    # Stages
    stages: List[StageDataSchema]
    
    # Overall metrics
    overall_ratio: float
    total_bhp: float
    
    # Exhaust
    exhaust_spread: float
    exhaust_temps: Dict[str, float]
    
    # Bearings
    bearing_temps: List[float]
    
    # Active alarms
    active_alarms: List[str] = []


class WebSocketMessage(BaseModel):
    """WebSocket message format"""
    type: str  # LIVE_DATA, ALARM, SUBSCRIBE, etc.
    unit_id: str
    data: dict
