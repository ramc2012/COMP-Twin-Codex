"""
Modbus Config API - Manage register mappings and server configuration.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List, Optional, Dict
from pydantic import BaseModel
from datetime import datetime
import yaml
import os

from app.db.database import get_db
from app.db.models import RegisterMapping, ModbusServerConfig
from ..routes.auth import require_engineer

router = APIRouter(prefix="/api/config/modbus", tags=["Modbus Configuration"])


class RegisterMappingCreate(BaseModel):
    address: int
    name: str
    description: Optional[str] = None
    unit: Optional[str] = None
    scale: float = 1.0
    offset: float = 0.0
    dataType: str = "uint16" 
    pollGroup: str = "A"
    category: str = "general"


class ModbusGlobalConfig(BaseModel):
    # Active connection (will be populated based on mode for output)
    host: str = "0.0.0.0"
    port: int = 502
    slave_id: int = 1
    timeout_ms: int = 1000
    scan_rate_ms: int = 1000
    
    # Mode Settings
    use_simulation: bool = True
    real_host: Optional[str] = None
    real_port: Optional[int] = None
    sim_host: str = "simulator"
    sim_port: int = 5020


class SimulationConfig(BaseModel):
    update_interval_ms: int = 100
    noise_enabled: bool = True
    trend_enabled: bool = True


class ModbusConfigFull(BaseModel):
    server: Optional[ModbusGlobalConfig] = None
    registers: Optional[List[Dict]] = None
    simulation: Optional[SimulationConfig] = None


@router.get("")
async def get_modbus_config(
    unit_id: str = "GCS-001",
    db: AsyncSession = Depends(get_db)
) -> Dict:
    """Get full Modbus configuration."""
    config_path = "/app/shared_config/registers.yaml"
    yaml_config: Dict = {}
    yaml_registers: List[Dict] = []
    yaml_simulation: Dict = {
        "update_interval_ms": 100,
        "noise_enabled": True,
        "trend_enabled": True
    }
    if os.path.exists(config_path):
        try:
            with open(config_path, "r") as f:
                yaml_config = yaml.safe_load(f) or {}
                yaml_registers = yaml_config.get("registers", []) or []
                if isinstance(yaml_config.get("simulation"), dict):
                    yaml_simulation = yaml_config["simulation"]
        except Exception:
            pass
    
    # Get Registers (Prefer DB to ensure we get all metadata, but check YAML for sim correctness if needed - 
    # actually let's stick to DB as primary for registers now that we have write-back working well)
    result_regs = await db.execute(
        select(RegisterMapping).where(RegisterMapping.unit_id == unit_id)
    )
    mappings = result_regs.scalars().all()
    
    # Get Server Config
    result_conf = await db.execute(
        select(ModbusServerConfig).where(ModbusServerConfig.unit_id == unit_id)
    )
    server_conf = result_conf.scalar_one_or_none()
    
    # Construct Server Data
    if server_conf:
        # Determine "effective" host/port for the UI to show as "Active"
        if server_conf.use_simulation:
            active_host = server_conf.sim_host
            active_port = server_conf.sim_port
        else:
            active_host = server_conf.real_host or ""
            active_port = server_conf.real_port or 502

        server_data = {
            "host": active_host, # Deprecated for config purposes, but kept for compat
            "port": active_port, # Deprecated for config purposes
            "slave_id": server_conf.slave_id,
            "timeout_ms": server_conf.timeout_ms,
            "scan_rate_ms": server_conf.scan_rate_ms,
            "use_simulation": server_conf.use_simulation,
            "real_host": server_conf.real_host,
            "real_port": server_conf.real_port,
            "sim_host": server_conf.sim_host,
            "sim_port": server_conf.sim_port
        }
    else:
        # Defaults
        server_data = {
            "host": "simulator",
            "port": 5020,
            "slave_id": 1,
            "timeout_ms": 1000,
            "scan_rate_ms": 1000,
            "use_simulation": True,
            "real_host": "",
            "real_port": 502,
            "sim_host": "simulator",
            "sim_port": 5020
        }

    yaml_by_address = {}
    yaml_by_name = {}
    for reg in yaml_registers:
        if not isinstance(reg, dict):
            continue
        addr = reg.get("address")
        name = reg.get("name")
        if isinstance(addr, (int, float)):
            yaml_by_address[int(addr)] = reg
        if isinstance(name, str):
            yaml_by_name[name.strip().lower()] = reg

    merged_registers = []
    for m in mappings:
        item = {
            "id": m.id,
            "address": m.address,
            "name": m.name,
            "description": m.description,
            "unit": m.unit,
            "scale": m.scale,
            "offset": m.offset,
            "dataType": m.data_type,
            "pollGroup": m.poll_group,
            "category": m.category
        }
        yaml_match = yaml_by_address.get(int(m.address)) or yaml_by_name.get((m.name or "").strip().lower())
        if yaml_match:
            for opt in ("default", "nominal", "min", "max", "noise"):
                if opt in yaml_match:
                    item[opt] = yaml_match[opt]
        merged_registers.append(item)

    return {
        "unit_id": unit_id,
        "server": server_data,
        "simulation": yaml_simulation,
        "registers": merged_registers,
        "count": len(merged_registers),
        "source": "db+yaml" if mappings else "db"
    }


@router.put("")
async def update_modbus_config(
    config: ModbusConfigFull,
    unit_id: str = "GCS-001",
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_engineer)
) -> Dict:
    """
    Update global Modbus configuration.
    """
    
    # 1. Update Server Config
    if config.server:
        result = await db.execute(
            select(ModbusServerConfig).where(ModbusServerConfig.unit_id == unit_id)
        )
        server_conf = result.scalar_one_or_none()
        
        if not server_conf:
            server_conf = ModbusServerConfig(unit_id=unit_id)
            db.add(server_conf)
        
        # Update fields
        server_conf.slave_id = config.server.slave_id
        server_conf.timeout_ms = config.server.timeout_ms
        server_conf.scan_rate_ms = config.server.scan_rate_ms
        
        server_conf.use_simulation = config.server.use_simulation
        if config.server.real_host is not None: server_conf.real_host = config.server.real_host
        if config.server.real_port is not None: server_conf.real_port = config.server.real_port
        if config.server.sim_host is not None: server_conf.sim_host = config.server.sim_host
        if config.server.sim_port is not None: server_conf.sim_port = config.server.sim_port
        
        # Update the "host"/"port" legacy columns based on mode for backward compatibility
        if server_conf.use_simulation:
            server_conf.host = server_conf.sim_host
            server_conf.port = server_conf.sim_port
        else:
            server_conf.host = server_conf.real_host if server_conf.real_host else "0.0.0.0"
            server_conf.port = server_conf.real_port if server_conf.real_port else 502

    # 2. Update Registers if provided
    if config.registers is not None:
        await db.execute(
            delete(RegisterMapping).where(RegisterMapping.unit_id == unit_id)
        )
        
        for r in config.registers:
            poll_group_val = str(r.get('pollGroup') if r.get('pollGroup') else r.get('category', 'A'))[:1]
            
            new_reg = RegisterMapping(
                unit_id=unit_id,
                address=r.get('address'),
                name=r.get('name'),
                description=r.get('description'),
                unit=r.get('unit'),
                scale=r.get('scale', 1.0),
                offset=r.get('offset', 0.0),
                data_type=r.get('dataType', 'uint16'),
                poll_group=poll_group_val,
                category=r.get('category', 'general')
            )
            db.add(new_reg)
            
    await db.commit()
    
    # 3. WRITE TO YAML (For Simulator - only needs to know about itself)
    # Simulator always listens on internal port, but its noise/values depend on this file.
    # We should basically just write the registers and simulation params.
    try:
        full_config = {
            "server": {}, # Simulator ignores host/port in this file mostly, it binds to 0.0.0.0 from main.py args
            "simulation": {
                "update_interval_ms": 100,
                "noise_enabled": True,
                "trend_enabled": True
            },
            "engine_states": {
                0: "STOPPED", 1: "PRE_LUBE", 2: "CRANKING", 3: "IDLE_WARMUP", 
                4: "LOADING", 8: "RUNNING", 16: "UNLOADING", 32: "COOLDOWN", 
                64: "SHUTDOWN", 255: "FAULT"
            },
            "registers": []
        }

        # Merge existing
        config_path = "/app/shared_config/registers.yaml"
        if os.path.exists(config_path):
             try:
                with open(config_path, "r") as f:
                    existing = yaml.safe_load(f) or {}
                    if existing.get("simulation"): full_config["simulation"] = existing["simulation"]
                    if existing.get("engine_states"): full_config["engine_states"] = existing["engine_states"]
                    if existing.get("registers"): full_config["registers"] = existing["registers"]
                    if existing.get("server"): full_config["server"] = existing["server"]
             except Exception:
                pass

        # Update Server info in YAML (Simulator uses this for Slave ID)
        server_sec = full_config.get("server", {})
        if config.server:
            server_sec["slave_id"] = config.server.slave_id
            # We don't change host/port here because Simulator always runs in its container
        full_config["server"] = server_sec

        # Update Registers
        if config.registers is not None:
            full_config["registers"] = []
            for r in config.registers:
                poll_group_val = str(r.get('pollGroup') if r.get('pollGroup') else r.get('category', 'A'))[:1]
                reg_dict = {
                    "address": r.get('address'),
                    "name": r.get('name'),
                    "description": r.get('description'),
                    "data_type": r.get('dataType', 'UINT16').upper(),
                    "category": r.get('category', 'general'),
                    "poll_group": poll_group_val
                }
                # Optional fields
                if 'default' in r: reg_dict['default'] = r['default']
                if 'scale' in r: reg_dict['scale'] = r['scale']
                if 'nominal' in r: reg_dict['nominal'] = r['nominal']
                if 'min' in r: reg_dict['min'] = r['min']
                if 'max' in r: reg_dict['max'] = r['max']
                if 'unit' in r: reg_dict['unit'] = r['unit']
                if 'noise' in r: reg_dict['noise'] = r['noise']
                if 'defaultValue' in r and 'default' not in reg_dict:
                    reg_dict['default'] = r['defaultValue']
                if 'currentValue' in r:
                    reg_dict['nominal'] = r['currentValue']
                    if 'default' not in reg_dict:
                        reg_dict['default'] = r['currentValue']
                
                full_config["registers"].append(reg_dict)

        # Update simulation behavior when requested (useful for strict simulator mode)
        if config.simulation:
            full_config["simulation"] = {
                "update_interval_ms": config.simulation.update_interval_ms,
                "noise_enabled": config.simulation.noise_enabled,
                "trend_enabled": config.simulation.trend_enabled
            }
                
        with open(config_path, "w") as f:
            yaml.dump(full_config, f, default_flow_style=False, sort_keys=False)
            
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Failed to write registers.yaml: {e}")

    # Reload poller
    await _reload_modbus_poller(unit_id)

    return {"status": "updated", "unit_id": unit_id}

@router.post("")
async def create_register_mapping(
    mapping: RegisterMappingCreate,
    unit_id: str = "GCS-001",
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_engineer)
) -> Dict:
    """Create a new register mapping."""
    new_mapping = RegisterMapping(
        unit_id=unit_id,
        address=mapping.address,
        name=mapping.name,
        description=mapping.description,
        unit=mapping.unit,
        scale=mapping.scale,
        offset=mapping.offset,
        data_type=mapping.dataType,
        poll_group=mapping.pollGroup,
        category=mapping.category
    )
    
    db.add(new_mapping)
    await db.commit()
    await db.refresh(new_mapping)
    
    # Trigger poller reload
    await _reload_modbus_poller(unit_id)
    
    return {
        "status": "created",
        "id": new_mapping.id,
        "address": new_mapping.address
    }

async def _reload_modbus_poller(unit_id: str):
    """Internal function to reload the Modbus poller configuration."""
    try:
        from app.services.modbus_poller import get_modbus_poller
        poller = get_modbus_poller()
        if poller and hasattr(poller, 'reload_config'):
            await poller.reload_config()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Failed to reload Modbus poller: {e}")
