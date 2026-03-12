-- Query to check all exercises in the Proteus database
-- This will show you all exercises, their row counts, and date ranges

SELECT 
    movement,
    exercise_name,
    COUNT(*) as total_rows,
    COUNT(DISTINCT athlete_uuid) as unique_athletes,
    COUNT(DISTINCT session_date) as unique_sessions,
    MIN(session_date) as earliest_date,
    MAX(session_date) as latest_date
FROM public.f_proteus
WHERE movement IS NOT NULL
GROUP BY movement, exercise_name
ORDER BY movement;

-- If you want to see exercises by date range (e.g., last 30 days):
-- Uncomment and modify the date as needed:
/*
SELECT 
    movement,
    COUNT(*) as row_count,
    COUNT(DISTINCT athlete_uuid) as unique_athletes
FROM public.f_proteus
WHERE movement IS NOT NULL
  AND session_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY movement
ORDER BY movement;
*/

-- To see all exercises for a specific athlete:
-- Replace 'ATHLETE_UUID_HERE' with the actual UUID
/*
SELECT 
    movement,
    exercise_name,
    session_date,
    COUNT(*) as row_count
FROM public.f_proteus
WHERE athlete_uuid = 'ATHLETE_UUID_HERE'
  AND movement IS NOT NULL
GROUP BY movement, exercise_name, session_date
ORDER BY session_date DESC, movement;
*/
