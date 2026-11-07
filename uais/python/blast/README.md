# Blast Motion ingestion

Blast is on one individual subscription, so every swing in the team-portal export says
"Bobby Wahl". Who actually swung comes from the **sensor serial + swing time** and the
hitting coach's sensor assignments in the coach portal (**Coach → Blast**, `/coach/blast`).

```
coach portal /coach/blast                       nightly
"664 is on John Smith" ──► blast_assignments     All_swings_by_player_*.csv ──► blast_swings
                                   └──────── attribution (sensor + time) ────────┘
```

## Setup (once)
1. `npm run blast:setup` — creates the `hitting_intel` schema (`uais/sql/create_hitting_intel_schema.sql`). Additive, safe to re-run. Try it on a Neon branch first.
2. In the coach portal → Blast → **Manage sensors**: add each sensor's serial (from the Blast app / the CSV's `sensorserialnumber`) and the number the coach uses. Sensors also auto-register from the CSV (label = last 3 digits).
3. On the ThinkPad, sign in to the team portal once as Bobby:
   `uais\venv\Scripts\python.exe uais\python\blast\blast_pull.py --login` (Playwright/Chromium are already in the venv for TrackMan).
4. Test the pull with a window: `... blast_pull.py --headed --from 2026-11-03 --to 2026-11-04`. If a step misses, the screenshot and the frame/control list are in `blast_out/debug/`; `--probe` stops before the export.
5. Task Scheduler: `uais\python\blast\run_nightly.bat` daily (an hour the ThinkPad is awake). It pulls yesterday..today, then loads.

## Pull (`blast_pull.py`)
- team.winreality.com → Insights (Amazon QuickSight, searched in the page and its iframes) → "All Swings (non events)" → Controls → Swing Timestamp between → "All swings by player" → ⋮ → Export to CSV.
- Saves to `blast_out/` (+ `blast_out/archive/`), one line per run in `blast_out/blast_pull_log.jsonl` (rows, UTC swing span, players, sensors, whether the date filter was typed/calendar/not set).
- The date filter leaks (asked Nov 3–4, got Oct 30–Nov 5 in the demo); harmless, the loader keeps every swing once.
- Sign-in kept in `.blast_profile/`; expired → `blast_out/NEEDS_LOGIN.txt`, exit 3, re-run `--login`.

## Daily use (hitting coach)
- Hitter picks up a bat → tap the sensor → pick the hitter (search covers the whole database; hitters with Blast / hitting 3D / screen data come first; **+ New player** adds someone who isn't in it).
- Next hitter on the same bat → tap the sensor again → pick them. No need to end the first one.
- The assignment ends on its own when nobody swings that sensor for **20 min** (`hitting_intel.blast_idle_minutes()`; the sensor sleeps) and at midnight. After a break, assign again.
- Wrong hitter? **Today → Wrong hitter** fixes it; swings move on the next nightly run.
- **Don't** switch players in the Blast app: it's ignored, and everything stays on one account.

## Loader
```
python uais/python/blast/load_blast_csv.py --dir blast_out --move-loaded   # new files (then filed in blast_out/loaded/) + re-attribute last 14 days
python uais/python/blast/load_blast_csv.py --file <export.csv> --dry-run
python uais/python/blast/load_blast_csv.py --reattribute --since 2026-11-01
python uais/python/blast/load_blast_csv.py --report                    # swings with no hitter
python uais/python/blast/load_blast_csv.py --manual 664 "2026-11-04 15:10" "2026-11-04 15:40" <athlete_uuid>
```
- Upserts on Blast's `captureid`; re-downloads update metrics but never attribution. A file with a sha256 that was already loaded is skipped (`--force` to reload).
- Timestamps in the export are **UTC** (checked: all 390 sample swings fall in the 1–9 PM Eastern window only when read as UTC). `local_date` is the Eastern date.
- On Plane Efficiency comes as a 0–1 fraction under a "%" header → stored as a percent.

## Attribution (`attribution.py`)
| status | meaning |
|---|---|
| `assigned` | inside a coach assignment |
| `grace` | ≤ 2 min before an assignment started (late tap / clock skew) |
| `stale` | after a > 20 min gap in an open assignment — sensor slept; held, not guessed |
| `unassigned` | no assignment covers it |
| `manual` | set with `--manual`; never recomputed |
| `hittrax`, `conflict` | reserved for the HitTrax cross-check |

## Tests
`cd uais && python -m unittest python.blast.tests.test_blast -v`
(add `BLAST_DATABASE_URL=<throwaway db / Neon branch>` to run the end-to-end load test).
