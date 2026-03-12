-- UAIS Database Schema Definitions
-- This file contains all table schemas for the Unified Athlete Identity System

-- ============================================================================
-- APP DATABASE SCHEMA
-- ============================================================================
-- The app database is the source of truth for athlete identity.
-- Contains: athletes table and source_athlete_map

-- Athletes Table
-- Stores demographic information for all athletes
CREATE TABLE IF NOT EXISTS athletes (
    athlete_uuid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date_of_birth TEXT,
    gender TEXT,
    height REAL,
    weight REAL,
    email TEXT,
    phone TEXT,
    notes TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Indexes for athletes table
CREATE INDEX IF NOT EXISTS idx_athletes_name ON athletes(name);
CREATE INDEX IF NOT EXISTS idx_athletes_email ON athletes(email);

-- Source Athlete Map Table
-- Maps legacy source system IDs to athlete_uuid
CREATE TABLE IF NOT EXISTS source_athlete_map (
    source_system TEXT NOT NULL,
    source_athlete_id TEXT NOT NULL,
    athlete_uuid TEXT NOT NULL,
    created_at TIMESTAMP,
    PRIMARY KEY (source_system, source_athlete_id),
    FOREIGN KEY (athlete_uuid) REFERENCES athletes(athlete_uuid)
);

-- Indexes for source_athlete_map
CREATE INDEX IF NOT EXISTS idx_source_map_uuid ON source_athlete_map(athlete_uuid);
CREATE INDEX IF NOT EXISTS idx_source_map_system ON source_athlete_map(source_system);

-- ============================================================================
-- WAREHOUSE DATABASE SCHEMA
-- ============================================================================
-- The warehouse database contains all fact tables (f_*) with measurement data.
-- These tables are created dynamically by ETL pipelines, but here are the
-- expected schemas for reference.

-- Fact Table: Athletic Screen
-- Note: Schema is flexible - columns added based on source data
-- Required columns: athlete_uuid, session_date, source_system, created_at
CREATE TABLE IF NOT EXISTS f_athletic_screen (
    athlete_uuid TEXT NOT NULL,
    session_date DATE NOT NULL,
    source_system TEXT NOT NULL,
    source_athlete_id TEXT,
    created_at TIMESTAMP,
    -- Movement-specific columns added dynamically:
    -- movement_type TEXT,
    -- trial_name TEXT,
    -- JH_IN REAL,
    -- Peak_Power REAL,
    -- PP_FORCEPLATE REAL,
    -- Force_at_PP REAL,
    -- Vel_at_PP REAL,
    -- PP_W_per_kg REAL,
    -- ... (other metrics)
    FOREIGN KEY (athlete_uuid) REFERENCES athletes(athlete_uuid)
);

-- Fact Table: Pro-Sup Test
CREATE TABLE IF NOT EXISTS f_pro_sup (
    athlete_uuid TEXT NOT NULL,
    session_date DATE NOT NULL,
    source_system TEXT NOT NULL,
    source_athlete_id TEXT,
    created_at TIMESTAMP,
    -- Pro-Sup specific columns:
    age REAL,
    height REAL,
    weight REAL,
    injury_history TEXT,
    season_phase TEXT,
    dynomometer_score TEXT,
    comments TEXT,
    forearm_rom_0to10 REAL,
    forearm_rom_10to20 REAL,
    forearm_rom_20to30 REAL,
    forearm_rom REAL,
    tot_rom_0to10 REAL,
    tot_rom_10to20 REAL,
    tot_rom_20to30 REAL,
    tot_rom REAL,
    num_of_flips_0_10 REAL,
    num_of_flips_10_20 REAL,
    num_of_flips_20_30 REAL,
    num_of_flips REAL,
    avg_velo_0_10 REAL,
    avg_velo_10_20 REAL,
    avg_velo_20_30 REAL,
    avg_velo REAL,
    fatigue_index_10 REAL,
    fatigue_index_20 REAL,
    fatigue_index_30 REAL,
    total_fatigue_score REAL,
    consistency_penalty REAL,
    total_score REAL,
    FOREIGN KEY (athlete_uuid) REFERENCES athletes(athlete_uuid)
);

-- Fact Table: Readiness Screen
CREATE TABLE IF NOT EXISTS f_readiness_screen (
    athlete_uuid TEXT NOT NULL,
    session_date DATE NOT NULL,
    source_system TEXT NOT NULL,
    source_athlete_id TEXT,
    created_at TIMESTAMP,
    -- Readiness Screen specific columns (varies by movement type)
    -- Columns added dynamically based on source data
    FOREIGN KEY (athlete_uuid) REFERENCES athletes(athlete_uuid)
);

-- Fact Table: Mobility
CREATE TABLE IF NOT EXISTS f_mobility (
    athlete_uuid TEXT NOT NULL,
    session_date DATE NOT NULL,
    source_system TEXT NOT NULL,
    source_athlete_id TEXT,
    created_at TIMESTAMP,
    -- Mobility-specific columns added dynamically
    FOREIGN KEY (athlete_uuid) REFERENCES athletes(athlete_uuid)
);

-- Fact Table: Proteus
CREATE TABLE IF NOT EXISTS f_proteus (
    athlete_uuid TEXT NOT NULL,
    session_date DATE NOT NULL,
    source_system TEXT NOT NULL,
    source_athlete_id TEXT,
    created_at TIMESTAMP,
    -- Proteus-specific columns added dynamically
    FOREIGN KEY (athlete_uuid) REFERENCES athletes(athlete_uuid)
);

-- Fact Table: Pitching Kinematics
CREATE TABLE IF NOT EXISTS f_kinematics_pitching (
    athlete_uuid TEXT NOT NULL,
    session_date DATE NOT NULL,
    source_system TEXT NOT NULL,
    source_athlete_id TEXT,
    created_at TIMESTAMP,
    -- Kinematics columns added dynamically from XML/CSV parsing
    -- Examples: velocities, angles, forces, etc.
    FOREIGN KEY (athlete_uuid) REFERENCES athletes(athlete_uuid)
);

-- Fact Table: Hitting Kinematics
CREATE TABLE IF NOT EXISTS f_kinematics_hitting (
    athlete_uuid TEXT NOT NULL,
    session_date DATE NOT NULL,
    source_system TEXT NOT NULL,
    source_athlete_id TEXT,
    created_at TIMESTAMP,
    -- Kinematics columns added dynamically from XML/CSV parsing
    FOREIGN KEY (athlete_uuid) REFERENCES athletes(athlete_uuid)
);

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

-- ============================================================================
-- DOMAIN-SPECIFIC DATABASE SCHEMAS (Legacy/Reference)
-- ============================================================================
-- These are the original domain-specific databases. They are kept for
-- reference and data consolidation purposes.

-- Athletic Screen Domain Database
-- Tables: CMJ, PPU, DJ, SLV, NMT
-- See: python/athleticScreen/database.py for full schemas

-- Pro-Sup Test Domain Database
-- Table: pro_sup_data
-- See: python/proSupTest/database.py for full schema

-- Readiness Screen Domain Database
-- Tables: Participant, I, Y, T, IR90, CMJ, PPU
-- See: python/readinessScreen/database.py for full schemas

-- ============================================================================
-- NOTES
-- ============================================================================

-- 1. Foreign Key Constraints:
--    - SQLite doesn't enforce foreign keys by default
--    - Enable with: PRAGMA foreign_keys = ON;
--    - Postgres enforces foreign keys automatically

-- 2. Table Creation:
--    - App database tables: Created by athlete_creation.py or manually
--    - Warehouse tables: Created automatically by ETL pipelines (to_sql)
--    - Domain databases: Created by domain-specific database.py modules

-- 3. Schema Evolution:
--    - Fact tables are flexible - columns added based on source data
--    - Use ALTER TABLE to add new columns as needed
--    - ETL pipelines handle schema changes automatically

-- 4. Indexes:
--    - Created automatically for common query patterns
--    - athlete_uuid and session_date are most commonly queried
--    - Add additional indexes based on query patterns

-- 5. Data Types:
--    - TEXT: For strings, dates (stored as ISO format strings)
--    - REAL: For numeric values (floats)
--    - INTEGER: For whole numbers
--    - TIMESTAMP: For datetime values

