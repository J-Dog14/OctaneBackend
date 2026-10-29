# Client Hub (coach suite)

The coach suite has two sections, switched in the top-left of the header:

- **Athlete Data**: the existing athlete pages (`/coach`, `/coach/athletes/:uuid`).
- **Client Hub** (`/coach/clients`): everyone who is or was on an 8ctane program. It opens on
  **active programmers**. Paused and expired programmers are one click away.

Clicking a client opens `/coach/clients/:id`. The athlete page of anyone in the hub (active,
paused or expired) also gets a **Program Management** tab that renders the same page. It's one
page with two routes. "Change linked athlete" on that page fixes a wrong or duplicate link.

The hub is the only part of the coach suite that coaches can edit. Every edit is logged with
who made it (`coach.hub_client_events`).

The original reverse-engineered spec is in `client-hub/` (kept for reference and excluded
from `tsc`). This page describes what was built instead.

## Where the data comes from

- **Programs, dates and check-offs** come from the 8ctane App DB snapshot (`app_db_snapshot.*`).
  It is refreshed nightly by `run_app_db_sync.bat` or by the **Sync database** button. Nothing
  is ever written to the 8ctane app.
- **Hub data** lives in the warehouse, in the `coach` schema. See
  `uais/sql/create_coach_client_hub.sql`.
- **Assessments** are read live from the warehouse fact tables (screen, mobility, 3D, arm
  action, pro/sup, Proteus, readiness, curveball).
- **Assessment checklist (per program):** Mobility, Proteus, 3D (pitching or hitting) and
  Athletic screen. A box is checked automatically when the warehouse has a session from 30 days
  before the current program started onward. A coach can also check a box by hand, for example
  when the assessment is scheduled but not in the database yet. Either one counts. Manual checks
  are `hub_assessment_checks` rows (`status 'done'`) tied to the program period. Onboarding
  Assessment and 3D follow the checklist.

## Tables (`coach` schema)

| Table | What |
|---|---|
| `hub_clients` | One row per client, ever. Holds the link to `d_athletes` and to the app `User`, the status (`auto_status` + `status_override` → `status`, `is_active`) and the coaching fields (phase, contract, onboarding, update dates, next assessment due). |
| `hub_client_programs` | One row per program period. The app's dates (`app_start`/`app_end`, archived, first/last scheduled day) sit next to coach overrides (`start_override`/`end_override`). The effective `start_date`/`end_date`/`span_days` are generated. Coaches can also add periods the app doesn't have. |
| `hub_assessment_checks` | Coach entries per assessment kind: scheduled / done elsewhere / waived. |
| `hub_client_notes` | The coach log. |
| `hub_client_events` | History of every coach edit and sync change. |
| `v_hub_clients` | Each client plus their current (or latest) period. |

**One table, not active and archived tables.** A client who comes back a year later gets a new
period on the same row, so their notes, checks and history stay attached.

## Rules

**Active vs expired**

- A client is active while one of their periods is current.
- A period is current when its effective end date is today or later, or it has no end date.
- Archived or deleted app programs only count if a coach extended them or added the period.
- "Today" is America/New_York.

**Coach override**

- A coach can set Active, Paused or Expired. Automatic clears the override.
- When a new program for that client appears in the app, the override is cleared automatically.

**Program start**

- Uses `Program.startDate` if the snapshot has that column.
- Otherwise uses the first scheduled day with work, and then `createdAt`.

**Linking to `d_athletes`.** The first rule that matches wins:

1. An existing hub link.
2. `d_athletes.app_db_uuid` is the app user id.
3. The same email on exactly one free athlete.
4. The same name on exactly one free athlete, with no other app user of that name. Nicknames
   count, so "Zach" matches "Zachary".
5. A close name (nameScore ≥ 88, which includes the same last name plus the same first initial):
   the client is **flagged for a coach to link**, and nothing is created.
6. Otherwise a new `d_athletes` row is created with `source_system = 'octane_app'`. Its
   `normalized_name` is built the same way as the Python `normalize_name_for_matching`.

