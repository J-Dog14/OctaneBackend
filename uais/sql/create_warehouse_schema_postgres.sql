-- PostgreSQL Warehouse Database Schema
-- Run this script to initialize the warehouse database tables
-- Usage: psql -U your_user -d uais_warehouse -f sql/create_warehouse_schema_postgres.sql
-- Or execute in Beekeeper Studio's SQL editor

-- ============================================================================
-- WAREHOUSE DATABASE SCHEMA (PostgreSQL)
-- ============================================================================
-- The warehouse database contains all fact tables (f_*) with measurement data.

-- Fact Table: Athletic Screen
CREATE TABLE IF NOT EXISTS f_athletic_screen (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL,
    source_athlete_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Note: Movement-specific columns added dynamically
-- Foreign key removed because app database is separate

-- Fact Table: Pro-Sup Test
CREATE TABLE IF NOT EXISTS f_pro_sup (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL,
    source_athlete_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    age NUMERIC,
    height NUMERIC,
    weight NUMERIC,
    injury_history TEXT,
    season_phase VARCHAR(50),
    dynomometer_score VARCHAR(50),
    comments TEXT,
    forearm_rom_0to10 NUMERIC,
    forearm_rom_10to20 NUMERIC,
    forearm_rom_20to30 NUMERIC,
    forearm_rom NUMERIC,
    tot_rom_0to10 NUMERIC,
    tot_rom_10to20 NUMERIC,
    tot_rom_20to30 NUMERIC,
    tot_rom NUMERIC,
    num_of_flips_0_10 NUMERIC,
    num_of_flips_10_20 NUMERIC,
    num_of_flips_20_30 NUMERIC,
    num_of_flips NUMERIC,
    avg_velo_0_10 NUMERIC,
    avg_velo_10_20 NUMERIC,
    avg_velo_20_30 NUMERIC,
    avg_velo NUMERIC,
    fatigue_index_10 NUMERIC,
    fatigue_index_20 NUMERIC,
    fatigue_index_30 NUMERIC,
    total_fatigue_score NUMERIC,
    consistency_penalty NUMERIC,
    total_score NUMERIC
);
-- Note: Foreign key removed because app database is separate
-- athlete_uuid references athletes table in app database

-- Fact Table: Readiness Screen
CREATE TABLE IF NOT EXISTS f_readiness_screen (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL,
    source_athlete_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Note: Readiness Screen specific columns (varies by movement type)
-- Columns added dynamically based on source data
-- Foreign key removed because app database is separate

-- Fact Table: Mobility
CREATE TABLE IF NOT EXISTS f_mobility (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL,
    source_athlete_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Note: Mobility-specific columns added dynamically
-- Foreign key removed because app database is separate

-- Fact Table: Proteus
CREATE TABLE IF NOT EXISTS f_proteus (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL,
    source_athlete_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Note: Proteus-specific columns added dynamically
-- Foreign key removed because app database is separate

-- Fact Table: Pitching Kinematics
CREATE TABLE IF NOT EXISTS f_kinematics_pitching (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL,
    source_athlete_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Note: Kinematics columns added dynamically from XML/CSV parsing
-- Examples: velocities, angles, forces, etc.
-- Foreign key removed because app database is separate

-- Fact Table: Hitting Kinematics
CREATE TABLE IF NOT EXISTS f_kinematics_hitting (
    id SERIAL PRIMARY KEY,
    athlete_uuid VARCHAR(36) NOT NULL,
    session_date DATE NOT NULL,
    source_system VARCHAR(50) NOT NULL,
    source_athlete_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Note: Kinematics columns added dynamically from XML/CSV parsing
-- Foreign key removed because app database is separate

-- Indexes for warehouse fact tables
CREATE INDEX IF NOT EXISTS idx_f_athletic_screen_uuid ON f_athletic_screen(athlete_uuid);
CREATE INDEX IF NOT EXISTS idx_f_athletic_screen_date ON f_athletic_screen(session_date);
CREATE INDEX IF NOT EXISTS idx_f_pro_sup_uuid ON f_pro_sup(athlete_uuid);
CREATE INDEX IF NOT EXISTS idx_f_pro_sup_date ON f_pro_sup(session_date);
CREATE INDEX IF NOT EXISTS idx_f_readiness_uuid ON f_readiness_screen(athlete_uuid);
CREATE INDEX IF NOT EXISTS idx_f_readiness_date ON f_readiness_screen(session_date);
CREATE INDEX IF NOT EXISTS idx_f_mobility_uuid ON f_mobility(athlete_uuid);
CREATE INDEX IF NOT EXISTS idx_f_mobility_date ON f_mobility(session_date);
CREATE INDEX IF NOT EXISTS idx_f_proteus_uuid ON f_proteus(athlete_uuid);
CREATE INDEX IF NOT EXISTS idx_f_proteus_date ON f_proteus(session_date);
CREATE INDEX IF NOT EXISTS idx_f_pitching_uuid ON f_kinematics_pitching(athlete_uuid);
CREATE INDEX IF NOT EXISTS idx_f_pitching_date ON f_kinematics_pitching(session_date);
CREATE INDEX IF NOT EXISTS idx_f_hitting_uuid ON f_kinematics_hitting(athlete_uuid);
CREATE INDEX IF NOT EXISTS idx_f_hitting_date ON f_kinematics_hitting(session_date);

-- Note: Foreign key constraints are NOT included because the app database
-- (containing the athletes table) is separate from the warehouse database.
-- The athlete_uuid column still references athletes in the app database,
-- but referential integrity is enforced at the application level.

