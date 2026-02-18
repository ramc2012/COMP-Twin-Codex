# Gas Engine Compressor System — Digital Twin
## Master Plan & Feature Specification for Brainstorming

---

## 1. Executive Summary

This document outlines the architecture, features, and physics calculations for a **universal digital twin platform** for gas engine-driven compressor systems. The system reads live data via Modbus (TCP/RTU), performs real-time thermodynamic and mechanical calculations, stores time-series data in InfluxDB, and presents everything through a visually rich monitoring application.

**Key Design Principle:** The platform is **make/model agnostic**. Every parameter — from Modbus addresses to cylinder bore dimensions — is user-configurable. No hardcoded assumptions about any specific controller, engine, or compressor brand.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE (Web App)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Overview  │ │Compressor│ │  Engine  │ │PV/PT Diag│ │  Config  │ │
│  │Dashboard │ │ Stages   │ │  Health  │ │  rams    │ │  Pages   │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │PerformKPI│ │  Safety  │ │ Trending │ │  Alarms  │              │
│  │ & Effic. │ │  Status  │ │  History │ │  & Logs  │              │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘              │
└────────────────────────────┬────────────────────────────────────────┘
                             │ REST / WebSocket
┌────────────────────────────┴────────────────────────────────────────┐
│                      CALCULATION ENGINE (Backend)                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Thermodynamic   │  │   Mechanical     │  │   Performance    │  │
│  │  Calculations    │  │   Calculations   │  │   Analytics      │  │
│  │  ─ Isen. eff     │  │  ─ Rod loads     │  │  ─ Trending      │  │
│  │  ─ Vol. eff      │  │  ─ Frame loads   │  │  ─ Degradation   │  │
│  │  ─ Polytropic    │  │  ─ Crosshead     │  │  ─ Anomaly det.  │  │
│  │  ─ Discharge T   │  │  ─ Bearing loads │  │  ─ Run-hours     │  │
│  │  ─ BHP per stage │  │  ─ Valve losses  │  │  ─ Fuel tracking │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌─────────────┬──────────────┴──────────────┬─────────────────────────┐
│  Modbus     │        InfluxDB             │    Configuration        │
│  Gateway    │     Time-Series DB          │      Store              │
│  ─ TCP/RTU  │  ─ Raw sensor data          │  ─ Modbus register map  │
│  ─ Polling  │  ─ Calculated metrics       │  ─ Equipment specs      │
│  ─ 16/32bit │  ─ Alarm history            │  ─ User overrides       │
│  ─ Scaling  │  ─ Downsampled aggregates   │  ─ Alarm setpoints      │
└─────────────┴─────────────────────────────┴─────────────────────────┘
```

---

## 3. Data Source Analysis (From Uploaded Modbus Map)

### 3.1 Available via Modbus (DE-4000 Controller)

Based on the analyzed register mapping, the controller provides:

| Category | Count | Addresses | What's Available |
|----------|-------|-----------|-----------------|
| **Stage Pressures** | 7 | 40090–40097 | Suction S1, Discharge S1/S2/S3, Suction S3, Comp Oil, Engine Oil |
| **Compressor Temps** | 5 | 40122–40126 | Comp Oil Temp, Cyl #1–#4 Discharge Temps |
| **Engine Temps** | 4 | 40130–40131, 40152–40153 | Engine Oil, Jacket Water, Air Manifold L/R |
| **Exhaust Temps** | 18 | 40138–40151, 40186–40189 | 6 Cyl L/R, Pre/Post Turbo L/R, FW/Aux Pre/Post |
| **Bearing Temps** | 9 | 40190–40198 | Engine Bearings #1–#9 |
| **Engine State** | 3 | 40001–40003 | State register (10 states), Hour Meter hrs/min |
| **Speeds** | 10 | 40250–40259 | RPM channels T1:SP1 through T5:SP2 |
| **Analog Outputs** | 20 | 40260–40279 | AO1–AO4 for T1–T5 (incl. Suction, Speed, Recycle) |
| **Digital Status** | 6 | 40005, 40020–40024 | DS outputs, DO status per terminal |
| **Safety/Discrete** | 30 | Various | Gas detectors, vibration, levels, ESD, flow switches |
| **PID Controllers** | 420 (32-bit) | 40402+ | P/I/D factors, setpoints, limits, enable |
| **Safety Setpoints** | 320 (32-bit) | 42000+ | Hi/Lo safety setpoints for all 160 inputs |
| **Fault Status** | 1 | 40004 | Encoded fault code (0–255) |

### 3.2 NOT Available via Modbus — Required for Physics (Must Be User-Configured)

These critical parameters are **never** transmitted over Modbus but are essential for accurate thermodynamic and mechanical calculations:

| Category | Parameters | Why Needed |
|----------|-----------|------------|
| **Compressor Cylinder Geometry** | Bore diameter, stroke length, rod diameter, clearance volume % (per cylinder/stage) | PV diagrams, volumetric efficiency, displacement, rod loads |
| **Number of Stages** | Total compression stages, cylinders per stage, single/double acting | Stage mapping, power distribution |
| **Piston & Rod Data** | Piston area, rod area, effective area HE/CE | Rod load calculations, frame load analysis |
| **Gas Composition** | Specific gravity, molecular weight, k (Cp/Cv), Z-factor | All thermodynamic calcs, compressibility corrections |
| **Gas Flow Conditions** | Design suction temperature, design flow rate (MMSCFD/ACFM) | Capacity calculations, efficiency benchmarking |
| **Engine Specifications** | Rated HP, rated RPM, # of cylinders, bore/stroke, displacement | Power utilization %, thermal efficiency |
| **Rated Conditions** | Design suction/discharge pressures per stage, design temperatures | Deviation analysis from design point |
| **Cooler Data** | Interstage cooler approach temperatures, cooling water temp | Heat balance, cooler performance monitoring |
| **Valve Loss Data** | Pressure drop across suction/discharge valves per cylinder | Corrected PV diagrams, valve health monitoring |
| **Frame Ratings** | Maximum rod load tension/compression, frame rating HP | Load limit monitoring, safety margins |
| **Coupling/Gearbox** | Speed ratio (if geared), mechanical losses | Actual compressor RPM from engine RPM |
| **Altitude/Ambient** | Site elevation, barometric pressure, ambient temperature | Absolute pressure corrections, density corrections |

---

## 4. Configuration System Design (Universal / Make-Model Agnostic)

### 4.1 Configuration Hierarchy

```
┌─────────────────────────────────────────────────┐
│  LAYER 1: COMMUNICATION SETTINGS                 │
│  Modbus TCP/RTU, IP, Port, Slave ID, Baud, etc. │
├─────────────────────────────────────────────────┤
│  LAYER 2: REGISTER MAP                           │
│  Address → Name → Scale → Offset → Unit → Type  │
│  Fully editable table; Import/Export JSON/CSV    │
├─────────────────────────────────────────────────┤
│  LAYER 3: EQUIPMENT SPECIFICATIONS               │
│  Engine specs, compressor geometry, gas props,   │
│  frame ratings, cooler data, design conditions   │
├─────────────────────────────────────────────────┤
│  LAYER 4: DATA SOURCE PRIORITY                   │
│  Per-parameter: Modbus → Calculated → User Value │
│  Fallback chain for every physics input          │
├─────────────────────────────────────────────────┤
│  LAYER 5: ALARM & SETPOINT CONFIGURATION         │
│  HH / H / L / LL per parameter, custom actions  │
├─────────────────────────────────────────────────┤
│  LAYER 6: DISPLAY & DASHBOARD PREFERENCES        │
│  Widget layout, units (imperial/metric), colors  │
└─────────────────────────────────────────────────┘
```

### 4.2 Data Source Priority / Fallback System

This is the **critical innovation** — for every parameter used in a physics calculation, the system defines a priority chain:

```
PARAMETER: "Suction Temperature Stage 1"

