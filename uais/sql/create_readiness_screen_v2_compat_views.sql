-- Readiness Screen v2 compatibility views.
--
-- Consumers written against the old f_readiness_screen_* tables switch by table name only.
-- Nothing here reads the old tables or the athletic-screen cross-insert rows.
--
--   jumps (CMJ / PPU)           old column        v2 source
--                               jump_height       jh_in
--                               peak_power,
--                               pp_forceplate,
--                               peak_power_w      peak_power_w  (force-plate peak power; the old peak_power was the
--                                                                Lewis/Sayers estimate from jump height + mass)
--                               peak_force,
--                               peak_grf_n        peak_force_n
--                               vel_at_pp         vel_at_pp_m_s * 1000  (mm/s, as before; vel_at_pp_m_s added)
--                               force_at_pp       force_at_pp_n
--                               auc_j,
--                               concentric_auc_j  concentric_work_j
--                               eccentric_auc_j   eccentric_work_j
--                               peak_grf_bw_ratio peak_force_bw  (PPU: relative to the hands-only load)
--                               rfd_0_100ms       rfd_con_0_100ms_n_per_s (from concentric onset, as before)
--                               time_to_peak_s / time_to_rpd_max_s  measured from push-off start
--                               fwhm/t_com/skewness/kurtosis        pwr_con_* (concentric power-curve shape)
--                               work_early_pct, spectral_centroid_hz  NULL
--   isometrics (I / Y / T / IR90): one row per athlete/session = the trial with the highest max force.
--                               max_force/avg_force/time_to_max   same V3D definitions, plate-offset corrected
--                               *_norm            N per kg of plate-measured body mass (session CMJ quiet stance),
--                                                 else the typed-in mass (as the old pipeline always did)
--
-- Re-runnable:  npx prisma db execute --file uais/sql/create_readiness_screen_v2_compat_views.sql --schema prisma/schema.prisma

DROP VIEW IF EXISTS public.v_readiness_screen_cmj;
CREATE VIEW public.v_readiness_screen_cmj AS
SELECT
  id,
  athlete_uuid,
  session_date,
  source_system::varchar(50) AS source_system,
  source_athlete_id::varchar(100) AS source_athlete_id,
  trial_number AS trial_id,
  age_at_collection::numeric AS age_at_collection,
  age_group,
  created_at::timestamp(6) AS created_at,
  jh_in::numeric AS jump_height,
  peak_power_w::numeric AS peak_power,
  peak_force_n::numeric AS peak_force,
  pp_w_per_kg::numeric AS pp_w_per_kg,
  peak_power_w::numeric AS pp_forceplate,
  force_at_pp_n::numeric AS force_at_pp,
  (vel_at_pp_m_s * 1000)::numeric AS vel_at_pp,
  trial_name,
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
  contraction_time_s::numeric AS contraction_time_s,
  eccentric_duration_s::numeric AS eccentric_duration_s,
  concentric_duration_s::numeric AS concentric_duration_s,
  ecc_con_duration_ratio::numeric AS ecc_con_duration_ratio,
  eccentric_mean_power_w::numeric AS eccentric_mean_power_w,
  eccentric_peak_power_w::numeric AS eccentric_peak_power_w,
  eccentric_work_j::numeric AS eccentric_auc_j,
  concentric_work_j::numeric AS concentric_auc_j,
  mrsi::numeric AS mrsi,
  peak_force_n::numeric AS peak_grf_n,
  peak_force_bw::numeric AS peak_grf_bw_ratio,
  rfd_con_0_100ms_n_per_s::numeric AS rfd_0_100ms,
  concentric_impulse_ns::numeric AS concentric_impulse_ns,
  vel_at_pp_m_s::numeric AS vel_at_pp_m_s,
  session_folder,
  source_root,
  qc_flags,
  processor_version
FROM public.f_readiness_screen_v2_cmj;

