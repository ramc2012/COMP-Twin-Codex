"""Physics calculation schemas"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict


class StageInputSchema(BaseModel):
    """Input for stage calculations"""
    suction_pressure_psig: float = Field(..., description="Suction pressure in PSIG")
    discharge_pressure_psig: float = Field(..., description="Discharge pressure in PSIG")
    suction_temp_f: float = Field(..., description="Suction temperature in °F")
    discharge_temp_f: float = Field(..., description="Discharge temperature in °F")
    clearance_pct: float = Field(10.0, description="Clearance volume %")
    k: float = Field(1.28, description="Specific heat ratio (Cp/Cv)")


class StageOutputSchema(BaseModel):
    """Calculated stage results"""
    stage_number: int
    compression_ratio: float
    isentropic_temp_f: float
    isentropic_efficiency: float
    volumetric_efficiency: float
    polytropic_exponent: float
    polytropic_efficiency: float
    gas_horsepower: Optional[float] = None


class PhysicsResultSchema(BaseModel):
    """Complete physics calculation results"""
    timestamp: str
    stages: List[StageOutputSchema]
    overall_ratio: float
    total_gas_hp: float
    total_bhp: float
    exhaust_spread: float


class PVDiagramSchema(BaseModel):
    """PV diagram data points"""
    stage: int
    volumes: List[float]
    pressures: List[float]
    work_hp: Optional[float] = None
