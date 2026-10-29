# Readiness Screen v2: rebuild from c3d

This replaces Visual3D for the readiness screen. Python reads FP3 straight from each trial's c3d file.

## Why

The V3D readiness pipelines (`Readiness_Screen.v3s` in Readiness Screen 3 and `Readiness_Screen V3.v3s` in Athletic Screen 2.0) have the same problem as the old athletic-screen pipeline:

- Velocity is integrated forward from frame 1 with v0 = 0, using FP3 *magnitude* and the typed-in mass.
- PPU uses half the body weight, or a 50 ms baseline in V3.
- The result is that every CMJ/PPU power value is wrong. Old readiness W/kg sits around 4–9; the corrected value is about 60.
- The isometric metrics involve no integration, so they were essentially right (within about 1–2 %).

## What is computed

**CMJ / PPU:** `athleticScreen/v2/kinetics.process_trial`, unchanged.

- Velocity is integrated backward from takeoff.
- Body weight comes from the quiet window.
- QC flags as for the athletic screen.
- Readiness-only extras: `eccentric_mean_power_w`, `eccentric_work_j`, `rfd_con_0_100ms_n_per_s`.

**I / Y / T / IR90:** `isometric.py`.

- V3D definitions:
  - Begin_Push is the first sample of 3 at or above 10 N.
  - Max force is the global maximum.
  - Average force runs from push start to the end of the file.
  - Time to max is measured from push start.
- Each definition is stored twice: on the raw signal (`*_raw_*`, for validation) and plate-offset corrected (used by the views).
- Added metrics:
  - fixed 3 s average and impulse
  - per-second averages and % of max
  - hold drop
  - RFD at 0–100 and 0–200 ms, peak RFD
- Normalization:
  - divide by plate-measured body mass from the session's CMJ quiet stance
  - if there is none, use a same-day sibling folder
  - otherwise use the typed-in mass

## Sources

| root | folder | which sessions |
|---|---|---|
| AS2 | `D:\Athletic Screen 2.0\Data` | session.xml has Session Type = "Readiness Screen" (current) |
| RS3 | `D:\Readiness Screen 3\Data` | every session folder with readiness c3d files (older; session type "Test") |

If an athlete and date appear in both roots, the AS2 copy is kept. Two folders for one athlete on one date are merged and the trials renumbered.

## Run (Windows, from the repo root, uais venv)

```
# Phase A - no DB, needs ezc3d + scipy. Writes tmp/readiness_v2/
python uais/python/readinessScreen/v2/scan_sessions.py --data "D:/Athletic Screen 2.0/Data" --data "D:/Readiness Screen 3/Data"
#   read tmp/readiness_v2/qc_report.md and errors.csv

# Phase B - match athletes (dry run), resolve match_review.csv -> match_overrides.csv, then apply
python uais/python/readinessScreen/v2/load_v2.py
python uais/python/readinessScreen/v2/load_v2.py --apply

# Phase C - compare with the old tables (read-only)
python uais/python/readinessScreen/v2/validate_v2.py

# compat views (old column names over v2)
npx prisma db execute --file uais/sql/create_readiness_screen_v2_compat_views.sql --schema prisma/schema.prisma
```

Writes only these tables:

- `public.f_readiness_screen_v2_cmj`
- `public.f_readiness_screen_v2_ppu`
- `public.f_readiness_screen_v2_iso` (I/Y/T/IR90, with a `movement` column)
- `public.f_readiness_screen_v2_force_curve`

The DDL is in `uais/sql/create_readiness_screen_v2_tables.sql`. To regenerate it: `python uais/python/readinessScreen/v2/schema.py > uais/sql/create_readiness_screen_v2_tables.sql`.

Trial names:

- CMJ and PPU keep the old style (`CMJ1`, `PPU2`).
- Isometrics are named `Y_1`, `IR90_1` and so on.

The views `v_readiness_screen_{cmj,ppu,i,y,t,ir90}` and `v_readiness_screen_sessions` expose the old column names. The isometric views keep one row per session: the trial with the highest max force.

## After the load (one-time switch-over)

```
# carry over readiness sessions that have no c3d (mostly Jan-Sep 2024): JH + isometrics only, power NULL
python uais/python/readinessScreen/v2/legacy_v2.py            # dry run
python uais/python/readinessScreen/v2/legacy_v2.py --apply

# views (re-run whenever this file changes; also creates v_readiness_screen_power_curve)
npx prisma db execute --file uais/sql/create_readiness_screen_v2_compat_views.sql --schema prisma/schema.prisma

# d_athletes readiness flags/counts read v_readiness_screen_sessions; triggers on the v2 tables
python uais/python/readinessScreen/v2/patch_flag_functions.py --apply

# recompute the whole readiness score history from v2
python uais/python/readinessScreen/v2/rescore_all.py --apply

npm run prisma:generate      # new prisma views: v_readiness_screen_sessions / _i / _y / _t / _ir90
```

Settings -> `uais_data_dir_readiness_screen` = `D:\Athletic Screen 2.0\Data`. Pointing it at an Output Files folder
stops the run with an explanation.

## Ingest (what the Ingest button runs)

`readinessScreen/main.py` routes every run to `v2/ingest.py`; the legacy Output Files writer
(`process_txt_files`) raises. Per athlete in one transaction: resolve the athlete (selected UUID with name
guard, else the folder's link in readiness v2 or athletic screen v2, else get_or_create_athlete), fill
DOB/gender/email from session.xml, age fields, replace the session's v2 rows and curves, set the readiness
flag. Then duplicate check and a readiness score for each new session.

```
python uais/python/readinessScreen/v2/ingest.py --dry-run     # what would be ingested (read-only)
python uais/python/readinessScreen/v2/ingest.py --offline     # processing check, no database
```

The athletic-screen ingest no longer cross-inserts CMJ/PPU into `f_readiness_screen_cmj/ppu`; readiness
scoring and the readiness dashboard union `v_athletic_screen_*` explicitly instead (no double count).

## Consumers switched to the views

scoring.py (labels in flags_json unchanged), lib/dashboard/readinessPayload.ts, research data route,
coach export registry, audit (+ fix-dob), dashboard athletes, muse sessions, client-hub assessments,
coach summary + athleteSearch, Octane reportPayload. Grip stays in `f_readiness_screen_grip`.
Merge/delete/audit table lists in common/ and scripts/ include the v2 tables.