DROP VIEW IF EXISTS public.v_readiness_screen_ppu;
CREATE VIEW public.v_readiness_screen_ppu AS
SELECT
  id,
  athlete_uuid,
  session_date,
  source_system::varchar(50) AS source_system,
  source_athlete_id::varchar(100) AS source_athlete_id,
  trial_number AS trial_id,
  age_at_collection::numeric AS age_at_collection,
  age_group,
  created_at::timestamp(6) AS created_at,
  jh_in::numeric AS jump_height,
  peak_power_w::numeric AS peak_power,
  peak_force_n::numeric AS peak_force,
  pp_w_per_kg::numeric AS pp_w_per_kg,
  peak_power_w::numeric AS pp_forceplate,
  force_at_pp_n::numeric AS force_at_pp,
  (vel_at_pp_m_s * 1000)::numeric AS vel_at_pp,
  trial_name,
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
  contraction_time_s::numeric AS contraction_time_s,
  eccentric_duration_s::numeric AS eccentric_duration_s,
  concentric_duration_s::numeric AS concentric_duration_s,
  ecc_con_duration_ratio::numeric AS ecc_con_duration_ratio,
  eccentric_mean_power_w::numeric AS eccentric_mean_power_w,
  eccentric_peak_power_w::numeric AS eccentric_peak_power_w,
  eccentric_work_j::numeric AS eccentric_auc_j,
  concentric_work_j::numeric AS concentric_auc_j,
  mrsi::numeric AS mrsi,
  peak_force_n::numeric AS peak_grf_n,
  peak_force_bw::numeric AS peak_grf_bw_ratio,
  rfd_con_0_100ms_n_per_s::numeric AS rfd_0_100ms,
  concentric_impulse_ns::numeric AS concentric_impulse_ns,
  vel_at_pp_m_s::numeric AS vel_at_pp_m_s,
  session_folder,
  source_root,
  qc_flags,
  processor_version
FROM public.f_readiness_screen_v2_ppu;

DROP VIEW IF EXISTS public.v_readiness_screen_i;
CREATE VIEW public.v_readiness_screen_i AS
SELECT DISTINCT ON (athlete_uuid, session_date)
  id,
  athlete_uuid,
  session_date,
  source_system::varchar(50) AS source_system,
  source_athlete_id::varchar(100) AS source_athlete_id,
  trial_number AS trial_id,
  age_at_collection::numeric AS age_at_collection,
  age_group,
  created_at::timestamp(6) AS created_at,
  avg_force_n::numeric AS avg_force,
  avg_force_n_per_kg::numeric AS avg_force_norm,
  max_force_n::numeric AS max_force,
  max_force_n_per_kg::numeric AS max_force_norm,
  time_to_max_s::numeric AS time_to_max,
  avg_force_3s_n::numeric AS avg_force_3s,
  pct_max_s3::numeric AS pct_max_s3,
  rfd_0_200ms_n_per_s::numeric AS rfd_0_200ms,
  mass_kg::numeric AS mass_kg,
  mass_source,
  trial_name,
  session_folder,
  source_root,
  qc_flags,
  processor_version
FROM public.f_readiness_screen_v2_iso
WHERE movement = 'I'
ORDER BY athlete_uuid, session_date, max_force_n DESC NULLS LAST, trial_number;

DROP VIEW IF EXISTS public.v_readiness_screen_y;
CREATE VIEW public.v_readiness_screen_y AS
SELECT DISTINCT ON (athlete_uuid, session_date)
  id,
  athlete_uuid,
  session_date,
  source_system::varchar(50) AS source_system,
  source_athlete_id::varchar(100) AS source_athlete_id,
  trial_number AS trial_id,
  age_at_collection::numeric AS age_at_collection,
  age_group,
  created_at::timestamp(6) AS created_at,
  avg_force_n::numeric AS avg_force,
  avg_force_n_per_kg::numeric AS avg_force_norm,
  max_force_n::numeric AS max_force,
  max_force_n_per_kg::numeric AS max_force_norm,
  time_to_max_s::numeric AS time_to_max,
  avg_force_3s_n::numeric AS avg_force_3s,
  pct_max_s3::numeric AS pct_max_s3,
  rfd_0_200ms_n_per_s::numeric AS rfd_0_200ms,
  mass_kg::numeric AS mass_kg,
  mass_source,
  trial_name,
  session_folder,
  source_root,
  qc_flags,
  processor_version
