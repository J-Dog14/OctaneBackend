-- Warehouse Athletes Dimension Table
-- This is the master athlete database for the warehouse
-- Acts as source of truth for athlete identity across all ETL scripts

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.d_athletes (
    athlete_uuid VARCHAR(36) PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,  -- For matching (FIRST LAST, uppercase, no dates)
    date_of_birth DATE,
    age NUMERIC,
    age_at_collection NUMERIC,  -- Age at time of data collection
    gender TEXT,
    height NUMERIC,
    weight NUMERIC,
    email TEXT,
    phone TEXT,
    notes TEXT,
    
    -- Metadata
    source_system TEXT,  -- Which system first created this athlete (pitching, hitting, etc.)
    source_athlete_id TEXT,  -- Original ID from source system
    app_db_uuid TEXT,  -- UUID from app database User table (if matched)
    app_db_synced_at TIMESTAMPTZ,  -- When we last checked app database
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_normalized_name UNIQUE (normalized_name)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_d_athletes_normalized_name ON analytics.d_athletes(normalized_name);
CREATE INDEX IF NOT EXISTS idx_d_athletes_app_db_uuid ON analytics.d_athletes(app_db_uuid);
CREATE INDEX IF NOT EXISTS idx_d_athletes_source_system ON analytics.d_athletes(source_system, source_athlete_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_d_athletes_updated_at 
    BEFORE UPDATE ON analytics.d_athletes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