Priority 1: MODBUS LIVE  → Register 40XXX (if mapped and reading valid)
Priority 2: CALCULATED   → Derived from upstream discharge temp - cooler approach ΔT
Priority 3: USER VALUE   → Manual entry: 80°F (static fallback)
Priority 4: DEFAULT      → Industry default for the parameter type
```

**Configuration UI for each parameter:**

| Field | Description |
|-------|------------|
| Parameter Name | Descriptive name (e.g., "Stage 1 Suction Temperature") |
| Source Priority | Dropdown: Modbus → Calculated → Manual → Default |
| Modbus Register | Address to read (if Modbus selected) |
| Calculation Formula | Auto-populated if Calculated is an option |
| Manual Override Value | User-entered static value |
| Default Value | Factory default |
| Engineering Unit | °F, PSIG, RPM, etc. |
| Active Source Indicator | Shows which source is currently supplying the value (green/yellow/red) |

### 4.3 Equipment Specifications Configuration Pages

#### 4.3.1 Compressor Specifications

```
┌─────────────── COMPRESSOR CONFIGURATION ───────────────┐
│                                                          │
│  General                                                 │
│  ├─ Manufacturer: [____________]  Model: [____________]  │
│  ├─ Serial Number: [____________]                        │
│  ├─ Number of Stages: [3] ▼                              │
│  ├─ Compressor Type: [Reciprocating] ▼                   │
│  └─ Frame Rating: [____] HP    Max Rod Load: [____] lbf  │
│                                                          │
│  Per-Stage Configuration (Tab for each stage)            │
│  ┌─ Stage 1 ─┬─ Stage 2 ─┬─ Stage 3 ─┐                 │
│  │ Cylinders: [2]                      │                 │
│  │ Action: [Double Acting] ▼           │                 │
│  │ Bore Diameter: [____] inches        │                 │
│  │ Stroke Length: [____] inches        │                 │
│  │ Rod Diameter: [____] inches         │                 │
│  │ Clearance Vol %: [____] % (HE)     │                 │
│  │ Clearance Vol %: [____] % (CE)     │                 │
│  │ Pocket Clearance: [____] % (if any)│                 │
│  │                                     │                 │
│  │ Design Conditions:                  │                 │
│  │ ├─ Suction Pressure: [____] PSIG   │                 │
│  │ ├─ Discharge Pressure: [____] PSIG │                 │
│  │ ├─ Suction Temp: [____] °F         │                 │
│  │ └─ Design Flow: [____] MMSCFD      │                 │
│  │                                     │                 │
│  │ Data Source Mapping:                │                 │
│  │ ├─ Suction P: [Modbus 40090] ▼     │                 │
│  │ ├─ Discharge P: [Modbus 40091] ▼   │                 │
│  │ ├─ Suction T: [Manual: 80°F] ▼     │                 │
│  │ └─ Discharge T: [Modbus 40123] ▼   │                 │
│  └─────────────────────────────────────┘                 │
└──────────────────────────────────────────────────────────┘
```

#### 4.3.2 Engine Specifications

```
┌─────────────── ENGINE CONFIGURATION ───────────────────┐
│                                                          │
│  General                                                 │
│  ├─ Manufacturer: [____________]  Model: [____________]  │
│  ├─ Serial Number: [____________]                        │
│  ├─ Fuel Type: [Natural Gas] ▼                           │
│  ├─ Number of Cylinders: [6]   Configuration: [V] ▼     │
│  ├─ Bore: [____] in    Stroke: [____] in                 │
│  ├─ Displacement: [____] cu.in (auto-calc if bore/stroke)│
│  ├─ Rated BHP: [____] HP  @ Rated RPM: [____] RPM       │
│  ├─ BSFC (rated): [____] BTU/HP-hr                      │
│  └─ Turbo: [Yes/No] ▼   Intercooled: [Yes/No] ▼        │
│                                                          │
│  Coupling                                                │
│  ├─ Type: [Direct / Geared / Belt] ▼                     │
│  ├─ Speed Ratio: [1.0:1] (engine:compressor)             │
│  └─ Mechanical Efficiency: [97] %                        │
│                                                          │
│  Data Source Mapping:                                    │
│  ├─ Engine RPM: [Modbus 40250] ▼                         │
│  ├─ Oil Pressure: [Modbus 40097] ▼                       │
│  ├─ Oil Temp: [Modbus 40130] ▼                           │
│  ├─ JW Temp: [Modbus 40131] ▼                            │
│  ├─ Fuel Rate: [Manual: ___ MMBTU/hr] ▼                  │
│  └─ Exhaust Temps: [Modbus 40138-40151] ▼                │
└──────────────────────────────────────────────────────────┘
```

#### 4.3.3 Gas Properties

```
┌─────────────── GAS PROPERTIES CONFIGURATION ──────────────┐
│                                                             │
│  Input Method: [Manual / From Chromatograph / AGA-8] ▼      │
│                                                             │
│  Manual Entry:                                              │
│  ├─ Specific Gravity: [0.65]                                │
│  ├─ Molecular Weight: [18.85] lbm/lbmol                    │
│  ├─ k (Cp/Cv) at suction: [1.28]                           │
│  ├─ k (Cp/Cv) at discharge: [1.25]                         │
│  ├─ Z-factor at suction: [0.98]                             │
│  ├─ Z-factor at discharge: [0.95]                           │
│  └─ Gas constant R: [auto-calc from MW]                     │
│                                                             │
│  Composition (optional, for precise Z/k):                   │
│  ├─ Methane (C1):   [___] %    Ethane (C2):   [___] %      │
│  ├─ Propane (C3):   [___] %    n-Butane (C4): [___] %      │
│  ├─ CO2:            [___] %    N2:            [___] %      │
│  └─ H2S:            [___] %    Others:        [___] %      │
│                                                             │
│  ★ If a gas chromatograph Modbus feed exists, it can be     │
│    mapped here to auto-update gas properties in real time.  │
└─────────────────────────────────────────────────────────────┘
```

#### 4.3.4 Site / Ambient Conditions

```
┌─────────────── SITE CONDITIONS ──────────────────────────┐
│  ├─ Elevation: [____] ft    Baro Pressure: [14.696] PSIA │
│  ├─ Ambient Temp: [Modbus / Manual: 95°F] ▼              │
│  ├─ Cooling Water Temp: [Manual: 85°F] ▼                 │
│  └─ Interstage Cooler Approach ΔT: [15] °F               │
└──────────────────────────────────────────────────────────┘
```

---

## 5. Physics Calculations — Complete Specification

### 5.1 Compressor Thermodynamics (Per Stage)

| Calculation | Formula | Inputs Required | Source |
|---|---|---|---|
| **Compression Ratio** | R = P_discharge / P_suction (absolute) | Suction P, Discharge P, Barometric P | Modbus + Config |
| **Isentropic Discharge Temp** | T_d,isen = T_s × R^((k-1)/k) | T_suction, R, k | Modbus/Manual + Config |
| **Actual vs Ideal Temp Rise** | ΔT_actual / ΔT_ideal | T_suction, T_discharge (actual), T_d,isen | Modbus + Calculated |
| **Isentropic Efficiency** | η_isen = (T_d,isen - T_s) / (T_d,actual - T_s) | All above | Calculated |
| **Polytropic Exponent** | n = ln(R) / ln(T_d/T_s) | R, T_suction, T_discharge | Calculated |
| **Polytropic Efficiency** | η_poly = ((k-1)/k) / ((n-1)/n) | k, n | Calculated |
| **Polytropic Head** | H_poly = Z_avg × R_gas × T_s × (n/(n-1)) × (R^((n-1)/n) - 1) | Z, R_gas, T_s, n, R | Config + Calculated |
| **Volumetric Efficiency** | η_vol = 1 - c × (R^(1/k) - 1) | Clearance %, R, k | Config + Calculated |
| **Actual Displacement** | V_disp = (π/4) × D² × L × N × RPM / (2 if single-acting) | Bore, Stroke, # cyls, RPM, action type | Config + Modbus |
| **Actual Inlet Volume Flow** | Q_actual = V_disp × η_vol | V_disp, η_vol | Calculated |
| **Isentropic Power (per stage)** | W_isen = (P_s × Q_act × (k/(k-1)) × (R^((k-1)/k) - 1)) / (229.17) | P_s, Q_act, k, R | Calculated |
| **Actual Power (per stage)** | W_actual = W_isen / η_isen | W_isen, η_isen | Calculated |
| **Gas Horsepower (total)** | GHP = Σ W_actual (all stages) | All stage powers | Calculated |
| **Brake Horsepower** | BHP = GHP / η_mechanical | GHP, mech eff | Calculated + Config |

### 5.2 Compressor Mechanical Calculations

| Calculation | Formula | Inputs Required |
|---|---|---|
| **Piston Area (HE)** | A_HE = (π/4) × D² | Bore diameter |
| **Piston Area (CE)** | A_CE = (π/4) × (D² - d²) | Bore, Rod diameter |
| **Rod Load (Tension)** | F_t = P_d × A_CE - P_s × A_HE | Pressures, Areas |
| **Rod Load (Compression)** | F_c = P_d × A_HE - P_s × A_CE | Pressures, Areas |
| **Combined Rod Load** | F_comb = max(|F_t|, |F_c|) + inertia | Rod loads + RPM/stroke |
| **Inertia Load** | F_inertia = M_recip × ω² × r (at TDC/BDC) | Reciprocating mass, RPM, stroke |
| **% of Frame Rating** | %Frame = F_comb / F_frame_rated × 100 | Combined load, Frame rating |
| **Rod Reversal Check** | Must have sign change in rod load each revolution | Tension & Compression loads |

### 5.3 PV Diagram Generation (Per Cylinder)

The PV diagram is synthesized from operating conditions and cylinder geometry:

```
Point 1 (BDC Suction): V = V_swept + V_clearance, P = P_suction
  │
  │  1→2: COMPRESSION (polytropic: PV^n = const)
  │       V decreases from V_max to V_cl × R^(1/n)
  │       P increases from P_s to P_d
  ▼