FROM public.f_readiness_screen_v2_iso
WHERE movement = 'Y'
ORDER BY athlete_uuid, session_date, max_force_n DESC NULLS LAST, trial_number;

DROP VIEW IF EXISTS public.v_readiness_screen_t;
CREATE VIEW public.v_readiness_screen_t AS
SELECT DISTINCT ON (athlete_uuid, session_date)
  id,
  athlete_uuid,
  session_date,
  source_system::varchar(50) AS source_system,
  source_athlete_id::varchar(100) AS source_athlete_id,
  trial_number AS trial_id,
  age_at_collection::numeric AS age_at_collection,
  age_group,
  created_at::timestamp(6) AS created_at,
  avg_force_n::numeric AS avg_force,
  avg_force_n_per_kg::numeric AS avg_force_norm,
  max_force_n::numeric AS max_force,
  max_force_n_per_kg::numeric AS max_force_norm,
  time_to_max_s::numeric AS time_to_max,
  avg_force_3s_n::numeric AS avg_force_3s,
  pct_max_s3::numeric AS pct_max_s3,
  rfd_0_200ms_n_per_s::numeric AS rfd_0_200ms,
  mass_kg::numeric AS mass_kg,
  mass_source,
  trial_name,
  session_folder,
  source_root,
  qc_flags,
  processor_version
FROM public.f_readiness_screen_v2_iso
WHERE movement = 'T'
ORDER BY athlete_uuid, session_date, max_force_n DESC NULLS LAST, trial_number;

DROP VIEW IF EXISTS public.v_readiness_screen_ir90;
CREATE VIEW public.v_readiness_screen_ir90 AS
SELECT DISTINCT ON (athlete_uuid, session_date)
  id,
  athlete_uuid,
  session_date,
  source_system::varchar(50) AS source_system,
  source_athlete_id::varchar(100) AS source_athlete_id,
  trial_number AS trial_id,
  age_at_collection::numeric AS age_at_collection,
  age_group,
  created_at::timestamp(6) AS created_at,
  avg_force_n::numeric AS avg_force,
  avg_force_n_per_kg::numeric AS avg_force_norm,
  max_force_n::numeric AS max_force,
  max_force_n_per_kg::numeric AS max_force_norm,
  time_to_max_s::numeric AS time_to_max,
  avg_force_3s_n::numeric AS avg_force_3s,
  pct_max_s3::numeric AS pct_max_s3,
  rfd_0_200ms_n_per_s::numeric AS rfd_0_200ms,
  mass_kg::numeric AS mass_kg,
  mass_source,
  trial_name,
  session_folder,
  source_root,
  qc_flags,
  processor_version
FROM public.f_readiness_screen_v2_iso
WHERE movement = 'IR90'
ORDER BY athlete_uuid, session_date, max_force_n DESC NULLS LAST, trial_number;

-- One row per athlete / readiness session (replaces the legacy public.f_readiness_screen).
DROP VIEW IF EXISTS public.v_readiness_screen_sessions;
CREATE VIEW public.v_readiness_screen_sessions AS
SELECT
  athlete_uuid,
  session_date,
  'readiness_screen_v2'::varchar(50) AS source_system,
  MIN(source_athlete_id)::varchar(100) AS source_athlete_id,
  MIN(session_folder) AS session_folder,
  MIN(source_root) AS source_root,
  MAX(age_at_collection)::numeric AS age_at_collection,
  MAX(age_group) AS age_group,
  MAX(created_at)::timestamp(6) AS created_at,
  array_agg(DISTINCT movement ORDER BY movement) AS movements,
  COUNT(*)::int AS trials
