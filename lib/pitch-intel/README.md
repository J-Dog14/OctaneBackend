# Pitch Intelligence (Baseball Savant, Trackman, report screenshots)

Pulls Baseball Savant pitch-by-pitch data for linked athletes into the
`pitch_intel` schema, one row per pitch, and re-pulls nightly. Trackman files,
hand-downloaded Savant CSVs and report screenshots come in through the upload
page (see Uploads below). Ported from
Ryan Chasse's Pitch Intelligence app (`rnchasse8/8ctane-pitch-intelligence`).
Column names match Savant's CSV so his parser can run on stored rows.

Self-contained: everything lives under `lib/pitch-intel/`, `scripts/pitch-intel/`,
`app/dashboard/pitch-intel/`, `app/api/dashboard/pitch-intel/`,
`app/api/biomech/pitch-intel/` and `uais/sql/create_pitch_intel_schema.sql`.
The only edits to existing files are one nav entry (`DashboardNav.tsx`) and the
`pi:*` scripts in `package.json`. No new dependencies.

## One-time setup

1. **Create the schema** (Neon branch first, then the warehouse):

   ```
   psql "$DATABASE_URL" -f uais/sql/create_pitch_intel_schema.sql
   ```

   Re-runnable. Roll back with `DROP SCHEMA pitch_intel CASCADE;`.

2. **Nightly trigger.** Add a Railway cron service that runs once a day:

   - Image: any image with curl (e.g. `curlimages/curl`)
   - Cron schedule: `0 10 * * *` (UTC; 6 AM Eastern in summer, 5 AM in winter)
   - Start command:
     `curl -fsS --max-time 900 -X POST -H "X-API-Key: <key>" https://<backend-domain>/api/biomech/pitch-intel/nightly`
   - `<key>` must be one of the values in the web service's `BIOMECH_API_KEYS`.

   The main web service's config does not change.

## Linking an athlete

Dashboard: **Pitch Intelligence → Link athlete** (admin), or `npm run pi:link`.

1. Search Savant by name (or paste an MLB ID / Savant player URL) and pick the player.
2. Pick the matching athlete from the closest names in `d_athletes` (typo-tolerant).
3. Confirm. Throws comes from Savant. The current and previous two seasons are
   pulled right away, then the nightly run keeps them current.

The athlete must already exist in `d_athletes`; this module never creates athletes.

## Commands

Run from the repo root (uses `.env`). `tsx` is fetched by `npx` on first use.

| Command | What it does |
| --- | --- |
| `npm run pi:link -- [--name "Jacob Webb"] [--from-season 2024] [--no-backfill]` | Link flow in the terminal, then backfill |
| `npm run pi:pull -- --athlete "Webb" [--season 2026 \| --from 2026-04-01 --to 2026-04-30] [--dry-run]` | Pull one athlete now |
| `npm run pi:backfill -- --athlete "Webb" --from-season 2021` | Pull whole seasons |
| `npm run pi:import -- --athlete "Webb" --file savant.csv` | Save a CSV downloaded by hand |
| `npm run pi:check -- --athlete "Webb" [--season 2026]` | Fetch and check without saving; pitches per game and pitch-type shapes |
| `npm run pi:nightly -- [--dry-run]` | Run the nightly job by hand |
| `npm run pi:unlink -- --athlete "Webb"` | Stop nightly pulls (data kept) |
| `npm run pi:list` / `npm run pi:runs` | Linked athletes / recent pulls |

`--athlete` accepts an athlete name (partial), athlete uuid or MLB ID.

## How a pull works

1. Download the CSV for one MLB ID and date range from both Savant searches
   (MLB and minor league: AAA 2023+, FSL 2021+), with no other filters.
2. Check it (`checks.ts`). Fatal (nothing saved): wrong pitcher, missing key
   columns, row cap on a hand CSV. Flagged (saved, shown on the dashboard):
   takes outside 40–60%, pitch shapes that contradict the tag, missing feature
   columns, minor-league download unavailable.
3. Upsert on (`game_pk`, `at_bat_number`, `pitch_number`), so re-pulls overwrite
   Statcast's corrections instead of duplicating. Unknown new CSV columns go to
   `raw_extra`.
4. Log the run in `pitch_intel.pull_runs`.

Nightly window per athlete: last game date minus 7 days through today. Settings
live in `config.ts`.

## The dashboard (Ryan's report)

**Pitch Intelligence → Dashboard** on an athlete's row, or `/dashboard/pitch-intel/report?athlete=<uuid>`.

