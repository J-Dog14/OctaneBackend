# Report Clarity Plan — Power Curve Table & Radar Chart

Goal: when reviewing a report with an athlete, the page should *tell the same story you're telling out loud* without you having to apologize for the labels. Today, an athlete like Chase can score "Spiky" + light-green-coded + 93rd percentile peak power on the radar and still have a 5th percentile jump height. The page reads as a contradiction; we want it to read as a diagnosis.

This plan covers four changes, in roughly increasing order of scope:

1. **Color map bug** for kurtosis tiers (`"Spiky"` painted green).
2. **Terminology**: rename `Spiky` → `Sharp`.
3. **Ideal Values column**: round to clean numbers per movement.
4. **Architectural fix**: replace the universal static tier thresholds for Max RPD and Work AUC with per-movement percentile-based tiers.
5. **Radar chart fix**: transform kurtosis to deviation-from-ideal before percentiling, so curve-shape inefficiency actually shows up as a depressed axis.

All file/line references are against the current `pdf_report.py` (and `power_analysis.py` for kurtosis computation).

---

## 1. Bug: kurtosis tier coloring is inverted for "Spiky"

**Where:** `pdf_report.py` lines 468–478 and 741–751 (`color_map` inside `performance_table()` and `slv_performance_table()`).

Current mapping:

| Tier | Color | Implied verdict |
|---|---|---|
| Very Flat | pastel red | bad |
| Moderately Flat | pastel yellow | caution |
| Typical | pastel gray | neutral |
| **Spiky** | **pastel light green** | **good** ← this is the bug |

The `typical_ranges_raw` dict at lines 535–540 says the *ideal* kurtosis for every movement we test is somewhere in the Very-Flat-to-Typical band:

- DJ: −1.43 to −1.12
- CMJ: −1.30 to −0.40
- PPU: −1.58 to −1.25
- SLV: −1.02 to −0.19

A Sharp/Spiky kurtosis is **outside ideal for every movement**, but the table paints it green.

**Fix — remap colors based on whether the tier overlaps the ideal range, not on a global "flat=bad, peaked=good" axis:**

```
Very Flat        → red       (outside ideal for DJ, CMJ, SLV; partial overlap for PPU)
Moderately Flat  → green     (inside ideal for DJ, CMJ, PPU)
Typical          → yellow    (borderline — only ideal for SLV)
Sharp            → red       (outside ideal for every movement)
```

A more rigorous version is to color the cell based on whether the **athlete's actual kurtosis** sits inside the per-movement `typical_ranges_raw` band — i.e., compute the color per-athlete instead of per-tier. Either approach works; the per-tier remap is simpler and gets us 95% of the way there.

---

## 2. Terminology: rename "Spiky" → "Sharp"

The other three kurtosis labels read fine (descriptive, not value-loaded). The reason `Spiky` was the only one throwing the conversation off is that it sounded *positive* — sharp/explosive/athletic — when in this context it means the opposite. The other labels don't have that problem.

**Change:**

| Current | New |
|---|---|
| Very Flat | Very Flat |
| Moderately Flat | Moderately Flat |
| Typical | Typical |
| **Spiky** | **Sharp** |

Affects the dict key in `kurtosis_thresholds` (lines 438–443) and the matching `color_map` entry (line 477). Also same change in the SLV variant (lines 711–716 and 750-ish).

Note: leaving the labels as descriptive (not "Too Sharp" / "Bad Spike" / etc.) keeps the verdict work in the color, not the label. The four labels stay parallel in tone.

---

## 3. Ideal Values column — round to clean numbers

**Where:** `pdf_report.py` lines 527–558 (the `elite_rpd`, `typical_ranges_raw`, and `elite_auc` dicts inside `get_threshold_text()`).

The intern's values were data-derived but ugly to read. Rounding to the values below shifts every threshold by ≤2% and won't move any athlete between tiers — except the kurtosis lower bound for PPU and DJ, which we tighten only slightly to avoid narrowing the ideal band meaningfully.

| Movement | Max RPD | Kurtosis | Work AUC |
|---|---|---|---|
| DJ | >32700 | -1.45 to -1.10 | >570 |
| CMJ | >25200 | -1.30 to -0.40 | >1260 |
| PPU | >8000 | -1.55 to -1.25 | >700 |
| SLV | >18200 | -1.00 to -0.20 | >1030 |

Notes:

- PPU kurtosis lower bound: rounding −1.58 → −1.55, **not** −1.5. The original 0.33-wide band would lose ~24% of its width if we went to −1.5; the −1.55 round is 0.03 (≈9% of band width), basically cosmetic.
- DJ kurtosis lower bound similarly rounded −1.43 → −1.45 to keep symmetry with the upper bound being rounded −1.12 → −1.10.
- All Max RPD and AUC thresholds are pure cosmetic rounds (≤0.5% shifts).

---

## 4. Architectural fix: per-movement percentile-based tiers for Max RPD and AUC

**The problem.** The "Tier" column for Max RPD and AUC (lines 430–436 and 445–451) is computed from a single universal threshold dict regardless of movement, but the "Ideal Values" column (lines 527–558) uses per-movement cutoffs. The two columns end up disagreeing.

Concrete example from Chase's PPU page:

| Variable | Athlete | Tier | Ideal |
|---|---|---|---|
| Max RPD | 8669 | **Below Average** | **>7980** |

He's *above* the per-movement Elite threshold of 7980 but tagged "Below Average" because the static tier puts the Elite floor at 25,000 — calibrated to CMJ-magnitude movements, not PPU. PPU peak RPDs are roughly a quarter the size of DJ peak RPDs because of body position. The static tiers were almost certainly set to CMJ-ish ranges and never recalibrated.