Point 2 (TDC start discharge): V = V_cl × R^(1/n), P = P_discharge
  │
  │  2→3: DISCHARGE (constant pressure at P_d)
  │       V decreases from V_2 to V_clearance
  ▼
Point 3 (TDC end discharge): V = V_clearance, P = P_discharge
  │
  │  3→4: RE-EXPANSION (polytropic: PV^n = const)
  │       V increases from V_cl to V_cl × R^(1/n)
  │       P decreases from P_d to P_s
  ▼
Point 4 (BDC start suction): V = V_cl × R^(1/n), P = P_suction
  │
  │  4→1: SUCTION (constant pressure at P_s)
  │       V increases from V_4 to V_max
  ▼
Back to Point 1.

Area enclosed = Work per cycle (W_indicated)
W_hp = (W_indicated × RPM) / 33000  [if P in psi, V in cu.in]
```

**Advanced PV Options (with valve loss data):**
- Suction valve loss: depresses suction line below P_suction
- Discharge valve loss: elevates discharge line above P_discharge
- Channel losses: additional P drops in passages
- These create a more realistic "lobed" PV diagram

### 5.4 PT (Pressure-Temperature) Diagram

Traces the thermodynamic state path through all stages:

```
Stage 1 Suction → Stage 1 Discharge → Interstage Cooler 1 →
Stage 2 Suction → Stage 2 Discharge → Interstage Cooler 2 →
Stage 3 Suction → Stage 3 Discharge → Final Aftercooler →
Final discharge conditions
```

Overlaid with:
- Isentropic path (dashed) for reference
- Phase envelope (if gas composition known)
- Critical point marker
- Retrograde condensation zone (if applicable)

### 5.5 Engine Performance Calculations

| Calculation | Formula | Inputs Required |
|---|---|---|
| **% Rated Load** | %Load = BHP_actual / BHP_rated × 100 | Actual BHP, Rated BHP |
| **BSFC** | BSFC = Fuel_rate / BHP_actual | Fuel rate, BHP (need external fuel meter or manual) |
| **Brake Thermal Efficiency** | η_th = (BHP × 2544) / (Fuel_rate_BTU/hr) × 100 | BHP, Fuel rate |
| **Turbo Efficiency** | η_turbo = ΔT_actual / ΔT_ideal (from pre/post turbo temps) | Pre/Post turbo temps |
| **Exhaust Spread** | ΔT_exh = T_max - T_min (across all cylinders) | All exhaust temps |
| **Exhaust Deviation** | Dev_i = T_cyl_i - T_avg | Individual exh temps, Average |
| **Bearing Temp Trend** | Rate of change per hour, deviation from baseline | Bearing temps, Time |
| **Volumetric Efficiency (Engine)** | Related to manifold pressure vs ambient | Manifold temps, Baro P |

### 5.6 Efficiency Monitoring Over Time

| Metric | Method | Alert Threshold |
|---|---|---|
| **Valve Degradation** | Rising discharge temp at same ratio → declining η_isen | η_isen drops > 3% from baseline |
| **Ring Wear** | Declining η_vol at same ratio | η_vol drops > 5% |
| **Fouling (Cooler)** | Rising approach temperature | ΔT_approach > design + 10°F |
| **Bearing Wear** | Rising bearing temps at same load/speed | Trend > 2°F/week |
| **Packing Leak** | Declining capacity at same conditions | > 5% from baseline |

---

## 6. InfluxDB Time-Series Database Design

### 6.1 Measurement Schema

```
MEASUREMENT: "sensor_data"
  Tags:   unit_id, category, sensor_name, unit_of_measure, modbus_address
  Fields: value (float)
  Time:   nanosecond precision

