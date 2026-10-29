# Athletic Screen v2 — rebuild from c3d

Replaces Visual3D's power calculation. Python reads FP3 straight from each trial's c3d.

**Why:** V3D integrated velocity forward from frame 1 with v0 = 0 and the typed-in mass. QTM trials are often cropped (drop jump always is), so the athlete is already moving at frame 1. The result was that every stored power value was wrong. JH, CT and RSI were fine.

## Method (`kinetics.py`)

1. Find flight: the longest stretch under 20 N that comes after a real contact.
   - JH = g·t²/8, the same method as V3D.
   - Takeoff velocity = g·t/2.
2. Zero the plate using the median force during flight.
3. Body weight, in order of preference:
   1. the trial's own quiet window
   2. the session's quiet BW (median of the CMJ/SLV quiet windows)
   3. the mass from session.xml
   - PPU uses its own plank window, otherwise the first 50 ms of contact.
4. Integrate velocity **backward from takeoff**. This gives a correct v/P for the whole contact, cropped or not, DJ included.
5. Compute:
   - concentric start (last v ≤ 0)
   - force, RFD, power, RPD and 10–90 metrics
   - eccentric metrics, only when the trial starts with quiet stance
   - DJ CT/RSI
   - curve shape (both kurtosis definitions) over fixed windows: concentric power, concentric Fz, and whole-contact Fz
6. QC:
   - `v_quiet_resid_m_s` should be about 0 for trials that start quiet
   - DJ `implied_drop_cm` should match the box
   - `qc_flags` holds the rest

Sample rate is read from each file (the c3d analog rate is 900 Hz).

## Ingest (what the Ingest button runs)

`main.py` (the athletic-screen runner) now routes every non-report run to `v2/ingest.py`. The legacy
Visual3D → Output Files → `f_athletic_screen_*` writer is disabled; `process_txt_files` raises if anything calls it.

- **Data dir:** Settings → `uais_data_dir_athletic_screen` = `D:\Athletic Screen 2.0\Data`. Pointing it at
  Output Files makes the run stop with an explanation.
- **What gets ingested:** every Athletic Screen session folder not yet in the v2 tables. With an athlete
  selected, only that athlete's folders. If none are new, you're asked whether to re-ingest the latest one.
  An upload/agent temp dir with c3d and session.xml at its root also works.
- **Per athlete, in one transaction:**
  1. Resolve the athlete: the selected one (name guard), else the uuid already in v2 for that folder, else
     `get_or_create_athlete`. The last one prints the NEW_ATHLETE / MISSING_DOB signals the UI listens for.
  2. Fill missing DOB/email/gender from session.xml.
  3. Set age and age group.
  4. Replace that session's v2 rows and curves.
  5. Readiness baseline cross-insert for CMJ/PPU (v2 values). It never overwrites a row that came from a
     real readiness session.
  6. Set the has_athletic_screen_data flag.
- Emails are also refreshed from already-ingested sessions, without reprocessing c3d. All session
  emails are considered, so an empty first session does not hide a later address. Existing profile
  emails are preserved; conflicting addresses go to email review.
- **After all athletes:** duplicate-athlete check.
- **Not generated yet:** the PDF report. Report-only and comparison runs still use the legacy report code.
- One-time setup: `patch_flag_functions.py --apply` (adds the v2 tables to the d_athletes flag functions and
  triggers). The athlete merge lists in `common/athlete_manager.py` and `common/athlete_cleanup.py` now
  include the v2 tables, so merges move v2 rows instead of cascade-deleting them.

```
python uais/python/athleticScreen/v2/ingest.py --dry-run       # what would be ingested (read-only)
python uais/python/athleticScreen/v2/ingest.py --offline       # processing check, no database
```

## Backfill run

```
# Phase A - no DB. Needs ezc3d (pip install ezc3d). Writes tmp/screen_v2/
python uais/python/athleticScreen/v2/scan_sessions.py --data "D:/Athletic Screen 2.0/Data" --box-height-cm <box>
#   check tmp/screen_v2/qc_report.md and errors.csv

# Phase B - match athletes, dry run first
python uais/python/athleticScreen/v2/load_v2.py
#   resolve tmp/screen_v2/match_review.csv -> tmp/screen_v2/match_overrides.csv (athlete_folder,athlete_uuid)
python uais/python/athleticScreen/v2/load_v2.py --apply

# Phase C - compare with the old tables (read-only)
python uais/python/athleticScreen/v2/validate_v2.py
```

The bulk loader writes `public.f_athletic_screen_v2_{cmj,dj,ppu,slv}` and
`public.f_athletic_screen_v2_force_curve`, and fills missing `d_athletes.email` for confidently
matched athletes. It preserves existing addresses and skips conflicting emails. The old tables and
the App DB are never touched. The DDL is in `uais/sql/create_athletic_screen_v2_tables.sql`, generated from `schema.py`.

To repair historical missing emails using the existing v2 session links (no name matching or merges):

```
python uais/python/athleticScreen/v2/backfill_emails.py          # read-only preview
python uais/python/athleticScreen/v2/backfill_emails.py --apply  # fill blanks only
```

Column name changes vs. the old tables:

| old | new |
|---|---|
| `pp_forceplate` | `peak_power_w` |
| `vel_at_pp` (mm/s) | `vel_at_pp_m_s` |
| `force_at_pp` | `force_at_pp_n` |
| `ct` | `ct_s` |

Old `rsi` was 2 × JH/CT. The standard JH/CT is now `rsi`; the old value is kept as `rsi_legacy`.
