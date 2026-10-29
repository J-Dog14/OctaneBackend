-- Athletic Screen v2 compatibility views.
--
-- The app (Octane payload, coach suite, percentiles, date lists, readiness context) was written against the
-- old f_athletic_screen_{cmj,dj,ppu,slv} column names. These views expose the v2 tables under those names so
-- consumers switch by table name only. Nothing here reads the old tables.
--
--   old column          v2 source
--   jh_in               jh_in
--   peak_power,
--   pp_forceplate,
--   peak_power_w        peak_power_w                       (one force-plate peak power now)
--   force_at_pp         force_at_pp_n
--   vel_at_pp           vel_at_pp_m_s * 1000               (mm/s - the old tables and readiness tables use mm/s)
--   vel_at_pp_m_s       vel_at_pp_m_s                      (m/s, extra column)
--   pp_w_per_kg         pp_w_per_kg
--   ct / rsi (DJ)       ct_s / rsi_legacy                  (RSI on the old 2 x JH / CT scale)
--   time_to_peak_s      concentric_duration_s - pp_before_takeoff_s      (push-off start -> peak power)
--   time_to_rpd_max_s   concentric_duration_s - rpd_max_before_takeoff_s (push-off start -> max RPD)
--   fwhm_s, t_com_norm_0to1, skewness, kurtosis   pwr_con_* shape of the concentric power curve
--   auc_j               concentric_work_j
--   work_early_pct, spectral_centroid_hz, demographic   NULL (not produced by v2)
--
-- Re-runnable. Apply with:  npx prisma db execute --file uais/sql/create_athletic_screen_v2_compat_views.sql --schema prisma/schema.prisma

DROP VIEW IF EXISTS public.v_athletic_screen_cmj;
CREATE VIEW public.v_athletic_screen_cmj AS
SELECT
  id,
  athlete_uuid,
  session_date,
  source_system::varchar(50) AS source_system,
  source_athlete_id::varchar(100) AS source_athlete_id,
  trial_name,
  age_at_collection::numeric AS age_at_collection,
  age_group,
  created_at::timestamp(6) AS created_at,
  jh_in::numeric AS jh_in,
  peak_power_w::numeric AS peak_power,
  peak_power_w::numeric AS pp_forceplate,
  force_at_pp_n::numeric AS force_at_pp,
  (vel_at_pp_m_s * 1000)::numeric AS vel_at_pp,
  vel_at_pp_m_s::numeric AS vel_at_pp_m_s,
  pp_w_per_kg::numeric AS pp_w_per_kg,
  peak_power_w::numeric AS peak_power_w,
  GREATEST(concentric_duration_s - pp_before_takeoff_s, 0)::numeric AS time_to_peak_s,
  rpd_max_w_per_s::numeric AS rpd_max_w_per_s,
  GREATEST(concentric_duration_s - rpd_max_before_takeoff_s, 0)::numeric AS time_to_rpd_max_s,
  rise_time_10_90_s::numeric AS rise_time_10_90_s,
  pwr_con_fwhm_s::numeric AS fwhm_s,
  concentric_work_j::numeric AS auc_j,
  NULL::numeric AS work_early_pct,
  decay_90_10_s::numeric AS decay_90_10_s,
  pwr_con_time_com_norm::numeric AS t_com_norm_0to1,
  pwr_con_time_skew::numeric AS skewness,
  pwr_con_time_kurtosis::numeric AS kurtosis,
  NULL::numeric AS spectral_centroid_hz,
  NULL::text AS demographic,
  session_folder,
  qc_flags,
  processor_version
FROM public.f_athletic_screen_v2_cmj;

