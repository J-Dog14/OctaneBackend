-- ============================================================================
-- App Database: Read-Only Role for Athlete Sync
-- ============================================================================
-- This script creates a dedicated read-only role for syncing athlete data
-- from the app database to the warehouse.
--
-- Usage: Run this script as a superuser (e.g., postgres) on the app database.
-- ============================================================================

-- Create the read-only role (if it doesn't exist)
-- Note: CREATE ROLE IF NOT EXISTS is available in PostgreSQL 9.5+
-- For older versions, use: DO $$ BEGIN CREATE ROLE app_readonly; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_readonly') THEN
        CREATE ROLE app_readonly WITH LOGIN PASSWORD 'CHANGE_ME';
    END IF;
END
$$;

-- Revoke default PUBLIC privileges on the database (security best practice)
-- This ensures the role only has explicitly granted permissions
REVOKE ALL ON DATABASE CURRENT_DATABASE() FROM PUBLIC;

-- Grant connection to the database
-- Replace 'app_prod' with your actual database name if different
GRANT CONNECT ON DATABASE CURRENT_DATABASE() TO app_readonly;

-- Grant usage on the public schema
GRANT USAGE ON SCHEMA public TO app_readonly;

-- Grant SELECT on the quoted "User" table
-- Note: The table name is quoted because "User" is a reserved word in SQL
-- We must use quoted identifiers: public."User"
GRANT SELECT ON TABLE public."User" TO app_readonly;

-- Optional: Grant SELECT on sequences if the table uses SERIAL/BIGSERIAL
-- (Not needed for UUID primary keys, but included for completeness)
-- GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO app_readonly;

-- Set default privileges for future tables (optional, for maintenance)
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_readonly;

-- Verify permissions (run as app_readonly user to test)
-- \c app_prod app_readonly
-- SELECT uuid, name FROM public."User" LIMIT 1;