Email and name matches also fill in an empty `d_athletes.app_db_uuid`.

**Sync**

- Runs when the Client Hub opens if the hub has never synced, if the snapshot is newer than the
  last sync, or if the last sync is more than 6 h old.
- Also runs from the **Sync from app** button or `npm run hub:sync`.
- It is transactional, and two syncs running at the same time are prevented with an advisory
  lock.

**Calendar cache (active clients)**

- Programmed through: the last scheduled day in a current period.
- Check-offs for the last 7 days, and the last tick.
- The plyos, lifts and delivery "updated" dates. These only move forward, and a coach can
  overwrite them.

**Attention filters**

| Filter | Shows active clients where… |
|---|---|
| Programming ≤ 7d | the last scheduled day is 7 days away or less |
| Program ends ≤ 14d | the program ends in 14 days or less |
| Nothing checked off | nothing was ticked in the last 7 days |
| Updates due | plyos, lifts or delivery were updated more than 42 days ago |
| Onboarding open | an onboarding step is open. Assessment and 3D tick themselves from warehouse sessions starting 30 days before the period |
| Assessment due | the due date has passed, or there has been no assessment for 90 days |
| Contract ending | the contract ends in 30 days or less |
| To review | the client is marked for review |

## Code

```
uais/sql/create_coach_client_hub.sql      schema, rules (hub_period_is_current, hub_refresh_status), view
lib/client-hub/snapshot.ts                reads app_db_snapshot (probes User name / Program start / program-coach table)
lib/client-hub/matching.ts                app user → d_athletes decisions (pure)
lib/client-hub/appSync.ts                 the sync (dry-run capable)
lib/client-hub/assessments.ts             warehouse assessment dates; assessmentRules.ts = pure status/onboarding
lib/client-hub/flags.ts, checkoffs.ts, profile.ts, dates.ts, names.ts   pure rules
lib/client-hub/repository.ts              SQL for the hub tables (edits, periods, notes, checks, events)
lib/client-hub/service.ts                 list / detail / link use cases
app/api/coach/client-hub/**               coach + admin only (lib/client-hub/http.ts)
app/coach/clients/                        Client Hub pages
app/coach/_components/clientHub/          ClientHubView, ClientProfile (shared with the athlete tab)
app/coach/_tabs/ProgramManagementTab.tsx  athlete-page tab (active programmers only)
tests/client-hub.test.ts                  npm run test:client-hub
scripts/client-hub/sync.ts                npm run hub:sync [-- --dry-run]
```

## Setup

1. Run `npm run hub:setup` to create the tables. It is additive and safe to re-run.
2. Make sure the app snapshot is current: run **Sync database** or wait for the nightly run.
3. Run `npm run hub:sync -- --dry-run`. It lists who would be added, which new athletes would
   be created, and who needs linking. Nothing is written.
4. Open **Client Hub** in the coach view. It syncs on first load. You can also run
   `npm run hub:sync`.

## API

All routes are under `/api/coach/client-hub`.

| Route | What it does |
|---|---|
| `GET clients?status=&scope=&types=&focus=&q=` | List clients |
| `POST sync {force?, dryRun?}` | Sync from the app snapshot |
| `GET/PATCH clients/:id` | Read or update a client |
| `POST clients/:id/programs` | Add a period |
| `PATCH/DELETE clients/:id/programs/:pid` | Edit or delete a period. Only coach-added periods can be deleted. |
| `POST clients/:id/notes`, `DELETE …/notes/:nid` | Add or delete a note |
| `PUT clients/:id/assessments {kind, done}` | Check or uncheck a checklist box for the current program |
| `POST clients/:id/assessments`, `DELETE …/assessments/:cid` | Add or delete an assessment check |
| `POST clients/:id/link {athleteUuid} \| {create: true}` | Link the client to an athlete, or create one |
| `GET athletes?q=` | Search athletes |
| `GET by-athlete/:uuid` | Find the client for an athlete |
