# UAIS ↔ Octane: Bugs Addressed & Remaining for Front End

**Audience:** Octane Biomech Backend / front-end app. Use this as a prompt or checklist when working on UAIS runners and the Add/Run New Data flow.

---

## Bugs addressed (fixed in UAIS)

- **Unicode console errors on Windows**  
  Athletic Screen, Pro Sup, and Readiness Screen were printing ✓ / ✗ in terminal output. On Windows (cp1252) this caused `UnicodeEncodeError` and crashed or errored after successful work.  
  **Fix (done in UAIS):** All such symbols were replaced with ASCII `[OK]` and `[X]` in:
  - `python/athleticScreen/main.py`
  - `python/proSupTest/main.py`
  - `python/readinessScreen/main.py`
  - `python/common/duplicate_detector.py`  
  **Action for Octane:** None. Athletic Screen and Pro Sup (and Readiness) should now complete without encoding errors when run from your UI.

- **Tkinter folder dialog buried behind other windows**  
  Pro Sup and Readiness Screen (and any flow that uses a folder picker) were opening the dialog behind the front-end window.  
  **Fix (done in UAIS):** The folder selection dialog now calls `root.lift()` and temporarily sets `root.attributes("-topmost", True)` so it appears on top. Applied in:
  - `python/proSupTest/file_parsers.py` (`select_folder_dialog`)
  - `python/readinessScreen/file_parsers.py` (`select_folder_dialog`)  
  **Data selection:** In UAIS, which data to run for Pro Sup and Readiness is determined **only** by the tkinter folder dialog (user picks the folder containing Session.xml). There is no separate “name match” UI; athlete identity is derived from the selected folder/XML and optional `ATHLETE_UUID` from Octane (Existing Athlete). **Pitching** uses the R script `R/pitching/main.R` (tcltk folder dialog); that dialog is now also brought to front in UAIS (topmost set in `R/pitching/main.R`). If your front end uses a separate dialog for **hitting**, use the same lift/topmost pattern (Python: `root.lift()` + `root.attributes("-topmost", True)`; R: `tcl("wm", "attributes", ".", "-topmost", 1)` then `0` after).

---

## Bugs / items still to fix by the front end (Octane)

### 1. Pitching runner: `Rscript` not found

- **Symptom:** When the user runs **Pitching** from the UI, the process fails with:  
  `'Rscript' is not recognized as an internal or external command, operable program or batch file.`
- **Cause:** The Octane pitching runner is configured to invoke **R** (e.g. via `Rscript`). On the machine where the job runs, R is either not installed or not on the system PATH for the spawned process.
- **Options for Octane:**
  - **A. Use R:** Install R and ensure `Rscript` is on the PATH for the user/process that runs UAIS jobs (same environment that runs the Python pipelines).
  - **B. Use Python instead:** Change the pitching runner to call the UAIS Python pipeline instead of R, e.g. run:  
    `python python/scripts/rebuild_pitching_trials_jsonb.py`  
    with the correct working directory (UAIS repo root) and any required args (e.g. `--athlete-name` if applicable). See handoff doc for pitching contract.

### 2. (Optional) Email popup and “Run selected” order

- These are **product/UX requirements**, not regressions. If not yet implemented, see **OCTANE_ATHLETIC_SCREEN_FIRST_HANDOFF.md**:
  - Email popup when a New Athlete has no email after run(s).
  - Multi-select sources and “Run selected” in canonical order (Athletic Screen first, etc.).
  - Existing Athlete: require athlete selection when running.

---

## Quick reference

| Item                         | Where it was fixed / who fixes it | Status   |
|-----------------------------|-----------------------------------|----------|
| Unicode ✓/✗ crash (Win console) | UAIS (Python scripts)             | **Done** |
| Tkinter/tcltk dialog behind window | UAIS (Pro Sup, Readiness, **Pitching R script**) | **Done** |
| Pitching: Rscript not found | Octane (runner config or R on PATH) | **Todo** |
| Email popup, run order, etc.| Octane (see handoff doc)          | Per plan |
