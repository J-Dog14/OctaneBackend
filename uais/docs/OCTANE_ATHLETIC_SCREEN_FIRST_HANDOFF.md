# Octane Biomech Backend: Athletic-Screen-First Workflow — Completion Handoff

This document is for an **agent or developer working in the Octane Biomech Backend repo**. It describes what remains to implement in Octane so the **Athletic-Screen-First Athlete Workflow** is complete. The source of truth is the Athletic-Screen-First Athlete Workflow plan (in the UAIS repo).

---

## 1. Reference: Plan overview and Octane requirements

From the plan:

- **Overview**: Athletic screen is the primary source for new athletes (email + profile from session.xml). New athletes get profile + email from athletic screen or fallbacks; **missing email triggers an Octane popup** (optional email, or continue with warning). Matching uses email first, then 90% fuzzy name. Octane offers **"New Athlete"** vs **"Existing Athlete"** with a **searchable dropdown** for existing.
- **Section 7.4 (Octane Biomech Backend)**:
  - **Add/Run New Data** → **New Athlete** | **Existing Athlete**.
  - **New Athlete**: Start run; no pre-selected athlete. Back end runs athletic screen first (or first selected), then other selected sources in fallback order. If no email found in any project, show **popup** for optional email; allow "Continue without email" with warning: "This athlete will not be able to be linked to the app."
  - **Existing Athlete**: **Searchable dropdown** of all athletes (alphabetical); type to filter. On submit: pass selected `athlete_uuid` and **list of sources to run**. Back end runs only selected pipelines, all attaching to that `athlete_uuid`.

---

## 2. What UAIS (upstream) already does — contract for Octane

When Octane starts a UAIS process, it can pass **environment variables**. UAIS scripts read them and behave accordingly.

### Environment variable: `ATHLETE_UUID`

- **When set**: UAIS treats this as "Existing Athlete" for that run. Every pipeline that was updated (athletic screen, readiness, pro sup, arm action, curveball, mobility) uses this UUID for all inserts; they do **not** create a new athlete.
- **When unset**: "New Athlete" behavior (create/match by email then 90% name, merge-by-email).

### Pipelines that accept `ATHLETE_UUID`

| Runner ID           | UAIS pipeline              | Accepts `ATHLETE_UUID` |
|---------------------|----------------------------|-------------------------|
| athletic-screen     | Athletic Screen main.py    | Yes                     |
| readiness-screen    | Readiness Screen main.py   | Yes                     |
| pro-sup             | Pro Sup main.py            | Yes                     |
| arm-action          | Arm Action ingest_data     | Yes                     |
| curveball           | Curveball ingest_pitches   | Yes                     |
| mobility            | Mobility main.py           | Yes                     |
| pitching            | Pitching (e.g. rebuild)   | Via --athlete-name      |
| hitting             | Hitting                    | If implemented          |
| proteus             | Proteus                    | N/A                     |

### Warehouse schema (for your Prisma / API)

- `analytics.d_athletes`: has `email` (nullable, normalized). No unique constraint on email.
- `public.f_pitching_trials`: has `handedness` (Left/Right). Ensure Prisma/API expose `email` if the popup or athlete list needs it.

### What UAIS does not do

- UAIS does **not** run multiple pipelines in one process or in a fixed order. **Orchestration order** (which pipeline runs first, second, …) is Octane’s responsibility.
- UAIS does **not** show a browser UI or popup. The **email popup** when no email is found is Octane’s responsibility.

---

## 3. What Octane already has (do not redo)

- **Run API**: `POST /api/dashboard/uais/run` with body `{ runnerId: string, athleteUuid?: string }`. When `athleteUuid` is present, it is passed to `createJob(runner, { athleteUuid })`, which sets `env.ATHLETE_UUID` for the spawned process.
- **runJob**: `createJob(runner, options?)` with `CreateJobOptions = { athleteUuid?: string | null }`; env is set as above.
- **UAIS Maintenance page** (`app/dashboard/uais-maintenance/page.tsx`): "Add/Run New Data" with **New Athlete** / **Existing Athlete**; for Existing, a **searchable dropdown** (fetch `/api/dashboard/athletes?q=...`); when user clicks **Run** on a runner, the request includes the selected `athlete_uuid`. There is **no multi-select of sources** and **no sequential run** of multiple runners—each runner has its own "Run" button.

---

## 4. Runner IDs and canonical run order

**Runner IDs** (from `lib/uais/runners.ts`):  
`athletic-screen`, `readiness-screen`, `pro-sup`, `pitching`, `hitting`, `arm-action`, `curveball`, `mobility`, `proteus`.

**Canonical order** for "run selected sources" (plan Sections 2 and 5.1):

1. Athletic Screen  
2. Readiness Screen  
3. Pro Sup  
4. Pitching  
5. Hitting  
6. Arm Action  
7. Curveball  

(Mobility can be placed with other screens; Proteus is out of scope for athlete profile flow.)

Use this order when implementing "Run selected" so that athletic screen runs first when selected.

---

## 5. What Octane must implement (step-by-step)

### 5.1 Multi-select sources and "Run selected"

