#!/usr/bin/env python3
"""
GCS Modbus Simulator
Standalone Modbus TCP server that emulates a gas compressor system PLC.
Supports hot-reloading of configuration.
"""

import argparse
import asyncio
import logging
import math
import random
import time
import os
from datetime import datetime
from typing import Dict, Any

import yaml

# Robust imports for pymodbus versions
from pymodbus.server import StartAsyncTcpServer

# Handle ModbusDeviceContext renaming (v3.6+)
try:
    from pymodbus.datastore import ModbusDeviceContext
    ModbusSlaveContext = ModbusDeviceContext
except ImportError:
    try:
        from pymodbus.datastore import ModbusSlaveContext
    except ImportError:
        # Fallback for older structures
        from pymodbus.datastore.context import ModbusSlaveContext

# Handle ServerContext and DataBlock
try:
    from pymodbus.datastore import ModbusServerContext, ModbusSequentialDataBlock
except ImportError:
    from pymodbus.datastore.context import ModbusServerContext
    from pymodbus.datastore.store import ModbusSequentialDataBlock

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("ModbusSimulator")


class CompressorSimulator:
    """Simulates realistic compressor operating conditions."""
    
    def __init__(self, config: Dict[str, Any]):
        self.load_config(config)
        
        # Simulation state
        self.engine_state = 8  # RUNNING
        self.start_time = time.time()
        
    def load_config(self, config: Dict[str, Any]):
        """Load or reload simulator configuration."""
        self.config = config
        self.simulation = config.get('simulation', {}) or {}
        self.registers = self._normalize_registers(config.get('registers', []) or [])
        logger.info(f"Simulator loaded {len(self.registers)} register definitions")

    def _normalize_registers(self, registers: list[Dict[str, Any]]) -> list[Dict[str, Any]]:
        """Normalize PLC-style 4xxxx addresses to datastore offsets when required."""
        numeric_addrs = [
            int(r.get("address"))
            for r in registers
            if isinstance(r, dict) and isinstance(r.get("address"), (int, float))
        ]
        if not numeric_addrs:
            return registers

        high_addr_ratio = sum(1 for a in numeric_addrs if a >= 40000) / len(numeric_addrs)
        if high_addr_ratio <= 0.5:
            return registers

        base = 40001 if any(a >= 40001 for a in numeric_addrs) else 40000
        normalized: list[Dict[str, Any]] = []
        for reg in registers:
            if not isinstance(reg, dict):
                continue
            item = dict(reg)
            addr = item.get("address")
            if isinstance(addr, (int, float)) and addr >= base:
                item["address"] = int(addr) - base
            normalized.append(item)
        logger.info("Simulator converted PLC-style addresses to 0-based offsets using base %s", base)
        return normalized

    def get_simulated_value(self, reg: Dict[str, Any]) -> int:
        """Generate a simulated value for a register."""
        
        # Handle static registers
        if 'default' in reg and 'nominal' not in reg:
            return int(reg['default'])
        
        # Get base value
        nominal = reg.get('nominal', reg.get('default', 0))
        if nominal is None:
            nominal = reg.get('default', 0) or 0

        noise = reg.get('noise', 0) or 0
        scale = reg.get('scale', 1.0) or 1.0
        trend_enabled = bool(self.simulation.get('trend_enabled', True))
        noise_enabled = bool(self.simulation.get('noise_enabled', True))

        # Apply time-based trend
        elapsed = time.time() - self.start_time
        trend_factor = 1.0 + 0.01 * math.sin(elapsed / 300) if trend_enabled else 1.0

        # Apply engine state effects
        if self.engine_state == 0:  # STOPPED
            category = reg.get('category')
            if category in ['engine', 'compressor', 'stage1', 'stage2', 'stage3']:
                return 0
            if category in ['exhaust', 'bearings']:
                return int(80 / scale) # Ambient
        
        # Calculate
        value = nominal * trend_factor
        if noise_enabled and noise > 0:
            value += random.gauss(0, noise)
        
        # Scale
        register_value = int(value / scale) if scale != 1.0 else int(value)
        
        # Clamp
        min_val = reg.get('min', 0)
        max_val = reg.get('max', 65535)
        if min_val is None:
            min_val = 0
        if max_val is None:
            max_val = 65535
        register_value = max(int(min_val / scale) if scale != 1.0 else min_val,
                            min(int(max_val / scale) if scale != 1.0 else max_val, register_value))
        
        return max(0, register_value)
    
    def update_registers(self, context: ModbusSlaveContext):
        """Update all simulated register values."""
        
        for reg in self.registers:
            addr = reg['address']
            value = self.get_simulated_value(reg)
            
            # Update the register (Holding Registers = 3)
            # v3 context.setValues(fx, address, values)
            try:
                context.setValues(3, addr, [value])
            except Exception as e:
                # Might happen if address is out of range of current datablock
                pass
        
        return True


