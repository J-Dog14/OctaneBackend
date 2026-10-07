# AI Lab (`/dashboard/ai-lab`)

The OctaneAiLayer's front end, inside this app. Admin only. Runs the AI layer's
Python CLI as jobs with the same streaming/kill machinery as UAIS Maintenance.

## Tabs

| Tab | What it does |
|---|---|
| **Athlete** | Pick an athlete → pipeline checklist (data → rounds matched → profiles → norms → cohort → coach report → packet → PDF), sources, rounds (±14 d), outputs. One button runs *prepare → coach report → skill packet* for any skill; everything else per-athlete is in the accordion. When the latest capture has no Proteus/mobility yet: **Pull Proteus now**, **Pull mobility now**, **Queue for tomorrow morning**. |
| **First look** | Same panel, `first-look` skill: one round, no history. |
| **Compare** | Athlete vs athlete (2–4) on the latest AI profile. |
| **Group stats** | `research overview / correlate / cross / velocity-deep / session-change / longitudinal / stratified-chain / roster / coverage`. |
| **Archetypes** | Mover taxonomy by level, k-means clusters, mover-profile ledger, v1 report. |
| **Maintenance & queue** | Proteus/mobility pulls, morning job, queue, norms, cohort refresh, backfill, App DB sync, program summaries, reliability gaps, metric coverage, migration, LLM spend. |

Finished runs list their files (`[ARTIFACT]` lines) as links served by
`/api/dashboard/ai-lab/file`; packet runs also show the Cowork prompt with a
copy button and the zip.

## Files

- `lib/ai-lab/actions.ts` — **the registry.** One entry per button: params
  (kind-validated) + argv builder. Add a CLI command here and it appears.
- `lib/ai-lab/config.ts` — locate the repo/python (OrgSetting `ai_layer_root` /
  `ai_layer_python` → env `AI_LAYER_ROOT` / `AI_LAYER_PYTHON` → `../OctaneAiLayer/.venv`);
  minimal child env (no backend secrets are passed to AI-layer processes).
- `lib/ai-lab/exec.ts` — short synchronous `--json` calls (status, skills, queue).
- `lib/uais/runJob.ts` → `createArgvJob()` — spawn **without a shell** into the
  shared job table, then announce new files under `outputs/`.
- `app/api/dashboard/ai-lab/{config,run,status,queue,file}/route.ts`
- `app/dashboard/ai-lab/*` — page, `useAiJob` hook, components.

Skills shown in the menus come from the Python registry
(`OctaneAiLayer/src/workbench/skills.py`) via `wb skills --json`.

## Safety

- Every route: `requireRole("admin")`.
- Params validated per kind (UUID, ISO date, enum, bounded numbers, token
  regex, existing absolute folder); no value may start with `-`; `shell:false`.
- File route serves only known types from inside `outputs/` (realpath check,
  so no `..`/symlink escape to `.env`); HTML is served with
  `Content-Security-Policy: sandbox` so a report cannot call dashboard APIs.
- Railway: the AI layer isn't in the image, so the page shows a setup notice
  and nothing else changes. Local-first by design.
