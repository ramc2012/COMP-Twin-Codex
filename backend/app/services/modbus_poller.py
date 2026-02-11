"""
Modbus Polling Service with Latency Monitoring
Connects to Modbus TCP/RTU devices and polls registers.
Includes latency tracking and adaptive throttling.
"""

import asyncio
import logging
import time
import re
from typing import Dict, Any, Optional, List, Callable, Awaitable
from datetime import datetime
from pymodbus.client import AsyncModbusTcpClient
from pymodbus.exceptions import ModbusException
import yaml
from pathlib import Path
from sqlalchemy import select

from app.config import get_settings
from app.db.database import async_session_factory
from app.db.models import ModbusServerConfig

logger = logging.getLogger(__name__)

# Latency threshold for throttling (milliseconds)
LATENCY_THRESHOLD_MS = 800


class LatencyMonitor:
    """Tracks poll cycle latency and manages throttling."""
    
    def __init__(self, threshold_ms: float = LATENCY_THRESHOLD_MS):
        self.threshold_ms = threshold_ms
        self.recent_durations: List[float] = []  # Last N poll durations
        self.max_history = 10
        self.throttle_group_b = False
        self.slow_poll_count = 0
        self.total_poll_count = 0
        self.alerts: List[Dict] = []
    
    def record_poll(self, duration_ms: float):
        """Record a poll cycle duration and check for throttling."""
        self.total_poll_count += 1
        self.recent_durations.append(duration_ms)
        if len(self.recent_durations) > self.max_history:
            self.recent_durations.pop(0)
        
        if duration_ms > self.threshold_ms:
            self.slow_poll_count += 1
            self.throttle_group_b = True
            self._emit_alert("MODBUS_LATENCY", duration_ms)
            logger.warning(f"Poll cycle exceeded threshold: {duration_ms:.0f}ms > {self.threshold_ms}ms")
        else:
            # Allow recovery after 3 consecutive fast polls
            avg = self.get_average_latency()
            if avg < self.threshold_ms * 0.7:
                self.throttle_group_b = False
    
    def _emit_alert(self, alert_type: str, value: float):
        """Store alert for API access."""
        self.alerts.append({
            "type": alert_type,
            "value": value,
            "timestamp": datetime.now().isoformat(),
            "message": f"Poll cycle took {value:.0f}ms (threshold: {self.threshold_ms}ms)"
        })
        # Keep only last 50 alerts
        if len(self.alerts) > 50:
            self.alerts = self.alerts[-50:]
    
    def get_average_latency(self) -> float:
        if not self.recent_durations:
            return 0.0
        return sum(self.recent_durations) / len(self.recent_durations)
    
    @property
    def throttle_active(self) -> bool:
        """Alias for throttle_group_b."""
        return self.throttle_group_b
    
    def get_stats(self) -> Dict[str, Any]:
        return {
            "average_latency_ms": round(self.get_average_latency(), 1),
            "last_latency_ms": round(self.recent_durations[-1], 1) if self.recent_durations else 0,
            "throttle_active": self.throttle_group_b,
            "slow_poll_count": self.slow_poll_count,
            "total_poll_count": self.total_poll_count,
            "threshold_ms": self.threshold_ms,
            "recent_alerts": self.alerts[-5:]
        }


