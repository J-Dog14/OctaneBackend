-- Database Size Check Script for UAIS
-- Run this in any PostgreSQL client (Beekeeper, psql, etc.)
-- Replace 'database_name' with the actual database name

-- ============================================================================
-- OPTION 1: Check size of a specific database (run this for each database)
-- ============================================================================

-- Size of entire database
SELECT 
    pg_size_pretty(pg_database_size('verceldb')) AS database_size,
    pg_database_size('verceldb') AS size_bytes;

-- Replace 'verceldb' with: 'local', 'uais_warehouse', 'verceldb', etc.


-- ============================================================================
-- OPTION 2: Check sizes of all databases on the server
-- ============================================================================

SELECT 
    datname AS database_name,
    pg_size_pretty(pg_database_size(datname)) AS size,
    pg_database_size(datname) AS size_bytes
FROM pg_database
WHERE datistemplate = false
ORDER BY pg_database_size(datname) DESC;


-- ============================================================================
-- OPTION 3: Check table sizes within a database
-- ============================================================================

-- Connect to the database first, then run:
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) AS indexes_size,
    pg_total_relation_size(schemaname||'.'||tablename) AS total_size_bytes
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;


-- ============================================================================
-- OPTION 4: Summary by schema (useful for warehouse with analytics schema)
-- ============================================================================

SELECT 
    schemaname,
    COUNT(*) AS table_count,
    pg_size_pretty(SUM(pg_total_relation_size(schemaname||'.'||tablename))) AS total_size,
    SUM(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size_bytes
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
GROUP BY schemaname
ORDER BY SUM(pg_total_relation_size(schemaname||'.'||tablename)) DESC;


-- ============================================================================
-- OPTION 5: Top 10 largest tables
-- ============================================================================

SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;

