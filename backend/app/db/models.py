"""
SQLAlchemy ORM models for configuration persistence.
"""
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Integer, Float, Boolean, DateTime, ForeignKey, Text, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from .database import Base


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    ENGINEER = "engineer"
    OPERATOR = "operator"


class DataSourcePriority(str, enum.Enum):
    MODBUS = "modbus"
    CALCULATED = "calculated"
    MANUAL = "manual"
    DEFAULT = "default"


# ============ UNIT MODEL ============

class Unit(Base):
    """Represents a compressor unit."""
    __tablename__ = "units"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    unit_id: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    equipment_spec: Mapped[Optional["EquipmentSpec"]] = relationship(back_populates="unit", uselist=False)
    stages: Mapped[List["StageConfig"]] = relationship(back_populates="unit", order_by="StageConfig.stage_num")
    # FIXED: back_populates matches RegisterMapping.unit_ref
    registers: Mapped[List["RegisterMapping"]] = relationship(back_populates="unit_ref")
    alarms: Mapped[List["AlarmSetpoint"]] = relationship(back_populates="unit")
    gas_properties: Mapped[Optional["GasProperty"]] = relationship(back_populates="unit", uselist=False)


# ============ EQUIPMENT SPEC MODEL ============

class EquipmentSpec(Base):
    """Equipment specifications for a unit."""
    __tablename__ = "equipment_specs"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    unit_id: Mapped[str] = mapped_column(String(50), ForeignKey("units.unit_id"), unique=True)
    
    # Compressor info
    compressor_manufacturer: Mapped[Optional[str]] = mapped_column(String(100))
    compressor_model: Mapped[Optional[str]] = mapped_column(String(100))
    compressor_serial: Mapped[Optional[str]] = mapped_column(String(100))
    frame_type: Mapped[Optional[str]] = mapped_column(String(50))
    stage_count: Mapped[int] = mapped_column(Integer, default=3)
    rated_speed_rpm: Mapped[int] = mapped_column(Integer, default=1000)
    max_rod_load_lb: Mapped[Optional[int]] = mapped_column(Integer)
    
    # Engine info
    engine_manufacturer: Mapped[Optional[str]] = mapped_column(String(100))
    engine_model: Mapped[Optional[str]] = mapped_column(String(100))
    engine_serial: Mapped[Optional[str]] = mapped_column(String(100))
    engine_cylinders: Mapped[int] = mapped_column(Integer, default=8)
    rated_hp: Mapped[Optional[int]] = mapped_column(Integer)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    unit: Mapped["Unit"] = relationship(back_populates="equipment_spec")


# ============ STAGE CONFIG MODEL ============

class StageConfig(Base):
    """Per-stage cylinder geometry and design conditions."""
    __tablename__ = "stage_configs"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    unit_id: Mapped[str] = mapped_column(String(50), ForeignKey("units.unit_id"))
    stage_num: Mapped[int] = mapped_column(Integer)  # 1, 2, 3...
    
    # Cylinder geometry
    bore_inches: Mapped[float] = mapped_column(Float, default=8.0)
    stroke_inches: Mapped[float] = mapped_column(Float, default=5.0)
    rod_diameter_inches: Mapped[float] = mapped_column(Float, default=2.0)
    clearance_pct_he: Mapped[float] = mapped_column(Float, default=12.0)  # Head end
    clearance_pct_ce: Mapped[float] = mapped_column(Float, default=15.0)  # Crank end
    
    # Design conditions
    design_p_suction_psig: Mapped[float] = mapped_column(Float, default=50.0)
    design_p_discharge_psig: Mapped[float] = mapped_column(Float, default=200.0)
    design_t_suction_f: Mapped[float] = mapped_column(Float, default=80.0)
    design_flow_mmscfd: Mapped[Optional[float]] = mapped_column(Float)
    
    # Data source assignments
    suction_pressure_source: Mapped[str] = mapped_column(String(20), default="modbus")
    discharge_pressure_source: Mapped[str] = mapped_column(String(20), default="modbus")
    suction_temp_source: Mapped[str] = mapped_column(String(20), default="modbus")
    discharge_temp_source: Mapped[str] = mapped_column(String(20), default="modbus")
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    unit: Mapped["Unit"] = relationship(back_populates="stages")


# ============ REGISTER MAPPING MODEL ============

class RegisterMapping(Base):
    """Modbus register configuration."""
    __tablename__ = "register_mappings"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    unit_id: Mapped[str] = mapped_column(String(50), ForeignKey("units.unit_id"))
    
    address: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(String(255))
    scale: Mapped[float] = mapped_column(Float, default=1.0)
    offset: Mapped[float] = mapped_column(Float, default=0.0)
    unit: Mapped[Optional[str]] = mapped_column(String(20))  # PSI, F, RPM
    category: Mapped[str] = mapped_column(String(50), default="general")  # engine, compressor, stage1, etc
    data_type: Mapped[str] = mapped_column(String(20), default="uint16")  # uint16, int16, uint32, float32
    poll_group: Mapped[str] = mapped_column(String(1), default="A")  # A=critical, B=secondary
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    # Relationships
    unit_ref: Mapped["Unit"] = relationship(back_populates="registers")


