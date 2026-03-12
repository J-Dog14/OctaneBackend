-- One-time fix: readiness screen session_date stored as 1955 (wrong century).
-- Adds 70 years to session_date where it is before 1980, then recomputes
-- age_at_collection and age_group from d_athletes.date_of_birth.
--
-- Run after applying the R migration parsing fix so new data is correct.
-- Usage: run against warehouse (e.g. psql or run from Python).

BEGIN;

-- 1) Fix session_date in main table
UPDATE public.f_readiness_screen r
SET session_date = r.session_date + interval '70 years'
WHERE r.session_date < '1980-01-01';

-- 2) Fix session_date in child tables
UPDATE public.f_readiness_screen_i   SET session_date = session_date + interval '70 years' WHERE session_date < '1980-01-01';
UPDATE public.f_readiness_screen_y   SET session_date = session_date + interval '70 years' WHERE session_date < '1980-01-01';
UPDATE public.f_readiness_screen_t   SET session_date = session_date + interval '70 years' WHERE session_date < '1980-01-01';
UPDATE public.f_readiness_screen_ir90 SET session_date = session_date + interval '70 years' WHERE session_date < '1980-01-01';
UPDATE public.f_readiness_screen_cmj SET session_date = session_date + interval '70 years' WHERE session_date < '1980-01-01';
UPDATE public.f_readiness_screen_ppu SET session_date = session_date + interval '70 years' WHERE session_date < '1980-01-01';

-- 3) Recompute age_at_collection and age_group from d_athletes (date - date = days in PostgreSQL)
UPDATE public.f_readiness_screen r
SET
  age_at_collection = (r.session_date - a.date_of_birth::date) / 365.25,
  age_group = CASE
    WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 13 THEN 'U13'
    WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 15 THEN 'U15'
    WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 17 THEN 'U17'
    WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 19 THEN 'U19'
    WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 23 THEN 'U23'
    ELSE '23+'
  END
FROM analytics.d_athletes a
WHERE r.athlete_uuid = a.athlete_uuid AND a.date_of_birth IS NOT NULL;

UPDATE public.f_readiness_screen_i r
SET age_at_collection = (r.session_date - a.date_of_birth::date) / 365.25,
    age_group = CASE WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 13 THEN 'U13' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 15 THEN 'U15' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 17 THEN 'U17' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 19 THEN 'U19' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 23 THEN 'U23' ELSE '23+' END
FROM analytics.d_athletes a WHERE r.athlete_uuid = a.athlete_uuid AND a.date_of_birth IS NOT NULL;

UPDATE public.f_readiness_screen_y r
SET age_at_collection = (r.session_date - a.date_of_birth::date) / 365.25,
    age_group = CASE WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 13 THEN 'U13' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 15 THEN 'U15' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 17 THEN 'U17' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 19 THEN 'U19' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 23 THEN 'U23' ELSE '23+' END
FROM analytics.d_athletes a WHERE r.athlete_uuid = a.athlete_uuid AND a.date_of_birth IS NOT NULL;

UPDATE public.f_readiness_screen_t r
SET age_at_collection = (r.session_date - a.date_of_birth::date) / 365.25,
    age_group = CASE WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 13 THEN 'U13' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 15 THEN 'U15' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 17 THEN 'U17' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 19 THEN 'U19' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 23 THEN 'U23' ELSE '23+' END
FROM analytics.d_athletes a WHERE r.athlete_uuid = a.athlete_uuid AND a.date_of_birth IS NOT NULL;

UPDATE public.f_readiness_screen_ir90 r
SET age_at_collection = (r.session_date - a.date_of_birth::date) / 365.25,
    age_group = CASE WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 13 THEN 'U13' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 15 THEN 'U15' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 17 THEN 'U17' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 19 THEN 'U19' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 23 THEN 'U23' ELSE '23+' END
FROM analytics.d_athletes a WHERE r.athlete_uuid = a.athlete_uuid AND a.date_of_birth IS NOT NULL;

UPDATE public.f_readiness_screen_cmj r
SET age_at_collection = (r.session_date - a.date_of_birth::date) / 365.25,
    age_group = CASE WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 13 THEN 'U13' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 15 THEN 'U15' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 17 THEN 'U17' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 19 THEN 'U19' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 23 THEN 'U23' ELSE '23+' END
FROM analytics.d_athletes a WHERE r.athlete_uuid = a.athlete_uuid AND a.date_of_birth IS NOT NULL;

UPDATE public.f_readiness_screen_ppu r
SET age_at_collection = (r.session_date - a.date_of_birth::date) / 365.25,
    age_group = CASE WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 13 THEN 'U13' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 15 THEN 'U15' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 17 THEN 'U17' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 19 THEN 'U19' WHEN (r.session_date - a.date_of_birth::date) / 365.25 < 23 THEN 'U23' ELSE '23+' END
FROM analytics.d_athletes a WHERE r.athlete_uuid = a.athlete_uuid AND a.date_of_birth IS NOT NULL;

COMMIT;
