-- ============================================================================
-- Warehouse Database: Athlete Dimension Table Setup
-- ============================================================================
-- This script creates the analytics schema and athlete_dim table in the
-- warehouse database for syncing canonical athlete identity from the app DB.
--
-- Usage: Run this script as a superuser or warehouse owner on the warehouse DB.
-- ============================================================================

-- Create the analytics schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS analytics;

-- Grant usage on the schema to warehouse users
-- Replace 'warehouse_writer' with your actual warehouse user role
GRANT USAGE ON SCHEMA analytics TO warehouse_writer;

-- Create the athlete dimension table
-- This table stores canonical athlete identity synced from the app database
CREATE TABLE IF NOT EXISTS analytics.athlete_dim (
    athlete_uuid UUID PRIMARY KEY,
    full_name TEXT NOT NULL,
    source_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Grant permissions on the table
GRANT SELECT, INSERT, UPDATE ON TABLE analytics.athlete_dim TO warehouse_writer;

-- Create index on lowercased full_name for fuzzy lookups and case-insensitive searches
-- This is useful for matching athlete names across different systems
CREATE INDEX IF NOT EXISTS ix_athlete_dim_full_name_lower 
    ON analytics.athlete_dim (LOWER(full_name));

-- Optional: Create an index on source_synced_at for monitoring/reporting queries
CREATE INDEX IF NOT EXISTS ix_athlete_dim_synced_at 
    ON analytics.athlete_dim (source_synced_at DESC);

-- Add comment to table for documentation
COMMENT ON TABLE analytics.athlete_dim IS 
    'Canonical athlete identity dimension synced from app database public."User" table';

COMMENT ON COLUMN analytics.athlete_dim.athlete_uuid IS 
    'Primary key UUID matching app database public."User".uuid';

COMMENT ON COLUMN analytics.athlete_dim.full_name IS 
    'Athlete full name from app database public."User".name';

COMMENT ON COLUMN analytics.athlete_dim.source_synced_at IS 
    'Timestamp when this row was last synced from the source app database';