DROP VIEW IF EXISTS public.v_athletic_screen_dj;
CREATE VIEW public.v_athletic_screen_dj AS
SELECT
  id,
  athlete_uuid,
  session_date,
  source_system::varchar(50) AS source_system,
  source_athlete_id::varchar(100) AS source_athlete_id,
  trial_name,
  age_at_collection::numeric AS age_at_collection,
  age_group,
  created_at::timestamp(6) AS created_at,
  jh_in::numeric AS jh_in,
  peak_power_w::numeric AS peak_power,
  peak_power_w::numeric AS pp_forceplate,
  force_at_pp_n::numeric AS force_at_pp,
  (vel_at_pp_m_s * 1000)::numeric AS vel_at_pp,
  vel_at_pp_m_s::numeric AS vel_at_pp_m_s,
  pp_w_per_kg::numeric AS pp_w_per_kg,
  ct_s::numeric AS ct,
  rsi_legacy::numeric AS rsi,
  peak_power_w::numeric AS peak_power_w,
  GREATEST(concentric_duration_s - pp_before_takeoff_s, 0)::numeric AS time_to_peak_s,
  rpd_max_w_per_s::numeric AS rpd_max_w_per_s,
  GREATEST(concentric_duration_s - rpd_max_before_takeoff_s, 0)::numeric AS time_to_rpd_max_s,
  rise_time_10_90_s::numeric AS rise_time_10_90_s,
  pwr_con_fwhm_s::numeric AS fwhm_s,
  concentric_work_j::numeric AS auc_j,
  NULL::numeric AS work_early_pct,
  decay_90_10_s::numeric AS decay_90_10_s,
  pwr_con_time_com_norm::numeric AS t_com_norm_0to1,
  pwr_con_time_skew::numeric AS skewness,
  pwr_con_time_kurtosis::numeric AS kurtosis,
  NULL::numeric AS spectral_centroid_hz,
  NULL::text AS demographic,
  session_folder,
  qc_flags,
  processor_version
FROM public.f_athletic_screen_v2_dj;

DROP VIEW IF EXISTS public.v_athletic_screen_ppu;
CREATE VIEW public.v_athletic_screen_ppu AS
SELECT
  id,
  athlete_uuid,
  session_date,
  source_system::varchar(50) AS source_system,
  source_athlete_id::varchar(100) AS source_athlete_id,
  trial_name,
  age_at_collection::numeric AS age_at_collection,
  age_group,
  created_at::timestamp(6) AS created_at,
  jh_in::numeric AS jh_in,
  peak_power_w::numeric AS peak_power,
  peak_power_w::numeric AS pp_forceplate,
  force_at_pp_n::numeric AS force_at_pp,
  (vel_at_pp_m_s * 1000)::numeric AS vel_at_pp,
  vel_at_pp_m_s::numeric AS vel_at_pp_m_s,
  pp_w_per_kg::numeric AS pp_w_per_kg,
  peak_power_w::numeric AS peak_power_w,
  GREATEST(concentric_duration_s - pp_before_takeoff_s, 0)::numeric AS time_to_peak_s,
  rpd_max_w_per_s::numeric AS rpd_max_w_per_s,
  GREATEST(concentric_duration_s - rpd_max_before_takeoff_s, 0)::numeric AS time_to_rpd_max_s,
  rise_time_10_90_s::numeric AS rise_time_10_90_s,
  pwr_con_fwhm_s::numeric AS fwhm_s,
  concentric_work_j::numeric AS auc_j,
  NULL::numeric AS work_early_pct,
  decay_90_10_s::numeric AS decay_90_10_s,
  pwr_con_time_com_norm::numeric AS t_com_norm_0to1,
  pwr_con_time_skew::numeric AS skewness,
  pwr_con_time_kurtosis::numeric AS kurtosis,
  NULL::numeric AS spectral_centroid_hz,
  NULL::text AS demographic,
  session_folder,
  qc_flags,
  processor_version
FROM public.f_athletic_screen_v2_ppu;

DROP VIEW IF EXISTS public.v_athletic_screen_slv;
CREATE VIEW public.v_athletic_screen_slv AS
SELECT
  id,
  athlete_uuid,
  session_date,
  source_system::varchar(50) AS source_system,
  source_athlete_id::varchar(100) AS source_athlete_id,
  trial_name,
  side,
  age_at_collection::numeric AS age_at_collection,
  age_group,
  created_at::timestamp(6) AS created_at,
  jh_in::numeric AS jh_in,
  peak_power_w::numeric AS pp_forceplate,
  force_at_pp_n::numeric AS force_at_pp,
  (vel_at_pp_m_s * 1000)::numeric AS vel_at_pp,
  vel_at_pp_m_s::numeric AS vel_at_pp_m_s,
  pp_w_per_kg::numeric AS pp_w_per_kg,
  peak_power_w::numeric AS peak_power_w,
  GREATEST(concentric_duration_s - pp_before_takeoff_s, 0)::numeric AS time_to_peak_s,
  rpd_max_w_per_s::numeric AS rpd_max_w_per_s,
  GREATEST(concentric_duration_s - rpd_max_before_takeoff_s, 0)::numeric AS time_to_rpd_max_s,
  rise_time_10_90_s::numeric AS rise_time_10_90_s,
  pwr_con_fwhm_s::numeric AS fwhm_s,
  concentric_work_j::numeric AS auc_j,
  NULL::numeric AS work_early_pct,
  decay_90_10_s::numeric AS decay_90_10_s,
  pwr_con_time_com_norm::numeric AS t_com_norm_0to1,
  pwr_con_time_skew::numeric AS skewness,
  pwr_con_time_kurtosis::numeric AS kurtosis,
  NULL::numeric AS spectral_centroid_hz,
  NULL::text AS demographic,
  session_folder,
  qc_flags,
  processor_version
