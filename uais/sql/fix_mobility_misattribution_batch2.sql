-- Mobility misattribution fix, batch 2 (see chat 2026-09-22/23).
-- User-confirmed identities from the manual-review list left over from batch 1
-- (uais/sql/fix_mobility_misattribution.sql). Same rules as batch 1: session_date
-- is left as originally recorded, never stamped with today's date.
BEGIN;

-- Trevor Cleveland (uuid 9eea68f3-b426-4afa-a41a-ae545f674b3e) already has his real
-- 2026-05-06 assessment correctly recorded (row 275). Row 421 is an exact duplicate of
-- that (same date, same file) -> delete. Rows 401/251 are two copies of his separate
-- "original" assessment (undated filename, recorded as 2026-06-08) -> keep 401, reassign
-- it to him, delete the duplicate 251.
UPDATE public.f_mobility SET athlete_uuid = '9eea68f3-b426-4afa-a41a-ae545f674b3e' WHERE id = 401; -- Trevor Cleveland (original assessment)

-- Will Gervase Short -> Will Gervase (the "Short" suffix denotes an abbreviated assessment,
-- per user). His existing row (id 34) is dated 2025-11-05, so this 2026-06-08 entry is a
-- separate, later session -- no collision.
UPDATE public.f_mobility SET athlete_uuid = 'fdf72939-81e4-4bc0-9d65-70771d08da27' WHERE id = 196; -- Will Gervase

-- Eli Erkert = Elijah Erkert (nickname, per user)
UPDATE public.f_mobility SET athlete_uuid = 'd9012d23-1f29-497f-8bf8-add6ee37d1b2' WHERE id = 125; -- Elijah Erkert

-- Killpatrick = Coley Kilpatrick (typo, per user)
UPDATE public.f_mobility SET athlete_uuid = '3c9f9750-c510-4a51-b486-2146f3d8026d' WHERE id = 253; -- Coley Kilpatrick

-- Josh Shepard = Josh Shepherd (typo, per user)
UPDATE public.f_mobility SET athlete_uuid = 'd03f397e-3221-4236-aa0c-9014fed7a43c' WHERE id = 497; -- Josh Shepherd

-- Noumaan Subzwari = Nomi Subzwari (nickname, per user)
UPDATE public.f_mobility SET athlete_uuid = '7694768a-5789-4520-86ac-948797324d3a' WHERE id = 550; -- Nomi Subzwari

-- Deletes:
--   421       Trevor Cleveland  - duplicate of his existing 2026-05-06 row (275)
--   251       Trevor Cleveland  - duplicate of the "original" assessment kept as row 401
--   394, 129  Josh Hutchins     - user confirmed: discard, not a real match, no profile wanted
--   509       Remote Assessment Key - blank template file, not real athlete data
--   310       Will Gervase      - duplicate of the copy kept as row 196
--   315       Elijah Erkert     - duplicate of the copy kept as row 125
--   349       Coley Kilpatrick  - duplicate of the copy kept as row 253
--   571       Drew Agius        - user confirmed: unrecognized, discard
DELETE FROM public.f_mobility WHERE id IN (421, 251, 394, 129, 509, 310, 315, 349, 571);

SELECT update_athlete_data_flags();

COMMIT;
