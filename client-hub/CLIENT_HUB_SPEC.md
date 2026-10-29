# Client Hub → OctaneBiomechBackend

A reverse-engineered spec of the "8ctane Client Hub" artifact, plus a port of its logic for this repo.

## What the original does

It's a coach CRM for remote and hybrid clients. Each client is a hand-kept record (status, phase, contract, onboarding, "last updated" dates, coach log) that can be linked to an 8ctane athlete. Once a client is linked, the hub reads three things from 8ctane: the athlete's active programs, the programming-coverage alerts, and the training calendar with per-set check-offs. From those it works out how many days of programming are left, what got ticked this week, and when plyos, lifts and delivery last changed.

Inside claude.ai it ran on:

| Artifact piece | What it did | Replacement here |
|---|---|---|
| `db` capability (`clients/*`, `clients/*/notes`) | Shared document store | Prisma models `HubClient`, `HubClientNote` (App DB) |
| `mcp` → 8ctane Database: `octane_athletes`, `octane_alerts`, `octane_training_calendar` | Live programs, coverage, check-offs | `lib/client-hub/octane/source.ts` (HTTP to Octane with `octane_api_key`) |
| `mcp` → Google Drive `download_file_content` | One-time sheet import | **Dropped.** Replaced by `POST /seed` from 8ctane |
| `user` capability | Who's viewing, note authors | Clerk (`/api/dashboard/*`), `HubCoach` mapping |
| Hardcoded `ME_COACH = 'Ryan Chasse'`, `/chasse/i` | "My clients" | `ownerClerkUserId` + `HubCoach.octaneUserUuid` per staff user |

## Architecture

```
/dashboard/client-hub (Mantine page — not included, see "Frontend")
        │  fetch
        ▼
/api/dashboard/client-hub/*         ← Clerk auth (requireStaff), Zod at the edge
        │
        ▼
lib/client-hub/service.ts           ← use cases; only file besides source.ts that does I/O
   ├── prisma (App DB)              ← HubClient, HubClientNote, HubCoach. Never the warehouse.
   └── OctaneProgrammingSource      ← interface; httpOctaneSource is the real one, tests use fakes
        │
pure modules (all unit-tested): coverage · checkoffs · flags · sync · linking · profile · names · dates
```

The hub's data is app data rather than assessment data, so it goes in the App DB through Prisma. Nothing touches the warehouse.

## Data model

Original field → Prisma field. Dates are `@db.Date` in Postgres and `'YYYY-MM-DD'` everywhere in TypeScript.

| Original | New | Notes |
|---|---|---|
| `status` active/paused/ended | `status` `ACTIVE/PAUSED/ENDED` | |
| `phase` | `phase` | Options in `PHASES`; stored as text so old values survive list edits |
| `program_type` Remote/Hybrid/In house | `programType` `REMOTE/HYBRID/IN_HOUSE` | |
| `mine` | `ownerClerkUserId` | Multi-user: "My clients" = I own it |
| `coach` | `coachName` | Display only |
| `octane_athlete_id`, `octane_name`, `link_src` auto/manual/dismissed | `octaneAthleteUuid`, `octaneName`, `linkSource` | `DISMISSED` blocks auto-link |
| `contract_*` | `contractDuration/Start/End/Status` | Status `SIGNED/SENT/NOT_SENT` |
| `onb_assessment/3d/review` | `onbAssessment/onb3d/onbReview` | |
| `upd_plyos/lifts/delivery` + `_src` | `updPlyos/updLifts/updDelivery` + `…Source` `OCTANE/MANUAL` | |
| `last_assessment`, `last_contacted`, `built_until` | same, camelCase | `builtUntil` only matters while unlinked |
| `needs_review` | `needsReview` | |
| `wk_done`, `wk_flagged`, `last_tick`, `synced_at` | `weekDone`, `weekTrackable`, `lastTick`, `syncedAt` | Sync cache |
| `clients/{id}/notes` | `HubClientNote` (cascade delete) | `body`, `goals`, `link`, `date`, author |
| — | `HubCoach` | Clerk user ↔ 8ctane coach UUID |

## Rules and thresholds

All of these live in `lib/client-hub/constants.ts`.

**Programming coverage ("Programmed through")**, in `coverage.ts`:

- Program choice when an athlete has several: one the viewer coaches, then `REMOTE`, then the latest end date.
- Coverage comes from 8ctane programming alerts with a **30-day horizon**. The cases:
  - No alert for the program → "30+ days out" (sentinel `999`).
  - An alert with no `lastScheduledDate` → "Nothing scheduled" (sentinel `-1`, red).
  - Otherwise days = `daysUntilLastScheduledDay`. Below 0 is red, 7 or fewer is amber.
