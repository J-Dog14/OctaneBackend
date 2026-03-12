# Safeguards: 90% name match and duplicate prevention

## Safeguard overview

| Safeguard | Primary owner | Why |
|-----------|---------------|-----|
| Name matches 90% across runs | UAIS | Each pipeline (Athletic Screen, Pro Sup, Pitching, etc.) resolves the athlete from the data (files/folders). Octane does not see the athlete name until UAIS runs. Consistency must be enforced where resolution happens: same shared logic and threshold in every UAIS pipeline. |
| Check name/email before creating (no duplicates) | UAIS (enforcement) + Octane (optional pre-check UX) | The actual "do not create if already exists" check must run in UAIS when it is about to create an athlete (it has the name/email from the data). Octane can optionally let the user type a name/email before running and show possible matches so they switch to Existing Athlete. **Recommendation:** Implement both safeguards in UAIS first (single source of truth, data is there). Optionally add a "Check for duplicates" step in Octane (API + UI) for New Athlete so users can verify before running. |
| Duplicate session (Existing Athlete) | UAIS (check + prompt) + Octane (modal + send yes/no) | Before inserting a session, check if that athlete_uuid + session_date already exists; if yes, prompt and wait for user confirmation. UAIS prints a parseable message and reads stdin; Octane detects the message and shows a modal, then sends yes/no via job input. |

---

## 1. UAIS: 90% name match across pipelines

**Goal:** When the user runs "Run selected" with New Athlete (no ATHLETE_UUID), the first run (e.g. Athletic Screen) may create an athlete; the second and third (Pro Sup, Pitching) must resolve to that same athlete so data does not attach to the wrong person.

**Current contract (from Athletic-Screen-First):** UAIS uses "create/match by email and 90% name, merge-by-email" when ATHLETE_UUID is unset. The behavior is already specified; the safeguard is enforcing that every pipeline uses the same logic.

**Tasks in UAIS:**

- Centralize athlete resolution in one place (e.g. `common/athlete_manager` or shared module) used by all pipelines: Athletic Screen, Readiness Screen, Pro Sup, Pitching, Hitting, Arm Action, Curveball, Mobility.
- Use a single name similarity threshold (e.g. 90%) and the same email matching rules everywhere. When resolving by name from file/folder data, call this shared "get or create athlete by name/email" so run 2 and run 3 find the same athlete created in run 1.
- Document the threshold (e.g. 90%) and that it is shared so future pipelines do not diverge.
- No change in Octane for this safeguard; Octane only passes athleteUuid or not. When not passed, UAIS is responsible for consistent resolution.

---

## 2. UAIS: Duplicate prevention when creating (New Athlete)

**Goal:** When UAIS is about to create a new athlete (no ATHLETE_UUID set), check d_athletes for an existing row with the same or very similar name and/or same email. If found, use that athlete (attach data to them) instead of creating a new one, and log a warning so operators know "New Athlete" was corrected to existing.

**Tasks in UAIS:**

- In the shared "create or get athlete" path (e.g. before inserting into d_athletes):
  - Query d_athletes for:
    - Same or similar name (e.g. same 90% threshold as above), and/or
    - Same normalized email (if email is present in the incoming data).
  - If a match is found: use that athlete_uuid and do not insert a new row; attach the new session/data to that athlete. Log: e.g. "Matched to existing athlete (name/email) instead of creating new."
  - If no match: create as today.
- This prevents "I thought it was new but they were already in the system" from creating duplicates. No UI needed in UAIS; the pipeline auto-corrects.
- The existing `common/duplicate_detector` logic can be reused or extended so that before create the same check runs and, if a clear match exists, the code path uses the existing athlete instead of creating.

---

## 3. Octane (this repo): Optional pre-run duplicate check

**Goal:** Before the user runs a UAIS job in New Athlete mode, optionally let them type a name (and optionally email) and show "Possible existing athlete(s)" so they can switch to Existing Athlete and select the right one instead of accidentally creating a duplicate.

**Why optional:** The hard safeguard is in UAIS (step 2). This is UX only: many runs don't have the name available in Octane (name comes from the file/folder UAIS reads), so we can't always pre-check. When the user does have a name in mind, a check can reduce mistakes.

**Tasks in Octane repo:**

- New API: e.g. `GET /api/dashboard/athletes/check-duplicates?name=...&email=...` (or a single q that searches both). Use Prisma to query d_athletes by name (fuzzy/similarity) and exact email if provided. Return a small list of `{ athlete_uuid, name, email }` so the UI can show "Possible existing: X, Y. Use Existing Athlete?".
- UAIS Maintenance UI: When New Athlete is selected, add an optional "Check for duplicates (name or email)" with a text input and "Check" button. On "Check", call the new API and display results. If matches exist, show a short message and a link to switch to Existing Athlete. Do not block Run; the run still starts. This is advisory only; UAIS (step 2) is the actual guard.
- If you prefer to keep the dashboard minimal, you can skip this step and rely entirely on UAIS duplicate prevention.