FROM public.f_athletic_screen_v2_slv;

-- One row per athlete / screen session (replaces the legacy public.f_athletic_screen session table).
DROP VIEW IF EXISTS public.v_athletic_screen_sessions;
CREATE VIEW public.v_athletic_screen_sessions AS
SELECT
  athlete_uuid,
  session_date,
  MIN(session_folder) AS session_folder,
  MIN(source_athlete_id)::varchar(100) AS source_athlete_id,
  MAX(age_at_collection)::numeric AS age_at_collection,
  MAX(age_group) AS age_group,
  MAX(created_at)::timestamp(6) AS created_at,
  array_agg(DISTINCT movement ORDER BY movement) AS movements,
  COUNT(*)::int AS trials
FROM (
  SELECT athlete_uuid, session_date, session_folder, source_athlete_id, age_at_collection, age_group, created_at, 'CMJ'::text AS movement FROM public.f_athletic_screen_v2_cmj
UNION ALL
  SELECT athlete_uuid, session_date, session_folder, source_athlete_id, age_at_collection, age_group, created_at, 'DJ'::text AS movement FROM public.f_athletic_screen_v2_dj
UNION ALL
  SELECT athlete_uuid, session_date, session_folder, source_athlete_id, age_at_collection, age_group, created_at, 'PPU'::text AS movement FROM public.f_athletic_screen_v2_ppu
UNION ALL
  SELECT athlete_uuid, session_date, session_folder, source_athlete_id, age_at_collection, age_group, created_at, 'SLV'::text AS movement FROM public.f_athletic_screen_v2_slv
) t
GROUP BY athlete_uuid, session_date;

-- Cached comparison populations (coach_population_snapshots): rebuild them whenever the v2 tables change,
-- and once now so nothing keeps serving a population built from the old tables.
DO $$
DECLARE mapping record; args text;
BEGIN
  IF to_regclass('public.coach_population_snapshots') IS NULL THEN
    RETURN;
  END IF;
  FOR mapping IN SELECT * FROM (VALUES
    ('public.f_athletic_screen_v2_cmj', ARRAY['population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-CMJ-all-v1', 'coach-screen-CMJ-female-v1']::text[]),
    ('public.f_athletic_screen_v2_dj', ARRAY['population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-DJ-all-v1', 'coach-screen-DJ-female-v1']::text[]),
    ('public.f_athletic_screen_v2_ppu', ARRAY['population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-PPU-all-v1', 'coach-screen-PPU-female-v1']::text[]),
    ('public.f_athletic_screen_v2_slv', ARRAY['population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-SLV-all-v1', 'coach-screen-SLV-female-v1']::text[])
  ) AS t(table_name, population_keys) LOOP
    SELECT string_agg(quote_literal(k), ', ') INTO args FROM unnest(mapping.population_keys) k;
    EXECUTE format('DROP TRIGGER IF EXISTS coach_population_dirty ON %s', mapping.table_name);
    EXECUTE format(
      'CREATE TRIGGER coach_population_dirty AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION public.coach_mark_populations_dirty(%s)',
      mapping.table_name, args
    );
  END LOOP;
  INSERT INTO public.coach_population_snapshots (key, next_attempt_at)
  SELECT k, now() FROM unnest(ARRAY['population-athletic-screen', 'population-athletic-screen-female', 'coach-screen-CMJ-all-v1', 'coach-screen-CMJ-female-v1', 'coach-screen-DJ-all-v1', 'coach-screen-DJ-female-v1', 'coach-screen-PPU-all-v1', 'coach-screen-PPU-female-v1', 'coach-screen-SLV-all-v1', 'coach-screen-SLV-female-v1']::text[]) k
  ON CONFLICT (key) DO UPDATE
     SET requested_version = coach_population_snapshots.requested_version + 1,
         next_attempt_at = now();
END;
$$;
