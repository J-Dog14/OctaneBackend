# Athletic Screen Report — Reference Blueprint

> **Purpose:** Complete blueprint for replicating the Athletic Screen report in the Octane front-end app. Covers every layer from raw force-plate file capture through database storage, payload generation, percentile computation, and UI rendering.

---

## Table of Contents

1. [End-to-End Data Flow](#1-end-to-end-data-flow)
2. [Data Collection & Files](#2-data-collection--files)
3. [Movement Classification](#3-movement-classification)
4. [Python Ingestion Pipeline](#4-python-ingestion-pipeline)
5. [File Parsing Details](#5-file-parsing-details)
6. [Power Curve Analysis](#6-power-curve-analysis)
7. [Cross-Insert to Readiness Screen](#7-cross-insert-to-readiness-screen)
8. [Database Schema](#8-database-schema)
9. [Payload Builder](#9-payload-builder)
10. [Variables in the Report](#10-variables-in-the-report)
11. [Percentile Layer](#11-percentile-layer)
12. [API Endpoints](#12-api-endpoints)
13. [UI Rendering](#13-ui-rendering)
14. [Radar Chart](#14-radar-chart)
15. [PDF Report Generation](#15-pdf-report-generation)
16. [File Paths](#16-file-paths)
17. [Replication Checklist](#17-replication-checklist)

---

## 1. End-to-End Data Flow

```
Force Plate (Vald/ForceDecks) .txt output
        │
        ▼
uais/python/athleticScreen/main.py
  ├── file_parsers.py → extract name, date, movement metrics from each .txt
  ├── power_analysis.py → analyze companion _Power.txt (1000 Hz)
  └── _cross_insert_to_readiness_screen() → CMJ & PPU also land in readiness tables
        │
        ▼
PostgreSQL (Neon) — 4 active tables
  f_athletic_screen_cmj / _dj / _ppu / _slv
        │
        ▼
lib/octane/athleticScreenPayload.ts
  buildAthleticScreenPayload()
  ├── Session date resolution: max(latest date across all 4 tables)
  ├── Trial averaging: avgNullable() across trials per movement
  └── SLV side grouping: SLV_Left / SLV_Right categories
        │
        ▼
lib/athlete-tracking/percentiles.ts
  getAthleticScreenWithPercentiles()
  └── Gender-stratified: female → getCachedAthleticScreenPopulationFemale()
                         else   → getCachedAthleticScreenPopulation()
        │
        ▼
app/api/dashboard/athlete-tracking/report/route.ts
  → domain "athleticScreen" in AthleteTrackingReport
        │
        ▼
app/dashboard/athlete-tracking/AthleteTrackingContent.tsx
  ├── Movement sub-navigation (← DJ | PPU | CMJ | SLV →)
  ├── Per-movement Radar chart (percentile-based)
  └── Cross-movement summary table (Variable × Movement columns)
```

---

## 2. Data Collection & Files

### Source System
Vald ForceDecks force plate hardware. All output files are plain `.txt`.

### File Types

| File Pattern | Contents |
|---|---|
| `{trial_name}.txt` | Standard output — first row is metadata path string, subsequent rows are frame data; first numeric row contains the trial metrics |
| `{trial_name}_Power.txt` | Power time series at 1000 Hz — col 0 = frame index, col 2 = watts |

### Metadata Encoding in Path String
The very first line of every `.txt` file is a filesystem path string. The Python parser extracts two fields from it via regex:

```python
# Athlete name: content between Data\ and the next _ or \
name = re.search(r'Data\\(.*?)[_\\]', first_line)

# Session date: YYYY-MM-DD inside parentheses before a _
date = re.search(r'\((\d{4}-\d{2}-\d{2})_', first_line)
```

### Session XML Auxiliary File
A `Session.xml` file accompanies multi-athlete batch sessions and provides subject-name and session-date metadata. The pipeline searches for it in:
1. The batch upload folder (if the file came from a batch)
2. The same directory as the source `.txt` file (sibling)

**Name guard:** The subject name in `Session.xml` must match the athlete's name in the database. This prevents cross-contamination when multiple athletes are processed in the same batch directory.

### File Disposition
After successful processing, each `.txt` file is moved into a `Processed txt Files/` subdirectory under its source directory and renamed with a `_NAME_DATE` suffix to prevent reprocessing.

---

## 3. Movement Classification

The trial name string determines movement type. Classification is by substring match:

```python
# uais/python/athleticScreen/file_parsers.py: classify_movement_type()
CMJ    → trial name contains "CMJ"
PPU    → trial name contains "PPU"
DJ     → trial name contains "DJ"
SLV    → trial name contains "SLVL" (Left) or "SLVR" (Right)
NMT    → trial name contains "NMT"
```

**NMT is stored but excluded from the payload and report.** The 5 DB tables are:

```
MOVEMENT_TO_PG_TABLE = {
  CMJ → f_athletic_screen_cmj
  DJ  → f_athletic_screen_dj
  PPU → f_athletic_screen_ppu
  SLV → f_athletic_screen_slv
  NMT → f_athletic_screen_nmt   ← stored only, not in report
}
```

---

## 4. Python Ingestion Pipeline

**Entry point:** `uais/python/athleticScreen/main.py`

### Processing Flow

```python
process_txt_files(source_path, athlete_name, athlete_uuid, ...)
  └── for each .txt file (excluding _Power.txt):
        1. classify_movement_type(trial_name)
        2. parse_movement_file(filepath, movement_type)
             → extracts name, session_date, metrics dict
        3. Look for companion {trial_name}_Power.txt
             → if found: analyze_power_curve_advanced()
             → merge power metrics into row dict
        4. Upsert into target table
             CMJ/PPU/DJ: WHERE (athlete_uuid, session_date, trial_name)
             SLV:        WHERE (athlete_uuid, session_date, trial_name, side)
        5. _cross_insert_to_readiness_screen() for CMJ and PPU
```

### Upsert Columns Written Per Movement

| Movement | Base Columns Written | Power Columns Written |
|---|---|---|
| CMJ | jh_in, peak_power, pp_forceplate, force_at_pp, vel_at_pp, pp_w_per_kg | auc_j, kurtosis, rpd_max_w_per_s, time_to_rpd_max_s, peak_power_w, time_to_peak_s, rise_time_10_90_s, fwhm_s, work_early_pct, decay_90_10_s, t_com_norm_0to1, skewness, spectral_centroid_hz |
| DJ | jh_in, peak_power, pp_forceplate, force_at_pp, vel_at_pp, pp_w_per_kg, ct, rsi | same as CMJ |
| PPU | same as CMJ | same as CMJ |
| SLV | jh_in, pp_forceplate, force_at_pp, vel_at_pp, pp_w_per_kg, side | same as CMJ |
| NMT | num_taps_10s, num_taps_20s, num_taps_30s, num_taps | none |

---

## 5. File Parsing Details

**Source:** `uais/python/athleticScreen/file_parsers.py` → `parse_movement_file()`

The first numeric (non-header) row of each `.txt` file contains the trial metrics. Column layout varies by movement:

### CMJ / PPU
```
5-column layout: [JH_in, PP_FP, F_at_PP, V_at_PP, W_kg]
6-column layout: [JH_in, PP_FP, F_at_PP, V_at_PP, Peak_Power, W_kg]
```
- `JH_in` → `jh_in` (jump height, inches)
- `PP_FP` → `pp_forceplate` (peak power from force plate, watts)
- `F_at_PP` → `force_at_pp` (force at peak power, N)
- `V_at_PP` → `vel_at_pp` (velocity at peak power, m/s)
- `W_kg` → `pp_w_per_kg` (peak power normalized to body weight, W/kg)
- `Peak_Power` (6-col only) → `peak_power`

### DJ
```
7-column layout: [JH_in, PP_FP, F_at_PP, V_at_PP, CT, RSI, W_kg]
```
- `CT` → `ct` (contact time, seconds)
- `RSI` → `rsi` (reactive strength index — note: stored raw, scaled ×2 in display)

### SLV
```
5 or 6 column layout (same structure as CMJ/PPU)
```
- Side determined from trial name: SLVL → "Left", SLVR → "Right"
- Side stored in `side` column

### NMT
```
4-column layout: [NUM_TAPS_10s, NUM_TAPS_20s, NUM_TAPS_30s, NUM_TAPS]
```

---

## 6. Power Curve Analysis

**Source:** `uais/python/athleticScreen/power_analysis.py`

Triggered when a `{trial_name}_Power.txt` companion file exists alongside the main `.txt` file.

### File Format
Plain text, frame-indexed at 1000 Hz. Column 2 (0-indexed) is watts.

```python
def load_power_txt(filepath):
    # reads frame-indexed power time series
    # col 2 = watts (power)
    # returns power array at 1000 Hz
```

### Metrics Computed by `analyze_power_curve_advanced()`

The function returns ~25 values; the following 13 are stored in the DB:

| DB Column | Description | Computation |
|---|---|---|
| `peak_power_w` | Peak power in watts | `max(power_array)` |
| `time_to_peak_s` | Time from onset to peak power | index of peak / fs_hz |
| `rpd_max_w_per_s` | Max rate of power development | `max(np.gradient(power, 1/fs_hz))` over 10–90% of peak power window |
| `time_to_rpd_max_s` | Time at which max RPD occurs | index of RPD peak / fs_hz |
| `rise_time_10_90_s` | Time from 10% to 90% of peak power | index difference / fs_hz |
| `fwhm_s` | Full width at half maximum | width of power curve at 50% peak |
| `auc_j` | Area under the power curve (Joules) | `np.trapezoid(power, dx=1/fs_hz)` from onset to offset |
| `work_early_pct` | % of total AUC in first half of contraction | `(auc_first_half / total_auc) * 100` |
| `decay_90_10_s` | Time from 90% to 10% of peak on descent | index difference / fs_hz |
| `t_com_norm_0to1` | Normalized time of center of mass at peak | COM index / total duration |
| `skewness` | Skewness of the power-time distribution | `scipy.stats.skew(power)` |
| `kurtosis` | Excess kurtosis of the power-time distribution | `scipy.stats.kurtosis(power, fisher=True)` |
| `spectral_centroid_hz` | Spectral centroid of the power signal | weighted mean of FFT frequencies |

### Key Technical Notes
- `fs_hz = 1000` (1000 Hz sampling rate)
- RPD computed as `np.gradient(power, 1/fs_hz)` — the instantaneous slope of the power curve in W/s
- RPD max is taken only in the 10%–90% of peak power window (excludes onset noise)
- Kurtosis uses **excess kurtosis** (Fisher=True) — a normal distribution returns 0, a sharper peak returns positive values
- AUC uses `np.trapezoid()` (formerly `numpy.trapz`), integrated from detected onset to offset indices
- Phase metrics (eccentric_duration_s, concentric_duration_s, mrsi, etc.) are also computed but **not currently stored** in the active schema

---

## 7. Cross-Insert to Readiness Screen

After successful CMJ and PPU upserts, the athletic screen pipeline writes those same rows into the readiness screen tables:

```python
_cross_insert_to_readiness_screen(movement_type, row_data, athlete_uuid, session_date)
  CMJ → f_readiness_screen_cmj
  PPU → f_readiness_screen_ppu
```

This means a single athletic screen session automatically populates the readiness screen with jump/push-up data. The readiness screen and athletic screen share CMJ/PPU data — they are the same measurements written to two tables.

---

## 8. Database Schema

All tables live in the `public` schema. Prisma model definitions in `prisma/schema.prisma`.

### f_athletic_screen_cmj

| Column | Type | Notes |
|---|---|---|
| id | Int PK | |
| athlete_uuid | VarChar(36) | FK → d_athletes |
| session_date | Date | |
| source_system | VarChar(50) | default "athletic_screen" |
| source_athlete_id | VarChar(100)? | |
| trial_name | String? | raw trial name from file |
| age_at_collection | Decimal? | |
| age_group | String? | |
| created_at | Timestamp | |
| jh_in | Decimal? | jump height (inches) |
| peak_power | Decimal? | peak power raw |
| pp_forceplate | Decimal? | peak power from force plate (W) |
| force_at_pp | Decimal? | force at peak power (N) |
| vel_at_pp | Decimal? | velocity at peak power (m/s) |
| pp_w_per_kg | Decimal? | peak power normalized (W/kg) ← used in payload |
| peak_power_w | Decimal? | from power curve analysis |
| time_to_peak_s | Decimal? | from power curve |
| rpd_max_w_per_s | Decimal? | max rate of power development (W/s) ← used in payload |
| time_to_rpd_max_s | Decimal? | time of max RPD (s) ← used in payload |
| rise_time_10_90_s | Decimal? | from power curve |
| fwhm_s | Decimal? | from power curve |
| auc_j | Decimal? | area under power curve (J) ← used in payload |
| work_early_pct | Decimal? | from power curve |
| decay_90_10_s | Decimal? | from power curve |
| t_com_norm_0to1 | Decimal? | from power curve |
| skewness | Decimal? | from power curve |
| kurtosis | Decimal? | excess kurtosis ← used in payload |
| spectral_centroid_hz | Decimal? | from power curve |
| demographic | String? | |

Indexes on `session_date` and `athlete_uuid`.

### f_athletic_screen_dj

Identical to CMJ plus:

| Column | Type | Notes |
|---|---|---|
| ct | Decimal? | contact time (s) ← used in payload |
| rsi | Decimal? | reactive strength index ← used in payload |

### f_athletic_screen_ppu

Identical to CMJ (same column set, no additions).

### f_athletic_screen_slv

Similar to CMJ with the following differences:
- Has `side` column (String?) — "Left" or "Right"
- Does **not** have a `peak_power` column (only `pp_forceplate` + `pp_w_per_kg`)
- All power analysis columns present (same 13 as CMJ)

### f_athletic_screen_nmt

| Column | Type | Notes |
|---|---|---|
| id, athlete_uuid, session_date, source_system, source_athlete_id, trial_name, age_at_collection, age_group, created_at, demographic | — | standard metadata |
| num_taps_10s | Decimal? | taps in first 10 seconds |
| num_taps_20s | Decimal? | taps in first 20 seconds |
| num_taps_30s | Decimal? | taps in first 30 seconds |
| num_taps | Decimal? | total taps |

> **NMT is collected and stored but is NOT included in the payload or displayed in the report.**

### f_athletic_screen (legacy)

An older table with a flat schema. Not queried by the current payload builder — exists for historical data only.

---

## 9. Payload Builder

**Source:** `lib/octane/athleticScreenPayload.ts`

```typescript
export async function buildAthleticScreenPayload(
  athleteUuid: string,
  sessionDate?: string
): Promise<AthleticScreenPayload>
```

### Types

```typescript
type ValueUnit = "NUMBER" | "IN" | "W" | "W_PER_KG" | "S" | "J";
type Orientation = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";

export type AthleticScreenPayloadMetric = {
  category: string;   // "CMJ" | "DJ" | "PPU" | "SLV_Left" | "SLV_Right"
  name: string;       // variable name, e.g. "JH", "Peak Power", "Work (AUC)"
  value: number | null;
  valueUnit: ValueUnit | string;  // always "NUMBER" in practice
  orientation: Orientation | string | null;  // always "HIGHER_IS_BETTER"
};

export type AthleticScreenPayload = {
  athleteUuid: string;
  level: string;
  score: number | null;  // always null — no overall score
  metrics: AthleticScreenPayloadMetric[];
  sessionDate?: string | null;
};
```

### Step 1 — Session Date Resolution

When no `sessionDate` is provided, the payload queries the latest record from **all four tables in parallel** and takes the maximum date:

```typescript
const [latestCmj, latestDj, latestPpu, latestSlv] = await Promise.all([
  prisma.f_athletic_screen_cmj.findFirst({ orderBy: [{session_date:"desc"}, {created_at:"desc"}] }),
  prisma.f_athletic_screen_dj.findFirst({ ... }),
  prisma.f_athletic_screen_ppu.findFirst({ ... }),
  prisma.f_athletic_screen_slv.findFirst({ ... }),
]);
resolvedSessionDate = new Date(Math.max(...dates.map(d => d.getTime())));
```

This handles the case where not all movements were tested on the same day — the report always shows the most recent complete session across all movements that exist.

### Step 2 — Query All Four Tables at Resolved Date

```typescript
const [cmjRows, djRows, ppuRows, slvRows] = await Promise.all([
  prisma.f_athletic_screen_cmj.findMany({ where: { athlete_uuid, session_date: resolvedSessionDate }, select: {...} }),
  prisma.f_athletic_screen_dj.findMany({ ... }),
  prisma.f_athletic_screen_ppu.findMany({ ... }),
  prisma.f_athletic_screen_slv.findMany({ ... select: { side, jh_in, pp_w_per_kg, auc_j, kurtosis, rpd_max_w_per_s, time_to_rpd_max_s } }),
]);
```

### Step 3 — Trial Averaging

Multiple trials per movement at the same session date are averaged field-by-field using `avgNullable()`:

```typescript
function avgNullable(values: (number | null)[]): number | null {
  const valid = values.filter(v => v !== null);
  return valid.length > 0 ? valid.reduce((a, b) => a + b) / valid.length : null;
}

const cmjRow = cmjRows.length > 0 ? {
  jh_in: avgNullable(cmjRows.map(r => decimalToNumber(r.jh_in))),
  pp_w_per_kg: avgNullable(...),
  auc_j: avgNullable(...),
  kurtosis: avgNullable(...),
  rpd_max_w_per_s: avgNullable(...),
  time_to_rpd_max_s: avgNullable(...),
} : null;
```

### Step 4 — SLV Side Normalization

SLV rows are grouped by normalized side before averaging:

```typescript
const normalizeSide = (s) => {
  const t = s?.trim().toLowerCase();
  if (t === "l" || t === "left") return "Left";
  if (t === "r" || t === "right") return "Right";
  return t ? String(s).trim() : "Unknown";
};

// Groups → Map<"Left"|"Right", rows[]> → averages each group
// Emits category = "SLV_Left" or "SLV_Right"
```

### Metrics Emitted Per Movement

All metrics use `valueUnit = "NUMBER"` and `orientation = "HIGHER_IS_BETTER"`.

| Category | Metric Name | DB Column | Notes |
|---|---|---|---|
| CMJ | JH | jh_in | inches |
| CMJ | Peak Power | pp_w_per_kg | W/kg |
| CMJ | Work (AUC) | auc_j | joules |
| CMJ | Kurtosis | kurtosis | excess kurtosis |
| CMJ | Max RPD | rpd_max_w_per_s | W/s |
| CMJ | Time to Max RPD | time_to_rpd_max_s | seconds |
| DJ | JH | jh_in | |
| DJ | Peak Power | pp_w_per_kg | |
| DJ | Work (AUC) | auc_j | |
| DJ | Kurtosis | kurtosis | |
| DJ | Max RPD | rpd_max_w_per_s | |
| DJ | Time to Max RPD | time_to_rpd_max_s | |
| DJ | RSI | rsi | scaled ×2 for display |
| DJ | CT | ct | contact time, seconds |
| PPU | JH | jh_in | |
| PPU | Peak Power | pp_w_per_kg | |
| PPU | Work (AUC) | auc_j | |
| PPU | Kurtosis | kurtosis | |
| PPU | Max RPD | rpd_max_w_per_s | |
| PPU | Time to Max RPD | time_to_rpd_max_s | |
| SLV_Left | JH | jh_in | |
| SLV_Left | Peak Power | pp_w_per_kg | |
| SLV_Left | Work (AUC) | auc_j | |
| SLV_Left | Kurtosis | kurtosis | |
| SLV_Left | Max RPD | rpd_max_w_per_s | |
| SLV_Left | Time to Max RPD | time_to_rpd_max_s | |
| SLV_Right | (same 6 metrics) | | |

**Total: up to 26 metrics** (6 CMJ + 8 DJ + 6 PPU + 6 SLV_Left + 6 SLV_Right, depending on which movements were tested).

---

## 10. Variables in the Report

### Display Order
Variables appear in this order in the UI (defined in `ATHLETIC_SCREEN_VARIABLE_ORDER`):

```
["JH", "Peak Power", "Work (AUC)", "Kurtosis", "Max RPD", "Time to Max RPD", "RSI", "CT"]
```

RSI and CT are only present for DJ (and SLV has RSI implicitly via reactive mechanics, but RSI/CT are only emitted for DJ in the payload).

### Movement Display Order
```
["DJ", "PPU", "CMJ", "SLV"]
```
Only movements that have data for the athlete are shown.

### Variable Reference

#### JH — Jump Height
- **Description:** Jump height; higher generally indicates better explosive output.
- **Unit:** Inches (from force plate, stored as `jh_in`)
- **Source:** Base `.txt` file, column 0

#### Peak Power — Peak Power (Normalized)
- **Description:** Peak power normalized to body weight; maximum power generated during the movement.
- **Unit:** W/kg (stored as `pp_w_per_kg`)
- **Source:** Base `.txt` file, last column (W_kg)

#### Work (AUC) — Area Under the Power Curve
- **Description:** Total mechanical energy produced during the movement.
- **Formula:** Time integral of the power curve (Joules) — area under the power-time trace.
- **What it means:** Captures both how much power was produced and how long it was sustained. Two athletes can share the same peak power but differ wildly in AUC if one sustains output and the other spikes then drops. Higher AUC = more total mechanical energy delivered.
- **Benchmarks:** Values are movement-specific and not directly comparable across DJ, CMJ, PPU, and SLV. Rising AUC across sessions for the same movement indicates improved power endurance or better force application timing. In DJ, the brief contact phase means AUC reflects explosive efficiency under constraint; in CMJ, the longer propulsion window typically yields higher AUC.
- **Characterizes:** Total energy output quality — the interaction of amplitude and duration. Pair with Max RPD: high RPD + high AUC = explosive and sustained; high RPD + low AUC = explosive but brief.
- **Unit:** Joules (stored as `auc_j`)
- **Source:** `_Power.txt` → `analyze_power_curve_advanced()`

#### Kurtosis — Power Curve Shape (Peakedness)
- **Description:** Shape descriptor of the power-time curve; reflects how concentrated the power output is around its peak.
- **Formula:** Excess kurtosis of the power-time distribution — `scipy.stats.kurtosis(power, fisher=True)`. Normal distribution = 0; sharper/more concentrated curves yield positive values; flatter curves yield negative values.
- **What it means:** A high positive kurtosis means the athlete generates power in a very sharp, concentrated burst. Low or negative kurtosis means power is spread more evenly over time. This distinguishes "explosive type" (high kurtosis, spike-and-done) from "sustained power type" (lower kurtosis) output strategies.
- **Benchmarks:** Interpret relative to movement type and across sessions. In DJ (short contact), very high kurtosis may indicate efficient SSC utilization. In CMJ, lower kurtosis may reflect better power endurance.
- **Characterizes:** Power curve shape and neuromuscular strategy — whether the athlete concentrates force into a sharp burst or distributes it across the movement duration.
- **Unit:** Dimensionless (excess kurtosis)
- **Source:** `_Power.txt` → `analyze_power_curve_advanced()`

#### Max RPD — Maximum Rate of Power Development
- **Description:** Peak slope of the power-time curve; how rapidly the athlete reaches peak power output.
- **Formula:** `max(np.gradient(power, 1/fs_hz))` computed in the 10%–90% of peak power window. Units: W/s.
- **What it means:** Measures the explosive quality of the power application — how fast the athlete can "turn on" power. Athletes with high RPD express force quickly, which is critical in ballistic movements. The 10–90% window filters onset noise and focuses on the main contraction phase.
- **Benchmarks:** Movement-specific. Compare across sessions for the same athlete to track explosiveness development.
- **Characterizes:** Explosive power capacity, neuromuscular recruitment speed, and fast-twitch fiber utilization. Distinct from AUC — an athlete can have high RPD (fast rise) but low AUC (short duration).
- **Unit:** W/s (stored as `rpd_max_w_per_s`)
- **Source:** `_Power.txt` → `analyze_power_curve_advanced()`

#### Time to Max RPD
- **Description:** The time in seconds at which maximum rate of power development is achieved.
- **Formula:** Index of max RPD value in the gradient array / sampling rate (1000 Hz). Measured from movement onset.
- **What it means:** Earlier time = faster neuromuscular activation. Later time may indicate a more deliberate or fatigued ramp-up to peak power development. Pair with Max RPD value — both speed and magnitude matter.
- **Characterizes:** Neuromuscular activation timing and reactive readiness.
- **Unit:** Seconds (stored as `time_to_rpd_max_s`)
- **Source:** `_Power.txt` → `analyze_power_curve_advanced()`

#### RSI — Reactive Strength Index
- **Description:** Ratio of jump height to contact time; measures reactive power and stretch-shortening cycle (SSC) efficiency.
- **Formula:** `RSI = jh_in / ct`. The displayed value is scaled ×2 (`rsi * 2`) — the stored raw value is half the displayed value. The ×2 scale puts typical competitive athlete values in the 2–5 range.
- **What it means:** Combines jump outcome with ground contact efficiency into a single ratio. Quantifies the SSC — the ability to store elastic energy on impact and release it as propulsive force. Higher RSI = more output achieved in less time on the ground.
- **Benchmarks (scaled ×2 system):** ~3.0 = solid competitive athlete baseline; above 4.0 = typically elite-level reactive capacity; below 2.0 may indicate SSC deficits or elevated fatigue. RSI applies primarily to DJ and SLV where a reactive constraint is present. CMJ and PPU RSI should be interpreted with caution as those movements are not reactive.
- **Characterizes:** Tendon stiffness, elastic energy utilization, and reactive neuromuscular efficiency. Distinct from peak power — an athlete can be very powerful (high PP, high AUC) but have poor RSI if they are slow off the ground.
- **Unit:** Dimensionless, scaled ×2 (stored raw as `rsi`, displayed as `rsi * 2`)
- **Source:** Base `.txt` file → DJ col 5 (0-indexed)
- **Only emitted for:** DJ

#### CT — Contact Time
- **Description:** Ground contact time in seconds during the Drop Jump.
- **Formula:** Duration between foot contact and takeoff detected by the force plate.
- **What it means:** Shorter contact time in combination with adequate jump height yields higher RSI. Excessively long contact time indicates the athlete is not using the SSC efficiently.
- **Unit:** Seconds (stored as `ct`)
- **Source:** Base `.txt` file → DJ col 4 (0-indexed)
- **Only emitted for:** DJ

---

## 11. Percentile Layer

**Source:** `lib/athlete-tracking/percentiles.ts`

### Gender Stratification

Athletic screen is the **only domain with gender-stratified percentile computation**:

```typescript
const isFemale = athlete?.gender === "Female";
const population = await (isFemale
  ? getCachedAthleticScreenPopulationFemale()
  : getCachedAthleticScreenPopulation());
```

**Female population cache:**
```typescript
const getCachedAthleticScreenPopulationFemale = unstable_cache(
  async () => {
    const rows = await prisma.f_athletic_screen_cmj.findMany({
      where: { d_athletes: { gender: "Female" } },
      select: { athlete_uuid: true },
      distinct: ["athlete_uuid"],
      take: POPULATION_LIMIT,  // 150
    });
    // builds full payload for each UUID
  },
  ["population-athletic-screen-female"],
  { revalidate: 3600 }
);
```

Female athletes are compared only to other female athletes. All other athletes use the mixed-gender population.

**General population cache:**
```typescript
const getCachedAthleticScreenPopulation = unstable_cache(
  async () => {
    const uuids = await getAthleteUuidsWithAthleticScreen();
    // queries f_athletic_screen_cmj DISTINCT athlete_uuid LIMIT 150
    // builds full payload for each UUID
  },
  ["population-athletic-screen"],
  { revalidate: 3600 }
);
```

### Population Construction
Population UUIDs come from `f_athletic_screen_cmj` (distinct athletes), limited to the most recent 150. Each UUID then gets its full payload built via `buildAthleticScreenPayload()` — this means the population includes all movements (DJ, PPU, SLV) for each athlete, ensuring percentiles for all movements use a consistent population sample.

### Percentile Computation
`attachPercentiles(payload.metrics, population, athleteUuid)` — standard rank-based percentile calculation shared across all domains. For each metric (category + name combination), the athlete's value is ranked against all population values for that same metric.

All athletic screen metrics use `orientation = "HIGHER_IS_BETTER"`, so higher raw values yield higher percentiles.

### Cache TTL
`revalidate: 3600` — population caches rebuild hourly via Next.js `unstable_cache`.

---

## 12. API Endpoints

### Payload-Only Endpoint (Dashboard, Admin)
```
GET /api/dashboard/payloads/athletic-screen?athleteUuid={uuid}
```
- Auth: requires `admin` role
- Returns raw `AthleticScreenPayload` (no percentiles)
- Source: `app/api/dashboard/payloads/athletic-screen/route.ts`

### Report Endpoint (With Percentiles)
```
GET /api/dashboard/athlete-tracking/report?athleteUuid={uuid}
      &athleticScreenDate={YYYY-MM-DD}  ← optional
```
- Returns full `AthleteTrackingReport` which includes all domains
- The `athleticScreen` domain is built by `getAthleticScreenWithPercentiles()`
- Source: `app/api/dashboard/athlete-tracking/report/route.ts`

---

## 13. UI Rendering

**Source:** `app/dashboard/athlete-tracking/AthleteTrackingContent.tsx`

> Athletic screen rendering is **implemented inline in `AthleteTrackingContent.tsx`** — NOT in `GenericDomain.tsx`. The `domainId === "athleticScreen"` check returns the custom layout before the generic fallback is reached.

### Layout: Movement Sub-Navigation

The report is broken into **per-movement views** with ← → arrow navigation:

```
[← button]  [Radar Chart — current movement's variables vs percentile]  [→ button]
            "{currentMovement} (YYYY-MM-DD) – percentiles" title
                        1/4  (current/total movement count)
```

Movement order: `["DJ", "PPU", "CMJ", "SLV"]` — only movements where data exists are shown. On domain load, `athleticScreenSubIndex` resets to 0.

### SLV Special Handling

When current movement is SLV, the radar shows **two series on one chart**: SLV Left (blue) and SLV Right (red `#ef4444`).

For non-SLV movements, the radar shows one series for the current date and up to 3 additional comparison date series (date comparison mode).

### Cross-Movement Summary Table

Below the radar, a **single table spanning all movements** is rendered:

```
┌─────────────────┬─────┬─────┬─────┬──────────┬───────────┐
│ Variable        │ DJ  │ CMJ │ PPU │ SLV Left │ SLV Right │
├─────────────────┼─────┼─────┼─────┼──────────┼───────────┤
│ JH              │ val │ val │ val │  val     │  val      │
│   percentile    │ %   │ %   │ %   │  %       │  %        │
├─────────────────┼─────┼─────┼─────┼──────────┼───────────┤
│ Peak Power      │ ... │ ... │ ... │  ...     │  ...      │
│ ...             │     │     │     │          │           │
└─────────────────┴─────┴─────┴─────┴──────────┴───────────┘
```

Column order: `["DJ", "CMJ", "PPU", "SLV_Left", "SLV_Right"]`
Row order: `["JH", "Peak Power", "Work (AUC)", "Kurtosis", "Max RPD", "Time to Max RPD", "RSI", "CT"]`

Rows where **no movement has data** for that variable are hidden (`hasAny` check).

### Cell Contents

Each cell shows:
1. **Value** (bold) — raw numeric value
2. **Percentile** (below, color-coded) — `{N}th %ile`

Empty cells (movement doesn't have that variable) render blank.

### Variable Label Column

Each variable row in the label column contains:
1. **Variable name** (bold, `fontWeight: 600`)
2. **ⓘ info button** — shown only for variables with rich detail (Work (AUC), Kurtosis, Max RPD, Time to Max RPD, RSI)
3. **Short description** (muted text, `0.8rem`)

Clicking the ⓘ button expands an inline detail panel (toggle, `expandedAthleticInfo` state) showing 4 sub-sections:

| Sub-section | Label Style | Content |
|---|---|---|
| Formula | uppercase 0.68rem muted | The mathematical formula |
| What the number means | uppercase 0.68rem muted | Plain-language explanation |
| Benchmarks | uppercase 0.68rem muted | Reference ranges and context |
| Characterizes | uppercase 0.68rem muted | What physiological quality this reflects |

The expanded panel uses `background: rgba(255,255,255,0.04)`, `border: 1px solid var(--border)`, `fontSize: 0.76rem`.

### Percentile Color Coding

Uses `getPercentileStyle(percentile)` — same function used throughout the dashboard. No specific cutoffs are defined here; consult the shared utility for color thresholds.

### Session Date Comparison Mode

Athletic screen supports the same multi-date comparison mode as other domains:
- Up to 3 comparison dates selectable from `availForDomain` dates
- Comparison date values appear in cells below the primary value, separated by a divider
- Comparison date labels shown in muted text (`0.68rem`, `rgba(255,255,255,0.38)`)

---

## 14. Radar Chart

**Source:** `app/dashboard/athlete-tracking/MetricRadarChart.tsx`

### For Non-SLV Movements

```typescript
<MetricRadarChart
  title={`${currentMovement} (${sessionDate}) – percentiles`}
  data={athleticRadarSeries[0].data}        // single date mode
  dataSeries={athleticRadarSeries}          // multi-date comparison mode
/>
```

`metricsToRadarData(movementMetrics, "athleticScreen")` — converts the movement's metrics to radar points. Uses `metric.percentile` as the chart value (0–100), so axes represent population percentile rank, not raw values.

### For SLV

```typescript
<MetricRadarChart
  title={`SLV (${sessionDate}) – percentiles`}
  dataSeries={[
    { name: "SLV Left",  data: metricsToRadarData(slvLeft, "athleticScreen"),  color: SERIES_COLORS[0] },  // "#2c99d4"
    { name: "SLV Right", data: metricsToRadarData(slvRight, "athleticScreen"), color: "#ef4444" },
  ]}
/>
```

Left and Right legs are compared on the same radar — useful for identifying asymmetry.

### Series Colors

Primary series uses `SERIES_COLORS[0] = "#2c99d4"`. Comparison dates cycle through:
```javascript
["#2c99d4", "#d62728", "#9467bd", "#2ca02c", "#e6c200", "#ff7f0e"]
```

### Radar Axes

Axes correspond to the **variable names** present for the current movement. For CMJ/PPU/SLV: 6 axes (JH, Peak Power, Work (AUC), Kurtosis, Max RPD, Time to Max RPD). For DJ: 8 axes (+ RSI, CT).

All values plotted are **percentile rank (0–100)**, not raw measurements.

---

## 15. PDF Report Generation

**Source:** `uais/python/athleticScreen/pdf_report.py` (called from `main.py`)

PDF reports are generated after successful DB inserts:

1. **Standard report** — generated for every athlete with percentile comparisons against the general population.

2. **Female comparison report** — for female athletes, an additional `_all_comparison` PDF is generated using `skip_gender_filter=True` (comparisons against the full mixed-gender population) to provide context against the broader athlete pool.

Report generation is triggered at the end of `process_txt_files()` after all movements have been processed. Reports are saved to the same directory as the source files.

---

## 16. File Paths

| Layer | Path |
|---|---|
| Python ingestion entry point | `uais/python/athleticScreen/main.py` |
| File parsing | `uais/python/athleticScreen/file_parsers.py` |
| Power curve analysis | `uais/python/athleticScreen/power_analysis.py` |
| PDF report generation | `uais/python/athleticScreen/pdf_report.py` |
| TypeScript payload builder | `lib/octane/athleticScreenPayload.ts` |
| Percentile layer | `lib/athlete-tracking/percentiles.ts` |
| UI rendering (inline) | `app/dashboard/athlete-tracking/AthleteTrackingContent.tsx` |
| Radar chart component | `app/dashboard/athlete-tracking/MetricRadarChart.tsx` |
| UI constants (variable order, descriptions) | `app/dashboard/athlete-tracking/constants.ts` |
| Payload-only API route | `app/api/dashboard/payloads/athletic-screen/route.ts` |
| Report API route | `app/api/dashboard/athlete-tracking/report/route.ts` |
| Prisma schema (DB models) | `prisma/schema.prisma` — models `f_athletic_screen_*` |

---

## 17. Replication Checklist

Use this checklist when building the Athletic Screen report in the Octane front-end app:

### Data Layer
- [ ] Fetch from the unified report API — the `athleticScreen` domain in `AthleteTrackingReport`
- [ ] Handle the case where individual movements are missing (some categories absent from metrics array)
- [ ] Handle the case where power analysis was not available (auc_j, kurtosis, etc. may be null)

### Movement Navigation
- [ ] Filter movements to only those present in `metrics` (check by `m.category === mov`)
- [ ] Display order: DJ → PPU → CMJ → SLV
- [ ] SLV is a single navigation entry but shows both Left and Right data
- [ ] Reset to first movement when switching athletes

### Summary Table
- [ ] Column order: DJ | CMJ | PPU | SLV Left | SLV Right
- [ ] Row order: JH → Peak Power → Work (AUC) → Kurtosis → Max RPD → Time to Max RPD → RSI → CT
- [ ] Skip rows entirely if no movement has data for that variable
- [ ] Show value (bold) + percentile below it (color-coded)
- [ ] Empty cells where a movement doesn't have that variable

### Variable Labels
- [ ] Short description under each variable name (from `ATHLETIC_SCREEN_VARIABLE_DESCRIPTIONS`)
- [ ] Rich detail panel for: Work (AUC), Kurtosis, Max RPD, Time to Max RPD, RSI
- [ ] Rich detail sections: Formula / What the number means / Benchmarks / Characterizes

### Radar Chart
- [ ] Plot **percentile rank** (0–100), not raw values
- [ ] Per-movement: one radar per movement view (6 or 8 axes)
- [ ] SLV: single radar with Left (blue) and Right (red #ef4444) as two series
- [ ] Multi-date comparison: up to 3 additional series, colors from series array

### Percentile Display
- [ ] Color-code percentile rank values consistently with other domains
- [ ] Remember: female athletes have their own population — percentiles are already computed server-side, just display what the API returns

### RSI Display
- [ ] RSI stored value is `rsi` (raw). The payload emits it directly, but the **display convention is ×2** — confirm whether the payload pre-multiplies or the UI multiplies. Check `athleticScreenPayload.ts` line 188: `value: djRow.rsi` is the raw value from DB; the display scaling note is from `ATHLETIC_SCREEN_VARIABLE_DETAIL` benchmarks description referencing a "scaled ×2 system". Verify the actual stored RSI calculation in `file_parsers.py` to confirm whether ×2 is applied at ingest or display time.

### Session Date Handling
- [ ] Pass `athleticScreenDate` query param to fetch a specific session
- [ ] Session date is the max date across all movements, not necessarily the same date in each table
- [ ] Available dates come from `app/api/dashboard/athlete-tracking/sessions/route.ts`

### What Athletic Screen Does NOT Have
- [ ] No overall score (`score: null`)
- [ ] No optimal range scoring (unlike Mobility)
- [ ] No timeline chart
- [ ] No custom domain component in GenericDomain.tsx — logic is inline in AthleteTrackingContent.tsx
- [ ] NMT data is not in the payload and should not be displayed