- Linked but no active program → "No active program" (amber).
- Unlinked → falls back to the manual `builtUntil` date with the same colors, or shows "Not linked".
- **Change from the original:** when 8ctane can't be read, the cell says "Unavailable" instead of spinning forever.

**Check-offs**, in `checkoffs.ts`:

- `done` = sum of `completedSets`. `trackable` = sum of `plannedSets − unknownSets`.
- Activities with `completion = null` (throwing) are skipped. Lifts without per-set flags add 0 to `trackable`.
- The week is today and the 6 days before it.
- `lastTick` = the latest date with `completedSets > 0`.

**"Updated" dates come from 8ctane** (`lastNewSessionDate`):

- Kinds: plyos → `plyo`, lifts → `lift`, delivery → `throwing`.
- For each day up to today, look at that kind's session names. A day counts as a change when one of its names wasn't scheduled in the 21 days before it.
- The first 7 days of data are skipped because there's nothing to compare them against.
- The latest qualifying day wins. Sync only moves a date **forward** and marks it `OCTANE`. A coach typing a date marks it `MANUAL`.

**Sync**, in `sync.ts`:

- It runs for clients that are `ACTIVE`, linked, and either never synced or synced more than **6 h** ago.
- Each one reads the calendar for **today−41 … today+7**. At most **2** reads are in flight at once, and one failure doesn't stop the rest.
- Program type and coach are filled from the program **only when empty**.
- The week cache and `lastTick` are refreshed.
- Opening a profile always re-syncs that client.

**Auto-link**, in `linking.ts`:

- Only clients that are unlinked, not `ENDED` and not `DISMISSED` are considered.
- It needs an **exact** canonical-name match, nickname-aware ("Zach" = "Zachary").
- Candidates are ranked by "coached by the owner", then by program count. A tie at the top means no link.
- Fuzzy matches (Levenshtein ≤ 2 on names of 8+ characters) are only used for picker suggestions, never for linking.

**Attention filters (chips)**, in `flags.ts`:

| Chip | Rule |
|---|---|
| Program running out | coverage days ≤ 7, including overdue and "nothing scheduled". Excludes 30+ and unknown |
| Nothing checked off (7 days) | linked + synced, trackable > 0, done = 0 |
| Updates due | any of plyos/lifts/delivery unset or > 42 days old |
| Onboarding open | any of Assessment / 3D / Review unchecked |
| Contract ending | contract end ≤ 30 days away, **including already ended** |
| To review | `needsReview` |

**Cell colors:**

- Oldest update: unset is amber "Not set", over 42 days is red, over 28 is amber.
- Contract end: past is red, 30 days or fewer is amber.
- Week: trackable > 0 with done = 0 is red.
- Programming: as described above.

**Sort:** coverage days ascending, with unknowns weighted 500 (after every real number but before 999), then name.

**Headline stats**, over the "mine"/"all" scope before the other filters:

- Active clients.
- Active clients with programming ending in 7 days.
- Active clients with onboarding open.
- To review, counted across **all** statuses.

**Search** looks at name, team, coach and phase.

**Coach log:** a note dated today also sets `lastContacted` to today, in the same transaction.

**Profile "In the app" card**, in `profile.ts`:

- Days of programming left, the program end date in 8ctane, and days since the contract started.
- A 14-day strip of the daily share ticked; days with nothing trackable are drawn hatched.
- The next 7 days of scheduled activities with labels (Lift, Plyo, Throw, Hit, Prep, Arm care, Movement).

## API

All routes are under `/api/dashboard/client-hub`, and every handler calls `requireStaff()` (Clerk) first.

| Method & path | Body / query | Does |
|---|---|---|
| `GET /clients` | `scope=mine\|all`, `status=ACTIVE\|PAUSED\|ENDED\|ALL`, `focus=…`, `q=` | Rows (with coverage, tones, flags), `stats`, `staleCount`, `errors` |
| `POST /clients` | `{ name, programType }` | Creates the client (phase Onboarding, owned by me) and auto-links on a clear match |
| `GET /clients/:id` | — | Client, notes, and `appCard`; re-syncs this client |
| `PATCH /clients/:id` | any subset of editable fields, `isMine` | One-field saves from the profile |
| `DELETE /clients/:id` | — | Hard delete plus notes |
| `POST /clients/:id/link` | `{ octaneAthleteUuid }` | Manual link |
| `DELETE /clients/:id/link` | — | Unlink, marking it `DISMISSED` |
| `POST /clients/:id/notes` | `{ date, body, goals?, link? }` | Adds a note |
| `DELETE /clients/:id/notes/:noteId` | — | |
| `POST /sync` | — | Auto-link + refresh stale clients. The list page calls it when `staleCount > 0` |
| `POST /seed` | — | Adds every athlete on an active REMOTE/HYBRID program who isn't in the hub yet. Idempotent |
| `GET /athletes` | `forName=` | Athlete picker plus ranked suggestions plus the coach list |
| `GET /me`, `PUT /me` | `{ octaneUserUuid, name }` | Link my Clerk user to my 8ctane coach identity |

