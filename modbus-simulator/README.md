# GCS Modbus Simulator

A standalone Modbus TCP server that emulates a gas compressor system's PLC/RTU.
This is used for testing and development when actual hardware is not available.

## Features

- Emulates 1000+ Modbus registers matching real compressor instrumentation
- Simulates realistic operating conditions with noise and trends
- Supports multiple engine states (STOPPED, STARTING, RUNNING, FAULT)
- Configurable via YAML file
- Standalone - runs independently of the main Digital Twin application

## Quick Start

```bash
# Install dependencies
pip install pymodbus pyyaml

# Run the simulator
python main.py

# Or with a custom config
python main.py --config my_config.yaml --port 5020
```

## Register Map

| Address Range | Description |
|--------------|-------------|
| 0-99 | System status and engine state |
| 100-199 | Engine vitals (RPM, oil, temps) |
| 200-299 | Compressor vitals |
| 300-399 | Stage 1 data |
| 400-499 | Stage 2 data |
| 500-599 | Stage 3 data |
| 600-699 | Exhaust temperatures |
| 700-799 | Bearing temperatures |
| 800-899 | Control outputs |
| 900-999 | Alarms and faults |

## Configuration

See `register_config.yaml` for the full register map.