# ============ ALARM SETPOINT MODEL ============

class AlarmSetpoint(Base):
    """Alarm configuration for a parameter."""
    __tablename__ = "alarm_setpoints"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    unit_id: Mapped[str] = mapped_column(String(50), ForeignKey("units.unit_id"))
    
    parameter: Mapped[str] = mapped_column(String(100))  # e.g., "stg1_discharge_temp"
    description: Mapped[Optional[str]] = mapped_column(String(255))
    
    # Setpoints (None = disabled)
    ll_value: Mapped[Optional[float]] = mapped_column(Float)  # Low-Low
    l_value: Mapped[Optional[float]] = mapped_column(Float)   # Low
    h_value: Mapped[Optional[float]] = mapped_column(Float)   # High
    hh_value: Mapped[Optional[float]] = mapped_column(Float)  # High-High
    
    # Alarm behavior
    deadband: Mapped[float] = mapped_column(Float, default=1.0)
    delay_seconds: Mapped[int] = mapped_column(Integer, default=5)
    is_shutdown: Mapped[bool] = mapped_column(Boolean, default=False)
    is_latching: Mapped[bool] = mapped_column(Boolean, default=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    unit: Mapped["Unit"] = relationship(back_populates="alarms")


# ============ GAS PROPERTY MODEL ============

class GasProperty(Base):
    """Gas composition and properties for a unit."""
    __tablename__ = "gas_properties"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    unit_id: Mapped[str] = mapped_column(String(50), ForeignKey("units.unit_id"), unique=True)
    
    gas_name: Mapped[str] = mapped_column(String(50), default="Natural Gas")
    specific_gravity: Mapped[float] = mapped_column(Float, default=0.65)
    molecular_weight: Mapped[float] = mapped_column(Float, default=18.5)
    
    # Isentropic exponent (k value) - can vary by stage
    k_suction: Mapped[float] = mapped_column(Float, default=1.28)
    k_discharge: Mapped[float] = mapped_column(Float, default=1.25)
    
    # Compressibility (z factor)
    z_suction: Mapped[float] = mapped_column(Float, default=0.98)
    z_discharge: Mapped[float] = mapped_column(Float, default=0.95)
    
    # Gas composition (mole %)
    methane_pct: Mapped[float] = mapped_column(Float, default=85.0)
    ethane_pct: Mapped[float] = mapped_column(Float, default=6.0)
    propane_pct: Mapped[float] = mapped_column(Float, default=3.0)
    co2_pct: Mapped[float] = mapped_column(Float, default=2.0)
    n2_pct: Mapped[float] = mapped_column(Float, default=4.0)
    
    use_coolprop: Mapped[bool] = mapped_column(Boolean, default=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    unit: Mapped["Unit"] = relationship(back_populates="gas_properties")


# ============ USER MODEL ============

class User(Base):
    """User account for authentication."""
    __tablename__ = "users"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(100), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="operator")
    
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ============ ALARM HISTORY MODEL ============

class AlarmHistory(Base):
    """History of alarm events."""
    __tablename__ = "alarm_history"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    unit_id: Mapped[str] = mapped_column(String(50), index=True)
    parameter: Mapped[str] = mapped_column(String(100))
    
    alarm_type: Mapped[str] = mapped_column(String(10))  # LL, L, H, HH
    value: Mapped[float] = mapped_column(Float)
    setpoint: Mapped[float] = mapped_column(Float)
    
    triggered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    acknowledged_by: Mapped[Optional[str]] = mapped_column(String(50))
    cleared_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    
    is_shutdown: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[Optional[str]] = mapped_column(Text)

# ============ MODBUS SERVER CONFIG MODEL ============

class ModbusServerConfig(Base):
    """Modbus TCP Server connection settings."""
    __tablename__ = "modbus_server_config"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    unit_id: Mapped[str] = mapped_column(String(50), ForeignKey("units.unit_id"), unique=True)
    
    host: Mapped[str] = mapped_column(String(50), default="0.0.0.0")
    port: Mapped[int] = mapped_column(Integer, default=502)
    slave_id: Mapped[int] = mapped_column(Integer, default=1)
    timeout_ms: Mapped[int] = mapped_column(Integer, default=1000)
    scan_rate_ms: Mapped[int] = mapped_column(Integer, default=1000)

    # Mode switching
    use_simulation: Mapped[bool] = mapped_column(Boolean, default=True)
    real_host: Mapped[Optional[str]] = mapped_column(String(50))
    real_port: Mapped[Optional[int]] = mapped_column(Integer)
    sim_host: Mapped[str] = mapped_column(String(50), default="simulator")
    sim_port: Mapped[int] = mapped_column(Integer, default=5020)
    
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    # Note: Unit needs to list this if we want back_populates, or we can skip it.
    # For simplicity, we won't change Unit model to avoid touching existing code too much.
