# Mobility Report — Complete Reference

> This document covers every layer of the mobility report: data collection → database → API → scoring → percentile computation → UI rendering. Intended for replication in the Octane app.

---

## Table of Contents
1. [End-to-End Order of Operations](#1-end-to-end-order-of-operations)
2. [Data Collection — Python Pipeline](#2-data-collection--python-pipeline)
3. [Database Schema](#3-database-schema)
4. [All 72 Metrics / 9 Groups](#4-all-72-metrics--9-groups)
5. [API Layer — Payload Builder](#5-api-layer--payload-builder)
6. [Scoring System](#6-scoring-system)
7. [Percentile Computation](#7-percentile-computation)
8. [UI Components](#8-ui-components)
9. [Group Row & Score Display](#9-group-row--score-display)
10. [Component Pill Display](#10-component-pill-display)
11. [Radar Chart](#11-radar-chart)
12. [Timeline Chart](#12-timeline-chart)
13. [Highlights vs Lowlights](#13-highlights-vs-lowlights)
14. [Value Formatting Rules](#14-value-formatting-rules)
15. [Color Coding](#15-color-coding)
16. [Styling & CSS Variables](#16-styling--css-variables)
17. [Relevant File Paths](#17-relevant-file-paths)

---

## 1. End-to-End Order of Operations

```
1. Clinician fills out Mobility Assessment Google Sheet
   ├─ A11:A80: Movement names (row labels)
   ├─ B11:B80: Numeric measurement values
   ├─ C11:C80: Optimal ranges (e.g. "80-90", "> 50", "3") — stored as JSON
   └─ Demographic fields in A6:E7 (name, DOB, height, weight, email, position, velo, side)

2. Python script (uais/python/mobility/main.py) runs on schedule
   ├─ Downloads .xlsx from Google Drive (Data/Mobility Assessments)
   ├─ Extracts demographics from fixed cells
   ├─ Extracts metrics from A/B/C columns (rows 11–80)
   ├─ Filters to MOBILITY_COLUMNS frozenset (72 valid columns)
   └─ Inserts/updates one row in public.f_mobility

3. Next.js API: GET /api/dashboard/athlete-tracking/report?athleteUuid=...
   ├─ Calls buildMobilityPayload(athleteUuid, sessionDate?)
   │   ├─ Raw SQL SELECT * from f_mobility (Prisma can't reach dynamic columns)
   │   ├─ For each of 9 MOBILITY_GROUPS → score each COMPONENT (0–100)
   │   ├─ GROUP score = average of scored components
   │   └─ Returns MobilityPayload { athleteUuid, level, score:null, metrics[], sessionDate }
   └─ Calls getMobilityWithPercentiles()
       ├─ getCachedMobilityPopulation() [unstable_cache, 3600s TTL]
       │   └─ Builds payload for up to 150 athletes, aggregates values per metric key
       ├─ attachPercentiles() for every metric
       └─ Returns DomainResult { metrics: MetricWithPercentile[], sessionDate }

4. Frontend: GenericDomain.tsx receives DomainWithMetrics for domainId="mobility"
   ├─ Renders radar chart (9 GROUP metrics) via MetricRadarChart.tsx
   │   └─ Values = group score / 100 × 100 (NOT population percentile)
   ├─ Renders single card table (9 groups, collapsible component pills)
   └─ Contributes GROUP metrics to Highlights/Lowlights tab (filtered out by default)
```

---

## 2. Data Collection — Python Pipeline

### Entry Point

| File | Purpose |
|------|---------|
| `uais/python/mobility/main.py` | Core orchestration: download from Drive, parse Excel, insert to DB |
| `uais/python/mobility/google_drive_utils.py` | Downloads .xlsx copies from Google Drive into local cache |

### Input Files

Source: Google Drive folder `G:\My Drive\Data\Mobility Assessments` (or local DriveFS path).
Each athlete has one `.xlsx` file per assessment session.

### Excel Sheet Layout

| Cell(s) | Field | Notes |
|---------|-------|-------|
| `A6` | Athlete Name | After stripping "Name: " prefix |
| `A7` | Date of Birth | Parsed into ISO date; many formats accepted |
| `B6` | Height | Numeric value extracted, stored in inches |
| `B7` | Weight | Numeric value extracted, stored in lbs |
| `C6` | Email / Gmail | After stripping "Gmail: " prefix |
| `C7` | Primary Position | After stripping "Primary Position: " prefix |
| `D6` | Throwing Velo Max | Numeric; stored as DECIMAL |
| `D7` | Hitting Velo Max | Numeric; stored as DECIMAL |
| `E6` | Hitting Side | String (e.g., "Right", "Left") |
| `E7` | Throwing Side | String (e.g., "Right", "Left") |
| `D11` | Medical History | Merged cell D11:D18; stored as TEXT in `medical_history` column |
| `A11:A80` | Movement name labels | Sanitized to SQL column name (`sanitize_column_name`) |
| `B11:B80` | Measurement values | Converted to float or null |
| `C11:C80` | Optimal ranges | Stored as JSONB in `optimal_ranges` column (e.g., `{"dominant_shoulder_ir": "80-90"}`) |

### Column Name Sanitization (`sanitize_column_name`)

Raw cell A labels are converted: lowercase, spaces/special chars → underscores, deduplicated underscores, stripped leading/trailing underscores. E.g., `"Dominant Shoulder IR"` → `"dominant_shoulder_ir"`.

### Special Conversion: Hawkins Kennedy Test

The Hawkins Kennedy Test value in column B is text, not numeric:
- `"Negative"` → stored as `0.0`
- `"Positive"` → stored as `1.0`
- Other/empty → stored as `null`

### Metric Filtering

Only columns present in `MOBILITY_COLUMNS` frozenset (72 valid columns defined in `uais/python/mobility/main.py`) are inserted. All other row labels are ignored, protecting the schema from template noise.

### Duplicate/Update Logic

Match on `(athlete_uuid, session_date, source_file)`. If already exists → UPDATE. If not → INSERT. The `source_file` column stores the absolute local path used for the match.

---

## 3. Database Schema

### `public.f_mobility` — Primary mobility table

One row per athlete × session. The **dynamic metric columns** (72 measurements) are added at runtime by `ensure_column_exists()` — they are not in the initial Prisma migration. The `buildMobilityPayload()` function reads them with `SELECT *` via raw SQL.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INT (PK) | Auto-increment |
| `athlete_uuid` | VARCHAR(36) | FK → `d_athletes.athlete_uuid` |
| `session_date` | DATE | Date of the mobility assessment |
| `source_system` | VARCHAR(50) | Always `"mobility"` |
| `source_athlete_id` | VARCHAR(100) | Original name from file/cell |
| `created_at` | TIMESTAMP | Insert timestamp |
| `source_file` | TEXT | Absolute path to the source .xlsx |
| `medical_history` | TEXT | Free-text from merged cell D11:D18 |
| `c7_value` | TEXT | Raw C7 cell value (legacy compat) |
| `primary_position` | TEXT | e.g., "RHP", "OF" |
| `throwing_side` | TEXT | "Right" or "Left" |
| `hitting_side` | TEXT | "Right" or "Left" |
| `throwing_velo_max` | DECIMAL | Peak throwing velo (mph) |
| `hitting_velo_max` | DECIMAL | Peak exit velocity (mph) |
| `optimal_ranges` | JSONB | Map of `{ column_key: range_string }` from Column C of the assessment sheet |
| *(72 dynamic columns)* | DECIMAL | See §4 — one column per metric in MOBILITY_COLUMNS |

**Indexes:** `athlete_uuid`, `session_date`, `assessment_date`

> **Critical Note:** The 72 measurement columns are added dynamically by `ensure_column_exists()` in the Python script and are NOT declared in the Prisma schema. The API uses raw SQL `SELECT *` to retrieve them at runtime. Any new metric added to the Excel template automatically gets its own column on first insert.

---

## 4. All 72 Metrics / 9 Groups

Defined in `lib/octane/mobilityPayload.ts` as `MOBILITY_GROUPS`. Each group has a GROUP metric and a set of COMPONENT metrics.

### Group 1 — Cervical (6 components)

| DB Column Key | Display Label | Unit | Scoring |
|--------------|--------------|------|---------|
| `cervical_rotation_r_rom` | Rotation R | ° | Optimal range from sheet |
| `cervical_rotation_l_rom` | Rotation L | ° | Optimal range from sheet |
| `cervical_flexion_rom` | Flexion | ° | Optimal range from sheet |
| `cervical_extension_rom` | Extension | ° | Optimal range from sheet |
| `cervical_lateral_flexion_r_rom` | Lateral Flexion R | ° | Optimal range from sheet |
| `cervical_lateral_flexion_l_rom` | Lateral Flexion L | ° | Optimal range from sheet |

### Group 2 — Shoulder Mobility (7 components)

| DB Column Key | Display Label | Unit | Scoring |
|--------------|--------------|------|---------|
| `horizontal_abduction_rom` | Horizontal Abduction | ° | Optimal range from sheet |
| `back_to_wall_shoulder_flexion` | Back to Wall Flexion | 1/2/3 | **SCALE_3**: value/3 × 100 |
| `dominant_shoulder_ir` | Dominant IR | ° | Optimal range from sheet |
| `dominant_shoulder_er` | Dominant ER | ° | Optimal range from sheet |
| `non_dominant_shoulder_ir` | Non-Dom IR | ° | Optimal range from sheet |
| `non_dominant_shoulder_er` | Non-Dom ER | ° | Optimal range from sheet |
| `young_stretch_passive` | Young Stretch | 1/2/3 | **SCALE_3**: value/3 × 100 |

### Group 3 — Shoulder Stability (8 components)

| DB Column Key | Display Label | Unit | Scoring |
|--------------|--------------|------|---------|
| `hawkins_kennedy_test` | Hawkins Kennedy | Neg/Pos | **Special**: 0→100, 1→50, >1→0 |
| `shoulder_stability_flexion_mmt` | Stability Flexion | lbs | No score (MMT) |
| `shoulder_stability_abduction_mmt` | Stability Abduction | lbs | No score (MMT) |
| `shoulder_stability_er_at_0_deg_horiz_abduction_mmt` | Stability ER | lbs | No score (MMT) |
| `shoulder_stability_ir_at_0_deg_horiz_abduction_mmt` | Stability IR | lbs | No score (MMT) |
| `mid_trap_mmt` | Mid Trap | lbs | No score (MMT) |
| `low_trap_mmt` | Low Trap | lbs | No score (MMT) |
| `scap_winging` | Scap Winging | 1/2/3 | **SCALE_3**: value/3 × 100 |

### Group 4 — Elbow (6 components)

| DB Column Key | Display Label | Unit | Scoring |
|--------------|--------------|------|---------|
| `elbow_extension_rom` | Extension | ° | Optimal range from sheet |
| `elbow_flexion_rom` | Flexion | ° | Optimal range from sheet |
| `elbow_pronation_rom` | Pronation | ° | Optimal range from sheet |
| `elbow_supination_rom` | Supination | ° | Optimal range from sheet |
| `radial_nerve_glide` | Radial Nerve Glide | 1/2/3 | **SCALE_3**: value/3 × 100 |
| `ulnar_nerve_glide` | Ulnar Nerve Glide | 1/2/3 | **SCALE_3**: value/3 × 100 |

### Group 5 — Spine / Core (6 components)

| DB Column Key | Display Label | Unit | Scoring |
|--------------|--------------|------|---------|
| `pelvic_tilt_against_wall` | Pelvic Tilt Wall | 1/2/3 | **SCALE_3**: value/3 × 100 |
| `backbend` | Backbend | 1/2/3 | **SCALE_3**: value/3 × 100 |
| `sittiing_t_spine_pvc_r` | T-Spine PVC R | ° | **Tiered**: ≥80→100, ≥70→65, <70→linear to 44 |
| `sittiing_t_spine_pvc_l` | T-Spine PVC L | ° | **Tiered**: ≥80→100, ≥70→65, <70→linear to 44 |
| `slump_test` | Slump Test | 1/2/3 | **SCALE_3**: value/3 × 100 |
| `isa_rom` | ISA | ° | Optimal range from sheet |

### Group 6 — Hip Mobility (13 components)

| DB Column Key | Display Label | Unit | Scoring |
|--------------|--------------|------|---------|
| `thomas_test_hip_flexor_r` | Thomas Test R | 1/2/3 | **SCALE_3**: value/3 × 100 |
| `thomas_test_hip_flexor_l` | Thomas Test L | 1/2/3 | **SCALE_3**: value/3 × 100 |
| `r_hamstring_stretch_rom` | Hamstring R | ° | Optimal range from sheet |
| `l_hamstring_stretch_rom` | Hamstring L | ° | Optimal range from sheet |
| `r_hip_abduction_rom` | Hip Abduction R | ° | Optimal range from sheet |
| `l_hip_abduction_rom` | Hip Abduction L | ° | Optimal range from sheet |
| `hip_pinch` | Hip Pinch | 1/2/3 | **SCALE_3**: value/3 × 100 |
| `r_hip_flexion_rom` | Hip Flexion R | ° | Optimal range from sheet |
| `l_hip_flexion_rom` | Hip Flexion L | ° | Optimal range from sheet |
| `r_prone_hip_ir` | Prone Hip IR R | ° | Optimal range from sheet |
| `r_prone_hip_er` | Prone Hip ER R | ° | Optimal range from sheet |
| `l_prone_hip_ir` | Prone Hip IR L | ° | Optimal range from sheet |
| `l_prone_hip_er` | Prone Hip ER L | ° | Optimal range from sheet |

### Group 7 — Hip Stability (12 components)

| DB Column Key | Display Label | Unit | Scoring |
|--------------|--------------|------|---------|
| `seated_r_hip_ir_mmt` | Seated Hip IR R | lbs | No score (MMT) |
| `seated_l_hip_ir_mmt` | Seated Hip IR L | lbs | No score (MMT) |
| `seated_r_hip_er_mmt` | Seated Hip ER R | lbs | No score (MMT) |
| `seated_l_hip_er_mmt` | Seated Hip ER L | lbs | No score (MMT) |
| `r_prone_hamstring_raise_mmt` | Hamstring Raise R | lbs | No score (MMT) |
| `l_prone_hamstring_raise_mmt` | Hamstring Raise L | lbs | No score (MMT) |
| `r_prone_glute_raise_mmt` | Glute Raise R | lbs | No score (MMT) |
| `l_prone_glute_raise_mmt` | Glute Raise L | lbs | No score (MMT) |
| `r_hip_abduction_mmt` | Hip Abduction R | lbs | No score (MMT) |
| `l_hip_adduction_mmt` | Hip Adduction L | lbs | No score (MMT) |
| `r_hip_adduction_mmt` | Hip Adduction R | lbs | No score (MMT) |
| `l_hip_abduction_mmt` | Hip Abduction L | lbs | No score (MMT) |

### Group 8 — Ankle (8 components)

| DB Column Key | Display Label | Unit | Scoring |
|--------------|--------------|------|---------|
| `r_ankle_dorsiflexion_to_wall_rom` | Dorsiflexion R | ° | Optimal range from sheet |
| `l_ankle_dorsiflexion_to_wall_rom` | Dorsiflexion L | ° | Optimal range from sheet |
| `r_ankle_dorsiflexion_mmt` | Dorsiflexion MMT R | lbs | No score (MMT) |
| `r_ankle_inversion_mmt` | Inversion R | lbs | No score (MMT) |
| `r_ankle_eversion_mmt` | Eversion R | lbs | No score (MMT) |
| `l_ankle_dorsiflexion_mmt` | Dorsiflexion MMT L | lbs | No score (MMT) |
| `l_ankle_inversion_mmt` | Inversion L | lbs | No score (MMT) |
| `l_ankle_eversion_mmt` | Eversion L | lbs | No score (MMT) |

### Group 9 — Grip Strength (4 components)

| DB Column Key | Display Label | Unit | Scoring |
|--------------|--------------|------|---------|
| `grip_strength_r` | Grip Strength R | lbs | Fallback: `> 50` → linear |
| `gs_l` | Grip Strength L | lbs | Fallback: `> 50` → linear |
| `grip_strength_r_at_90` | GS R at 90° | lbs | Fallback: `> 40` → linear |
| `gs_l_at_90` | GS L at 90° | lbs | Fallback: `> 40` → linear |

---

## 5. API Layer — Payload Builder

### Key Files

| File | Purpose |
|------|---------|
| `lib/octane/mobilityPayload.ts` | `buildMobilityPayload()` — fetches DB row, builds GROUP + COMPONENT metrics |
| `lib/octane/mobilityColumnTypes.ts` | `SCALE_3_COLUMNS`, `isRomDegreeColumn()` — shared column-type constants |
| `lib/athlete-tracking/percentiles.ts` | `getMobilityWithPercentiles()` — population percentile layer |
| `app/api/dashboard/athlete-tracking/report/route.ts` | Main dashboard report endpoint |
| `app/api/dashboard/athlete-tracking/sessions/route.ts` | Returns available session dates per domain |

### `buildMobilityPayload(athleteUuid, sessionDate?)`

```
1. Fetch d_athletes record → derive level (from age_group)
2. Raw SQL: SELECT * FROM public.f_mobility WHERE athlete_uuid = ? [AND session_date = ?]
   ORDER BY session_date DESC, created_at DESC LIMIT 1
3. Extract optimal_ranges JSONB (already parsed as JS object by Postgres driver)
4. For each of 9 MOBILITY_GROUPS:
   a. For each column in group:
      - toNumber(row[column_key]) → rawVal
      - scoreComponent(key, rawVal, optimalRanges) → rangeScore (0-100 or null)
      - Push COMPONENT metric with all metadata
   b. groupScore = average of non-null rangeScores (null if all null)
   c. Push GROUP metric first (before components)
5. Return MobilityPayload { athleteUuid, level, score:null, metrics[], sessionDate }
```

**Return type:**
```typescript
type MobilityPayload = {
  athleteUuid: string;
  level: string;          // PRO | COLLEGE | HIGH_SCHOOL | BASEBALL_CLUB
  score: number | null;   // always null for mobility
  metrics: MobilityPayloadMetric[];
  sessionDate?: string | null; // "YYYY-MM-DD"
};

type MobilityPayloadMetric = {
  category: string;           // groupName (e.g., "Shoulder Mobility")
  name: string;               // groupName for GROUP; column_key for COMPONENT
  value: number | null;       // GROUP: 0-100 score; COMPONENT: raw measurement
  valueUnit: "NUMBER";        // always NUMBER
  orientation: "HIGHER_IS_BETTER";
  mobilityMetricKind: "GROUP" | "COMPONENT";
  mobilityGroup: string;      // groupName — used to link COMPONENTs to their GROUP
  mobilityDisplayLabel: string; // Human-readable label
  mobilityOutOf: 100 | null;  // 100 for GROUP (score/100); null for COMPONENT
  mobilityOptimalRange: string | null; // e.g., "80-90°" — COMPONENT only
  mobilityRangeScore: number | null;  // 0-100 — COMPONENT only
};
```

**Metric payload order** (important for UI):
Each group emits its GROUP metric first, followed immediately by all COMPONENT metrics for that group. The UI uses `mobilityMetricKind` and `mobilityGroup` to re-link them.

---

## 6. Scoring System

All component scores are **0–100**, where 100 = optimal/at or beyond target.

### SCALE_3 Columns (11 columns)

```
score = Math.min(100, Math.max(0, Math.round((value / 3) * 100)))
```

Clinician grades these on a 1/2/3 pass/fail scale:
- 1/3 (33%) — significant limitation
- 2/3 (67%) — partial / borderline
- 3/3 (100%) — meets standard

**SCALE_3 column keys:**
`back_to_wall_shoulder_flexion`, `pelvic_tilt_against_wall`, `radial_nerve_glide`, `ulnar_nerve_glide`, `backbend`, `slump_test`, `thomas_test_hip_flexor_r`, `thomas_test_hip_flexor_l`, `young_stretch_passive`, `hip_pinch`, `scap_winging`

### T-Spine PVC (2 columns — tiered)

Applied to `sittiing_t_spine_pvc_r` and `sittiing_t_spine_pvc_l`:

```
value >= 80  →  score = 100   (green — full pass)
value >= 70  →  score = 65    (amber — borderline)
value <  70  →  score = Math.min(44, Math.round((value / 70) * 44))  (red — limited)
```

### Hawkins Kennedy Test (binary)

`hawkins_kennedy_test` is stored as 0 or 1 (converted from text at ingest):

```
value == 0  →  score = 100   (Negative = pass)
value == 1  →  score = 50    (Positive = concerning)
value >  1  →  score = 0
```

Fallback range key: `"negative"` (defined in `FALLBACK_RANGES`).

### Range-Based Scoring (`scoreAgainstRange`)

Used for all ROM columns that have a stored or fallback optimal range.

**Range string formats parsed by `parseOptimalRange()`:**

| Format | Example | Meaning |
|--------|---------|---------|
| `"X-Y"` or `"X–Y"` | `"80-90"` | Value must be within min–max |
| `">= X"` or `"> X"` | `"> 50"` | Value must be ≥ min |
| `"<= X"` or `"< X"` | `"< 10"` | Value must be ≤ max |
| Bare number `"X"` | `"3"` | Value must be ≥ target |
| `"negative"` | `"negative"` | Boolean pass/fail (for Hawkins Kennedy) |

**Scoring logic per kind:**

```
range (min–max):
  value in [min,max] → 100
  outside → max(0, round((1 - dist/width) × 100))  where dist = overshoot amount

min (>= X):
  value >= min → 100
  else → max(0, round((value / min) × 100))

max (<= X):
  value <= max → 100
  else → max(0, round((max / value) × 100))

target (bare number):
  value >= target → 100
  else → max(0, round((value / target) × 100))
```

### MMT Columns — No Score

All columns with `_mmt` suffix are dynamometer force readings in lbs. No reference population data is available, so `scoreComponent()` returns `null` for these. They appear in the component pill with no border-color score and contribute nothing to the group score.

**MMT columns include:** all `*_mmt` keys across Shoulder Stability, Hip Stability, and Ankle groups.

### Fallback Ranges (Grip Strength)

These are hardcoded in `FALLBACK_RANGES` when no range is stored in `optimal_ranges`:

| Column | Fallback Range | Meaning |
|--------|---------------|---------|
| `grip_strength_r` | `"> 50"` | ≥ 50 lbs = 100% |
| `gs_l` | `"> 50"` | ≥ 50 lbs = 100% |
| `grip_strength_r_at_90` | `"> 40"` | ≥ 40 lbs = 100% |
| `gs_l_at_90` | `"> 40"` | ≥ 40 lbs = 100% |

### Group Score Calculation

```
groupScore = round(sum(scored_component_scores) / scored_component_scores.length)
```

Only components with a non-null `rangeScore` are included in the average. If all components are null (e.g., a group where only MMT columns exist and no range data is available), `groupScore = null` and displays as "—".

---

## 7. Percentile Computation

### `getMobilityWithPercentiles(athleteUuid, sessionDate?)`

```
1. Build target athlete's payload via buildMobilityPayload()
2. getCachedMobilityPopulation() [unstable_cache, 3600s revalidation]:
   a. SELECT DISTINCT athlete_uuid FROM f_mobility LIMIT 150
   b. buildMobilityPayload() for each in batches of 15 (Promise.allSettled)
   c. Build PopulationByKey: Map<"category.name", Array<{athleteUuid, value}>>
3. attachPercentiles(): for each metric in target payload:
   a. metricKey(category, name) → lookup population array
   b. computePercentileRank(value, populationValues, "HIGHER_IS_BETTER")
   c. Attach percentile (0–100)
4. For GROUP metrics: add max: 100 so metricsToRadarData renders value/max correctly
```

### `computePercentileRank(value, population, orientation)`

- **HIGHER_IS_BETTER:** `percentile = (count of population values < value) / population.length × 100`
- All mobility metrics are `HIGHER_IS_BETTER` (higher score = better)

### Important: Radar Uses Score, Not Percentile

The mobility radar chart does **NOT** use population percentile for GROUP metrics. Instead:

```
chartValue = (m.value / m.max) × 100  where m.max = 100
displaySuffix = `${Math.round(m.value)}%`
```

This means the radar always shows 0–100 based on range compliance, not relative ranking. This is intentional because the mobility population can be small, making percentiles less meaningful for the group-level summary.

---

## 8. UI Components

### Component Tree

```
GenericDomain.tsx  (domainId === "mobility")
├─ Session comparison panel (date selector, primary/compare date chips)
├─ MetricRadarChart.tsx  (9 GROUP metrics, values = group scores)
└─ Single <div class="card">
   └─ <table>
      └─ For each of 9 groups:
         ├─ Divider row (border-top line)
         ├─ Group header row (group name + score + "Show/Hide details" button)
         └─ [if expanded] Component grid row (auto-fill pill grid)
```

### `GenericDomain.tsx` — State

The mobility domain uses `expandedMobilityGroups: Record<string, boolean>` lifted into `AthleteTrackingContent.tsx`. Each group is collapsed by default; clicking "Show details" expands its component pills.

### Data Flow: `buildMobilityGroupSections(metrics)`

This helper (in `domainHelpers.ts`) re-links the flat metrics array into group sections:

```typescript
type GroupSection = {
  group: MobilityGroupMetric;        // the GROUP metric (score + metadata)
  components: MobilityComponentMetric[];  // all COMPONENTs for this group
};
```

Filtering: `metrics.filter(m => m.mobilityMetricKind === "GROUP")` → for each group, `metrics.filter(m => m.mobilityMetricKind === "COMPONENT" && m.mobilityGroup === group.category)`.

---

## 9. Group Row & Score Display

Each group renders as a two-column row in the shared table:

```html
<!-- Divider -->
<tr>
  <td colSpan={3}><div style="border-top: 1px solid var(--border)" /></td>
</tr>

<!-- Group header -->
<tr>
  <td style="font-size: 1.08rem; font-weight: 700; padding: 0.55rem 2.5rem 0.4rem">
    <div>
      <span>{groupDisplayLabel}</span>   <!-- e.g. "Shoulder Mobility" -->
      <button class="btn-ghost" style="font-size: 0.72rem; padding: 2px 8px">
        Show details | Hide details
      </button>
    </div>
  </td>
  <td colSpan={2} style="text-align: right; font-size: 1.08rem; font-weight: 700; padding: 0.55rem 2.5rem 0.4rem">
    {scoreText}   <!-- "83%" or "—" -->
  </td>
</tr>
```

**Score display rule:**
```typescript
const scoreValue = Math.round(section.group.value ?? NaN); // NaN if null
const scoreText = isFinite(scoreValue) ? `${scoreValue}%` : "—";
```

---

## 10. Component Pill Display

When a group is expanded, components render in a responsive auto-fill grid:

```css
display: grid;
grid-template-columns: repeat(auto-fill, minmax(175px, 1fr));
column-gap: 0.75rem;
row-gap: 0.55rem;
```

### Pill Structure

```html
<div style="
  border: 1px solid {rangeColor};
  border-radius: 999px;
  background: var(--bg-tertiary);
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
">
  <!-- Label (left, truncated) -->
  <span style="color: var(--text-secondary); font-size: 0.84rem; flex: 1 1 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
    {formatMobilityComponentLabel(component)}
  </span>

  <!-- Value (center-right, bold) -->
  <strong style="font-size: 0.9rem; flex-shrink: 0; white-space: nowrap;">
    {formatMobilityComponentValue(component)}
    <!-- If rangeScore present: -->
    <span style="font-size: 0.75rem; color: {getMobilityRangeColor(rangeScore)}; margin-left: 3px">
      ({rangeScore}%)
    </span>
  </strong>

  <!-- Optimal range pill (right, optional) -->
  {shortRange && (
    <span style="color: var(--text-secondary); font-size: 0.78rem; flex-shrink: 0; white-space: nowrap;">
      {shortRange}
    </span>
  )}
</div>
```

### Border Color (`getMobilityRangeColor`)

The `effectiveScore` for the border is: `component.mobilityRangeScore ?? (component.name.endsWith("_mmt") ? component.percentile : null)`.

```
effectiveScore >= 80  →  border: "#16a34a"             (green)
effectiveScore >= 50  →  border: "#f59e0b"             (amber)
effectiveScore < 50   →  border: "var(--accent-secondary)"  (red)
effectiveScore == null → border: "var(--border)"       (neutral grey)
```

### Optimal Range Display (`condenseMobilityOptimalRange`)

Condenses the raw stored range string into a compact pill label:

| Condition | Output |
|-----------|--------|
| `SCALE_3_COLUMNS` | `null` (range redundant — value already shows "X/3") |
| `hawkins_kennedy_test` | `"Negative"` |
| `sittiing_t_spine_pvc_r/l` | `"70-80"` |
| `gs_l` or `gs_l_at_90` | `"R ±10%"` (comparison to dominant side) |
| Raw ends with `+` (e.g. `"80+"`) | `"≥80"` |
| Contains `"within X% of dominant"` | `"R ±X%"` |
| Contains `"within X-Y%"` | `"±X-Y%"` |
| Short raw string (≤ 12 chars) | Raw as-is |
| Long raw string | First 10 chars + `"…"` |
| No range available | `null` (range span not shown) |

---

## 11. Radar Chart

### Configuration

```typescript
// In domainHelpers.ts: getRadarMetricsForDomain
if (domainId === "mobility") {
  return metrics.filter((m) => m.mobilityMetricKind === "GROUP");
}
```

**9 axes** (one per group):

| Axis Label | DB Column / Group Key |
|-----------|----------------------|
| Cervical | `Cervical` group |
| Shoulder Mobility | `Shoulder Mobility` group |
| Shoulder Stability | `Shoulder Stability` group |
| Elbow | `Elbow` group |
| Spine / Core | `Spine / Core` group |
| Hip Mobility | `Hip Mobility` group |
| Hip Stability | `Hip Stability` group |
| Ankle | `Ankle` group |
| Grip Strength | `Grip Strength` group |

**Value mapping** (`metricsToRadarData()` in `domainHelpers.ts`):

```typescript
// For GROUP metrics with max=100
if (m.mobilityMetricKind === "GROUP" && m.max != null && m.value != null && m.max > 0) {
  chartValue = (m.value / m.max) * 100;   // == m.value since max=100
  displaySuffix = `${Math.round(m.value)}%`;
}
```

- Axis range: 0–100
- `fullMark: 100` for every point
- Tooltip label: `"{GroupName}: {score}%"`

### Multi-Series (Comparison Mode)

Up to 4 series (primary + 3 comparison dates). Colors same as other domains:

| Series Index | Color |
|-------------|-------|
| 0 | `#2c99d4` (Octane blue — primary) |
| 1 | `#d62728` (red) |
| 2 | `#9467bd` (purple) |
| 3 | `#2ca02c` (green) |

---

## 12. Timeline Chart

**Mobility has no timeline chart.** `getTimelineMetricKeys("mobility")` returns `[]`.

The Radar/Timeline toggle is only shown when `timelineKeys.length > 0`, so the toggle does not appear for mobility. The domain always shows the radar chart.

---

## 13. Highlights vs Lowlights

Mobility contributes to the Highlights/Lowlights tab (Tab 0), but **both GROUP and COMPONENT metrics are excluded by default**:

```typescript
// getHighlightsAndLowlights() in domainHelpers.ts
if (
  m.percentile != null &&
  Number.isFinite(m.percentile) &&
  m.mobilityMetricKind !== "GROUP" &&       // ← EXCLUDED
  m.mobilityMetricKind !== "COMPONENT" &&   // ← EXCLUDED
  !HIGHLIGHTS_EXCLUDE_KEYS.has(key)
) { ... }
```

This means mobility currently contributes **zero metrics** to the highlights/lowlights panel. If mobility is ever added to highlights, the `mobilityMetricKind` filter would need to be relaxed for specific component keys.

---

## 14. Value Formatting Rules

Applied in `formatMobilityComponentValue()` (in `domainHelpers.ts`) and `formatMobilityComponentLabel()`:

### Component Value Display

| Condition | Display Format | Example |
|-----------|---------------|---------|
| `SCALE_3_COLUMNS.has(key)` | `"X/3"` | `"2/3"` |
| `key === "hawkins_kennedy_test"` | `"Negative"` (0) or `"Positive"` (1) | `"Negative"` |
| `key.endsWith("_mmt")` | Numeric, up to 1 decimal | `"42.5"` |
| `isRomDegreeColumn(key)` | Numeric + `"°"` | `"85°"` |
| All other | `formatValueWithUnit(value, valueUnit, null)` | `"82"` |

### `isRomDegreeColumn(key)` — True for:

- Any key ending in `_rom`
- Keys in `ROM_DEGREE_MANUAL` set:
  - `dominant_shoulder_ir`, `dominant_shoulder_er`
  - `non_dominant_shoulder_ir`, `non_dominant_shoulder_er`
  - `r_prone_hip_ir`, `r_prone_hip_er`
  - `l_prone_hip_ir`, `l_prone_hip_er`
  - `sittiing_t_spine_pvc_r`, `sittiing_t_spine_pvc_l`

### Group Score Display

```typescript
const scoreText = scoreValue != null ? `${scoreValue}%` : "—";
```

The `%` suffix means range-compliance percentage, not percentile rank.

### Formatting Rule: Decimal vs Integer

```typescript
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
```

Whole numbers display without decimal; fractional values show 1 decimal place.

---

## 15. Color Coding

### Group Score / Range Score → Border Color

| Range Score | Color | Hex |
|------------|-------|-----|
| ≥ 80 | Green | `#16a34a` |
| ≥ 50 | Amber | `#f59e0b` |
| < 50 | Red | `var(--accent-secondary)` = `#d62728` |
| null | Neutral | `var(--border)` = `#30363d` |

### Percentile → Text Color (for any metric with percentile)

| Percentile | Color |
|-----------|-------|
| > 85 | `#16a34a` (bright green — elite) |
| > 60 | `#4ade80` (light green — above average) |
| > 40 | `var(--text-primary)` (white — average) |
| > 15 | `#f59e0b` (amber — developing) |
| ≤ 15 | `var(--accent-secondary)` (red) |

---

## 16. Styling & CSS Variables

```css
--bg-primary:       #0f1419   /* page background */
--bg-secondary:     #1a2332   /* card background */
--bg-tertiary:      #243044   /* pill background */
--bg-elevated:      #2d3a4d   /* hover / modal */
--text-primary:     #e6edf3   /* main text */
--text-secondary:   #8b949e   /* label text, pill labels */
--text-muted:       #6e7681   /* dimmed labels */
--accent:           #2c99d4   /* Octane blue */
--accent-secondary: #d62728   /* red — alerts, low scores */
--border:           #30363d   /* dividers, neutral pill borders */
```

### Typography in Mobility Card

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Session date line | 0.82rem | 400 | `--text-muted` |
| Group name | 1.08rem | 700 | `--text-primary` |
| "Show/Hide details" button | 0.72rem | 400 | `--text-secondary` |
| Group score (right-aligned) | 1.08rem | 700 | `--text-primary` |
| Component label in pill | 0.84rem | 400 | `--text-secondary` |
| Component value in pill | 0.9rem | 700 | `--text-primary` |
| Range score annotation `(X%)` | 0.75rem | 400 | range color (green/amber/red) |
| Optimal range text in pill | 0.78rem | 400 | `--text-secondary` |

### Mobility Card Structure

```html
<div class="card">
  <table style="border-collapse:collapse; width:100%">
    <tbody>
      <!-- Session date row (if present) -->
      <tr>
        <td colSpan={3} class="text-muted" style="font-size:0.82rem; padding:0.35rem 0 1.6rem; border-bottom:none">
          Session Date: {domain.sessionDate}
        </td>
      </tr>

      <!-- For each of 9 groups: -->
      <!-- 1. Divider row -->
      <tr><td colSpan={3}><div style="border-top: 1px solid var(--border)"/></td></tr>

      <!-- 2. Group header row -->
      <tr>
        <td style="font-size:1.08rem; font-weight:700; padding:0.55rem 2.5rem 0.4rem">
          <div style="display:inline-flex; align-items:center; gap:0.55rem">
            <span>{groupName}</span>
            <button class="btn-ghost" style="font-size:0.72rem; padding:2px 8px">
              Show details | Hide details
            </button>
          </div>
        </td>
        <td colSpan={2} style="text-align:right; font-size:1.08rem; font-weight:700; padding:0.55rem 2.5rem 0.4rem">
          {scoreText}
        </td>
      </tr>

      <!-- 3. Component grid row (only when expanded) -->
      <tr>
        <td colSpan={3} style="padding:0.15rem 0 0.95rem; border-bottom:none">
          <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(175px,1fr)); gap:0.55rem 0.75rem">
            <!-- Component pill per metric -->
            <div style="border:1px solid {color}; border-radius:999px; background:var(--bg-tertiary); padding:6px 10px; ...">
              <span>{label}</span>
              <strong>{value}{rangeScoreAnnotation}</strong>
              <span>{condensedRange}</span>
            </div>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

---

## 17. Relevant File Paths

| File | Role |
|------|------|
| `uais/python/mobility/main.py` | Core Python ingestion script — downloads, parses, inserts |
| `uais/python/mobility/google_drive_utils.py` | Google Drive download utility |
| `lib/octane/mobilityPayload.ts` | `buildMobilityPayload()` — 9 groups × components, scoring |
| `lib/octane/mobilityColumnTypes.ts` | `SCALE_3_COLUMNS`, `isRomDegreeColumn()` — shared column type constants |
| `lib/athlete-tracking/percentiles.ts` | `getMobilityWithPercentiles()`, population cache |
| `lib/athlete-tracking/percentile.ts` | `computePercentileRank()` |
| `lib/athlete-tracking/displayNames.ts` | `formatMetricDisplayName()`, `formatValueWithUnit()` |
| `app/dashboard/athlete-tracking/domainHelpers.ts` | Mobility helpers: `buildMobilityGroupSections()`, `formatMobilityComponentValue()`, `formatMobilityComponentLabel()`, `getMobilityRangeColor()`, `condenseMobilityOptimalRange()`, `getRadarMetricsForDomain()` |
| `app/dashboard/athlete-tracking/components/GenericDomain.tsx` | Mobility UI rendering (group rows + component pills) |
| `app/dashboard/athlete-tracking/MetricRadarChart.tsx` | Recharts radar |
| `app/dashboard/athlete-tracking/types.ts` | `MobilityGroupMetric`, `MobilityComponentMetric`, `MetricWithPercentile` |
| `app/api/dashboard/athlete-tracking/report/route.ts` | Main report endpoint |
| `app/api/dashboard/athlete-tracking/sessions/route.ts` | Session date availability |
| `prisma/schema.prisma` | `f_mobility` model (note: 72 measurement columns are dynamic, not all declared) |

---

## Appendix A — Complete MOBILITY_COLUMNS Frozenset

The 72 valid column keys (defined in `uais/python/mobility/main.py`):

```python
# Cervical (6)
cervical_rotation_r_rom, cervical_rotation_l_rom, cervical_flexion_rom,
cervical_extension_rom, cervical_lateral_flexion_r_rom, cervical_lateral_flexion_l_rom

# Shoulder Mobility (7)
horizontal_abduction_rom, back_to_wall_shoulder_flexion,
dominant_shoulder_ir, dominant_shoulder_er, non_dominant_shoulder_ir, non_dominant_shoulder_er,
young_stretch_passive

# Shoulder Stability (8)
hawkins_kennedy_test, shoulder_stability_flexion_mmt, shoulder_stability_abduction_mmt,
shoulder_stability_er_at_0_deg_horiz_abduction_mmt, shoulder_stability_ir_at_0_deg_horiz_abduction_mmt,
mid_trap_mmt, low_trap_mmt, scap_winging

# Elbow (6)
elbow_extension_rom, elbow_flexion_rom, elbow_pronation_rom, elbow_supination_rom,
radial_nerve_glide, ulnar_nerve_glide

# Spine / Core (6)
pelvic_tilt_against_wall, backbend, sittiing_t_spine_pvc_r, sittiing_t_spine_pvc_l, slump_test, isa_rom

# Hip Mobility (13)
thomas_test_hip_flexor_r, thomas_test_hip_flexor_l,
r_hamstring_stretch_rom, l_hamstring_stretch_rom,
r_hip_abduction_rom, l_hip_abduction_rom,
young_stretch_passive, hip_pinch,
r_hip_flexion_rom, l_hip_flexion_rom,
r_prone_hip_ir, r_prone_hip_er, l_prone_hip_ir, l_prone_hip_er

# Hip Stability (12)
seated_r_hip_ir_mmt, seated_l_hip_ir_mmt, seated_r_hip_er_mmt, seated_l_hip_er_mmt,
r_prone_hamstring_raise_mmt, l_prone_hamstring_raise_mmt,
r_prone_glute_raise_mmt, l_prone_glute_raise_mmt,
r_hip_abduction_mmt, l_hip_adduction_mmt, r_hip_adduction_mmt, l_hip_abduction_mmt

# Ankle (8)
r_ankle_dorsiflexion_to_wall_rom, l_ankle_dorsiflexion_to_wall_rom,
r_ankle_dorsiflexion_mmt, r_ankle_inversion_mmt, r_ankle_eversion_mmt,
l_ankle_dorsiflexion_mmt, l_ankle_inversion_mmt, l_ankle_eversion_mmt

# Grip Strength (4)
grip_strength_r, gs_l, grip_strength_r_at_90, gs_l_at_90
```

---

## Appendix B — Replication Checklist

To replicate the mobility report in a new front-end app:

1. **Data source:** Read from `f_mobility` via the existing API or a new endpoint that returns `MobilityPayload`
2. **Dynamic columns:** Use `SELECT *` (raw SQL) — do not enumerate the 72 columns in a schema; they are dynamically added
3. **Optimal ranges:** Read from `optimal_ranges` JSONB column; use `FALLBACK_RANGES` for grip strength and `"negative"` for Hawkins Kennedy
4. **Scoring logic:** Implement all 4 range scoring modes + SCALE_3 + T-spine tiered + Hawkins binary (see §6)
5. **Group score:** Average of non-null component range scores; `null` if all null
6. **Radar:** 9 axes = 9 GROUP metrics; values = `group.value` (already 0–100); no population percentile for radar
7. **Table layout:** Collapsible group rows (score on right) → expandable component pill grid (175px min)
8. **Pill colors:** Green ≥80, Amber ≥50, Red <50 range score; neutral if null
9. **Value formatting:** SCALE_3 → "X/3"; Hawkins → "Negative"/"Positive"; _mmt → numeric; _rom → "X°"
10. **Range pill:** Condense raw range string using condenseMobilityOptimalRange() rules (see §10)
11. **No timeline:** Do not render a timeline chart — no timeline keys are defined for mobility
12. **Highlights/lowlights:** Mobility metrics are currently excluded (both GROUP and COMPONENT) — maintain this exclusion
