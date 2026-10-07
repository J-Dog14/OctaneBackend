-- Merge misnamed athlete "Jacob Wells" into "Jacob Webb".
-- Run each step in order in the Neon SQL editor (warehouse DB).

-- STEP 1: Inspect both rows. Confirm which is which and note the UUIDs.
SELECT athlete_uuid, name, normalized_name, email, app_db_uuid, created_at
FROM analytics.d_athletes
WHERE normalized_name ILIKE '%jacob%webb%' OR normalized_name ILIKE '%webb%jacob%'
   OR normalized_name ILIKE '%jacob%wells%' OR normalized_name ILIKE '%wells%jacob%';

-- STEP 2: Row counts per fact table for each UUID (paste UUIDs below).
-- Replace WELLS_UUID / WEBB_UUID in STEP 3 too.
DO $$
DECLARE
    wells text := '74f3851b-62d6-43b2-8e0b-ae9b4bf60bda';
    t text;
    n bigint;
BEGIN
    FOR t IN
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'athlete_uuid'
    LOOP
        EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE athlete_uuid::text = %L', t, wells) INTO n;
        IF n > 0 THEN RAISE NOTICE '% : % rows under Wells', t, n; END IF;
    END LOOP;
END $$;

-- STEP 3: The merge (single transaction; rolls back entirely on any error,
-- e.g. a unique-constraint clash if both UUIDs have the same session/trial).
BEGIN;

DO $$
DECLARE
    wells text := '74f3851b-62d6-43b2-8e0b-ae9b4bf60bda';   -- misnamed row (will be deleted)
    webb  text := '427fc77e-fe7c-4908-af75-ceea46ac2a72';    -- correct row (kept)
    wells_email text;
    t text;
    n bigint;
BEGIN
    FOR t IN
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'athlete_uuid'
    LOOP
        EXECUTE format('UPDATE public.%I SET athlete_uuid = %L WHERE athlete_uuid::text = %L', t, webb, wells);
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN RAISE NOTICE 'Moved % row(s) in %', n, t; END IF;
    END LOOP;

    EXECUTE format('UPDATE analytics.source_athlete_map SET athlete_uuid = %L WHERE athlete_uuid::text = %L', webb, wells);

    -- Keep Webb's identity, but carry over the email only Wells had.
    -- Free it on Wells first in case email has a unique constraint.
    SELECT email INTO wells_email FROM analytics.d_athletes WHERE athlete_uuid::text = wells;
    UPDATE analytics.d_athletes SET email = NULL WHERE athlete_uuid::text = wells;
    UPDATE analytics.d_athletes
    SET email = COALESCE(email, wells_email), updated_at = NOW()
    WHERE athlete_uuid::text = webb;

    DELETE FROM analytics.d_athletes WHERE athlete_uuid::text = wells;
END $$;

-- STEP 4: Verify, then COMMIT (or ROLLBACK if anything looks off).
SELECT athlete_uuid, name FROM analytics.d_athletes
WHERE normalized_name ILIKE '%jacob%' AND (normalized_name ILIKE '%webb%' OR normalized_name ILIKE '%wells%');

-- COMMIT;
-- ROLLBACK;