MEASUREMENT: "physics_calcs"
  Tags:   unit_id, stage, calc_type
  Fields: value (float)
  Time:   nanosecond precision

MEASUREMENT: "alarm_events"
  Tags:   unit_id, severity (HH/H/L/LL), parameter, acknowledged
  Fields: value, setpoint, message
  Time:   nanosecond precision

MEASUREMENT: "equipment_state"
  Tags:   unit_id
  Fields: engine_state, hour_meter, fault_code
  Time:   nanosecond precision

MEASUREMENT: "pv_diagram_snapshot"
  Tags:   unit_id, stage, cylinder
  Fields: volume_points (JSON string), pressure_points (JSON string)
  Time:   captured every N minutes for historical comparison
```

### 6.2 Retention Policies

| Bucket | Retention | Aggregation | Use Case |
|--------|-----------|-------------|----------|
| `raw` | 7 days | None (1-sec data) | Real-time dashboards, troubleshooting |
| `hourly` | 90 days | Mean, Min, Max per hour | Short-term trending |
| `daily` | 2 years | Mean, Min, Max per day | Long-term efficiency tracking |
| `events` | 5 years | None | Alarm history, state changes |

### 6.3 Continuous Aggregation Tasks (Flux)

```flux
// Downsample raw to hourly
option task = {name: "downsample_hourly", every: 1h}
from(bucket: "raw")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "sensor_data")
  |> aggregateWindow(every: 1h, fn: mean)
  |> to(bucket: "hourly")