---

## 4. Duplicate session safeguard (Existing Athlete)

**Goal:** When the user runs a pipeline for Existing Athlete (e.g. Athletic Screen, Pro Sup, Pitching), avoid inserting the same session twice. Before inserting, check that the session date for this athlete is not already in the relevant fact table. If it is, prompt: "It looks like you already ran this data for the following date: XX-XX-XXXX. Are you sure you want to continue?" with Yes / No. Only insert if the user confirms Yes.

**Requirements:**

- **Name match:** In Existing Athlete mode we already pass ATHLETE_UUID, so the pipeline attaches to that athlete; name matching is satisfied by the user's selection in Octane.
- **Session date check:** Before inserting a new session row, UAIS must query the warehouse: for this athlete_uuid, does the relevant table (e.g. f_athletic_screen, f_pro_sup, f_pitching_trials, etc.) already have a row with this session date? If yes, do not insert yet; instead prompt and wait for user input.

**Flow:**

- **UAIS (each pipeline that inserts sessions):** When about to insert a session for the given athlete_uuid and session_date (parsed from files/folder):
  - Query the appropriate fact table for athlete_uuid + session_date (or equivalent date field for that pipeline).
  - If a row exists: print a parseable line to stdout so Octane can show a modal, then block and read from stdin for one line (e.g. "yes" or "no").
  - If user replies no: exit without inserting (or skip that session). If yes: proceed with insert.
  - Use a stable format for the message so Octane can detect it and extract the date, e.g. `DUPLICATE_SESSION:YYYY-MM-DD` or a human-readable line that includes the date in a known format, plus a follow-up line like "Reply 'yes' to continue or 'no' to abort."

- **Octane:** In the UAIS Maintenance stream UI: while appending stream chunks to the output state, watch for the duplicate-session message (e.g. regex for `DUPLICATE_SESSION:(\d{4}-\d{2}-\d{2})` or a phrase like "already ran this data for the following date: (date)"). When detected: show a modal with the text and [Yes] [No] buttons. On Yes: call the existing "send input" API to send "yes" to the process. On No: send "no". The process is already waiting on stdin.

**Tables / session date fields (for UAIS):** Each pipeline maps to one or more fact tables with a session date. UAIS already knows the table and date for the run; the check is: `SELECT 1 FROM <table> WHERE athlete_uuid = ? AND session_date = ?` (or the correct date column name). If a row exists, trigger the prompt.

**Summary for this safeguard:**

- UAIS: Before insert, query for existing session (athlete_uuid + session_date). If exists, print parseable message and wait for stdin "yes"/"no"; proceed or abort accordingly.
- Octane: Detect the message in the stream, show modal with date and Yes/No, then send "yes" or "no" via the existing job input API.

Applies to Existing Athlete runs; name is already fixed by athlete selection.

---

## Summary

- **90% name match across runs:** Implement in UAIS by using one shared athlete-resolution module and one threshold in all pipelines.
- **No duplicate creation for "New Athlete":** Implement in UAIS by checking d_athletes before create and reusing an existing athlete when name/email match; optionally add an Octane pre-run "check for duplicates" API + UI for better UX.
- **Duplicate session (Existing Athlete):** Implement in UAIS by checking the relevant fact table for existing athlete_uuid + session_date before insert; if found, print a parseable message and wait for stdin "yes"/"no". Implement in Octane by detecting that message in the stream, showing a modal with the date and Yes/No buttons, and sending "yes" or "no" via the existing job input.

Octane does not need to change how it invokes UAIS (it already sends athleteUuid or not); all enforcement for athlete and session duplicates is in UAIS, with Octane providing the confirmation modal for the duplicate-session case.

---

## Implementation status (UAIS)

| Safeguard | Location | Status |
|-----------|----------|--------|
| 90% name match + duplicate prevention | `python/common/athlete_manager.py` (constant `NAME_SIMILARITY_THRESHOLD`, `find_existing_athlete_by_name_or_email`, `get_or_create_athlete`) | Implemented |
| 90% default in post-run merge check | `python/common/duplicate_detector.py` (`min_similarity` default 0.9) | Implemented |
| Duplicate session check + prompt | `python/common/session_duplicate_prompt.py` | Implemented |
| Pipeline integration (session check) | Athletic Screen, Pro Sup, Readiness, Mobility, Arm Action, Curveball, Pitching (Python + R) | Implemented |

**Parseable message for Octane (Safeguard 4):** UAIS prints exactly:
- Line 1: `DUPLICATE_SESSION:YYYY-MM-DD`
- Line 2: `It looks like you already ran this data for the following date: YYYY-MM-DD. Reply 'yes' to continue or 'no' to abort.`

Octane can detect with regex: `DUPLICATE_SESSION:(\d{4}-\d{2}-\d{2})`.
