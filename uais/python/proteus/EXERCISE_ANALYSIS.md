# Proteus Exercise Analysis Results

## Summary

**All exercises ARE in the database!** The diagnostic analysis shows that 20 unique exercises are currently stored in the `f_proteus` table, including all the exercises you mentioned.

## Exercises in Database

1. Chest Press (One Hand) - 114 rows
2. External Rotation 0° - 199 rows
3. External Rotation 90° - 202 rows
4. Horizontal Row (One Hand) - 114 rows
5. Kettlebell Swing (Down; Two Hand) - 1 row
6. Kettlebell Swing (Up; Two Hand) - 1 row
7. Lateral Bound - 98 rows
8. PNF D2 Extension - 604 rows
9. PNF D2 Flexion - 308 rows
10. Scaption (Up) - 190 rows
11. Shot Put (Countermovement) - 390 rows
12. Shoulder Abduction (Horizontal) - 196 rows
13. Split Squat (Down) - 2 rows
14. Split Squat (Up) - 2 rows
15. Squat (Down) - 1 row
16. Squat (Up) - 1 row
17. Straight Arm Pulldown (One Hand) - 204 rows
18. Straight Arm Trunk Rotation - 248 rows
19. Straight Arm Trunk Rotation (Plyo) - 106 rows
20. Vertical Jump (Countermovement) - 163 rows

## User-Mentioned Exercises Status

All exercises you mentioned are present in the database:

- ✅ **Shoulder Abduction** → "Shoulder Abduction (Horizontal)" (196 rows)
- ✅ **Scaption Up** → "Scaption (Up)" (190 rows)
- ✅ **External Rotation 90** → "External Rotation 90°" (202 rows)
- ✅ **External Rotation 0** → "External Rotation 0°" (199 rows)
- ✅ **PNF D2 Flexion** → "PNF D2 Flexion" (308 rows)
- ✅ **PNF D2 Extension** → "PNF D2 Extension" (604 rows)
- ✅ **Straight Arm Pulldown** → "Straight Arm Pulldown (One Hand)" (204 rows)
- ✅ **Shot Put** → "Shot Put (Countermovement)" (390 rows)
- ✅ **Straight Arm Trunk Rotation** → "Straight Arm Trunk Rotation" (248 rows)
- ✅ **Vertical** → "Vertical Jump (Countermovement)" (163 rows)

## Current Excel Files Analysis

The Excel files currently in the inbox (`data/proteus/inbox/`) contain only 4 unique exercises:
- PNF D2 Extension
- Shot Put (Countermovement)
- Straight Arm Trunk Rotation
- Vertical Jump (Countermovement)

This is expected - different export files may contain different exercises depending on what was tested during those sessions.

## Possible Reasons You're Not Seeing All Exercises

If you're only seeing a subset of exercises when viewing the data, it might be due to:

1. **Date Range Filter**: You might be viewing data from a specific date range that only includes certain exercises
2. **Athlete Filter**: You might be viewing data for specific athletes who only performed certain exercises
3. **Aggregated View**: The tool you're using might be showing aggregated or grouped data
4. **Query Filter**: If you're using a SQL query, it might have a WHERE clause filtering exercises

## Verification Query

To verify all exercises are in the database, run this SQL query:

```sql
SELECT 
    movement,
    exercise_name,
    COUNT(*) as row_count,
    COUNT(DISTINCT athlete_uuid) as unique_athletes,
    MIN(session_date) as earliest_date,
    MAX(session_date) as latest_date
FROM public.f_proteus
WHERE movement IS NOT NULL
GROUP BY movement, exercise_name
ORDER BY movement;
```

## Next Steps

1. **Check your query/view**: If you're using a specific query or view to display the data, check if it has any filters on the `movement` or `exercise_name` columns
2. **Check date ranges**: Verify you're looking at the full date range, not just recent data
3. **Check aggregation**: If data is aggregated, you might need to look at the raw table instead
4. **Run the diagnostic script**: Use `python/proteus/diagnose_exercises.py` to compare Excel files with database

## Code Analysis

The ETL process (`python/proteus/etl_proteus.py` and `python/proteus/process_raw.py`) correctly:
- Reads both "Exercise Name" and "Movement" columns from Excel files
- Normalizes column names (converts to lowercase with underscores)
- Preserves both columns in the database
- Filters only by Sport (baseball/softball), not by exercise name

**No exercise filtering is happening in the code** - all exercises from the Excel files are being inserted into the database.
