# Pelvic tilt and rotation: first-pass exploration

Run from the repository root using the existing UAIS Python environment and warehouse configuration:

```powershell
python uais/python/scripts/plot_pitching_pelvic_tilt.py --help
# Use degrees only after checking the source export's units:
python uais/python/scripts/plot_pitching_pelvic_tilt.py --units degrees --limit 100 --output outputs/pelvic_tilt
python uais/python/scripts/plot_pitching_pelvic_tilt.py --units degrees --athlete-uuid <uuid> --start-date 2026-01-01
python uais/python/scripts/plot_pitching_pelvic_tilt.py --units degrees --age-group "HIGH SCHOOL" --limit 500
```

This script only SELECTs from the warehouse in a read-only transaction. Dependencies are already listed in `uais/python/requirements.txt`. It writes local CSVs and standalone interactive HTML charts. Exports contain athlete UUIDs.

## Data and outputs

- `f_pitching_segment_rot_data`: `segment_names` resolves the pelvis index dynamically; `data[frame][segment][0]` and `[2]` supply X and Z. This is rotation data, not the segment position table or summary metrics.
- `f_pitching_time_data`: actual frame rate, with no assumed 300 Hz fallback.
- `f_pitching_trials`: collection age, handedness, and `TIMING.ReleaseTime.X` / `TIMING.FootstrikeTime.X`. All joins use athlete UUID, session date, and trial index to avoid mixing pitches.
- `pelvis_frames.csv`: one row per frame, source X/Z converted to degrees, frame index, cropped-relative seconds, seconds to release, and 0–100% of the selected window.
- HTML files: separate age-group/handedness cohorts, with matching trial legends across X and Z panels; clicking legends selects individual traces. Zero is release; crosses mark footstrike when available. Both panels use the same time window. No averaging or smoothing.
- `cohort_counts.csv`: distinct athlete and trial counts, so repeated pitches remain visible.
- `skipped_trials.csv`: joined trials rejected for missing release, invalid frame rate, missing segment, malformed angles, or release outside the recording. Trials missing an entire joined table are excluded by the query, so these counts do not describe database-wide coverage.

The limit applies to joined trials before age filtering, newest first; increase it or narrow the athlete/date range when a cohort has few pitches. Age groups use age **at collection** and existing UAIS rules: <14 YOUTH, 14–18 HIGH SCHOOL, >18–22 COLLEGE, >22 PRO. These are age bands; PRO does not establish professional status. Missing numeric age falls back to the stored group, otherwise UNKNOWN. Handedness is kept separate without mirroring or inferring signs.

## Interpretation checks before calling X tilt and Z opening

Confirm `segmentRot` units, Euler order, axis directions, and which X sign means anterior tilt against a known trial/visualization. The script requires `--units degrees|radians` and keeps source signs. It does not unwrap angle discontinuities automatically: inspect any jumps around ±180 degrees first. Segment global Euler rotation may differ from the model's computed `Pelvis_Angle` variable; compare known frames before interpreting it anatomically.

Event indexing follows the existing force pipeline: timing values are relative to the cropped trial start, and release index is `round(release_seconds * frame_rate)`. The release is sampled to the nearest frame; no clamping of invalid events. Metadata `start_time` is not subtracted from cropped-relative events.

The first recorded frame is a **setup proxy**, not a verified setup event. Check that recording includes the actual stance. `--start-seconds` can choose a later cropped-relative starting point for a selected trial. The charts align on release in real seconds; the CSV also provides percent-window timing, which should only be compared after validating the window starts.

## Next questions

Start by reviewing several individual pitches, then compare the shape and timing of X changes with Z opening within each age/hand cohort. This can reveal candidate patterns but does not define over-rotation or establish an optimal tilt. A shared time trend can produce apparent association even without a meaningful relationship.

For the next iteration, validate setup and maximum-leg-lift events and add pelvis/COM position or velocity to operationalize “riding the slope.” These indicators are not inferred from X/Z alone. Then define opening timing and excessive rotation, account for repeated pitches within athletes, and examine within-athlete versus between-athlete relationships before fitting nonlinear “sweet spot” models. Archetypes can be added as another trial-level join once their source and definitions are chosen.
