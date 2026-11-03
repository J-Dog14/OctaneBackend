-- Pitch-category trial numbering (2026-11-03).
--
-- Joey: trial numbers are counted within each pitch category and never renumbered
-- (fastball 0..n, breaking_ball 0..n, off_speed 0..n, pitch 0..n). The category is
-- part of a trial's identity, so every per-trial pitching table is now unique on
--   (athlete_uuid, session_date, pitch_category, trial_index)
-- instead of (athlete_uuid, session_date, trial_index).
--
-- What this does (idempotent; needs 20261102000000_pitch_category first):
--   1. Drops the 2026-11-02 triggers that copied the category from the trial with the same
--      trial_index (with per-category numbers that lookup is ambiguous).
--   2. Renumbers existing NON-fastball trials within their category, in all seven tables and
--      the 3D <-> TrackMan link table. Fastball numbers are never touched.
--   3. Swaps each table's unique key to include pitch_category (same constraint/index names).
--   4. Sets pitch_category from owner_filename on every insert/update
--      ("Fastball LH 5.c3d" -> fastball, "Breaking Ball LH 2.c3d" -> breaking_ball, ...),
--      so writers that don't pass the category (older backfills) still file rows correctly.
--   5. Creates v_pitching_trial_order: per trial, its order in the capture session and, when
--      paired, its TrackMan pitch number (order thrown among the TrackMan session's live pitches).
--
-- Run with: npm run pitchtype:keys
BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(hashtext('pitch_category_keys_setup'));

-- 1. Old category triggers (from 20261102000000_pitch_category)
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['f_pitching_time_data', 'f_pitching_force_metrics', 'f_pitching_force_data',
                             'f_pitching_marker_data', 'f_pitching_segment_pos_data', 'f_pitching_segment_rot_data'] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_pitch_category ON public.%I', tbl);
    END IF;
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_pitch_category_propagate ON public.f_pitching_trials;
DROP FUNCTION IF EXISTS public.pitching_trials_propagate_category();
DROP FUNCTION IF EXISTS public.pitching_child_set_category();

-- Category from the QTM measurement name (same rules as classify_pitch_category() in
-- uais/R/pitching/pitching_processing.R). NULL = not a pitch trial / unknown name.
CREATE OR REPLACE FUNCTION public.pitch_category_from_owner(owner text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN b IS NULL OR b = '' OR b LIKE '%static%' THEN NULL
    WHEN b LIKE '%fastball%' THEN 'fastball'
    WHEN b ~ '^breaking[ _-]*ball' THEN 'breaking_ball'
    WHEN b ~ '^off[ _-]*speed' THEN 'off_speed'
    WHEN b ~ '^pitch([ _-]|[0-9]|\.|$)' THEN 'pitch'
  END
  FROM (SELECT btrim(lower(regexp_replace(owner, '^.*[\\/]', ''))) AS b) s
$$;

-- 2 + 3. Renumber non-fastballs within their category and swap the unique keys.
CREATE TEMP TABLE _pc_renum ON COMMIT DROP AS
SELECT athlete_uuid, session_date, pitch_category, old_idx, new_idx
  FROM (SELECT athlete_uuid, session_date, pitch_category, trial_index AS old_idx,
               (row_number() OVER (PARTITION BY athlete_uuid, session_date, pitch_category ORDER BY trial_index) - 1)::int AS new_idx
          FROM public.f_pitching_trials
         WHERE pitch_category <> 'fastball') r
 WHERE old_idx <> new_idx;

DO $$
DECLARE
  tbl text;
  old_cols text[] := ARRAY['athlete_uuid', 'session_date', 'trial_index'];
  rec record;
  key_name text;
  key_is_constraint boolean;
  has_new boolean;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['f_pitching_trials', 'f_pitching_time_data', 'f_pitching_force_metrics', 'f_pitching_force_data',
                             'f_pitching_marker_data', 'f_pitching_segment_pos_data', 'f_pitching_segment_rot_data'] LOOP
    CONTINUE WHEN to_regclass('public.' || tbl) IS NULL;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS pitch_category text NOT NULL DEFAULT ''fastball''', tbl);

    -- the old 3-column unique key (an index or a constraint), if still there
    key_name := NULL; key_is_constraint := false;
    FOR rec IN
      SELECT ic.relname AS idx_name, con.conname
        FROM pg_index i
        JOIN pg_class ic ON ic.oid = i.indexrelid
        LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid AND con.contype = 'u'
       WHERE i.indrelid = ('public.' || tbl)::regclass AND i.indisunique AND NOT i.indisprimary
         AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                FROM pg_attribute a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey))
             = (SELECT array_agg(x ORDER BY x) FROM unnest(old_cols) x)
    LOOP
      IF rec.conname IS NOT NULL THEN
        key_name := rec.conname; key_is_constraint := true;
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', tbl, rec.conname);
      ELSE
        key_name := rec.idx_name;
        EXECUTE format('DROP INDEX public.%I', rec.idx_name);
      END IF;
    END LOOP;

    EXECUTE format(
      'UPDATE public.%I t SET trial_index = m.new_idx FROM _pc_renum m
        WHERE t.athlete_uuid = m.athlete_uuid AND t.session_date = m.session_date
          AND t.pitch_category = m.pitch_category AND t.trial_index = m.old_idx', tbl);

    SELECT EXISTS (
      SELECT 1 FROM pg_index i
       WHERE i.indrelid = ('public.' || tbl)::regclass AND i.indisunique
         AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                FROM pg_attribute a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey))
             = ARRAY['athlete_uuid', 'pitch_category', 'session_date', 'trial_index']
    ) INTO has_new;
    IF NOT has_new THEN
      key_name := COALESCE(key_name, CASE WHEN tbl IN ('f_pitching_trials', 'f_pitching_time_data')
                                          THEN 'idx_' || tbl || '_unique' ELSE tbl || '_unique' END);
      IF key_is_constraint THEN
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (athlete_uuid, session_date, pitch_category, trial_index)', tbl, key_name);
      ELSE
        EXECUTE format('CREATE UNIQUE INDEX %I ON public.%I (athlete_uuid, session_date, pitch_category, trial_index)', key_name, tbl);
      END IF;
    END IF;
  END LOOP;
END $$;

-- 3D <-> TrackMan links: same key change (table comes from npm run pi:setup; it may not exist yet).
DO $$
DECLARE rec record;
BEGIN
  IF to_regclass('pitch_intel.biomech_trackman_links') IS NULL THEN
    RETURN;
  END IF;
  UPDATE pitch_intel.biomech_trackman_links SET pitch_category = 'fastball' WHERE pitch_category IS NULL;
  ALTER TABLE pitch_intel.biomech_trackman_links ALTER COLUMN pitch_category SET DEFAULT 'fastball';
  ALTER TABLE pitch_intel.biomech_trackman_links ALTER COLUMN pitch_category SET NOT NULL;
  FOR rec IN
    SELECT con.conname FROM pg_constraint con
     WHERE con.conrelid = 'pitch_intel.biomech_trackman_links'::regclass AND con.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
             WHERE a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey))
           = ARRAY['athlete_uuid', 'session_date', 'trial_index']
  LOOP
    EXECUTE format('ALTER TABLE pitch_intel.biomech_trackman_links DROP CONSTRAINT %I', rec.conname);
  END LOOP;
  UPDATE pitch_intel.biomech_trackman_links t SET trial_index = m.new_idx FROM _pc_renum m
   WHERE t.athlete_uuid = m.athlete_uuid AND t.session_date = m.session_date
     AND t.pitch_category = m.pitch_category AND t.trial_index = m.old_idx;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'biomech_trackman_links_trial_key') THEN
    ALTER TABLE pitch_intel.biomech_trackman_links
      ADD CONSTRAINT biomech_trackman_links_trial_key UNIQUE (athlete_uuid, session_date, pitch_category, trial_index);
  END IF;
END $$;

-- 4. Category from owner_filename on every write
CREATE OR REPLACE FUNCTION public.pitching_set_category_from_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  -- to_jsonb(NEW) so the trigger can't fail on a table without owner_filename
  c := public.pitch_category_from_owner(to_jsonb(NEW) ->> 'owner_filename');
  IF c IS NOT NULL THEN
    NEW.pitch_category := c;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['f_pitching_trials', 'f_pitching_time_data', 'f_pitching_force_metrics', 'f_pitching_force_data',
                             'f_pitching_marker_data', 'f_pitching_segment_pos_data', 'f_pitching_segment_rot_data'] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_pitch_category_owner ON public.%I', tbl);
      EXECUTE format('CREATE TRIGGER trg_pitch_category_owner BEFORE INSERT OR UPDATE ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION public.pitching_set_category_from_owner()', tbl);
    END IF;
  END LOOP;
END $$;

-- 5. Capture order + TrackMan pitch number per trial
DO $$
BEGIN
  IF to_regclass('pitch_intel.biomech_trackman_links') IS NULL OR to_regclass('pitch_intel.trackman_pitches') IS NULL THEN
    RAISE NOTICE 'v_pitching_trial_order skipped: run npm run pi:setup, then npm run pitchtype:keys again';
    RETURN;
  END IF;
  EXECUTE $v$
    CREATE OR REPLACE VIEW public.v_pitching_trial_order AS
    SELECT t.athlete_uuid,
           t.session_date,
           t.pitch_category,
           t.trial_index,
           t.owner_filename,
           t.capture_time,
           t.velocity_mph,
           -- order the 3D trials were captured in (all categories), 1-based
           row_number() OVER (PARTITION BY t.athlete_uuid, t.session_date
                              ORDER BY t.capture_time NULLS LAST, t.pitch_category, t.trial_index)::int AS capture_order,
           l.pitch_uid,
           l.confidence AS link_confidence,
           p.tm_session_id,
           p.pitch_type AS tm_pitch_type,
           p.rel_speed AS tm_velo,
           -- TrackMan's pitch number: order thrown among that player's live pitches in the TrackMan session
           p.pitch_no AS tm_pitch_no
      FROM public.f_pitching_trials t
      LEFT JOIN pitch_intel.biomech_trackman_links l
             ON l.athlete_uuid = t.athlete_uuid AND l.session_date = t.session_date
            AND l.pitch_category = t.pitch_category AND l.trial_index = t.trial_index
      LEFT JOIN pitch_intel.trackman_pitches p ON p.pitch_uid = l.pitch_uid
  $v$;
END $$;

COMMIT;
