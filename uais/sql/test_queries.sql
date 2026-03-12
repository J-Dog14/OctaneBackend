-- UAIS Test Queries
-- Useful queries for testing and validation

-- ============================================================================
-- APP DATABASE QUERIES
-- ============================================================================

-- Get all athletes
SELECT * FROM athletes ORDER BY name;

-- Get athlete by UUID
SELECT * FROM athletes WHERE athlete_uuid = ?;

-- Get all mappings for a source system
SELECT * FROM source_athlete_map WHERE source_system = ?;

-- Get unmapped source IDs for a system
SELECT DISTINCT source_athlete_id 
FROM source_athlete_map 
WHERE source_system = ? 
AND athlete_uuid IS NULL;

-- Count athletes by source system
SELECT source_system, COUNT(*) as count
FROM source_athlete_map
GROUP BY source_system;

-- ============================================================================
-- WAREHOUSE DATABASE QUERIES
-- ============================================================================

-- Get all data for an athlete across all systems
SELECT 'athletic_screen' as source, athlete_uuid, session_date 
FROM f_athletic_screen 
WHERE athlete_uuid = ?
UNION ALL
SELECT 'pro_sup' as source, athlete_uuid, session_date 
FROM f_pro_sup 
WHERE athlete_uuid = ?
UNION ALL
SELECT 'readiness_screen' as source, athlete_uuid, session_date 
FROM f_readiness_screen 
WHERE athlete_uuid = ?
ORDER BY session_date;

-- Count rows per fact table
SELECT 'f_athletic_screen' as table_name, COUNT(*) as row_count FROM f_athletic_screen
UNION ALL
SELECT 'f_pro_sup', COUNT(*) FROM f_pro_sup
UNION ALL
SELECT 'f_readiness_screen', COUNT(*) FROM f_readiness_screen
UNION ALL
SELECT 'f_mobility', COUNT(*) FROM f_mobility
UNION ALL
SELECT 'f_proteus', COUNT(*) FROM f_proteus
UNION ALL
SELECT 'f_kinematics_pitching', COUNT(*) FROM f_kinematics_pitching
UNION ALL
SELECT 'f_kinematics_hitting', COUNT(*) FROM f_kinematics_hitting;

-- Find athletes with data in multiple systems
SELECT athlete_uuid, COUNT(DISTINCT source_system) as system_count
FROM (
    SELECT athlete_uuid, source_system FROM f_athletic_screen
    UNION ALL
    SELECT athlete_uuid, source_system FROM f_pro_sup
    UNION ALL
    SELECT athlete_uuid, source_system FROM f_readiness_screen
    UNION ALL
    SELECT athlete_uuid, source_system FROM f_mobility
    UNION ALL
    SELECT athlete_uuid, source_system FROM f_proteus
    UNION ALL
    SELECT athlete_uuid, source_system FROM f_kinematics_pitching
    UNION ALL
    SELECT athlete_uuid, source_system FROM f_kinematics_hitting
) AS all_data
GROUP BY athlete_uuid
HAVING system_count > 1
ORDER BY system_count DESC;

-- Find rows with missing athlete_uuid (data quality check)
SELECT 'f_athletic_screen' as table_name, COUNT(*) as missing_uuid_count
FROM f_athletic_screen WHERE athlete_uuid IS NULL
UNION ALL
SELECT 'f_pro_sup', COUNT(*) FROM f_pro_sup WHERE athlete_uuid IS NULL
UNION ALL
SELECT 'f_readiness_screen', COUNT(*) FROM f_readiness_screen WHERE athlete_uuid IS NULL
UNION ALL
SELECT 'f_mobility', COUNT(*) FROM f_mobility WHERE athlete_uuid IS NULL
UNION ALL
SELECT 'f_proteus', COUNT(*) FROM f_proteus WHERE athlete_uuid IS NULL
UNION ALL
SELECT 'f_kinematics_pitching', COUNT(*) FROM f_kinematics_pitching WHERE athlete_uuid IS NULL
UNION ALL
SELECT 'f_kinematics_hitting', COUNT(*) FROM f_kinematics_hitting WHERE athlete_uuid IS NULL;

-- ============================================================================
-- CROSS-DATABASE QUERIES (if using same database or Postgres)
-- ============================================================================

-- Join athletes with warehouse data
SELECT 
    a.name,
    a.athlete_uuid,
    f.session_date,
    f.source_system
FROM athletes a
JOIN f_athletic_screen f ON a.athlete_uuid = f.athlete_uuid
ORDER BY a.name, f.session_date;

-- Get athlete summary with data counts
SELECT 
    a.name,
    a.athlete_uuid,
    COUNT(DISTINCT f_as.session_date) as athletic_screen_sessions,
    COUNT(DISTINCT f_ps.session_date) as pro_sup_sessions,
    COUNT(DISTINCT f_rs.session_date) as readiness_screen_sessions
FROM athletes a
LEFT JOIN f_athletic_screen f_as ON a.athlete_uuid = f_as.athlete_uuid
LEFT JOIN f_pro_sup f_ps ON a.athlete_uuid = f_ps.athlete_uuid
LEFT JOIN f_readiness_screen f_rs ON a.athlete_uuid = f_rs.athlete_uuid
GROUP BY a.athlete_uuid, a.name
ORDER BY a.name;