class ModbusServer:
    """Modbus TCP Server wrapper."""
    
    def __init__(self, config_path: str):
        self.config_path = config_path
        self.config_mtime = 0
        
        # Initial load
        self.config = self._load_config()
        self.simulator = CompressorSimulator(self.config)
        self.server_config = self.config.get('server', {})
        self.sim_config = self.config.get('simulation', {})
        
        # Create data store (larger to accommodate dynamic changes)
        # Using 65536 to cover full range or reasonably large
        self.store = ModbusSequentialDataBlock(0, [0] * 5000)
        
        # Initialize Context (ModbusDeviceContext/ModbusSlaveContext)
        self.context = ModbusSlaveContext(
            di=ModbusSequentialDataBlock(0, [0] * 5000),
            co=ModbusSequentialDataBlock(0, [0] * 5000),
            hr=self.store,
            ir=ModbusSequentialDataBlock(0, [0] * 5000),
        )
        
        # Initialize Server Context
        # Using 'single=True' ignores Slave ID strictly, simplifying dynamic ID changes
        # as we don't need to reconstruct the mapping.
        # However, for correctness, the simulator respects the "intended" ID in logs.
        self.server_context = ModbusServerContext(
            devices=self.context,
            single=True
        )
        
        # Initial update
        self.simulator.update_registers(self.context)
        
    def _load_config(self) -> Dict[str, Any]:
        """Load configuration from YAML file."""
        try:
            with open(self.config_path, 'r') as f:
                config = yaml.safe_load(f) or {}
                # Update mtime
                try:
                    self.config_mtime = os.path.getmtime(self.config_path)
                except OSError:
                    pass
                return config
        except Exception as e:
            logger.error(f"Error loading config: {e}")
            return {}

    async def watch_config(self):
        """Watch configuration file for changes."""
        while True:
            await asyncio.sleep(2) # Check every 2 seconds
            try:
                if not os.path.exists(self.config_path):
                    continue
                    
                current_mtime = os.path.getmtime(self.config_path)
                if current_mtime > self.config_mtime:
                    logger.info("Configuration change detected. Reloading...")
                    self.config_mtime = current_mtime
                    new_config = self._load_config()
                    if new_config:
                        self.config = new_config
                        self.simulator.load_config(new_config)
                        self.server_config = new_config.get('server', {})
                        self.sim_config = new_config.get('simulation', {})
                        logger.info(f"Configuration reloaded. Active Simulator Slave ID: {self.server_config.get('slave_id', 1)}")
            except Exception as e:
                logger.error(f"Error watching config: {e}")
    
    async def update_loop(self):
        """Periodically update registers with simulated values."""
        
        while True:
            # Use current interval
            interval_ms = self.sim_config.get('update_interval_ms', 100)
            interval_s = interval_ms / 1000.0
            
            self.simulator.update_registers(self.context)
            await asyncio.sleep(interval_s)
    
    async def run(self, host: str = None, port: int = None):
        """Start the Modbus TCP server."""
        
        host = host or self.server_config.get('host', '0.0.0.0')
        port = port or self.server_config.get('port', 5020)
        
        logger.info(f"GCS Modbus Simulator Starting on {host}:{port}")
        
        # Start background tasks
        update_task = asyncio.create_task(self.update_loop())
        watch_task = asyncio.create_task(self.watch_config())
        
        try:
            await StartAsyncTcpServer(
                context=self.server_context,
                address=(host, port),
            )
        except asyncio.CancelledError:
            logger.info("Server shutting down...")
        finally:
            update_task.cancel()
            watch_task.cancel()


def main():
    parser = argparse.ArgumentParser(description='GCS Modbus Simulator')
    parser.add_argument('--config', type=str, default='register_config.yaml',
                        help='Path to register configuration YAML')
    parser.add_argument('--host', type=str, default=None,
                        help='Server bind address')
    parser.add_argument('--port', type=int, default=None,
                        help='Server port')
    
    args = parser.parse_args()
    
    # Create and run server (config loading happens inside)
    # Note: args.config will point to the mounted path
    server = ModbusServer(args.config)
    
    try:
        asyncio.run(server.run(args.host, args.port))
    except KeyboardInterrupt:
        logger.info("Stopped by user")
    
    return 0


if __name__ == '__main__':
    exit(main())