## Decisions that differ from the original

1. **No sheet import.** `POST /seed` builds the hub from 8ctane's remote and hybrid programs. Everyone else gets added by hand.
2. **Multi-coach.** `ownerClerkUserId` and `HubCoach` replace the hardcoded coach name.
3. **"Today" is America/New_York.** The browser used local time. Railway runs in UTC, so computing dates on the server would be off by a day every evening.
4. **Adding a client auto-links on an exact, unambiguous match only.** The original linked on the first fuzzy hit.
5. **`HYBRID`** from 8ctane maps to Hybrid. The original mapped anything other than REMOTE to In house.
6. **8ctane down → "Unavailable"** plus an `errors[]` banner list. The hub keeps working on its own data.

## Open items — confirm before wiring up

1. **Octane REST endpoints (blocking).** `source.ts` assumes the Octane app serves `GET /api/external/athletes`, `/api/external/alerts?kind=programming`, and `/api/external/training-calendar` behind `X-API-Key`, returning the same JSON the 8ctane connector returns. Ask the Octane app's owner what exists. Only `OCTANE_PATHS` and the query params should need to change.
2. **Existing helpers.** Swap in the repo's own versions where they exist:
   - `requireStaff()` in `http.ts` → `lib/auth/requireAuth.ts` if it returns the Clerk user.
   - `readSetting()` in `source.ts` → the existing OrgSetting helper. It assumes `OrgSetting { key, value }`.
   - `import prisma from '@/lib/prisma'` → the singleton's real export.
3. **Permissions.** Any signed-in staff member can edit. The original had view-only users, so add a role check in `requireStaff` if you need that.
4. **Delete.** This is a hard delete, as in the original. Switch to an `isArchived` flag if you'd rather keep history.
5. **Next.js version.** The route handlers use async `params` (Next 15+). On Next 14, drop the `await`.
6. **Possible upgrade.** If `d_athletes.app_db_uuid` equals the 8ctane `athleteUuid`, the 3D and assessment onboarding boxes could tick themselves from the warehouse `has_pitching_data` / `has_athletic_screen_data` flags.

## Frontend

The UI isn't included. It's a thin client over `GET /clients`, and the server already returns labels, tones and flags. Map the original's pieces to Mantine:

- **Header stats:** clickable numbers. Each sets the status and focus filters.
- **Toolbar:** `SegmentedControl` for scope and for status, `Chip.Group` for focus (one at a time, click again to clear), and a `TextInput` for search.
- **Table:** Client (name, a Review badge, and position · team · program type on a second line), Status badge, Phase, Programmed through, Checked off (last 7 days), Oldest update, Onboarding, Contract ends. Hide the last four columns at narrow widths.
- **Profile:**
  - Left column: the "In the app" card and the coach log.
  - Right column: Programming (phase, schedule, "updated" dates each with a **Today** button), Contract, Onboarding checkboxes, and Athlete details with a "My client" toggle.
  - Each field saves on change through `PATCH`.
- On list load, if `staleCount > 0`, fire `POST /sync` and refetch when it finishes.

## Files

```
prisma/client-hub.prisma                       models to paste into schema.prisma
lib/client-hub/constants.ts                    every threshold
lib/client-hub/dates.ts                        timezone-safe day math
lib/client-hub/names.ts                        canonical names, nicknames, fuzzy match
lib/client-hub/types.ts                        ClientFacts + normalized 8ctane types
lib/client-hub/octane/payloads.ts              Zod for 8ctane responses
lib/client-hub/octane/source.ts                HTTP source, pagination, retry, 5-min cache
lib/client-hub/coverage.ts | checkoffs.ts | flags.ts | sync.ts | linking.ts | profile.ts
lib/client-hub/repository.ts                   Prisma <-> ClientFacts
lib/client-hub/service.ts                      use cases
lib/client-hub/schemas.ts                      request Zod schemas
lib/client-hub/http.ts                         auth + error mapping
lib/client-hub/*.test.ts, fixtures.ts          Vitest (43 tests)
app/api/dashboard/client-hub/**/route.ts       9 route files
```

## Install

1. Paste `prisma/client-hub.prisma` into `prisma/schema.prisma`, then run `npx prisma migrate dev --name client_hub`. The migration only adds tables, so it's safe to run before the deploy.
2. Copy `lib/client-hub/` and `app/api/dashboard/client-hub/` into the repo.
3. Sort out open items 1 and 2.
4. Run `npx vitest run lib/client-hub`.
5. `PUT /me` for each coach, then `POST /seed`, then `POST /sync`.