FROM (
  SELECT athlete_uuid, session_date, source_athlete_id, session_folder, source_root, age_at_collection, age_group, created_at, 'CMJ'::text AS movement FROM public.f_readiness_screen_v2_cmj
UNION ALL
  SELECT athlete_uuid, session_date, source_athlete_id, session_folder, source_root, age_at_collection, age_group, created_at, 'PPU'::text FROM public.f_readiness_screen_v2_ppu
UNION ALL
  SELECT athlete_uuid, session_date, source_athlete_id, session_folder, source_root, age_at_collection, age_group, created_at, movement::text FROM public.f_readiness_screen_v2_iso
) t
GROUP BY athlete_uuid, session_date;

-- Power-curve metrics per CMJ/PPU trial (replaces the legacy public.f_readiness_screen_power_curve).
-- rise_slope_w_per_s = 0.8 x peak power / 10-90 % rise time (rpd_10_90_w_per_s); t_com_s is measured from
-- concentric start. Legacy (no-c3d) rows have no power and are left out, as the old table had no row for them.
DROP VIEW IF EXISTS public.v_readiness_screen_power_curve;
CREATE VIEW public.v_readiness_screen_power_curve AS
SELECT
  id,
  athlete_uuid,
  session_date,
  movement_type::varchar(10) AS movement_type,
  trial_number AS trial_id,
  source_c3d AS source_file,
  fs_hz::numeric AS fs_hz,
  NULL::int AS n_samples,
  peak_power_w::numeric AS peak_power_w,
  GREATEST(concentric_duration_s - pp_before_takeoff_s, 0)::numeric AS time_to_peak_s,
  rise_time_10_90_s::numeric AS rise_time_10_90_s,
  rpd_10_90_w_per_s::numeric AS rise_slope_w_per_s,
  pwr_con_fwhm_s::numeric AS fwhm_s,
  concentric_work_j::numeric AS auc_j,
  (pwr_con_time_com_norm * concentric_duration_s)::numeric AS t_com_s,
  pwr_con_time_com_norm::numeric AS t_com_norm_0to1,
  NULL::numeric AS cv_local_peak,
  rpd_max_w_per_s::numeric AS rpd_max_w_per_s,
  GREATEST(concentric_duration_s - rpd_max_before_takeoff_s, 0)::numeric AS time_to_rpd_max_s,
  NULL::numeric AS auc_pre_j,
  NULL::numeric AS auc_post_j,
  NULL::numeric AS work_early_pct,
  decay_90_10_s::numeric AS decay_90_10_s,
  pwr_con_time_skew::numeric AS skewness,
  pwr_con_time_kurtosis::numeric AS kurtosis,
  NULL::numeric AS spectral_centroid_hz,
  contraction_time_s::numeric AS contraction_time_s,
  eccentric_duration_s::numeric AS eccentric_duration_s,
  concentric_duration_s::numeric AS concentric_duration_s,
  ecc_con_duration_ratio::numeric AS ecc_con_duration_ratio,
  eccentric_mean_power_w::numeric AS eccentric_mean_power_w,
  eccentric_peak_power_w::numeric AS eccentric_peak_power_w,
  eccentric_work_j::numeric AS eccentric_auc_j,
  concentric_work_j::numeric AS concentric_auc_j,
  mrsi::numeric AS mrsi,
  created_at::timestamp(6) AS created_at
FROM (
  SELECT *, 'CMJ'::text AS movement_type FROM public.f_readiness_screen_v2_cmj
UNION ALL
  SELECT *, 'PPU'::text AS movement_type FROM public.f_readiness_screen_v2_ppu
) t
WHERE peak_power_w IS NOT NULL;