// Physics recalculation every minute
option task = {name: "physics_calc", every: 1m}
// ... compute derived metrics from latest raw data

// Anomaly detection (deviation from 24h rolling average)
option task = {name: "anomaly_check", every: 5m}
from(bucket: "hourly")
  |> range(start: -24h)
  |> filter(fn: (r) => r._field == "isentropic_efficiency")
  |> mean()
  |> map(fn: (r) => ({r with _value: r._value * 0.95}))  // 5% threshold
```

### 6.4 Plugin Architecture

```
┌──────────────────────────────────────────────────────┐
│  INFLUXDB WRITER PLUGIN                               │
│                                                        │
│  modbus_poller.py                                      │
│  ├─ Reads config JSON (register map + connection)      │
│  ├─ Polls Modbus registers at configured interval      │
│  ├─ Applies scale/offset/data-type conversion          │
│  └─ Emits to → writer queue                            │
│                                                        │
│  physics_engine.py                                     │
│  ├─ Subscribes to raw sensor data                      │
│  ├─ Loads equipment specs from config                  │
│  ├─ Applies fallback chain (Modbus→Calc→Manual)        │
│  ├─ Runs all thermodynamic/mechanical calculations     │
│  └─ Emits calculated metrics to → writer queue         │
│                                                        │
│  influx_writer.py                                      │
│  ├─ Batches points from queue                          │
│  ├─ Writes to InfluxDB with retry logic                │
│  └─ Handles connection failures gracefully             │
│                                                        │
│  alarm_engine.py                                       │
│  ├─ Compares values against HH/H/L/LL setpoints       │
│  ├─ Implements deadband to prevent alarm chatter       │
│  ├─ Writes alarm events to InfluxDB                    │
│  └─ Emits to notification system                       │
└──────────────────────────────────────────────────────┘
```

---

## 7. Application Pages & Features

### 7.1 Dashboard / Overview Page

**Purpose:** Single-glance health assessment of entire package.

**Widgets:**
- Engine state indicator with color-coded badge (all 10 states from register 40001)
- Hour meter display
- Key pressure cascade: Suction → S1 Disch → S2 Disch → S3 Disch (with ratios)
- Engine RPM gauge with trend sparkline
- Oil pressures (comp + engine) with alert thresholds
- Jacket water temp with trend
- Gas detector readings (comp side + engine side)
- Control outputs: Suction valve %, Speed control %, Recycle valve %
- Overall compression ratio (calculated)
- Total estimated BHP (calculated)
- Mini alarm banner (last 5 active alarms)

### 7.2 Compressor Detail Page

**Widgets per stage:**
- Suction/Discharge pressure gauges
- Compression ratio display
- Cylinder discharge temperatures (all 4 cylinders)
- Isentropic efficiency % gauge
- Volumetric efficiency % gauge
- Estimated stage power (HP)
- Ideal vs actual discharge temperature comparison
- PV diagram thumbnail (clickable for full-screen)

**Summary widgets:**
- Overall compression ratio
- Total gas horsepower
- Comp oil pressure + temperature
- Scrubber level status (3 stages)
- Vibration status (compressor cylinders + cooler)
- Rod load status (if geometry configured) with % of frame limit

### 7.3 Engine Detail Page

**Widgets:**
- RPM gauge (large, central)
- Oil pressure + temperature
- Jacket water temperature
- Exhaust temperature bar chart: 6 cylinders × L/R banks
- Exhaust spread indicator with deviation highlighting
- Pre-turbo / Post-turbo temperature comparison (both banks)
- Air manifold temperatures L/R
- Bearing temperature radial display (9 bearings)
- Engine load % (if rated HP configured)
- ESD status indicators

### 7.4 PV / PT Diagram Page

**Features:**
- Interactive PV diagrams for each stage/cylinder
- Overlay: ideal (isentropic) vs actual (polytropic) curves
- With valve losses if configured
- Work area calculation (shaded region)
- PT diagram showing full compression path through all stages
- Historical PV comparison: overlay current vs baseline snapshot
- Zoom, pan, cursor data readout
- Export diagram as image/PDF

### 7.5 Performance / Analytics Page

**Widgets:**
- Thermodynamic analysis table (all stages side-by-side)
- Power distribution bar chart
- Efficiency trend charts (isen, vol, polytropic over 24h/7d/30d)
- Exhaust temperature deviation plot
- Bearing temperature trend matrix
- Energy balance: input fuel energy vs useful compression work
- Degradation indicators: efficiency decline rates
- Performance deviation from design conditions

### 7.6 Alarm & Safety Page

**Features:**
- Active alarm list with severity, time, value, setpoint
- Alarm history with filtering (date, severity, parameter)
- Safety system status: all ESD, gas detectors, pressure switches
- Fault code decoder (register 40004 mapping)
- Trip event log with pre-trip data snapshot

### 7.7 Historical Trending Page

**Features:**
- Multi-parameter trend selector (checkboxes for any parameter)
- Configurable time ranges (1h, 6h, 24h, 7d, 30d, custom)
- Overlaid Y-axes for different parameter types
- Statistical overlay: mean, ±1σ, ±2σ bands
- Query directly from InfluxDB

### 7.8 Configuration Pages (as detailed in Section 4)

- Communication Settings
- Register Map (full CRUD table)
- Equipment Specifications (Compressor / Engine / Gas / Site)
- Data Source Priority / Fallback settings
- Alarm Setpoints
- Display Preferences (units, colors, layout)
- Import/Export entire configuration as JSON
- Configuration templates for common engine/compressor models

---

## 8. Data Source Fallback — Detailed Design

### 8.1 Fallback Resolution Engine

For every parameter consumed by the physics engine, the resolver runs this logic:

```python
def resolve_parameter(param_name, config, live_data):
    sources = config.get_source_priority(param_name)
    # e.g., ["modbus:40090", "calculated:interstage_cooler", "manual:80", "default:75"]
    
    for source in sources:
        if source.type == "modbus":
            value = live_data.get(source.register)
            if value is not None and is_valid(value, source.range):
                return ParameterResult(value, source="MODBUS", quality="GOOD")
        
        elif source.type == "calculated":
            try:
                value = calculations.compute(source.formula, live_data, config)
                return ParameterResult(value, source="CALCULATED", quality="INFERRED")
            except CalculationError:
                continue
        
        elif source.type == "manual":
            return ParameterResult(source.value, source="MANUAL", quality="STATIC")
        
        elif source.type == "default":
            return ParameterResult(source.value, source="DEFAULT", quality="ASSUMED")
    
    return ParameterResult(None, source="NONE", quality="BAD")
