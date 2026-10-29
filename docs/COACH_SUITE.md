# Coach suite (`/coach`)

A coach-facing view of everything we have on an athlete, separate from the
backend dashboard. Coaches never see UAIS, AI Lab, Settings or payload tools.

## Who can open it

Clerk `publicMetadata.role`:

| Role    | /coach | /dashboard                         |
|---------|--------|------------------------------------|
| `coach` | yes    | redirected to /coach               |
| `admin` | yes    | yes (nav has **Coach View**)       |
| other   | no     | as before                          |

To make someone a coach: Clerk dashboard → Users → the user → Metadata →
Public → `{ "role": "coach" }`.

Every coach can see every athlete today. All coach API routes go through
`lib/coach/access.ts` (`requireCoach`, `requireCoachForAthlete`); to add
rosters later, change `canViewAthlete` there only.

Coach accounts are blocked from the staff write routes that only checked
sign-in (`PATCH /api/dashboard/athletes/:uuid`, `POST /api/dashboard/audit/fix-*`)
via `denyRoles(["coach"])`. Other `/api/dashboard/*` reads still only need a
sign-in, same as before.

## Flow

Single athlete is the default; comparing is opt-in.

- The header always has an athlete switcher (search) and an **All athletes** link.
- `/coach` opens the last athlete this browser viewed (kept in localStorage). With nothing remembered, or via **All athletes** (`/coach?browse=1`), it shows search, recently viewed and recently updated athletes.
- `/coach/athletes/[uuid]?tab=…`: header (demographics, data-on-file chips with recency) and tabs
  - **Overview**: readiness, latest fastball velo + 12-month peak, arsenal grade, last 3D capture, highlights/lowlights, current arsenal + velo trend, data on file
  - **Pitching**: Arsenal (movement plot + per-type table, pick any Savant season / Trackman session / report, optionally overlay another), Savant games, Trackman & reports, Velocity, Full dashboard (Ryan's app embedded)
  - **Biomechanics**: pitching 3D, hitting 3D, arm action
  - **Athletic Screen**: the screen report (like the PDF) or the metrics explorer
  - **Mobility**: grouped mobility scores with session / athlete comparison
  - **Pro/Sup**: report (like the pro-sup PDF) + test history
  - **Curveball**: only shown when the athlete has curveball tests
  - **Readiness**: the Readiness Screen dashboard
  - **Proteus**
  - Tabs with no data are hidden (a ?tab= link to one of them falls back to Overview).
- **Compare** in the athlete header defaults to the active tab. Search offers athletes with actual data in that area; adding one keeps the current tab open and displays the area comparison. Up to three comparison athletes are stored separately per tab (`?vs_pitching=a,b&vs_biomechanics=c`, etc.). **Apply to all comparisons** shares the current selection via `?vs=a,b,c`. Each tab then displays only eligible athletes and loads its own comparison payload. **Use only this tab** returns to an independent selection. An **All comparisons** tab offers the full snapshot, arsenal, assessment radar/tables, readiness, Pro/Sup and curveball comparisons. Existing `/coach/compare?ids=` and `?tab=compare&vs=` links remain supported.
- Within Biomechanics / Assessments / Proteus each domain still has its own optional "Compare sessions" / "Compare another athlete" toggles (off by default). Their athlete picker requires data in that exact domain, and dated/other-athlete requests build only that domain.

Metrics explorer sections in Biomechanics put the pitching diagram in a narrow column on the left with the title and metrics table beside it (desktop layout; the change is in the shared `GenericDomain`).

Biomechanics, Athletic Screen and Proteus reuse the Athlete Tracking domain
components (`app/dashboard/athlete-tracking/components/*`) through
`app/coach/_components/DomainWorkspace.tsx`, so session and athlete comparisons
work as they did on the old page.

## Live reports

Both reports are built from the warehouse and reused briefly, so new captures and screens show up without regenerating a PDF. Use **Refresh data** to bypass the recent athlete-response caches. Each has a capture/screen date picker (latest by default) and a **Metrics explorer** toggle back to the percentile tables.

### Pitching report (Biomechanics tab)

Same read and look as the `biomech-pitching-breakdown` PDF (black + powder blue): cover with mean fastball and overall percentile, release-phase cut/ride cells, 8-axis cohort radar, The Read, throw-by-throw velocity, the 8 cylinder cards, ~28 underlying metrics, What's Working / Where Velocity Is Leaking, Recommendations and Bottom Line.

- `lib/coach/biomech/extract.ts`: port of the skill's `extract_metrics.py` (v12/v13) over `f_pitching_trials.metrics` (keys `FOLDER.Variable.Component`), plus the force-plate layer from `f_pitching_force_metrics`. Checked against the skill's script on `sample-data/session_data.xml`: all 23 compared metrics and every flag match.
- `lib/coach/biomech/framework.ts`: bands from `benchmarks.md` / `cylinders.md`, cylinder percentiles, archetypes, and the written read. The skill has Claude write the narrative; here it's rule-based with the skill's vocabulary (no "trunk dump", no towel drills, arm-early = timing).
- Percentiles: each pitcher's latest capture in the warehouse (prepared in a persistent population snapshot). Recipe per `percentile_computation.md`, remapped to the v12 cylinder numbering.
- Cyl 4 force: the Visual3D export the R pipeline stores skips `AT_EVENT`, so `Lead GRF_BW@Release` isn't in the warehouse. The card uses the force-plate peak vertical GRF and "peaks before MER" instead, when that layer exists.

### Athletic screen report (Athletic Screen tab)

Same pages as `uais/python/athleticScreen/pdf_report.py` (DJ, CMJ, PPU, SLV): histograms with mean/max lines, F–V scatter, Force/Velocity @ peak power rings, 6-axis radar with the kurtosis-deviation transform, power curve with the 10–90% rise, and the Max RPD / Kurtosis / Work tier table.

- `lib/coach/athleticScreen/compute.ts`: the PDF math ported to TS (scipy `percentileofscore(kind="rank")`, numpy histogram bins, `format_sigfig`, tiers, ideal ranges). Checked against `pdf_report.py` on the same data: every percentile, radar value, tier, histogram count and formatted number matches. Keep `KURTOSIS_IDEAL_RANGE` / `ELITE_*_REFERENCE` in step with the Python.
- Population: everyone who did the movement; female athletes vs females only (same as `query_population_data`). Prepared in persistent population snapshots. The F–V scatter shows at most 900 population points.
- Power curves come from `f_athletic_screen_power_curve`. Screens processed before that table existed show "No stored power curve" instead of the PDF's synthetic curve.

### Pro/Sup report (Pro/Sup tab)

Same card layout as the pro-sup PDF (`uais/python/proSupTest/main.py`, `generate_report_from_postgres`): score with percentile ring, then 0–10 / 10–20 / 20–30 s cards with cumulative ROM, fatigue index, forearm ROM, the three-bar ROM chart and a percentile ring. Percentiles = pandas `rank(pct=True)` over every `f_pro_sup` row, same as the PDF (checked against pandas, ties included). Built in `lib/coach/proSup.ts`; the history chart and table sit underneath.

## API (`/api/coach/*`, read-only, role coach|admin)

| Route | Source |
|---|---|
| `GET /athletes?q=&limit=&scope=&domain=` | `d_athletes` |
| `GET /athletes/:uuid/summary` | `lib/coach/summary.ts` |
| `GET /athletes/:uuid/tracking?domains=pitching,hitting&{domain}Date=` | `buildAthleteTrackingReport` |
| `GET /athletes/:uuid/pitching` | `lib/coach/pitching.ts` (Savant seasons/games/velo + `getAthleteSessions`) |
| `GET /athletes/:uuid/readiness` | `buildReadinessPayload` |
| `GET /athletes/:uuid/assessments?kind=prosup|curveball` | pro-sup + curveball history |
| `GET /athletes/:uuid/biomech-report?date=` | `lib/coach/biomech/report.ts` |
| `GET /athletes/:uuid/athletic-screen-report?date=` | `lib/coach/athleticScreen/report.ts` |
| `GET /athletes/:uuid/pro-sup-report?date=` | `lib/coach/proSup.ts` |

Pitch conventions match `lib/pitch-intel/sessions.ts`: HB arm-side positive
(inches), IVB inches, whiff% per swing (foul tips are swings, not whiffs),
Savant seasons graded with xArsenal at 10+ pitches per type, Trackman sessions
at 5+. Savant VAA is computed from release kinematics at the front of the plate.

## Trackman

Trackman rows land in `pitch_intel.trackman_pitches` through Pitch Intelligence
→ Upload. The coach Pitching tab, velocity trend and Overview pick them up with
no extra work.

## Not here yet

- Hitting-side Trackman / batted-ball data
- Rosters per coach
- The old `/dashboard/athlete-tracking` page still exists (removed from the nav); delete it once the coach view has replaced it

## Pitch report & trends (2026-10-14)

Pitching tab views: **Pitch report** (default) · Arsenal · Games · Trackman & reports · **Trends** · **Savant dashboard**.

- **Pitch report** (`app/coach/_components/pitchReport.tsx`): the TrackMan portal's "Pitching Player" layout on our own
  pitch-by-pitch data, Trackman (portal + CSV) and Savant together. Rows: Release (table · velo vs spin · release
  position), Movement (table · breaks · spin-direction clock), Location (table · strike zone · approach angle), then a
  pitch log. Scope: one session/game (default newest) or a range (30/90 days, season, all, custom; bullpens/games).
  Click a pitch anywhere to select it (detail strip with deltas vs its type average, ← / → to step, Esc clears); click
  a pitch type (table row or average diamond) to show only it. Strike zone: pitcher's or catcher's view, colored by
  type or (games) result.
- **Trends** (`metricTrends.tsx`): one chart per metric (velo, max velo, spin, IVB, HB, extension, release height/side,
  VAA, HAA, spin efficiency, gyro), one line per pitch type, one point per day; filter types, bullpens/games, range.
  Lines break across gaps > 45 days.
- **Savant dashboard**: Ryan's Pitch Intelligence app, unchanged; labeled as Savant-only (it does not read Trackman).
- Data: `lib/coach/pitchLog.ts`, `GET /api/coach/athletes/:uuid/pitches` (`?session=` or `?from&to&kinds`),
  `/pitches/sessions`, `/pitches/trends`. Side measures are from the pitcher's view (+ = pitcher's right, TrackMan's
  convention; Savant's catcher-view values are negated); movement is arm side positive. Savant VAA/HAA are computed
  from release kinematics at the front of the plate.


## Coach loading and caching

- The browser reuses successful API responses for **60 seconds** and shares concurrent requests for the same URL. SWR keeps the displayed data available while revalidating. The response cache retains at most 100 entries / 16 MiB.
- Browser payloads live in memory only. The cache and SWR provider are recreated on sign-out/account changes; no assessment or pitch payloads are written to localStorage. Reloading the browser starts a new browser cache.
- After the overview's tracking, pitching and readiness requests finish, other available tabs warm silently with **two background workers**. This includes reports, mobility, assessment histories, pitch trends, the pitch-session list, and the latest session's pitch log. Tracking already contains the Proteus, hitting and arm-action explorers.
- Warming skips unavailable tabs, stops scheduling on athlete navigation/hidden pages, and skips data-saving / 2G connections. Historical dates, other comparison athletes, arbitrary pitch ranges and the embedded Savant app load on demand.
- Heavy tab components use dynamic imports so the initial athlete page downloads less JavaScript. Biomechanics is loaded with the athlete page to keep the PDF report's styles available on navigation; its data still loads through the cached fetcher.
- Coach API results are cached for **60 seconds per server process**, bounded to 250 entries / 32 MiB. Simultaneous requests share the same report build. Every request still runs the role and athlete-access checks before reading cached data. Dates/filters are included in cache keys. This is not shared between separate servers and resets on restart.
- **Refresh data** bypasses both response caches for the athlete's default views and already-loaded historical selections. Comparison populations refresh in the background after data changes; this button refreshes athlete responses rather than running expensive population builds. Athlete data does not continuously poll; published population generations trigger revalidation, and switching tabs/revisiting or refreshing also revalidates. Browser and server cache lifetimes can overlap, so a regular refetch can receive a response approaching two minutes old.
- Independent Savant game/velocity queries now run alongside Trackman session loading.
- Header/session-picker dates use one SQL UNION query, returning unique dates from PostgreSQL instead of transferring biomechanics frame rows for Prisma to deduplicate in memory.

Validation: `npm run test:coach-performance` exercises TTLs, concurrent request deduplication, failure retries, memory bounds, refresh races, account isolation, and background concurrency/cancellation. `tsc --noEmit` verifies the application types.

## Background percentile populations

Comparison populations are now stored as JSONB in `public.coach_population_snapshots`. Page requests read the last completed snapshot and perform the inexpensive percentile rank calculation against it. The expensive population builders run only in a background worker. Existing sample limits, cohort selection, latest-session rules and tie/orientation conventions are preserved. Pro/Sup reads only the selected athlete's history on page loads; its comparison scores come from the snapshot.

### Changes that queue a refresh

The migration installs PostgreSQL **statement-level** triggers on the affected tracking/report source tables. INSERT, UPDATE, DELETE and TRUNCATE enqueue only the dependent population keys. Athlete inserts/deletions and demographic changes (gender, DOB, age/group, height, weight) also invalidate dependent populations. Flag/sync timestamp updates alone do not invalidate every group.

The trigger writes the dirty revision in the same transaction as the source change, so failed imports do not leave refresh jobs. It waits for a **30-second quiet period** before rebuilding, combining multiple committed import chunks into one refresh. This also works for direct SQL, Python and R writes without adding callbacks to every importer. An import with a longer pause can cause an intermediate refresh; later writes remain queued for another pass.

### Worker and cache behavior

- The persistent Node/Railway server starts a worker from `instrumentation.ts`, checks for jobs every five seconds and builds one population at a time. Generic per-athlete builders run in batches of four to limit database pressure.
- Successful payload publication is atomic. A failed build retains the previous payload and retries with backoff. Leases, heartbeats and ownership tokens protect against concurrent or crashed workers; writes arriving during a build remain pending.
- Snapshots survive restarts and are shared by all server instances. A daily age check rebuilds old snapshots as a fallback for missed events or changed calculation code.
- Coach pages poll a protected generation/status endpoint every 15 seconds. Published generations clear browser caches and revalidate mounted athlete views while keeping displayed data available. Generation headers also clear old population/response reads on another server instance.
- The UI shows a short preparation/update message during refreshes. Before the first backfill, athlete measurements remain available with comparison percentiles unavailable; page requests never rebuild entire populations.

### Setup and operations

The additive, transactional migration is `prisma/migrations/20261014000000_coach_population_snapshots/migration.sql`; the Prisma schema includes the snapshot table. For an existing database:

```sh
npm run populations:setup
npm run populations:refresh
```

Setup is idempotent and does not rewrite source athlete tables. Refresh drains queued work once. Restart an already-running development server after adding the worker; production servers start it normally on deployment. Deploy the migration before the new application code on any other database.

A scheduler can also POST to `/api/biomech/percentiles/refresh` with the existing `X-API-Key` / `BIOMECH_API_KEYS` authentication. This drains pending jobs and performs the daily age fallback; it does not force unchanged populations to rebuild on each scheduler call. It can replace the in-process worker on platforms that do not keep Node running continuously.

Validation:

```sh
npm run test:coach-performance
npm run test:populations
npm run test:populations:db
npx tsc --noEmit
```

The PostgreSQL integration test creates an isolated schema inside a transaction and rolls it back. It exercises migration idempotence, bulk-write coalescing, import rollback, updates/deletions/demographics, lease ownership, concurrent writes, failure retention and recovery. The unit suite also uses Next's production SWC transform to catch dynamic-import compiler errors that TypeScript does not detect.


## Comparison filtering and loading

Picker filters run in SQL before search pagination, using indexed EXISTS checks against real session tables. Pitching means Savant/Trackman pitches or saved pitch reports; it does not mean the `has_pitching_data` 3D flag or an empty Savant link. Biomechanics means pitching 3D, hitting 3D or arm action. Athletic Screen accepts CMJ, DJ, PPU or SLV sessions, including athletes with only one of those movements. Optional pitch-intel tables are detected so fresh warehouses still support the other pickers.

The main header uses tab filters; the metrics explorer additionally uses an exact `domain` filter. Athlete switching/browsing remains unfiltered. Shared comparison selections retain their identities across tabs, but missing-area athletes are omitted from each area's comparison. Editing a partially eligible shared selection creates a local override, so unrelated tabs keep their selection. Historical comparisons build only the requested domains; Pro/Sup and curveball comparisons fetch only their respective histories. The originally selected athlete's background tab warming remains enabled.

Validation: `npm run test:coach-comparison` checks independent/shared/legacy URL selections, eligibility and payload/domain isolation. `npm run test:coach-comparison:db` verifies real SQL filters, stale flags, DJ-only screens, pagination and literal search characters inside an isolated rolled-back PostgreSQL schema.

## Data download (Oct 2026)

"Download data" under the Compare button on an athlete's header opens
`/coach/athletes/[uuid]/download`. One column per data type the athlete has
(Pitching · TrackMan, Pitching · Savant, Biomechanics, Athletic screen, Mobility,
Proteus, Other assessments), one checkbox per session date; a column header
selects every date. "Download all" or "Download selected" returns a ZIP with a
README and one CSV per table (JSON columns split into `raw.*` / `metrics.*` /
`raw_extra.*`). Raw 3D time series (marker / segment / force-plate JSON) are
opt-in via a switch.

- API: `GET /api/coach/athletes/:uuid/export` (listing) and `POST` (ZIP), both
  behind `requireCoachForAthlete`.
- What's exportable lives in `lib/coach/export/registry.ts` (table, date column,
  file name, listing group). Add a table there and it appears on the page.
  Table/column names only come from the registry; the request only carries
  category ids and YYYY-MM-DD dates, both validated.
- ZIP writer and CSV builder are dependency-free (`lib/coach/export/zip.ts`, `csv.ts`).

## Client Hub

The second section of the coach view (header toggle: Athlete Data / Client Hub) and the athlete-page **Program Management** tab. See `docs/CLIENT_HUB.md`.
