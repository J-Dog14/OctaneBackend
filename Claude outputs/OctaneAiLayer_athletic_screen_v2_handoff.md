# Handoff: switch OctaneAiLayer to Athletic Screen v2

**For:** whoever works in the OctaneAiLayer repo next. **Date:** 2026-10-21. **Owner:** Joey.

## What happened

Every power-derived value in the old `public.f_athletic_screen_{cmj,dj,ppu,slv}` tables is wrong, because of Visual3D pipeline errors. That covers peak power, W/kg, force/vel at PP, RPD, AUC, kurtosis and timing. Jump heights were mostly fine.

The screen was rebuilt from the c3d force data into new tables. The backend ingest now writes **only** v2, so the old tables are frozen: no new screens will ever land there. OctaneBiomechBackend has been fully switched. OctaneAiLayer is the last reader of the old tables.

## What exists in the warehouse now (Neon warehouse, never the App DB)

| Object | What it is | Use it when |
|---|---|---|
| `public.f_athletic_screen_v2_{cmj,dj,ppu,slv}` | One row per trial, ~100 metrics plus curve-shape columns, `qc_flags text[]`, `session_folder`, `source_system='athletic_screen_v2'` | New features, full metric set |
| `public.f_athletic_screen_v2_force_curve` | Offset-corrected FP3 Fz per trial (`fz_n real[]`, `fs_hz`, `bw_n`, event indices) | Curves / power traces |
| `public.v_athletic_screen_{cmj,dj,ppu,slv}` | **Compat views**: v2 data under the OLD column names | Drop-in swap for existing queries |
| `public.v_athletic_screen_sessions` | One row per athlete/date (`movements text[]`, `trials`) | Replaces legacy `public.f_athletic_screen` |
| `public.f_athletic_screen_nmt` | Unchanged (NMT was not rebuilt) | Leave as is |

**Fastest path:** replace `f_athletic_screen_cmj` with `v_athletic_screen_cmj` (same for dj, ppu, slv), and `f_athletic_screen` with `v_athletic_screen_sessions`. Column names stay the same.

## Compat-view column mapping (old name ← v2 source)

- `jh_in` ← jh_in
- `peak_power`, `pp_forceplate`, `peak_power_w` ← peak_power_w (one force-plate peak power now)
- `pp_w_per_kg` ← pp_w_per_kg
- `force_at_pp` ← force_at_pp_n
- `vel_at_pp` ← vel_at_pp_m_s × 1000. It is still **mm/s**, as before. `vel_at_pp_m_s` is also exposed.
- `ct`, `rsi` (DJ) ← ct_s, rsi_legacy. RSI stays on the old 2 × JH / CT scale; the v2 table's own `rsi` column is JH_m / CT.
- `auc_j` ← concentric_work_j
- `rpd_max_w_per_s` ← rpd_max_w_per_s
- `time_to_rpd_max_s`, `time_to_peak_s` ← measured from push-off start (concentric_duration − *_before_takeoff)
- `rise_time_10_90_s`, `decay_90_10_s` ← same names
- `fwhm_s`, `t_com_norm_0to1`, `skewness`, `kurtosis` ← shape of the concentric power curve (`pwr_con_*`)
- `work_early_pct`, `spectral_centroid_hz`, `demographic` ← NULL (not produced anymore)

## Things that change meaning, not just location

1. **Kurtosis is a different quantity.**
   - Old: value-distribution kurtosis of the whole window, which is mostly an artifact.
   - New: time-domain (excess) kurtosis of the concentric power curve.
   - Joey's call: no ideal range yet. Show it as a percentile only, and drop any hard-coded thresholds or ideal bands.
2. **Power magnitudes roughly doubled.** For example, CMJ W/kg went from about 24 to about 60. Any stored z-scores, norms, archetype cut-points or cached profiles built on old screen values are invalid.
3. **Coverage is narrower.** v2 holds only sessions on or after 2025-07-01, collected on FP3. Older screens exist only in the old tables. Joey decided not to rebuild them, so an athlete's screen history may start later than before. Don't silently backfill from the old tables.
4. **PPU power is an index.** It uses a point-mass model, so treat PPU RPD and Work as low-confidence. PPU jump height is fine.
5. **QC flags.** You can filter `qc_flags` for `flight_split_suspect`, `jh_outlier_in_session` and `bw_from_entered_mass` if a metric looks off.
6. **Readiness double count.** Ingest cross-inserts v2 CMJ/PPU values into `f_readiness_screen_cmj/ppu` with `source_system='athletic_screen_v2'`. If the AI layer unions readiness and athletic screen, it counts screens twice. Filter that source_system out of the readiness side, or skip the union.

## To-do in OctaneAiLayer

1. Find readers: `rg -n "f_athletic_screen" src/ analysis_skills/ scripts/` (also check SQL files and any domain/table registry, e.g. the `athletic_screen*` domains the AI Lab passes in).
2. Swap tables:
   - Old tables → compat views, for a minimal change.
   - Old tables → v2 tables, where you want the new metrics (eccentric phase, force, RFD, curve shape).
   - Keep `f_athletic_screen_nmt`.
3. Remove kurtosis ideal ranges and labels. Make sure any "freshness" or `queue` logic that waits for a screen looks at v2 or `v_athletic_screen_sessions`; otherwise new screens never appear.
4. Rebuild derived state, in this order: `ai_layer.assessment_norms` → `ai_layer.athlete_profiles` (whole population) → regenerate coach reports and packets.
5. Check: for a recent athlete (e.g. Josh Sborz 2026-10-05), compare the AI layer's CMJ JH / W/kg against `v_athletic_screen_cmj`. Then run one mover-profile and one first-look.

## Guardrails

- Read-only against the warehouse, apart from the `ai_layer.*` tables. Never write the App DB.
- Don't read the old `f_athletic_screen_{cmj,dj,ppu,slv}` or `f_athletic_screen_power_curve`. They are kept only to validate the rebuild and will be retired.

**Background:** the Backend project docs `athletic-screen-v2-rebuild.md` and `athletic-screen-v2-ingest-switch.md`; the view SQL is `OctaneBiomechBackend/uais/sql/create_athletic_screen_v2_compat_views.sql`.
