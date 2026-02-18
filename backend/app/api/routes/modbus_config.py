"""
Modbus Config API - Manage register mappings and server configuration.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List, Optional, Dict, Literal
from pydantic import BaseModel
from datetime import datetime
from pathlib import Path
import yaml
import os
import json

from app.db.database import get_db
from app.db.models import RegisterMapping, ModbusServerConfig
from ..routes.auth import require_engineer

router = APIRouter(prefix="/api/config/modbus", tags=["Modbus Configuration"])

UNIT_TEMPLATE_MAP_PATHS: Dict[str, List[Path]] = {
    "GCS-001": [
        Path("/app/shared_config/gcsmot_first_two_package_map.json"),
        Path("app/core/gcsmot_first_two_package_map.json"),
    ],
    "GCS-002": [
        Path("/app/shared_config/gcsmot_package_2_3_map.json"),
        Path("app/core/gcsmot_package_2_3_map.json"),
    ],
    "GCS-003": [
        Path("/app/shared_config/gcsmot_package_2_3_map.json"),
        Path("app/core/gcsmot_package_2_3_map.json"),
    ],
}
UNIT_OVERRIDE_DIRS = [
    Path("/app/shared_config/modbus_by_unit"),
    Path("shared_config/modbus_by_unit"),
]


def _load_template_registers(unit_id: str) -> List[Dict]:
    for path in UNIT_TEMPLATE_MAP_PATHS.get(unit_id, []):
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text())
            registers = payload.get("registers", [])
            if isinstance(registers, list):
                return registers
        except Exception:
            continue
    return []


def _resolve_override_path(unit_id: str, create_parent: bool = False) -> Optional[Path]:
    for base in UNIT_OVERRIDE_DIRS:
        if base.exists():
            path = base / f"{unit_id}.yaml"
            if create_parent:
                path.parent.mkdir(parents=True, exist_ok=True)
            return path
    if create_parent:
        fallback = UNIT_OVERRIDE_DIRS[0] / f"{unit_id}.yaml"
        fallback.parent.mkdir(parents=True, exist_ok=True)
        return fallback
    return None


def _load_unit_override(unit_id: str) -> Dict:
    path = _resolve_override_path(unit_id)
    if not path or not path.exists():
        return {}
    try:
        with open(path, "r") as f:
            loaded = yaml.safe_load(f) or {}
            return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


def _write_unit_override(unit_id: str, payload: Dict) -> None:
    path = _resolve_override_path(unit_id, create_parent=True)
    if not path:
        return
    with open(path, "w") as f:
        yaml.safe_dump(payload, f, default_flow_style=False, sort_keys=False)


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
    communication_mode: Literal["TCP_IP", "RS485_RTU"] = "TCP_IP"
    serial_port: Optional[str] = None
    baud_rate: int = 9600
    parity: Literal["N", "E", "O"] = "N"
    stop_bits: int = 1
    byte_size: int = 8


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
            "sim_port": server_conf.sim_port,
            "communication_mode": "TCP_IP",
            "serial_port": None,
            "baud_rate": 9600,
            "parity": "N",
            "stop_bits": 1,
            "byte_size": 8
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
            "sim_port": 5020,
            "communication_mode": "TCP_IP",
            "serial_port": None,
            "baud_rate": 9600,
            "parity": "N",
            "stop_bits": 1,
            "byte_size": 8
        }

    # Overlay per-unit server override (transport-specific settings are persisted here).
    override_cfg = _load_unit_override(unit_id)
    server_override = override_cfg.get("server") if isinstance(override_cfg, dict) else None
    if isinstance(server_override, dict):
        server_data = {
            **server_data,
            "slave_id": server_override.get("slave_id", server_data.get("slave_id", 1)),
            "use_simulation": bool(server_override.get("use_simulation", server_data.get("use_simulation", True))),
            "real_host": server_override.get("real_host", server_data.get("real_host", "")),
            "real_port": server_override.get("real_port", server_data.get("real_port", 502)),
            "sim_host": server_override.get("sim_host", server_data.get("sim_host", "simulator")),
            "sim_port": server_override.get("sim_port", server_data.get("sim_port", 5020)),
            "communication_mode": str(server_override.get("communication_mode", server_data.get("communication_mode", "TCP_IP"))).upper(),
            "serial_port": server_override.get("serial_port", server_data.get("serial_port")),
            "baud_rate": int(server_override.get("baud_rate", server_data.get("baud_rate", 9600)) or 9600),
            "parity": str(server_override.get("parity", server_data.get("parity", "N"))).upper(),
            "stop_bits": int(server_override.get("stop_bits", server_data.get("stop_bits", 1)) or 1),
            "byte_size": int(server_override.get("byte_size", server_data.get("byte_size", 8)) or 8),
        }

    if server_data.get("use_simulation"):
        server_data["host"] = server_data.get("sim_host") or "simulator"
        server_data["port"] = int(server_data.get("sim_port") or 5020)
    elif server_data.get("communication_mode") == "RS485_RTU":
        server_data["host"] = server_data.get("serial_port") or "/dev/ttyUSB0"
        server_data["port"] = 0
    else:
        server_data["host"] = server_data.get("real_host") or ""
        server_data["port"] = int(server_data.get("real_port") or 502)

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

    # For template-configured packages, use the package-specific address-map template as the base.
    # Any per-package override YAML values (and DB calibration values) are layered on top.
    if unit_id in UNIT_TEMPLATE_MAP_PATHS:
        template_registers = _load_template_registers(unit_id)
        override_registers = override_cfg.get("registers", []) if isinstance(override_cfg, dict) else []

        if template_registers:
            # Optional simulation override stored per unit.
            simulation_override = override_cfg.get("simulation") if isinstance(override_cfg, dict) else None
            if isinstance(simulation_override, dict):
                yaml_simulation = simulation_override

            db_by_address = {}
            for m in mappings:
                try:
                    addr_key = int(m.address)
                except Exception:
                    continue
                if addr_key not in db_by_address:
                    db_by_address[addr_key] = m

            override_by_key = {}
            for reg in override_registers:
                if not isinstance(reg, dict):
                    continue
                try:
                    addr_key = int(reg.get("address"))
                except Exception:
                    continue
                bit_key = reg.get("bit")
                try:
                    bit_key = int(bit_key) if bit_key is not None else -1
                except Exception:
                    bit_key = -1
                name_key = str(reg.get("name", "")).strip().lower()
                override_by_key[(addr_key, name_key, bit_key)] = reg

            merged_template_registers: List[Dict] = []
            for base in template_registers:
                if not isinstance(base, dict):
                    continue
                item = dict(base)
                try:
                    addr_key = int(item.get("address"))
                except Exception:
                    continue
                name_key = str(item.get("name", "")).strip().lower()
                bit_raw = item.get("bit")
                try:
                    bit_key = int(bit_raw) if bit_raw is not None else -1
                except Exception:
                    bit_key = -1

                # Layer 1: unit override YAML (exact match by address+name+bit).
                ov = override_by_key.get((addr_key, name_key, bit_key))
                if ov:
                    for fld in (
                        "description", "unit", "scale", "offset", "dataType", "pollGroup", "category",
                        "type", "min", "max", "nominal", "default", "valueMode", "manualValue", "bit",
                        "sourcePriority", "source_priority", "calcFormula", "calculationFormula",
                        "interstage_dp", "cooler_approach_f", "speed_ratio"
                    ):
                        if fld in ov:
                            item[fld] = ov.get(fld)
                    if "value_mode" in ov and "valueMode" not in ov:
                        item["valueMode"] = str(ov.get("value_mode", "LIVE")).upper()
                    if "manual_value" in ov and "manualValue" not in ov:
                        item["manualValue"] = ov.get("manual_value")

                # Layer 2: DB calibration values by address (legacy compatibility).
                db_match = db_by_address.get(addr_key)
                if db_match:
                    item["unit"] = db_match.unit if db_match.unit is not None else item.get("unit")
                    item["scale"] = db_match.scale if db_match.scale is not None else item.get("scale", 1.0)
                    item["offset"] = db_match.offset if db_match.offset is not None else item.get("offset", 0.0)
                    item["dataType"] = db_match.data_type or item.get("dataType", "uint16")
                    item["pollGroup"] = db_match.poll_group or item.get("pollGroup", "A")
                    item["category"] = db_match.category or item.get("category", "general")

                # Layer 3: shared YAML fallback by address/name (for value mode/manual compatibility).
                yaml_match = yaml_by_address.get(addr_key) or yaml_by_name.get(name_key)
                if yaml_match:
                    for opt in (
                        "default", "nominal", "min", "max", "noise", "value_mode", "manual_value", "type", "bit",
                        "source_priority", "sourcePriority", "calc_formula", "calcFormula", "calculationFormula",
                        "interstage_dp", "cooler_approach_f", "speed_ratio"
                    ):
                        if opt in yaml_match:
                            item[opt] = yaml_match[opt]
                    if "value_mode" in item and "valueMode" not in item:
                        item["valueMode"] = str(item["value_mode"]).upper()
                    if "manual_value" in item and "manualValue" not in item:
                        item["manualValue"] = item["manual_value"]
                    if "calc_formula" in item and "calcFormula" not in item:
                        item["calcFormula"] = item["calc_formula"]

                if "valueMode" not in item:
                    item["valueMode"] = "LIVE"
                if "manualValue" not in item:
                    item["manualValue"] = None

                merged_template_registers.append(item)

            return {
                "unit_id": unit_id,
                "server": server_data,
                "simulation": yaml_simulation,
                "registers": merged_template_registers,
                "count": len(merged_template_registers),
                "source": "template+unit_override"
            }

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
            for opt in (
                "default", "nominal", "min", "max", "noise", "value_mode", "manual_value", "type",
                "source_priority", "sourcePriority", "calc_formula", "calcFormula", "calculationFormula",
                "interstage_dp", "cooler_approach_f", "speed_ratio"
            ):
                if opt in yaml_match:
                    item[opt] = yaml_match[opt]
            if "value_mode" in item:
                item["valueMode"] = str(item["value_mode"]).upper()
            if "manual_value" in item:
                item["manualValue"] = item["manual_value"]
            if "calc_formula" in item and "calcFormula" not in item:
                item["calcFormula"] = item["calc_formula"]
            if "type" in item:
                item["type"] = item["type"]
        if "valueMode" not in item:
            item["valueMode"] = "LIVE"
        if "manualValue" not in item:
            item["manualValue"] = None
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
    # Primary package persists to DB + shared poller yaml.
    # Secondary packages (e.g. GCS-002/GCS-003) persist via per-unit override yaml only,
    # so missing DB rows/FKs do not block saves.
    persist_to_db = unit_id == "GCS-001"

    if persist_to_db:
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
                if config.server.communication_mode == "RS485_RTU":
                    server_conf.host = config.server.serial_port or "/dev/ttyUSB0"
                    server_conf.port = 0
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

    # 3. Write per-unit YAML override snapshot (preserves fields not stored in DB such as bit index).
    try:
        unit_override_payload: Dict = {
            "unit_id": unit_id,
            "updated_at": datetime.utcnow().isoformat(),
        }
        existing_override = _load_unit_override(unit_id)
        if isinstance(existing_override.get("simulation"), dict):
            unit_override_payload["simulation"] = existing_override["simulation"]
        if isinstance(existing_override.get("server"), dict):
            unit_override_payload["server"] = existing_override["server"]
        if isinstance(existing_override.get("registers"), list):
            unit_override_payload["registers"] = existing_override["registers"]

        if config.server:
            unit_override_payload["server"] = {
                "slave_id": config.server.slave_id,
                "use_simulation": config.server.use_simulation,
                "real_host": config.server.real_host,
                "real_port": config.server.real_port,
                "sim_host": config.server.sim_host,
                "sim_port": config.server.sim_port,
                "communication_mode": config.server.communication_mode,
                "serial_port": config.server.serial_port,
                "baud_rate": config.server.baud_rate,
                "parity": config.server.parity,
                "stop_bits": config.server.stop_bits,
                "byte_size": config.server.byte_size,
            }
        if config.simulation:
            unit_override_payload["simulation"] = {
                "update_interval_ms": config.simulation.update_interval_ms,
                "noise_enabled": config.simulation.noise_enabled,
                "trend_enabled": config.simulation.trend_enabled
            }
        if config.registers is not None:
            unit_override_payload["registers"] = config.registers

        _write_unit_override(unit_id, unit_override_payload)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Failed to write per-unit modbus override for {unit_id}: {e}")

    # 4. Write shared poller YAML only for primary package (GCS-001).
    # This avoids non-primary package edits from overriding the active poller register map.
    if unit_id == "GCS-001":
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
                server_sec["use_simulation"] = config.server.use_simulation
                server_sec["real_host"] = config.server.real_host
                server_sec["real_port"] = config.server.real_port
                server_sec["sim_host"] = config.server.sim_host
                server_sec["sim_port"] = config.server.sim_port
                server_sec["communication_mode"] = config.server.communication_mode
                server_sec["serial_port"] = config.server.serial_port
                server_sec["baud_rate"] = config.server.baud_rate
                server_sec["parity"] = config.server.parity
                server_sec["stop_bits"] = config.server.stop_bits
                server_sec["byte_size"] = config.server.byte_size
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
                    if 'offset' in r: reg_dict['offset'] = r['offset']
                    if 'nominal' in r: reg_dict['nominal'] = r['nominal']
                    if 'min' in r: reg_dict['min'] = r['min']
                    if 'max' in r: reg_dict['max'] = r['max']
                    if 'unit' in r: reg_dict['unit'] = r['unit']
                    if 'noise' in r: reg_dict['noise'] = r['noise']
                    if 'type' in r: reg_dict['type'] = r['type']
                    if 'bit' in r and r['bit'] not in (None, ""):
                        try:
                            reg_dict['bit'] = int(r['bit'])
                        except (TypeError, ValueError):
                            pass
                    if 'defaultValue' in r and 'default' not in reg_dict:
                        reg_dict['default'] = r['defaultValue']
                    if 'currentValue' in r:
                        reg_dict['nominal'] = r['currentValue']
                        if 'default' not in reg_dict:
                            reg_dict['default'] = r['currentValue']
                    mode_raw = r.get('valueMode', r.get('value_mode', 'LIVE'))
                    mode = str(mode_raw).upper() if mode_raw is not None else 'LIVE'
                    reg_dict['value_mode'] = 'MANUAL' if mode == 'MANUAL' else 'LIVE'
                    manual_raw = r.get('manualValue', r.get('manual_value'))
                    if manual_raw is not None and manual_raw != "":
                        try:
                            reg_dict['manual_value'] = float(manual_raw)
                        except (TypeError, ValueError):
                            pass
                    source_priority = r.get('sourcePriority', r.get('source_priority'))
                    if source_priority not in (None, "", []):
                        reg_dict['source_priority'] = source_priority
                    calc_formula = r.get('calcFormula', r.get('calculationFormula', r.get('calc_formula')))
                    if calc_formula not in (None, ""):
                        reg_dict['calc_formula'] = calc_formula
                    if 'interstage_dp' in r:
                        reg_dict['interstage_dp'] = r.get('interstage_dp')
                    if 'cooler_approach_f' in r:
                        reg_dict['cooler_approach_f'] = r.get('cooler_approach_f')
                    if 'speed_ratio' in r:
                        reg_dict['speed_ratio'] = r.get('speed_ratio')

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
