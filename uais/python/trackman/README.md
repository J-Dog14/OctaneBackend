# TrackMan Team Portal pulls

Pulls per-pitch data from the TrackMan Team Portal (B1 / portable practice
sessions) and stores it next to the Savant and uploaded-Trackman data in
`pitch_intel`. Runs on a PC with a browser, by hand or on a local schedule,
because the portal needs an interactive sign-in. Not part of the Railway app.

## One-time setup

```
pip install playwright
playwright install chromium
npm run pi:setup                                   # adds trackman_players / trackman_sessions
python uais/python/trackman/trackman_pull.py --login   # sign in, then press Enter in the terminal
```

The sign-in lives in `.trackman_profile/` (a browser profile). Pull output goes to
`trackman_out/`. Both hold athlete names and birth dates: keep them out of git
(they're in `.gitignore`).

## Unattended: nightly + backfill

`run_trackman.py` wraps pull + load, runs the browser with no window, keeps the PC
awake while it works, logs to `trackman_out/logs/`, and remembers progress in
`trackman_out/state.json`.

```
uais\venv\Scripts\python.exe uais\python\trackman\run_trackman.py backfill --year 2025   # month by month, newest first, resumable
uais\venv\Scripts\python.exe uais\python\trackman\run_trackman.py nightly       # everything since the last good run
uais\venv\Scripts\python.exe uais\python\trackman\run_trackman.py status
uais\venv\Scripts\python.exe uais\python\trackman\run_trackman.py login         # when a run says the sign-in expired
```

Windows Task Scheduler (paths are worked out from the script's own location, so this
runs from any folder):

```
$s = "C:\Users\Joey\PycharmProjects\OctaneBiomechBackend\uais\python\trackman\setup_trackman_task.ps1"
powershell -ExecutionPolicy Bypass -File $s -Year 2026     # backfill one year in the background (re-run to resume)
powershell -ExecutionPolicy Bypass -File $s -Year 2025     # then the next year back
powershell -ExecutionPolicy Bypass -File $s -Year 2026 -Rescan   # walk finished months again (only pitchers not yet pulled)
powershell -ExecutionPolicy Bypass -File $s -Nightly       # "UAIS TrackMan Nightly", 3:15 AM
```

The tasks run while you're signed in to Windows (a locked screen is fine) and wake
the PC from sleep to start ("Allow wake timers" must be on in Power Options). They
can't run "signed out" like Proteus: the TrackMan sign-in is the browser's saved
cookies, which Windows only unlocks for a signed-in user. Nightly and backfill share
the browser profile, so one waits (exit code 3) while the other runs; the nightly
window stretches back to the last good run, so nothing is skipped.

Exit codes: 0 ok, 2 sign-in expired (`trackman_out/NEEDS_LOGIN.txt`), 3 another run
has the browser, 4 partial (retried next run), 5 load failed (pull kept, loads next run).

## Every pull (by hand)

```
python uais/python/trackman/trackman_pull.py --from 2026-10-01 --to 2026-10-14
python uais/python/trackman/load_trackman_pull.py --dir trackman_out --dry-run   # who matches, who gets created
python uais/python/trackman/load_trackman_pull.py --dir trackman_out
python uais/python/trackman/load_trackman_pull.py --report                       # anything that needs a look
```

The pull is resumable: `done.json` remembers each finished session x player.

**First time, run `--probe` instead** (one player from the newest session). It
saves `trackman_out/probe/table.png`, `table.json` (the table headers, how they
were mapped and the first rows) and `pitches.json`. If the row count, the
mapping or the first row look wrong, the selectors need adjusting before a full
pull.

## Where the data comes from

| Data | Source |
| --- | --- |
| Sessions, players in each session (ID, DOB, jersey, team) | the portal's own `/api/sessions` JSON, captured as the page loads it |
| Roster | `/api/players` JSON (falls back to Export to .csv) |
| Pitches | Legacy report "Portable - Pitching Player" (Power BI embed): pitcher + date slicers, Live only, VELO VS. SPIN → Show as a table |

Per pitch: pitch type, velo, spin, release height/side, extension, tilt,
measured tilt, gyro, spin efficiency, IVB, HB, VAA, HAA, plate location, zone,
session ID, pitch time. **No pitch calls, batters or results**: these are
practice sessions, stored as bullpens.

Known limits, all reported rather than hidden:

- The report only shows a pitcher's **top 5 pitch types**. `validation.json`
  compares pitches pulled per session against the session's Plays count. Plays
  may also count warmups, which the Live filter leaves out.
- No throwing hand in the portal. The loader infers it from release side and
  fastball horizontal break (portable TrackMan reports both from the pitcher's
  view, + = pitcher's right; checked on a known RHP export). If the two
  disagree, throws is left blank and the player shows in `--report`.
- Pitch time can be a day off the session date (time zone). Sessions are dated
  by the portal's local session date.
- A pitch uploaded from a CSV export *and* pulled from the portal is stored
  twice (different IDs). Use one route per session.

## Athletes

Every player is stored in `pitch_intel.trackman_players`, linked or not.
Players **with pitches** are matched to an athlete in this order:

1. already linked (a previous run, or `--link`)
2. an existing Trackman link (from a CSV upload)
3. MLB-ID players: an existing Savant link with that ID
4. `analytics.source_athlete_map` (trackman, player ID)
5. `athlete_manager.get_or_create_athlete` rules (exact name + DOB, then 90%
   fuzzy name), **except** when both sides have a birth date and they differ:
   then nothing is linked or created, the player is marked `conflict`, and their
   pitches are stored with no athlete until you link them:
   `load_trackman_pull.py --link <player_id> <athlete_uuid>`
6. close but under 90% (name similarity >= 80%, or same DOB and >= 60%, e.g.
   "Mike" / "Michael"): **held**, not created. Status `unmatched`, pitches
   stored with no athlete, and the note names the likely match. Decide with
   `--link <player_id> <athlete_uuid>` (same person) or
   `--create <player_id>` (different person).
7. no match: a new athlete is created in `analytics.d_athletes` with
   `source_system = 'trackman'` and `source_athlete_id = <TrackMan ID>`

Nothing is interactive (no prompts), so the pull and load can run unattended.
Fuzzy matches, held players and new athletes are listed after every load;
`--report` lists the ones still open. `--relink` re-runs matching for players
still without an athlete (e.g. after adding athletes).

A linked player gets a Trackman row in `pitch_intel.athlete_source_links`, so
the Pitch Intel Sessions page, Ryan's dashboard (games only) and the coach suite
show their pitches with no other changes. New links get a grading level from
age on the latest session date (≤14 Youth, 15–18 High School, 19–22 College;
adults left blank to set by hand).

## Tables

- `pitch_intel.trackman_players`: player_id, id_source (trackman/mlb), name,
  DOB, team, jersey, throws (+ how it was set), athlete_uuid, match_status,
  match_note
- `pitch_intel.trackman_sessions`: session GUID, type, local date, UTC time,
  radar serial, players, plays, pitches pulled
- `pitch_intel.trackman_pitches`: shared with CSV uploads; portal rows have
  `data_source = 'portal'`, `tm_session_id`, `tm_player_id`, `gyro`, `tilt`,
  `measured_tilt`, `zone_location`

## Long term

The portal's Data Integration page (Management → Data integration) says API
access has to be enabled by TrackMan. Once it is, swap the scrape for the API
and keep the loader: it only needs `sessions.json`, `roster.json` and
`pitches.jsonl` in the same shape.

## Session lineups (fixed Oct 2026)

The sessions API returns every pitcher in `sessionLineup`. Before the fix the puller didn't read
that key and fell back to the portal's "Players in session" dialog, which only shows 10, so any
session with more than 10 pitchers lost the rest (about 990 pitcher-sessions across 2026).
Months backfilled before the fix need one `-Rescan` pass; done.json skips anyone already pulled.

Windows PowerShell 5.1 reads the logs as ANSI, so names with ’ or emoji look garbled in
`Get-Content` unless you add `-Encoding UTF8`. The files themselves are UTF-8.

## Team game files (in-season TrackMan CSVs)

A team's game export (e.g. Ryan Chasse's 2026 High Point season) goes through the app's
uploader (Dashboard -> Pitch Intel -> Upload), which links the pitcher, saves pitches as
`session_type = 'game'` with pitch calls / counts / results, and keeps every column in `raw`.
Clean the file first:

    python uais/python/trackman/prepare_trackman_game_csv.py "<file>.csv" --pitcher-id <id> --pitcher "Last, First" --types auto

It fixes Excel's \r\r\n line endings, name typos / blank PitcherId (single-pitcher files),
adds PitchNo (the exports have none and Time is often mm:ss with the hour dropped), and with
`--types auto` uses AutoPitchType for every pitch (game operators' tags were unreliable in
Chasse's file; theirs is kept as OperatorTaggedPitchType). Re-uploading the same cleaned file
updates the same pitches. Side measures in these files are pitcher's view, the same as the
portal data (checked: LHP RelSide < 0, fastball HB < 0, hit-by-pitch on a RHB at PlateLocSide > 0).