This is Ryan's dashboard itself (`public/pitch-intel-app/`, copied unchanged from
his repo), embedded in the tab. His page gets its data from one function that
calls his Google Sheet backend; here it calls `/api/dashboard/pitch-intel/legacy`
instead (`lib/pitch-intel/legacy/adapter.ts`), which answers in the same format:

- `getAthletes`: linked athletes (Savant and/or Trackman)
- `getOutings`: outings built by **his own parsers**
  (`lib/pitch-intel/legacy/ryan-statcast.js`, extracted verbatim) and his Bulk
  Import → Code.gs mapping, so the numbers match his app: Savant games from
  `savant_pitches` (`parseStatcastBulk`) plus Trackman **games** from
  `trackman_pitches` (`parseTrackmanBulk` on the original file rows, with the
  reviewed pitch types). Savant wins when both have the same date. Bullpens are
  not outings; they're on the Sessions page. His Trackman path has no pitch
  locations, so Locations is empty for Trackman-only outings.
- `scoreArsenal`: graded here with **Octane's xArsenal engine**
  (`lib/pitch-intel/xarsenal/`). `octane-engine.ts` is copied verbatim from
  Octane's `services/xArsenal/scoreArsenal.ts` (benchmarks, curve, bonuses, caps,
  labels) and is server-only. `score.ts` wraps it in the request/response Ryan's
  dashboard expects (Statcast pitch codes, missing metrics dropped, estimated spin
  efficiency, importance tiers, levers, batch). Set `PITCH_INTEL_XARSENAL_URL` to
  use Ryan's Worker instead. After changing benchmarks in Octane, run
  `node scripts/pitch-intel/sync-xarsenal.mjs ../Octane`.
- `analyze` (Season / Outing Insight): Claude, same request as his Code.gs, when
  `ANTHROPIC_API_KEY` is set (optional `PITCH_INTEL_AI_MODEL`, default `claude-sonnet-4-5`)
- writes (add athlete, add/delete outing, bulk import): refused, and hidden by
  `pi-embed.css`

**Updating when Ryan ships changes:** clone or pull his repo, then

```
node scripts/pitch-intel/sync-ryan-dashboard.mjs ../8ctane-pitch-intelligence
```

That re-copies his files (adding only the two `pi-embed` lines to `athletes.html`)
and re-extracts his parser. Don't edit `public/pitch-intel-app/` or
`ryan-statcast.js` by hand.

Like Ryan's app, outings are one per game date (a doubleheader's second game is
dropped) and spring-training games are included.

## Uploads (Trackman, Savant CSVs, screenshots)

**Pitch Intelligence → Upload data** (admin), `/dashboard/pitch-intel/upload`.
Drop a file, choose one, or paste a screenshot. Nothing is saved until you review it.

- **Trackman export (CSV or XLSX).** Detected from its columns. Pitches the file
  didn't tag are auto-tagged per pitcher per date (`trackman/classify.ts`); every
  pitch can be changed before saving, one at a time or "change all X to Y".
  Each session is marked Game or Bullpen (games are detected from PitchCall /
  GameID; you can switch it). Each Trackman pitcher is linked to an athlete once
  (pick from the closest names, plus a level for grading); later files match
  automatically. Upserts on PitchUID (or PlayID), so re-uploading a file
  updates it. Stored in `pitch_intel.trackman_pitches` with the original row in
  `raw`. HB is stored as Trackman gives it (positive = pitcher's right); views
  show it arm-side positive.
- **Baseball Savant pitch-by-pitch CSV.** Same checks and storage as the nightly
  pull. The player must already be linked.
- **Screenshots / PDFs** (Trackman summaries, Savant or scouting pages, CLAW,
  Rapsodo). Read by Claude (`reports/vision.ts`; needs `ANTHROPIC_API_KEY`,
  optional `PITCH_INTEL_VISION_MODEL`) into per-pitch-type averages, which you
  check and edit next to the image. HB is converted to arm-side positive using
  the source's convention; rows where the direction is unclear must be filled in
  before saving. psStuff+ / Stuff+ is never read. Stored in
  `aggregate_reports` + `aggregate_pitch_rows` (the image itself is not kept).

Every save is logged in `pitch_intel.uploads`.

**Sessions page** (`/dashboard/pitch-intel/sessions?athlete=<uuid>`): Trackman
games and bullpens and saved screenshot reports, with per-pitch-type averages
and xArsenal grades. A pitch type needs 5+ pitches in a session to be graded;
whiff% (per swing) is marked when it rests on fewer than 30 swings.

After pulling this change, run `npm run pi:setup` once to add the new tables.