class ModbusPoller:
    """Modbus polling service with latency monitoring."""
    
    def __init__(self, host: str = None, port: int = None, slave_id: int = 1, 
                 poll_interval_ms: int = 1000, timeout: float = 3.0):
        settings = get_settings()
        self.host = host or settings.MODBUS_HOST
        self.port = port or settings.MODBUS_PORT
        self.slave_id = slave_id or settings.MODBUS_SLAVE_ID
        self.poll_interval = poll_interval_ms / 1000.0
        self.timeout = timeout
        
        self.client: Optional[AsyncModbusTcpClient] = None
        self.connected = False
        self.last_poll_time: Optional[datetime] = None
        self.last_values: Dict[int, int] = {}
        self.poll_count = 0
        self.error_count = 0
        self._polling_task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()
        
        # Latency monitoring
        self.latency_monitor = LatencyMonitor()
        
        # Register groups: A = critical (always poll), B = secondary (skipped when throttling)
        self.group_a_registers: List[Dict] = []
        self.group_b_registers: List[Dict] = []
        
        # Load register map
        self.register_config = self._load_register_config()
        self.name_to_register = {r['name']: r for r in self.register_config}
        self._categorize_registers()
        
        logger.info(f"ModbusPoller initialized: {self.host}:{self.port} (slave {self.slave_id})")
        logger.info(f"Loaded {len(self.register_config)} registers (A:{len(self.group_a_registers)}, B:{len(self.group_b_registers)})")

    def _categorize_registers(self):
        """Separate registers into Group A (critical) and Group B (secondary)."""
        critical_keywords = ["pressure", "temp", "rpm", "speed", "status", "alarm", "fault"]
        
        self.group_a_registers = []
        self.group_b_registers = []

        for reg in self.register_config:
            name_lower = reg.get('name', '').lower()
            group = reg.get('group', 'A').upper()
            
            # Use explicit group from config, or infer from name
            if group == 'A' or any(kw in name_lower for kw in critical_keywords):
                self.group_a_registers.append(reg)
            else:
                self.group_b_registers.append(reg)

    def _load_register_config(self) -> List[Dict[str, Any]]:
        """Load register configuration from YAML file."""
        try:
            paths = [Path("/app/shared_config/registers.yaml"), Path("app/core/registers.yaml")]
            config_path = next((p for p in paths if p.exists()), None)
            
            if not config_path:
                logger.warning("Register config not found")
                return []
                
            logger.info(f"Loading register config from {config_path}")
            with open(config_path, 'r') as f:
                data = yaml.safe_load(f)
                registers = data.get('registers', [])

                # Some imported maps use PLC-style 4xxxx addresses. Convert them to 0-based Modbus offsets.
                numeric_addrs = [
                    int(r.get("address"))
                    for r in registers
                    if isinstance(r, dict) and isinstance(r.get("address"), (int, float))
                ]
                if numeric_addrs:
                    high_addr_ratio = sum(1 for a in numeric_addrs if a >= 40000) / len(numeric_addrs)
                    if high_addr_ratio > 0.5:
                        base = 40001 if any(a >= 40001 for a in numeric_addrs) else 40000
                        for reg in registers:
                            if not isinstance(reg, dict):
                                continue
                            addr = reg.get("address")
                            if isinstance(addr, (int, float)) and addr >= base:
                                reg["address"] = int(addr) - base
                        logger.info("Converted PLC-style addresses to 0-based Modbus offsets using base %s", base)

                return registers
        except Exception as e:
            logger.error(f"Error loading register config: {e}")
            return []

    async def _update_connection_settings(self):
        """Fetch active connection settings from DB (supports mode switching)."""
        try:
            async with async_session_factory() as db:
                result = await db.execute(select(ModbusServerConfig))
                configs = result.scalars().all()
                if not configs:
                    return

                # Prefer the primary package row; otherwise use the first available config.
                conf = next((c for c in configs if c.unit_id == "GCS-001"), configs[0])

                if conf.use_simulation:
                    # Do not trust legacy host/port columns in simulation mode: they may still be 0.0.0.0:502.
                    new_host = conf.sim_host or conf.host or self.host
                    new_port = conf.sim_port or conf.port or self.port
                else:
                    real_host = (conf.real_host or "").strip()
                    real_port = conf.real_port or conf.port
                    # Guard against invalid "real mode" placeholders that break dockerized simulator setups.
                    if not real_host or real_host in {"0.0.0.0", "127.0.0.1", "localhost"}:
                        logger.warning(
                            "Real mode configured for %s but real_host is not usable (%s). Falling back to simulation endpoint.",
                            conf.unit_id,
                            real_host or "empty",
                        )
                        new_host = conf.sim_host or conf.host or self.host
                        new_port = conf.sim_port or conf.port or self.port
                    else:
                        new_host = real_host
                        new_port = real_port or self.port

                new_slave = conf.slave_id or self.slave_id
                new_host = str(new_host).strip() if new_host else self.host
                new_port = int(new_port) if new_port else self.port

                # Log if changing
                if new_host != self.host or new_port != self.port or new_slave != self.slave_id:
                    mode = "simulation" if conf.use_simulation else "real"
                    logger.info(
                        "Connection settings changed for %s (%s mode): %s:%s -> %s:%s",
                        conf.unit_id,
                        mode,
                        self.host,
                        self.port,
                        new_host,
                        new_port,
                    )
                    self.host = new_host
                    self.port = new_port
                    self.slave_id = new_slave

                    # Trigger reconnect
                    await self.disconnect()
                    await self.connect()
        except Exception as e:
            logger.error(f"Failed to update connection settings from DB: {e}")

    async def reload_config(self):
        """Reload configuration from file and DB."""
        logger.info("Reloading Modbus configuration...")
        self.register_config = self._load_register_config()
        self.name_to_register = {r['name']: r for r in self.register_config}
        self._categorize_registers()
        
        # Update connection settings (Simulation vs Real World)
        await self._update_connection_settings()
        
        logger.info(f"Reloaded {len(self.register_config)} registers")
    
    async def connect(self) -> bool:
        """Establish connection to Modbus device."""
        # Ensure we have latest settings before connecting (on first connect)
        if not self.client:
             await self._update_connection_settings()

        try:
            self.client = AsyncModbusTcpClient(host=self.host, port=self.port, timeout=self.timeout)
            await self.client.connect()
            self.connected = self.client.connected
            if self.connected:
                logger.info(f"Connected to Modbus device at {self.host}:{self.port}")
            return self.connected
        except Exception as e:
            logger.error(f"Connection error: {e}")
            self.connected = False
            return False
    
    async def disconnect(self):
        """Close Modbus connection."""
        if self.client:
            self.client.close()
            self.connected = False
    
    async def read_registers(self, start_address: int, count: int) -> Optional[List[int]]:
        """Read holding registers from device."""
        if not self.connected and not await self.connect():
            return None
        
        try:
            try:
                result = await self.client.read_holding_registers(address=start_address, count=count, device_id=self.slave_id)
            except TypeError:
                result = await self.client.read_holding_registers(address=start_address, count=count, slave=self.slave_id)
            
            if result.isError():
                self.error_count += 1
                return None
            return list(result.registers)
        except ModbusException as e:
            logger.error(f"Modbus exception: {e}")
            self.error_count += 1
            self.connected = False
            return None
    
    async def poll_all_registers(self) -> Dict[str, float]:
        """Poll registers with latency tracking and throttling."""
        start_time = time.monotonic()
        all_raw_values = {}
        
        # Determine which registers to poll
        if self.latency_monitor.throttle_active:
            registers_to_poll = self.group_a_registers
            logger.debug(f"Throttle active - polling Group A only ({len(registers_to_poll)} registers)")
        else:
            registers_to_poll = self.register_config
        
        if not registers_to_poll:
            return {}
        
        # Build contiguous blocks
        addresses = sorted([r['address'] for r in registers_to_poll])
        blocks = self._build_blocks(addresses)
        
        # Read blocks
        for start, count in blocks:
            current_start, remaining = start, count
            while remaining > 0:
                chunk = min(remaining, 100)
                values = await self.read_registers(current_start, chunk)
                if values:
                    for i, val in enumerate(values):
                        all_raw_values[current_start + i] = val
                current_start += chunk
                remaining -= chunk
        
        # Record latency
        duration_ms = (time.monotonic() - start_time) * 1000
        self.latency_monitor.record_poll(duration_ms)
        
        self.last_values.update(all_raw_values)
        self.last_poll_time = datetime.now()
        self.poll_count += 1
        
        return self._scale_values(all_raw_values)
    
    def _build_blocks(self, addresses: List[int]) -> List[tuple]:
        """Build contiguous address blocks for efficient reading."""
        if not addresses:
            return []
        blocks = []
        start = prev = addresses[0]
        count = 1
        for addr in addresses[1:]:
            if addr == prev + 1:
                count += 1
                prev = addr
            else:
                blocks.append((start, count))
                start = prev = addr
                count = 1
        blocks.append((start, count))
        return blocks
    
    def _scale_values(self, raw_data: Dict[int, int]) -> Dict[str, float]:
        """Convert raw register values to scaled engineering units."""
        scaled = {}
        for reg in self.register_config:
            addr, name, scale = reg.get('address'), reg.get('name'), reg.get('scale', 1.0)
            if addr in raw_data:
                raw_val = raw_data[addr]
                bit_index = reg.get("bit")

                # Discrete points can be packed into a word; decode bit when provided by map.
                if bit_index is not None:
                    try:
                        bit_i = int(bit_index)
                        normalized = 1 if ((int(raw_val) >> bit_i) & 0x1) else 0
                    except Exception:
                        val = raw_val * scale
                        normalized = round(val, 2) if scale < 1 else val
                else:
                    val = raw_val * scale
                    normalized = round(val, 2) if scale < 1 else val

                scaled[name] = normalized

                canonical_name = self._canonical_metric_name(name)
                if canonical_name and canonical_name != name:
                    scaled[canonical_name] = normalized
        return scaled

    def _canonical_metric_name(self, name: Any) -> Optional[str]:
        """Map imported/human register labels to canonical app metric keys."""
        if not isinstance(name, str):
            return None

        key = " ".join(name.strip().lower().split())
        direct_map = {
            "engine rpm": "engine_rpm",
            "engine lube oil pressure": "engine_oil_pressure",
            "compressor lube oil pressure": "comp_oil_pressure",
            "compressor oil temp": "comp_oil_temp",
            "engine oil temp": "engine_oil_temp",
            "engine jacket water temp": "jacket_water_temp",
            "suction stage 1 pressure": "stg1_suction_pressure",
            "discharge stage 1 pressure": "stg1_discharge_pressure",
            "discharge stage 2 pressure": "stg2_discharge_pressure",
            "3rd stage suction pressure": "stg3_suction_pressure",
            "suction control out": "suction_valve_position",
            "engine speed control out": "speed_control_output",
            "recycle valve control out": "recycle_valve_position",
            "pre-turbo flywheel exhaust temp": "pre_turbo_left",
            "pre-turbo aux end exhaust temp": "pre_turbo_right",
            "post turbo flywheel exhaust temp": "post_turbo_left",
            "post turbo aux end exhaust temp": "post_turbo_right",
        }
        if key in direct_map:
            return direct_map[key]

        match = re.match(r"engine bearing (\d+) temp", key)
        if match:
            return f"main_bearing_{match.group(1)}"

        match = re.match(r"engine exhaust cyl (\d+) (left|right)", key)
        if match:
            cyl = match.group(1)
            side = match.group(2)
            return f"exh_cyl{cyl}_{side}"

        return None
    
    def get_data(self) -> Dict[str, float]:
        return self._scale_values(self.last_values)
    
    async def start_polling(self, callback=None):
        """Start continuous polling loop with latency monitoring."""
        logger.info(f"Starting polling loop (interval: {self.poll_interval}s, threshold: {LATENCY_THRESHOLD_MS}ms)")
        self._stop_event.clear()

        while not self._stop_event.is_set():
            try:
                values = await self.poll_all_registers()
                if values and callback:
                    await callback(values)
                await asyncio.sleep(self.poll_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Polling error: {e}")
                await asyncio.sleep(self.poll_interval)

    async def stop(self):
        """Stop background polling and close Modbus connection."""
        self._stop_event.set()

        if self._polling_task and not self._polling_task.done():
            self._polling_task.cancel()
            try:
                await self._polling_task
            except asyncio.CancelledError:
                pass

        self._polling_task = None
        await self.disconnect()
        logger.info("Modbus poller stopped")
    
    def get_status(self) -> Dict[str, Any]:
        """Get poller status with latency metrics."""
        status = {
            "host": self.host, "port": self.port, "connected": self.connected,
            "poll_count": self.poll_count, "error_count": self.error_count,
            "last_poll": self.last_poll_time.isoformat() if self.last_poll_time else None,
            "registers_cached": len(self.last_values),
            "group_a_count": len(self.group_a_registers),
            "group_b_count": len(self.group_b_registers),
        }
        status.update(self.latency_monitor.get_stats())
        return status


_poller_instance: Optional[ModbusPoller] = None

def get_modbus_poller() -> ModbusPoller:
    global _poller_instance
    if _poller_instance is None:
        _poller_instance = ModbusPoller()
    return _poller_instance

async def init_modbus_poller():
    return await init_modbus_poller_with_callback()


async def init_modbus_poller_with_callback(callback: Optional[Callable[[Dict[str, float]], Awaitable[None]]] = None):
    settings = get_settings()
    if settings.MODBUS_ENABLED:
        poller = get_modbus_poller()
        # Connect is called inside start_polling loop via poll_all_registers implicitly or explicitly here
        # But let's let it init settings first
        await poller._update_connection_settings()
        await poller.connect()
        if poller._polling_task is None or poller._polling_task.done():
            poller._polling_task = asyncio.create_task(poller.start_polling(callback=callback))
        return poller
    return None