- Add a **multi-select** (checkboxes or similar) for "Which data to run" using the runner list (or subset: athletic screen, readiness, pro sup, pitching, hitting, arm action, curveball, mobility).
- Add a single **"Run selected"** (or "Run all selected") action that:
  - For **Existing Athlete**: passes the same selected `athlete_uuid` to every run.
  - Runs the selected runners **in the canonical order** (Section 4): start the first job; when its stream/job completes, start the next with the same `athlete_uuid` (if Existing), and so on until all selected runners have been run.
- Keep the existing per-runner "Run" button for single-run use.

### 5.2 New Athlete: run selected in order

- For **New Athlete**, "Run selected" must **not** pass `athlete_uuid` (so UAIS creates/matches by email and name).
- Run selected sources in the **same canonical order** so athletic screen runs first when selected.

### 5.3 Email popup when no email found (New Athlete)

- **Requirement** (plan Section 3 and 7.4): If we are adding a **new** athlete and no email was present in any of the files/sources that were run, the **Octane UI** must prompt the user to enter an email (or continue without). If they continue without, show: **"This athlete will not be able to be linked to the app."**
- **Implementation options**:
  - **Option A**: After "Run selected" finishes for New Athlete, call an API to get the "last created/updated" athlete for the current run; if that athlete has no `email`, show the popup. If the user submits an email, PATCH that athlete’s `email`.
  - **Option B**: Have UAIS scripts print a known token to stdout when they finish a new-athlete run with no email (e.g. `UAIS_NO_EMAIL_PROMPT`). Octane’s stream reader watches for it and opens the popup. Submit path as in A.
  - **Option C**: For New Athlete, always show a short "Add email for this athlete?" step after "Run selected", with optional email input and "Continue without email" plus the warning.
- **Popup content**: Optional email input; primary action to submit email (if provided); secondary "Continue without email" with the exact warning text above.

### 5.4 Submitting email from the popup

- Provide a way to save the entered email to the warehouse (`analytics.d_athletes.email`). Options:
  - **PATCH** endpoint in Octane that updates an athlete’s `email` (e.g. `PATCH /api/dashboard/athletes/[uuid]` with `{ email: string }`), with normalization (lowercase, trim).
  - Or a small endpoint in UAIS that accepts `athlete_uuid` and `email` and updates `d_athletes`; Octane calls it after the user submits the popup.

### 5.5 Existing Athlete: require athlete selection

- When **Existing Athlete** is selected and the user clicks "Run selected", require that an athlete is selected in the dropdown; otherwise show an inline error (e.g. "Select an athlete").

### 5.6 UX and copy

- Ensure the athlete dropdown list is **alphabetical** (plan Section 6). Confirm that `GET /api/dashboard/athletes` returns items ordered by name (or sort by name in the client).
- Optional: Short copy near "Add/Run New Data" explaining that for New Athlete, running athletic screen first is recommended, and for Existing Athlete, select an athlete and which sources to run.

---

## 6. API contract summary

- **Start a single run**: `POST /api/dashboard/uais/run` with `{ runnerId: string, athleteUuid?: string }`. Returns `{ jobId }`; client then consumes stream and/or waits for job completion.
- **No batch endpoint**: Implement "Run selected" by calling the existing run endpoint once per selected runner, in order, with the same `athlete_uuid` when in Existing Athlete mode.
- **Athletes list**: `GET /api/dashboard/athletes?q=...&limit=50` (and optional cursor) for the searchable dropdown; response includes `items` with `athlete_uuid`, `name`, and optionally `email`.

---

## 7. Checklist for the Octane agent

- [ ] **Multi-select sources**: User can select multiple runners (sources) to run.
- [ ] **Run in order**: When running multiple, use order: Athletic Screen → Readiness → Pro Sup → Pitching → Hitting → Arm Action → Curveball (mobility where appropriate).
- [ ] **Existing Athlete**: Pass the same `athlete_uuid` to every run in the batch.
- [ ] **New Athlete**: Do not pass `athlete_uuid`; run in the same order.
- [ ] **Email popup**: When a new athlete has no email after the run(s), show popup: optional email + "Continue without email" with warning: "This athlete will not be able to be linked to the app."
- [ ] **Submit email**: Provide a way to save the popup email to the warehouse (PATCH athlete or UAIS endpoint).
- [ ] **Existing Athlete**: Require athlete selection when "Run selected" is used.
- [ ] **Athlete list**: Searchable dropdown; alphabetical by name.
- [ ] **Copy**: Optional short explanation near "Add/Run New Data" for New vs Existing flow.

---

## 8. Files in Octane to focus on

- **`app/dashboard/uais-maintenance/page.tsx`** (or wherever "Add/Run New Data" lives): multi-select, run-in-order logic, email popup.
- **`app/api/dashboard/athletes/`**: If you add PATCH for email, implement or extend here; ensure response includes `email` for display/popup.
- **`app/api/dashboard/uais/run/route.ts`** and **`lib/uais/runJob.ts`**: Already support `athleteUuid`; no change needed for single-run or sequential run.

---

## 9. How this ties to UAIS

- Octane **starts** UAIS processes (one per runner) with env `ATHLETE_UUID` when Existing Athlete is chosen.
- Octane **orchestrates** which pipelines run and in what order.
- Octane **surfaces** the email popup and (optionally) the form to submit email. UAIS handles merge-by-email, 90% name match, and path resolution; Octane does not implement those.
