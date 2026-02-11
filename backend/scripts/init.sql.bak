-- GCS Digital Twin - PostgreSQL Schema
-- Configuration database for equipment, register maps, alarms, and users

-- UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- UNITS / EQUIPMENT
-- ============================================================

CREATE TABLE units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_name VARCHAR(100) NOT NULL UNIQUE,
    location VARCHAR(200),
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Equipment specifications (compressor details)
CREATE TABLE equipment_specs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
    spec_type VARCHAR(50) NOT NULL, -- 'compressor', 'engine', 'cooler'
    
    -- Compressor specs
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    serial_number VARCHAR(100),
    num_stages INTEGER,
    rated_speed_rpm FLOAT,
    rated_bhp FLOAT,
    frame_rating_lbs FLOAT,
    
    -- Cylinder specs (JSON for flexibility)
    cylinder_data JSONB,
    
    -- Engine specs
    engine_make VARCHAR(100),
    engine_model VARCHAR(100),
    engine_serial VARCHAR(100),
    engine_rated_hp FLOAT,
    num_cylinders INTEGER,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- MODBUS CONFIGURATION
-- ============================================================

CREATE TABLE modbus_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
    connection_name VARCHAR(100) NOT NULL,
    connection_type VARCHAR(10) NOT NULL DEFAULT 'TCP', -- 'TCP' or 'RTU'
    host VARCHAR(100),
    port INTEGER DEFAULT 502,
    slave_id INTEGER DEFAULT 1,
    
    -- RTU specific
    serial_port VARCHAR(50),
    baud_rate INTEGER DEFAULT 9600,
    parity VARCHAR(5) DEFAULT 'N',
    stop_bits INTEGER DEFAULT 1,
    
    is_active BOOLEAN DEFAULT true,
    poll_interval_ms INTEGER DEFAULT 1000,
    timeout_ms INTEGER DEFAULT 3000,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE register_map (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID REFERENCES modbus_connections(id) ON DELETE CASCADE,
    unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
    
    name VARCHAR(100) NOT NULL,
    tag VARCHAR(50),
    description TEXT,
    
    -- Register details
    address INTEGER NOT NULL,
    register_type VARCHAR(10) NOT NULL DEFAULT '16bit', -- '16bit', '32bit'
    function_code INTEGER DEFAULT 3, -- 3=holding, 4=input
    data_type VARCHAR(20) NOT NULL DEFAULT 'UINT16', -- UINT16, INT16, FLOAT32, BOOL
    byte_order VARCHAR(10) DEFAULT 'AB', -- AB, BA, ABCD, DCBA, CDAB, BADC
    bit_position INTEGER, -- For boolean extraction from 16-bit
    
    -- Scaling
    scale_factor FLOAT DEFAULT 1.0,
    offset FLOAT DEFAULT 0.0,
    engineering_unit VARCHAR(20),
    
    -- Categorization
    category VARCHAR(50),
    subcategory VARCHAR(50),
    
    -- Polling
    poll_group VARCHAR(1) DEFAULT 'A', -- A=fast, B=medium, C=slow
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER,
    
    -- Validation
    min_valid FLOAT,
    max_valid FLOAT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- DATA SOURCE PRIORITY (Fallback chain)
-- ============================================================

CREATE TABLE data_source_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
    parameter_name VARCHAR(100) NOT NULL,
    
    -- Source priority (1 = highest)
    priority INTEGER NOT NULL DEFAULT 1,
    source_type VARCHAR(20) NOT NULL, -- 'modbus', 'calculated', 'manual', 'default'
    
    -- Reference based on source_type
    register_id UUID REFERENCES register_map(id),
    calculation_formula TEXT,
    manual_value FLOAT,
    default_value FLOAT,
    
    -- Quality timeout (seconds before falling back)
    stale_timeout INTEGER DEFAULT 30,
    
    UNIQUE(unit_id, parameter_name, priority)
);

-- ============================================================
-- GAS PROPERTIES
-- ============================================================

CREATE TABLE gas_properties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
    name VARCHAR(100) DEFAULT 'Default Gas',
    
    specific_gravity FLOAT DEFAULT 0.65,
    molecular_weight FLOAT DEFAULT 18.85,
    k_suction FLOAT DEFAULT 1.28,
    k_discharge FLOAT DEFAULT 1.25,
    z_suction FLOAT DEFAULT 0.98,
    z_discharge FLOAT DEFAULT 0.95,
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ALARM CONFIGURATION
-- ============================================================

CREATE TABLE alarm_setpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
    parameter_name VARCHAR(100) NOT NULL,
    
    -- Setpoint levels
    ll_value FLOAT, -- Low-Low (critical)
    l_value FLOAT,  -- Low (warning)
    h_value FLOAT,  -- High (warning)
    hh_value FLOAT, -- High-High (critical)
    
    -- Deadband
    deadband FLOAT DEFAULT 0,
    
    -- Delay before triggering (seconds)
    delay_seconds INTEGER DEFAULT 0,
    
    -- Whether this alarm can shut down unit
    is_shutdown BOOLEAN DEFAULT false,
    
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(unit_id, parameter_name)
);

-- ============================================================
-- USERS & AUTHENTICATION
-- ============================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'operator', -- 'admin', 'engineer', 'operator'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- ============================================================
-- MANUAL ENTRIES
-- ============================================================

CREATE TABLE manual_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
    parameter_name VARCHAR(100) NOT NULL,
    value FLOAT NOT NULL,
    entered_by UUID REFERENCES users(id),
    entered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    effective_until TIMESTAMP,
    notes TEXT
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_register_map_unit ON register_map(unit_id);
CREATE INDEX idx_register_map_connection ON register_map(connection_id);
CREATE INDEX idx_register_map_category ON register_map(category);
CREATE INDEX idx_alarm_setpoints_unit ON alarm_setpoints(unit_id);
CREATE INDEX idx_data_source_unit ON data_source_config(unit_id);

-- ============================================================
-- DEFAULT DATA
-- ============================================================

-- Insert default unit
INSERT INTO units (id, unit_name, location, description) VALUES 
(uuid_generate_v4(), 'GCS-001', 'Site A - Compressor Station', 'Primary gas compressor unit');

-- Insert default admin user (password: admin123)
INSERT INTO users (username, email, password_hash, full_name, role) VALUES
('admin', 'admin@gcs.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.OPaIfZf.4tIhWm', 'System Admin', 'admin'),
('engineer', 'engineer@gcs.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.OPaIfZf.4tIhWm', 'Field Engineer', 'engineer'),
('operator', 'operator@gcs.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.OPaIfZf.4tIhWm', 'Plant Operator', 'operator');

-- Insert default gas properties for first unit
INSERT INTO gas_properties (unit_id, name, specific_gravity, molecular_weight, k_suction, k_discharge, z_suction, z_discharge)
SELECT id, 'Natural Gas - Typical', 0.65, 18.85, 1.28, 1.25, 0.98, 0.95 FROM units WHERE unit_name = 'GCS-001';

COMMIT;
