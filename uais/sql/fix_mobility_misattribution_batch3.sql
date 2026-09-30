-- Mobility misattribution fix, batch 3 (see chat 2026-09-23).
-- The root cause (Dom Fritton's email stored as literal "gmail:" placeholder, matching
-- every other blank-email file via the email-first lookup) was NOT actually fixed after
-- batch 1/2 -- only the resulting bad rows were cleaned up. Re-running main.py to pick up
-- Dom's real 2026-09-22 assessment reprocessed the whole folder (by design, to catch the
-- Drive-refresh fix) and re-triggered the same bug, sending 55 other athletes' files back
-- into Dom's profile.
--
-- Now actually fixed at the source:
--   - uais/python/mobility/main.py: email extraction requires an "@", rejecting the bare
--     "Gmail:" label as a fake email.
--   - uais/python/common/athlete_manager.py: normalize_email() rejects any value without
--     an "@" as defense-in-depth, since every pipeline funnels through it.
-- This script cleans up today's re-occurrence and clears Dom's stored placeholder email.
--
-- Good news: Dom's real 2026-09-22 assessment (row 607) is already correctly in place --
-- the Drive-refresh fix from earlier worked. This script only touches the 56 *other*
-- rows that got re-misattributed to him during the full reprocess.
BEGIN;

-- 6 rows are genuinely new sessions for these athletes (different date than what they
-- already have on file) -- reassign rather than delete.
UPDATE public.f_mobility SET athlete_uuid = '613b2616-1957-428e-b73a-0eabfeffc3ee' WHERE id = 587; -- Eli James (2026-08-04)
UPDATE public.f_mobility SET athlete_uuid = '616d67f2-ad90-4755-81ab-d90156b43a00' WHERE id = 595; -- Peter Hoffman (2026-08-07)
UPDATE public.f_mobility SET athlete_uuid = 'e0cda8bf-d3f1-4dd3-9102-b5210bdd26b9' WHERE id = 615; -- Mason Eller (2026-07-09)
UPDATE public.f_mobility SET athlete_uuid = 'a7e0daaf-e605-485c-8a9a-dfa35d8346d5' WHERE id = 622; -- Jaxon Lucas (2026-06-16)
UPDATE public.f_mobility SET athlete_uuid = '68282a35-97ff-412d-a76e-1912c9460ada' WHERE id = 628; -- Simon Leach (2026-07-06)
UPDATE public.f_mobility SET athlete_uuid = 'da84c235-6f25-49a7-841e-2b078ae25d3b' WHERE id = 634; -- Parker Garrett (2026-09-01)

-- 50 rows are exact duplicates of data the correct athlete already has on that date
-- (same names/dates resolved in batch 1/2) -- delete rather than reassign.
DELETE FROM public.f_mobility WHERE id IN (
    584, 585, 586, 588, 589, 590, 591, 592, 593, 594, 596, 597, 598, 600, 601, 602, 603,
    604, 605, 606, 608, 609, 610, 611, 613, 614, 616, 617, 618, 619, 620, 621, 623, 625,
    626, 627, 629, 630, 631, 632, 633, 635, 636, 637, 638, 639, 640, 641, 642, 599
);

-- Clear the bogus placeholder email so Dom's profile can never again act as a magnet
-- for other athletes' blank-email files.
UPDATE analytics.d_athletes SET email = NULL
WHERE athlete_uuid = '54d697ac-d3d6-4ba1-a5ca-d1a6b55f76a6' AND email = 'gmail:';

SELECT update_athlete_data_flags();

COMMIT;
