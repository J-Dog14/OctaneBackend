-- Persistent comparison snapshots and coalesced, post-commit background jobs.
-- No raw athlete/source tables are rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtext('coach_population_snapshots_setup'));
CREATE TABLE IF NOT EXISTS public.coach_population_snapshots (
  key text PRIMARY KEY,
  payload jsonb,
  requested_version bigint NOT NULL DEFAULT 1,
  completed_version bigint NOT NULL DEFAULT 0,
  refreshed_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_until timestamptz,
  last_error text,
  failure_count integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.coach_mark_populations_dirty()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE population_key text;
BEGIN
  FOREACH population_key IN ARRAY TG_ARGV LOOP
    INSERT INTO public.coach_population_snapshots (key, next_attempt_at)
    VALUES (population_key, now() + interval '30 seconds')
    ON CONFLICT (key) DO UPDATE
       SET requested_version = coach_population_snapshots.requested_version + 1,
           next_attempt_at = now() + interval '30 seconds';
  END LOOP;
  RETURN NULL;
END;
$$;

-- Statement triggers run once per batch; updates roll back with failed imports.
-- A 30-second quiet period combines multiple committed chunks into one refresh.
DO $$
DECLARE mapping record; args text;
BEGIN
  FOR mapping IN SELECT * FROM (VALUES
    ('public.f_pitching_trials', ARRAY['population-pitching', 'coach-biomech-cohort-v1']::text[]),
    ('public.f_kinematics_pitching', ARRAY['population-pitching']::text[]),
    ('public.f_pitching_force_metrics', ARRAY['population-pitching', 'coach-biomech-cohort-v1']::text[]),
    ('public.f_kinematics_hitting', ARRAY['population-hitting']::text[]),
    ('public.f_mobility', ARRAY['population-mobility', 'coach-mobility-population-v1']::text[]),
    ('public.f_arm_action', ARRAY['population-arm-action']::text[]),
    ('public.f_proteus', ARRAY['population-proteus-pitcher', 'population-proteus-hitter']::text[]),
    ('public.f_pro_sup', ARRAY['coach-pro-sup-population-v1']::text[]),
    ('public.f_athletic_screen_cmj', ARRAY['population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-CMJ-all-v1', 'coach-screen-CMJ-female-v1']::text[]),
    ('public.f_athletic_screen_dj', ARRAY['population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-DJ-all-v1', 'coach-screen-DJ-female-v1']::text[]),
    ('public.f_athletic_screen_ppu', ARRAY['population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-PPU-all-v1', 'coach-screen-PPU-female-v1']::text[]),
    ('public.f_athletic_screen_slv', ARRAY['population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-SLV-all-v1', 'coach-screen-SLV-female-v1']::text[]),
    ('public.f_athletic_screen_v2_cmj', ARRAY['population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-CMJ-all-v1', 'coach-screen-CMJ-female-v1']::text[]),
    ('public.f_athletic_screen_v2_dj', ARRAY['population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-DJ-all-v1', 'coach-screen-DJ-female-v1']::text[]),
    ('public.f_athletic_screen_v2_ppu', ARRAY['population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-PPU-all-v1', 'coach-screen-PPU-female-v1']::text[]),
    ('public.f_athletic_screen_v2_slv', ARRAY['population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-SLV-all-v1', 'coach-screen-SLV-female-v1']::text[])
  ) AS t(table_name, population_keys) LOOP
    IF to_regclass(mapping.table_name) IS NOT NULL THEN
      SELECT string_agg(quote_literal(k), ', ') INTO args FROM unnest(mapping.population_keys) k;
      EXECUTE format('DROP TRIGGER IF EXISTS coach_population_dirty ON %s', mapping.table_name);
      EXECUTE format(
        'CREATE TRIGGER coach_population_dirty AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION public.coach_mark_populations_dirty(%s)',
        mapping.table_name, args
      );
    END IF;
  END LOOP;
END;
$$;

-- Demographic edits can change cohort membership or normalized metrics.
-- Import flag/sync timestamp updates alone do not rebuild every population.
DROP TRIGGER IF EXISTS coach_population_demographics_dirty ON analytics.d_athletes;
CREATE TRIGGER coach_population_demographics_dirty
AFTER UPDATE OF gender, date_of_birth, age, age_group, height, weight ON analytics.d_athletes
FOR EACH STATEMENT EXECUTE FUNCTION public.coach_mark_populations_dirty('population-pitching', 'coach-biomech-cohort-v1', 'population-hitting', 'population-mobility', 'coach-mobility-population-v1', 'population-arm-action', 'population-proteus-pitcher', 'population-proteus-hitter', 'coach-pro-sup-population-v1', 'population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-CMJ-all-v1', 'coach-screen-CMJ-female-v1', 'coach-screen-DJ-all-v1', 'coach-screen-DJ-female-v1', 'coach-screen-PPU-all-v1', 'coach-screen-PPU-female-v1', 'coach-screen-SLV-all-v1', 'coach-screen-SLV-female-v1');
DROP TRIGGER IF EXISTS coach_population_athletes_dirty ON analytics.d_athletes;
CREATE TRIGGER coach_population_athletes_dirty
AFTER INSERT OR DELETE OR TRUNCATE ON analytics.d_athletes
FOR EACH STATEMENT EXECUTE FUNCTION public.coach_mark_populations_dirty('population-pitching', 'coach-biomech-cohort-v1', 'population-hitting', 'population-mobility', 'coach-mobility-population-v1', 'population-arm-action', 'population-proteus-pitcher', 'population-proteus-hitter', 'coach-pro-sup-population-v1', 'population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-CMJ-all-v1', 'coach-screen-CMJ-female-v1', 'coach-screen-DJ-all-v1', 'coach-screen-DJ-female-v1', 'coach-screen-PPU-all-v1', 'coach-screen-PPU-female-v1', 'coach-screen-SLV-all-v1', 'coach-screen-SLV-female-v1');

INSERT INTO public.coach_population_snapshots (key)
SELECT unnest(ARRAY['population-pitching', 'coach-biomech-cohort-v1', 'population-hitting', 'population-mobility', 'coach-mobility-population-v1', 'population-arm-action', 'population-proteus-pitcher', 'population-proteus-hitter', 'coach-pro-sup-population-v1', 'population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-CMJ-all-v1', 'coach-screen-CMJ-female-v1', 'coach-screen-DJ-all-v1', 'coach-screen-DJ-female-v1', 'coach-screen-PPU-all-v1', 'coach-screen-PPU-female-v1', 'coach-screen-SLV-all-v1', 'coach-screen-SLV-female-v1']::text[]) ON CONFLICT (key) DO NOTHING;
COMMIT;