**The fix.** Replace the static `rpd_thresholds` and `auc_thresholds` dicts with **per-movement percentile-based tiering** computed against the population data the same way the histograms and radar chart already work.

Mapping (applied per movement, against the same population dataframe the radar chart uses):

| Athlete percentile vs. population for this movement | Tier |
|---|---|
| < 20th | Low |
| 20–40th | Below Average |
| 40–60th | Average |
| 60–80th | High |
| ≥ 80th | Elite |

This makes the Tier column consistent across movements (Elite always means "top 20% of athletes who did this movement") and lines it up with how the rest of the page already reasons about performance.

**Implementation notes:**

- `performance_table()` and `slv_performance_table()` will need access to the population dataframe (same one passed to `radar_chart()` via the `population` parameter). The easiest path is to add a `population=None` parameter and fall back to the static thresholds if it's missing.
- Use `scipy.stats.percentileofscore(population[movement][metric].dropna(), athlete_value)` — same call already used at lines 311 and 369.
- The `color_map` for the five tiers (Low/Below Average/Average/High/Elite) doesn't need to change — those labels and colors are already well-aligned and stay the same.
- Kurtosis stays on its own track: the labels (Very Flat / Moderately Flat / Typical / Sharp) are *shape descriptors*, not performance tiers, so percentile-tiering isn't the right model for them. The deviation-from-ideal color rule from §1 is what we want for kurtosis.
- The "Ideal Values" column keeps showing the static rounded numbers from §3 as concrete reference targets athletes can chase. Most of the time they'll line up with the 80th-percentile floor, but they're maintained as a fixed reference rather than recomputed every report.

---

## 5. Radar chart — kurtosis percentile transform

**Where:** `pdf_report.py` lines 297–344 (`radar_chart`) and lines 349–423 (`slv_radar_chart`). Percentile calc at lines 304–320 and 361–381 via `scipy.stats.percentileofscore`.

### 5a. Kurtosis is plotted raw, so spike = high percentile

`percentileofscore(pop_values, athlete_kurtosis)` is called directly with no transform. So:

- Athlete with kurtosis 3.0 (Sharp, bad) → high percentile → **filled out far on the radar**
- Athlete with kurtosis −1.2 (within ideal for CMJ, good) → middle percentile → less filled in

That's the optical illusion on the Chase chart — bad shape rewarded with a long axis.

**Fix: transform kurtosis before percentiling.**

For the kurtosis axis specifically, replace the raw value with a deviation-from-ideal score:

```
ideal_low, ideal_high = typical_ranges_raw[movement]   # from §3
if ideal_low <= kurt <= ideal_high:
    deviation = 0
else:
    deviation = min(abs(kurt - ideal_low), abs(kurt - ideal_high))

# Percentile against population deviation scores (computed once per render)
# Invert so low deviation = high radar value
radar_value = 1.0 - percentileofscore(pop_deviations, deviation) / 100
```

Athletes inside the ideal band score 0 deviation (best, axis fully extended). Athletes far outside in *either* direction score high deviation (axis pulled inward). This makes the kurtosis axis honest about whether the curve shape is helping or hurting.

### 5b. Time-to-Max-RPD probably has the same issue (flagged, not in scope)

Worth a separate audit. If "faster time to max RPD" is preferred for some movements (PPU, DJ) but "later peak inside the propulsive phase" is preferred for others (CMJ), the raw percentile is again misleading. Decide per-movement whether to invert before percentiling. Not blocking the rest of this plan — flag for a future pass.

---

## 6. Suggested rollout order

1. **5-min change:** §1 color map remap. Stops the table from saying the wrong thing today.
2. **5-min change:** §2 rename `Spiky` → `Sharp` (dict key + color_map entry, both copies).
3. **15-min change:** §3 round the ideal values per the table above.
4. **Bigger change:** §4 per-movement percentile-based tiers for RPD and AUC — needs population data plumbed into `performance_table()` / `slv_performance_table()` and the static threshold dicts deleted or relegated to fallback.
5. **Same scope as §4:** §5 kurtosis deviation-transform on the radar — uses `typical_ranges_raw` from §3 plus population deviation scoring.
6. **Future:** §5b time-to-max-RPD per-movement inversion audit.

Steps 1–3 can be a single small commit and ship today. Steps 4 and 5 share the population-data-plumbing work and probably want to ship together.

---

## 7. Things to flag / decide later

- **Population data scope.** When we percentile-tier per movement, what's the population? All athletes who did that movement, all time? Last N months? Same age bracket as the report subject? Whatever the radar chart currently uses is the natural default — worth confirming that's the right cohort or whether the table should use a different one.
- **What happens at the boundary.** Edge cases like an athlete sitting at the 80.0th percentile — currently the static buckets use `min_val <= value < max_val` (line 483). Same convention for the new percentile tiers is fine; just want to be consistent.
- **PPU's kurtosis ideal includes Very Flat territory.** PPU ideal is `-1.55 to -1.25`, which crosses the −1.3 boundary between Very Flat and Moderately Flat. So a PPU athlete inside ideal could be tagged either Very Flat (red) or Moderately Flat (green) by the §1 color rule depending on which side of −1.3 they land on. The per-athlete coloring approach (color the cell based on whether `athlete_kurtosis` is inside `typical_ranges_raw[movement]`, ignoring the static tier) avoids this edge entirely. Worth deciding which approach to take when implementing §1.
- **§5b** time-to-max-RPD direction needs you to weigh in once we get there.