```

### 8.2 Quality Indicator Badges

Every displayed value shows its data source:

| Badge | Meaning | Color |
|-------|---------|-------|
| 🟢 LIVE | Value from Modbus, validated | Green |
| 🔵 CALC | Derived from other live values | Blue |
| 🟡 MANUAL | User-entered static value | Yellow |
| 🟠 DEFAULT | Using factory default | Orange |
| 🔴 BAD | No valid source available | Red |

### 8.3 Fallback Configuration UI

```
┌──────────────── PARAMETER SOURCE CONFIGURATION ──────────────┐
│                                                                │
│  Parameter: Stage 1 Suction Temperature                        │
│                                                                │
│  Priority │ Source Type    │ Configuration        │ Status     │
│  ─────────┼───────────────┼──────────────────────┼────────────│
│     1     │ Modbus         │ Register: [None] ▼   │ ⚫ N/A     │
│     2     │ Calculated     │ = T_upstream_disch   │ 🔵 Available│
│           │                │   - cooler_approach  │            │
│     3     │ Manual Value   │ [80] °F              │ 🟡 Standby │
│     4     │ Default        │ 75 °F                │ 🟠 Standby │
│                                                                │
│  Currently Active: Priority 2 (Calculated) → 82.3°F 🔵        │
│                                                                │
│  [↑ Move Up] [↓ Move Down] [+ Add Source] [✕ Remove]          │
└────────────────────────────────────────────────────────────────┘
```

---

## 9. Universal Adaptability Features

### 9.1 What Makes It Universal

| Feature | How It Works |
|---------|-------------|
| **No hardcoded registers** | Every Modbus address is in the config; change them and the system adapts |
| **Variable stage count** | 1 to N compression stages; UI dynamically generates stage cards |
| **Variable cylinder count** | Per stage and for the engine; exhaust/bearing displays auto-scale |
| **Multiple controller support** | Not tied to DE-4000; any Modbus device maps the same way |
| **Unit system toggle** | Imperial ↔ Metric throughout (°F/°C, PSIG/kPa, HP/kW, CFM/m³/h) |
| **Gas type flexibility** | Works for natural gas, CO2, hydrogen, refrigerants — just change gas properties |
| **Compressor type adaptable** | Reciprocating (default), but framework supports screw/centrifugal with different calc modules |
| **Multi-unit support** | Can monitor multiple compressor packages, each with its own config |
| **Template library** | Save/load equipment configs: "Ariel JGK/4, CAT G3516, Waukesha P48GLD" etc. |

### 9.2 Configuration Import/Export

Entire system configuration exportable as a single JSON file:

```json
{
  "version": "1.0",
  "unit_id": "GCS-001",
  "communication": { ... },
  "register_map": [ ... ],
  "equipment": {
    "compressor": { "stages": [...], "frame": {...} },
    "engine": { ... },
    "gas": { ... },
    "site": { ... }
  },
  "data_sources": { ... },
  "alarms": { ... },
  "display": { ... }
}
```

---

## 10. Technology Stack Options

### 10.1 Option A: Full-Stack Web Application

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | React + Tailwind CSS | Rich interactive dashboards |
| Charting | Canvas API + D3.js / Recharts | Custom PV/PT diagrams |
| Backend | Python (FastAPI) | Physics engine, Modbus comms |
| Modbus | pymodbus | Mature TCP/RTU library |
| Database | InfluxDB 2.x | Purpose-built time-series |
| Real-time | WebSocket (via FastAPI) | Live data push to UI |
| Config Store | PostgreSQL or JSON files | Equipment specs, register maps |
| Deployment | Docker Compose | Entire stack in containers |

### 10.2 Option B: Lightweight / Edge Deployment

| Layer | Technology |
|-------|-----------|
| All-in-one | Python + Flask + SQLite + Chart.js |
| Runs on | Raspberry Pi / Industrial PC at the wellsite |
| Optional | InfluxDB if resources allow; otherwise CSV logging |

### 10.3 Option C: Single-Page React App (Prototype/Demo)

| Layer | Technology |
|-------|-----------|
| Frontend | React JSX artifact (single file) |
| Data | Simulated data generator |
| Physics | JavaScript physics engine (runs in browser) |
| Storage | Browser localStorage / window.storage API |
| Deploy | Runs in Claude artifact or any static host |

---

## 11. Implementation Roadmap

### Phase 1: Foundation (Weeks 1–2)
- [ ] Configuration data model & JSON schema
- [ ] Modbus polling engine with register map
- [ ] Basic physics calculations (ratios, efficiency, power)
- [ ] InfluxDB schema creation & writer plugin
- [ ] Core dashboard with live values

### Phase 2: Full Physics (Weeks 3–4)
- [ ] PV diagram synthesis engine
- [ ] PT diagram generation
- [ ] Rod load calculations
- [ ] Equipment spec configuration pages
- [ ] Data source fallback resolver

### Phase 3: Rich UI (Weeks 5–6)
- [ ] All dashboard pages (7 pages)
- [ ] Interactive PV/PT with zoom/overlay
- [ ] Alarm engine & notification system
- [ ] Historical trending with InfluxDB queries
- [ ] Unit conversion system (imperial ↔ metric)

### Phase 4: Intelligence (Weeks 7–8)
- [ ] Efficiency degradation tracking
- [ ] Anomaly detection on bearing/exhaust trends
- [ ] Maintenance prediction indicators
- [ ] Performance deviation from design
- [ ] Report generation (PDF/Excel)

### Phase 5: Universalization (Weeks 9–10)
- [ ] Configuration template library
- [ ] Multi-unit support
- [ ] Import/Export everything
- [ ] Documentation & user guide
- [ ] Edge deployment packaging

---

## 12. Open Questions for Brainstorming

1. **Scope of the initial deliverable:** Full-stack application or React prototype with simulated data first?
2. **Deployment target:** Cloud server, on-premise industrial PC, or edge device?
3. **Multiple units:** Will this monitor one compressor package or multiple simultaneously?
4. **Historian integration:** Besides InfluxDB, need integration with any existing SCADA/historian (PI, Wonderware)?
5. **User roles:** Should there be operator vs. engineer vs. admin access levels?
6. **Mobile access:** Need a responsive/mobile version for field operators?
7. **Notification channels:** Email, SMS, push notifications for alarms?
8. **Offline capability:** Should it buffer data if InfluxDB or network is unavailable?
9. **Gas chromatograph integration:** Is there a live GC feed for real-time gas properties?
10. **Valve analyzers:** Any integration with third-party valve analyzer data for accurate PV diagrams?
11. **Regulatory compliance:** Any API/ASME reporting requirements to embed?
12. **Data export:** Need scheduled reports (daily/weekly) auto-emailed?

---

## 13. Key Differentiators from Existing Solutions

| Feature | This Platform | Typical SCADA | OEM Software |
|---------|--------------|---------------|-------------|
| Full physics calculations | ✅ Built-in | ❌ Display only | Partial |
| PV/PT diagrams from operating data | ✅ Synthesized | ❌ | Some (requires analyzer) |
| Universal make/model support | ✅ Fully configurable | ✅ | ❌ Locked to OEM |
| Data source fallback chain | ✅ Unique feature | ❌ | ❌ |
| Equipment spec entry for non-Modbus data | ✅ Comprehensive | ❌ | ❌ |
| Open-source time-series DB | ✅ InfluxDB | ❌ Proprietary | ❌ Proprietary |
| Efficiency degradation tracking | ✅ Automated | ❌ Manual | Basic |
| Exportable configuration | ✅ JSON | ❌ | ❌ |
| Zero license cost for core platform | ✅ | ❌ | ❌ |

---

*This document is a living specification. All sections are open for discussion, modification, and prioritization during the brainstorming phase.*
