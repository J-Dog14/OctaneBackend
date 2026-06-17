# Hitting Report — Complete Reference

> This document covers every layer of the hitting report: data collection → database → API → percentile computation → UI rendering. Intended for replication in the Octane app.

---

## Table of Contents
1. [End-to-End Order of Operations](#1-end-to-end-order-of-operations)
2. [Data Collection — R Pipeline](#2-data-collection--r-pipeline)
3. [Database Schema](#3-database-schema)
4. [Metric Specs (All 29)](#4-metric-specs-all-29)
5. [API Layer](#5-api-layer)
6. [Percentile Computation](#6-percentile-computation)
7. [UI Components](#7-ui-components)
8. [Display Sections (8 Sections)](#8-display-sections-8-sections)
9. [Radar Chart](#9-radar-chart)
10. [Timeline View](#10-timeline-view)
11. [Highlights vs Lowlights](#11-highlights-vs-lowlights)
12. [Styling & CSS Variables](#12-styling--css-variables)

---

## 1. End-to-End Order of Operations

```
1. R script (uais/R/hitting/hitting_processing.R) runs on a local machine
   ├─ Reads session.xml  →  extracts athlete demographics
   ├─ Reads session_data.xml  →  extracts swing kinematics (PROCESSED + PLANE folders)
   └─ Writes rows to PostgreSQL table: f_kinematics_hitting

2. Next.js API: GET /api/dashboard/athlete-tracking/report?athleteUuid=...
   ├─ Calls buildHittingPayload(athleteUuid, sessionDate?)
   │   └─ Queries f_kinematics_hitting for 29+ metric candidates
   │   └─ Computes 3 derived metrics (extensions / total rotations)
   │   └─ Returns HittingPayload { athleteUuid, level, score, metrics[], sessionDate }
   └─ Calls getHittingWithPercentiles()
       └─ Fetches up to 150 athlete UUIDs from f_kinematics_hitting
       └─ Builds payload for each → builds population value arrays
       └─ Runs computePercentileRank() for each metric
       └─ Returns DomainWithMetrics { domainId:"hitting", metrics: MetricWithPercentile[] }

3. Frontend: AthleteTrackingContent.tsx receives AthleteTrackingReport
   ├─ Renders 8 table sections via GenericDomain.tsx
   ├─ Renders radar chart (8 metrics) via MetricRadarChart.tsx
   ├─ Renders timeline charts (6 metrics) via MetricLineChart.tsx
   └─ Renders Highlights/Lowlights card across all domains
```

---

## 2. Data Collection — R Pipeline

### Entry Points

| File | Purpose |
|------|---------|
| `uais/R/hitting/main.R` | GUI folder-picker; sources `hitting_processing.R` and calls `process_all_files()` |
| `uais/R/hitting/hitting_processing.R` | Core engine (~2,400 lines); can also be called directly |

### Input Files (per athlete session folder)

| File | Contains |
|------|---------|
| `session.xml` (or `.gz`) | Athlete demographics: name, DOB, height (m), weight (kg), creation date |
| `session_data.xml` (or `.gz`) | Kinematic metric time series; XML structure: `<v3d> → <owner> → <type value="METRIC"> → <folder> → <name> → <component data="..."/>` |
| `*.json` | 3D motion capture: markers, segment positions, segment rotations, force plate |

### Phase 1 — Athlete Extraction

**Function:** `extract_athlete_info(path)`

Reads `session.xml`, extracts:

| Raw Field | Transformation | Stored As |
|-----------|---------------|-----------|
| `name` | `normalize_name_for_matching()`: removes embedded dates, converts "LAST, FIRST" → "FIRST LAST", uppercases | `normalized_name` |
| `date_of_birth` | MM/DD/YYYY string | `date_of_birth` |
| `height` | meters × 39.3701 | inches |
| `weight` | kg × 2.20462 | lbs |
| `creation_date` | session creation date | used for `age_at_collection` |
| `gender` | "f"/"female" → "Female"; else "Male" | `gender` |

**Age group classification** (`calculate_age_group_from_age`):
- `< 14` → `YOUTH`
- `14–18` → `HIGH SCHOOL`
- `18–22` → `COLLEGE`
- `> 22` → `PRO`

**Output:** Athlete record upserted into `d_athletes` table with `source_system = "hitting"`.

### Phase 2 — Metric Extraction

**Function:** `extract_metric_data(doc, owner_name)`

- Iterates every `<owner>` element in `session_data.xml`
- **Keeps:** owners whose name contains "Swing" (skips "Static" / setup trials)
- **Skips:** `<folder value="AT_EVENT">` entirely
- **Skips** these specific metric patterns:
  - `Back_Foot_wrt_Lab`, `Back_Ankle_Angle`, `Lead_Ankle_Angle`
  - `Back_Hip_Angle`, `Glove_Elbow_Angle`, `Glove_Shoulder_Angle`
  - `Lead_Hip_Angle`, `Back_Knee_Ang_Vel`
  - `COM wrt Lead Heel_vel`, `Combined COP wrt Lead Heel`
- Parses `data` attribute as comma-separated floats → frame array
- **Output row format:** `(owner, folder, variable, value_1, value_2, ..., value_N)` — wide format, one row per metric variable

**Key folders extracted:**
- `PROCESSED` — primary kinematic metrics (angular velocities, angles, separation)
- `PLANE` — bat attack angles and bat orientation at contact
- `BALLSPEED` — ball exit speed (if present)

### Phase 3 — Database Write

With `USE_WAREHOUSE = TRUE` (PostgreSQL):

1. **Pivot** to long format: `(athlete_uuid, session_date, metric_name, frame, value)`
   - `metric_name` = `"folder.variable"` e.g. `"PROCESSED.Max_Bat_Ang_Vel"`
2. **Write** to `f_kinematics_hitting` with `ON CONFLICT DO NOTHING`
3. **Write** trial metadata to `f_hitting_trials` (includes `metrics` JSONB: `{ "folder.variable": [frame1, frame2, ...] }`)
4. **Write** 3D JSON data to `f_hitting_3d_trials`, `f_hitting_marker_data`, `f_hitting_segment_pos_data`, `f_hitting_segment_rot_data`, `f_hitting_force_data`

---

## 3. Database Schema

### `f_kinematics_hitting` — Primary hitting metrics table

This is the table queried by the API for every report.

| Column | Type | Notes |
|--------|------|-------|
| `athlete_uuid` | VARCHAR(36) | FK → `d_athletes.athlete_uuid` |
| `session_date` | DATE | Date of the hitting session |
| `source_system` | VARCHAR(50) | Always `"hitting"` |
| `source_athlete_id` | VARCHAR(100) | Original ID from XML |
| `metric_name` | TEXT | Format: `"folder.variable"` e.g. `"PROCESSED.Max_Bat_Ang_Vel"` |
| `frame` | INTEGER | Frame index (0-based) |
| `value` | NUMERIC | Metric value at that frame |
| `created_at` | TIMESTAMP | Insert timestamp |

**Unique constraint:** `(athlete_uuid, session_date, metric_name, frame)`

**Indexes:** `athlete_uuid`, `session_date`, `metric_name`

> **Important:** The API fetches by `(athlete_uuid, session_date, metric_name)` and uses the **first row returned** (the first frame / single summary frame that holds the peak or mean value). Trial-averaged (`_MEAN`) and raw metric names are stored as distinct `metric_name` values.

### `f_hitting_trials` — Trial-level metadata + metrics JSONB

| Column | Type | Notes |
|--------|------|-------|
| `athlete_uuid` | VARCHAR(36) | |
| `session_date` | DATE | |
| `trial_index` | INTEGER | 1-based per athlete/session |
| `metrics` | JSONB | `{ "PROCESSED.Max_Bat_Ang_Vel": [frame1, frame2, ...] }` |
| `age_at_collection` | NUMERIC | |
| `age_group` | TEXT | YOUTH / HIGH SCHOOL / COLLEGE / PRO |
| `height` | NUMERIC | inches |
| `weight` | NUMERIC | lbs |

### `d_athletes` — Hitting flags

| Column | Type |
|--------|------|
| `has_hitting_data` | Boolean |
| `hitting_session_count` | Int |
| `has_hitting_trial_data` | Boolean |
| `hitting_trial_count` | Int |

---

## 4. Metric Specs (All 29)

Defined in `lib/octane/hittingPayload.ts` as `HITTING_METRIC_SPECS`.

The lookup key used in the UI is always `"CATEGORY|name"` (pipe separator). The DB `metric_name` uses a dot separator `"CATEGORY.name"`.

### Angular Velocities (°/s) — HIGHER_IS_BETTER

| UI Key | Display Label | DB metric_name candidates |
|--------|--------------|--------------------------|
| `PROCESSED\|Max_Pelvis_Ang_Vel` | Pelvis Velo | `PROCESSED.Max_Pelvis_Ang_Vel`, `PROCESSED.Max_Pelvis_Ang_Vel_MEAN` |
| `PROCESSED\|Max_Thorax_Ang_Vel` | Trunk Velo | `PROCESSED.Max_Thorax_Ang_Vel`, `PROCESSED.Max_Thorax_Ang_Vel_MEAN` |
| `PROCESSED\|Max_Lead_Forearm_Ang_Vel` | Arm Velo | `PROCESSED.Max_Lead_Forearm_Ang_Vel`, `PROCESSED.Max_Lead_Forearm_Ang_Vel_MEAN` |
| `PROCESSED\|Max_Lead_Hand_Ang_Vel` | Hand Velo | `PROCESSED.Max_Lead_Hand_Ang_Vel`, `PROCESSED.Max_Lead_Hand_Ang_Vel_MEAN` |
| `PROCESSED\|Max_Bat_Ang_Vel` | Bat Velo | `PROCESSED.Max_Bat_Ang_Vel`, `PROCESSED.Max_Bat_Ang_Vel_MEAN` |

### Linear Velocities (NUMBER) — HIGHER_IS_BETTER

| UI Key | Display Label | DB metric_name candidates |
|--------|--------------|--------------------------|
| `PROCESSED\|Max_RPV_CGPos_VLab_Linear_Vel` | Rear Pelvis Linear Vel | `PROCESSED.Max_RPV_CGPos_VLab_Linear_Vel`, `..._MEAN` |
| `PROCESSED\|Max_RTA_CGPos_VLab_Linear_Vel` | Rear Trunk Linear Vel | `PROCESSED.Max_RTA_CGPos_VLab_Linear_Vel`, `..._MEAN` |

### Bat Path (DEGREES / NUMBER) — HIGHER_IS_BETTER

| UI Key | Display Label | DB metric_name candidates | Unit |
|--------|--------------|--------------------------|------|
| `PLANE\|Horizontal_attack_angle` | Horizontal Attack Angle | `PLANE.Horizontal_attack_angle` | ° |
| `PLANE\|Vertical_attack_angle` | Vertical Attack Angle | `PLANE.Vertical_attack_angle` | ° |
| `PROCESSED\|Bat_travelled_distance_max` | Bat Travelled Distance | `PROCESSED.Bat_travelled_distance_max` | (number) |
| `PLANE\|Bat_Angle_Frontal@Contact` | Frontal @ Contact | `PLANE.Bat_Angle_Frontal@Contact` | ° |
| `PLANE\|Bat_Angle_Sagittal@Contact` | Sagittal @ Contact | `PLANE.Bat_Angle_Sagittal@Contact` | ° |
| `PLANE\|Bat_Angle_Transversal@Contact` | Transversal @ Contact | `PLANE.Bat_Angle_Transversal@Contact` | ° |

### Lead Knee (DEGREES) — HIGHER_IS_BETTER

| UI Key | Display Label | Source | Computation |
|--------|--------------|--------|-------------|
| `PROCESSED\|Lead_Knee_Extension` | Lead Knee Extension | **Computed** | `Angle@Contact − Angle@Lead_Foot_Down` |
| `PROCESSED\|Lead_Knee_Angle@Lead_Foot_Down` | Lead Knee Angle @ FC | Direct DB | `PROCESSED.Lead_Knee_Angle@Lead_Foot_Down[_MEAN]` |
| `PROCESSED\|Lead_Knee_Angle@Contact` | Lead Knee Angle @ Contact | Direct DB | `PROCESSED.Lead_Knee_Angle@Contact[_MEAN]` |

### Pelvis (DEGREES) — HIGHER_IS_BETTER

| UI Key | Display Label | Source | Computation |
|--------|--------------|--------|-------------|
| `PROCESSED\|Pelvis_Angle@Lead_Foot_Down` | Pelvis @ Lead Foot Down | Direct DB | `PROCESSED.Pelvis_Angle@Lead_Foot_Down[_MEAN]` |
| `PROCESSED\|Pelvis_Angle@Contact` | Pelvis @ Contact | Direct DB | `PROCESSED.Pelvis_Angle@Contact` |
| `PROCESSED\|Pelvis_Total_Rotation` | Total Pelvis Rotation | **Computed** | `Angle@Contact − Angle@Lead_Foot_Down` |
| `PROCESSED\|Pelvis_Shoulders_Separation@Setup` | Separation @ Setup | Direct DB | `PROCESSED.Pelvis_Shoulders_Separation@Setup` |
| `PROCESSED\|Pelvis_Shoulders_Separation@Lead_Foot_Down` | Separation @ Lead Foot Down | Direct DB | `PROCESSED.Pelvis_Shoulders_Separation@Lead_Foot_Down[_MEAN]` |
| `PROCESSED\|Pelvis_Shoulders_Separation@Downswing` | Separation @ Downswing | Direct DB | `PROCESSED.Pelvis_Shoulders_Separation@Downswing[_MEAN]` |
| `PROCESSED\|Pelvis_Shoulders_Separation@Max_Bat_Ang_Vel` | Separation @ Max Bat Velo | Direct DB | `PROCESSED.Pelvis_Shoulders_Separation@Max_Bat_Ang_Vel[_MEAN]` |
| `PROCESSED\|Pelvis_Shoulders_Separation@Max_Lead_Hand_Ang_Vel` | Separation @ Max Hand Velo | Direct DB | `PROCESSED.Pelvis_Shoulders_Separation@Max_Lead_Hand_Ang_Vel[_MEAN]` |
| `PROCESSED\|Pelvis_Shoulders_Separation@Contact` | Separation @ Contact | Direct DB | `PROCESSED.Pelvis_Shoulders_Separation@Contact[_MEAN]` |

### Trunk (DEGREES) — HIGHER_IS_BETTER

| UI Key | Display Label | Source | Computation |
|--------|--------------|--------|-------------|
| `PROCESSED\|Trunk_Angle@Lead_Foot_Down` | Trunk @ Lead Foot Down | Direct DB | `PROCESSED.Trunk_Angle@Lead_Foot_Down[_MEAN]` |
| `PROCESSED\|Trunk_Angle@Contact` | Trunk @ Contact | Direct DB | `PROCESSED.Trunk_Angle@Contact` |
| `PROCESSED\|Trunk_Total_Rotation` | Total Trunk Rotation | **Computed** | `Angle@Contact − Angle@Lead_Foot_Down` |

### Stride (NUMBER) — HIGHER_IS_BETTER

| UI Key | Display Label | DB metric_name candidates |
|--------|--------------|--------------------------|
| `PROCESSED\|Stride_Width@Lead_Foot_Down` | Stride Width @ Lead Foot Down | `PROCESSED.Stride_Width@Lead_Foot_Down[_MEAN]` |

---

## 5. API Layer

### Key Files

| File | Purpose |
|------|---------|
| `lib/octane/hittingPayload.ts` | `buildHittingPayload()` — fetches DB rows, resolves 29 metric specs |
| `lib/athlete-tracking/percentiles.ts` | `getHittingWithPercentiles()` — wraps payload with population percentiles |
| `app/api/dashboard/athlete-tracking/report/route.ts` | Main dashboard report endpoint |
| `app/api/dashboard/athlete-tracking/sessions/route.ts` | Returns available session dates per domain |
| `app/api/uais/hitting/route.ts` | Lightweight external API (8 key metrics, API-key protected) |

### `buildHittingPayload(athleteUuid, sessionDate?)`

```
1. Fetch d_athletes record → get age_group → derive level
2. If no sessionDate: findFirst f_kinematics_hitting ORDER BY session_date DESC
3. findMany f_kinematics_hitting WHERE athlete_uuid AND session_date AND metric_name IN [all candidates]
4. Build Map<metric_name, value> (first occurrence wins — frame dedup)
5. For each of 29 HITTING_METRIC_SPECS:
   a. If spec has computeFromMap → call it (computed metrics use 2 direct lookups)
   b. Else: getFirstValue(map, metricNameCandidates)  ← tries each candidate in order
6. Return HittingPayload { athleteUuid, level, score: null, metrics[], sessionDate }
```

**Return type:**
```typescript
type HittingPayload = {
  athleteUuid: string;
  level: string;          // PRO | COLLEGE | HIGH_SCHOOL | BASEBALL_CLUB
  score: number | null;   // always null today
  metrics: Array<{
    category: string;     // "PROCESSED" | "PLANE"
    name: string;         // e.g. "Max_Bat_Ang_Vel"
    value: number | null;
    valueUnit: "DEGREES" | "DEGREES_PER_SECOND" | "NUMBER";
    orientation: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
  }>;
  sessionDate?: string;   // "YYYY-MM-DD"
};
```

### `getHittingWithPercentiles(athleteUuid, sessionDate?)`

```
1. Build target athlete's payload via buildHittingPayload()
2. getCachedHittingPopulation() [unstable_cache, 3600s revalidation]:
   a. Distinct athlete_uuids from f_kinematics_hitting (LIMIT 150)
   b. buildHittingPayload() for each in batches of 15 (Promise.allSettled)
   c. Build PopulationByKey: Map<"CATEGORY.name", Array<{athleteUuid, value}>>
3. For each metric in target payload:
   a. Look up population array by metricKey(category, name)
   b. computePercentileRank(value, populationValues, orientation)
   c. Attach percentile (0–100)
4. Return DomainWithMetrics { domainId: "hitting", label: "Hitting", metrics: MetricWithPercentile[], sessionDate }
```

### `computePercentileRank(value, population, orientation)`

- **HIGHER_IS_BETTER:** `percentile = (count of population values < value) / population.length * 100`
- **LOWER_IS_BETTER:** `percentile = (count of population values > value) / population.length * 100`

---

## 6. Percentile Computation

### Color Thresholds (`getPercentileStyle()` in `domainHelpers.ts`)

```typescript
percentile > 85  →  color: "#16a34a"               // bright green (elite)
percentile > 60  →  color: "#4ade80"               // light green (above average)
percentile > 40  →  color: "var(--text-primary)"   // white (average)
percentile > 15  →  color: "#f59e0b"               // amber (developing)
percentile ≤ 15  →  color: "var(--accent-secondary)" // red #d62728
```

### Display Format

Each metric cell shows:
1. **Primary value** (bold) — formatted number + unit
2. **Percentile line** — `"{N}th %ile"` at 0.78rem, colored by threshold above
3. **Comparison rows** (if date/athlete comparison active) — stacked below with top-border separator

### Unit Formatting (`formatValueWithUnit`)

| valueUnit | unit string | display example |
|-----------|------------|----------------|
| `DEGREES_PER_SECOND` | ` °/s` | `"1042 °/s"` |
| `DEGREES` | `°` | `"34.2°"` |
| `NUMBER` | `""` | `"0.87"` |

---

## 7. UI Components

### Component Tree

```
app/dashboard/athlete-tracking/AthleteTrackingContent.tsx   ← master (2400+ lines)
├─ Tab 0: HighlightsLowlightsCard.tsx
└─ Tab N (hitting): GenericDomain.tsx
    ├─ Compare mode buttons
    ├─ Session date selector panel (when date-compare active)
    ├─ MetricRadarChart.tsx  (or MetricLineChart.tsx if timeline mode)
    └─ 8 × section card (title + description + table)
```

### `AthleteTrackingContent.tsx`

**Key state:**

| State | Type | Purpose |
|-------|------|---------|
| `currentUuid` | string | Active athlete |
| `report` | AthleteTrackingReport | Full report including all domains |
| `pageIndex` | number | 0 = Highlights, 1+ = domain tab |
| `domainCompareDates` | `Record<domainId, string[]>` | Up to 3 comparison session dates |
| `domainViewMode` | `Record<domainId, "radar"\|"timeline">` | Toggle state |
| `domainCompareMode` | `Record<domainId, "none"\|"date"\|"athlete">` | Active compare mode |

### `GenericDomain.tsx`

**Receives:**
- `domain: DomainWithMetrics` — hitting domain with `metrics: MetricWithPercentile[]`
- `compareDomains?: DomainWithMetrics[]` — 0–3 comparison domains (from other dates or athletes)
- `viewMode: "radar" | "timeline"`
- `compareMode: "none" | "date" | "athlete"`

**Renders (in order):**
1. Compare mode toggle buttons ("Compare Sessions" | "Compare Other Athletes")
2. Date selector panel (if `compareMode === "date"`)
3. Radar chart (if `viewMode === "radar"`) OR 6 timeline mini-charts
4. 8 section cards — each: title → description → horizontal scrollable table

### `MetricRadarChart.tsx`

Uses Recharts `RadarChart`.
- Input: `series: Array<{ label: string; data: RadarMetric[] }>`
- `RadarMetric = { subject: string; value: number; fullMark: 100; displayValue: string }`
- Value axis: 0–100 (percentile scale)
- Height: 360px, responsive width
- Fill opacity: 0.2 per series
- Colors from `SERIES_COLORS` (see Section 9)

### `MetricLineChart.tsx`

Uses Recharts `LineChart`.
- One 130px mini-chart per metric key, responsive grid (min 220px per chart)
- X-axis: abbreviated date labels (e.g. "Jan 15")
- Y-axis: auto-scaled, large-number formatted ("1.5k")
- Line: accent color `#2c99d4`, 2px stroke
- Most-recent point: r=5 filled; earlier: r=3 outline

---

## 8. Display Sections (8 Sections)

Defined in `app/dashboard/athlete-tracking/constants.ts` as `HITTING_TABLE_SECTIONS`.

Each section renders as a card with: **title → description → horizontal scrollable table row**.

### Section 1 — Kinematic Sequence
> "Kinematic sequence tracks the order and peak magnitude of segment angular velocities through the swing."

| Col | Key | Label | Unit |
|-----|-----|-------|------|
| 1 | `PROCESSED\|Max_Pelvis_Ang_Vel` | Pelvis Velo | °/s |
| 2 | `PROCESSED\|Max_Thorax_Ang_Vel` | Trunk Velo | °/s |
| 3 | `PROCESSED\|Max_Lead_Forearm_Ang_Vel` | Arm Velo | °/s |
| 4 | `PROCESSED\|Max_Lead_Hand_Ang_Vel` | Hand Velo | °/s |
| 5 | `PROCESSED\|Max_Bat_Ang_Vel` | Bat Velo | °/s |

### Section 2 — Bat Attack Angles
> "Attack angles and travelled distance describe the path and coverage of the bat through contact."

| Col | Key | Label | Unit |
|-----|-----|-------|------|
| 1 | `PLANE\|Horizontal_attack_angle` | Horizontal Attack Angle | ° |
| 2 | `PLANE\|Vertical_attack_angle` | Vertical Attack Angle | ° |
| 3 | `PROCESSED\|Bat_travelled_distance_max` | Bat Travelled Distance | — |

### Section 3 — Bat Angles @ Contact
> "Bat orientation at contact captures how the barrel is presented in frontal, sagittal, and transversal planes."

| Col | Key | Label | Unit |
|-----|-----|-------|------|
| 1 | `PLANE\|Bat_Angle_Frontal@Contact` | Frontal @ Contact | ° |
| 2 | `PLANE\|Bat_Angle_Sagittal@Contact` | Sagittal @ Contact | ° |
| 3 | `PLANE\|Bat_Angle_Transversal@Contact` | Transversal @ Contact | ° |

### Section 4 — Lead Knee Block
> "Lead-leg extension captures block quality, followed by lead-knee position at foot contact and at ball contact."

| Col | Key | Label | Unit |
|-----|-----|-------|------|
| 1 | `PROCESSED\|Lead_Knee_Extension` | Lead Knee Extension | ° |
| 2 | `PROCESSED\|Lead_Knee_Angle@Lead_Foot_Down` | Lead Knee Angle @ FC | ° |
| 3 | `PROCESSED\|Lead_Knee_Angle@Contact` | Lead Knee Angle @ Contact | ° |

### Section 5 — Pelvis
> "Pelvis positioning at lead foot down and contact, plus total pelvis rotation across that window."

| Col | Key | Label | Unit |
|-----|-----|-------|------|
| 1 | `PROCESSED\|Pelvis_Angle@Lead_Foot_Down` | Pelvis @ Lead Foot Down | ° |
| 2 | `PROCESSED\|Pelvis_Angle@Contact` | Pelvis @ Contact | ° |
| 3 | `PROCESSED\|Pelvis_Total_Rotation` | Total Pelvis Rotation | ° |

### Section 6 — Hip-Shoulder Separation
> "Separation values across key swing events show how the pelvis and trunk load/unload through the motion."

| Col | Key | Label | Unit |
|-----|-----|-------|------|
| 1 | `PROCESSED\|Pelvis_Shoulders_Separation@Setup` | Separation @ Setup | ° |
| 2 | `PROCESSED\|Pelvis_Shoulders_Separation@Lead_Foot_Down` | Separation @ Lead Foot Down | ° |
| 3 | `PROCESSED\|Pelvis_Shoulders_Separation@Downswing` | Separation @ Downswing | ° |
| 4 | `PROCESSED\|Pelvis_Shoulders_Separation@Max_Bat_Ang_Vel` | Separation @ Max Bat Velo | ° |
| 5 | `PROCESSED\|Pelvis_Shoulders_Separation@Max_Lead_Hand_Ang_Vel` | Separation @ Max Hand Velo | ° |
| 6 | `PROCESSED\|Pelvis_Shoulders_Separation@Contact` | Separation @ Contact | ° |

### Section 7 — Trunk
> "Trunk positioning at lead foot down and contact, plus total trunk rotation across that window."

| Col | Key | Label | Unit |
|-----|-----|-------|------|
| 1 | `PROCESSED\|Trunk_Angle@Lead_Foot_Down` | Trunk @ Lead Foot Down | ° |
| 2 | `PROCESSED\|Trunk_Angle@Contact` | Trunk @ Contact | ° |
| 3 | `PROCESSED\|Trunk_Total_Rotation` | Total Trunk Rotation | ° |

### Section 8 — Stride Width
> "Stride width at lead foot down helps contextualize lower-half positioning and base stability."

| Col | Key | Label | Unit |
|-----|-----|-------|------|
| 1 | `PROCESSED\|Stride_Width@Lead_Foot_Down` | Stride Width @ Lead Foot Down | — |

---

## 9. Radar Chart

**Allowlist** (`HITTING_RADAR_ALLOWLIST` in `constants.ts`) — exactly these 8 metrics:

| Key | Display Name |
|-----|-------------|
| `PROCESSED\|Max_Bat_Ang_Vel` | Bat Ang Velo |
| `PROCESSED\|Max_Pelvis_Ang_Vel` | Pelvis Ang Velo |
| `PROCESSED\|Max_Thorax_Ang_Vel` | Trunk Ang Velo |
| `PROCESSED\|Max_Lead_Hand_Ang_Vel` | Lead Hand Ang Velo |
| `PROCESSED\|Max_Lead_Forearm_Ang_Vel` | Lead Forearm Ang Velo |
| `PROCESSED\|Pelvis_Shoulders_Separation@Lead_Foot_Down` | Sep @ Lead Foot Down |
| `PROCESSED\|Max_RPV_CGPos_VLab_Linear_Vel` | Rear Pelvis Linear Vel |
| `PROCESSED\|Max_RTA_CGPos_VLab_Linear_Vel` | Rear Trunk Linear Vel |

**Chart values:** percentile (0–100 scale). Each axis label truncated to ~14 chars per line.

**Multi-series colors** (`SERIES_COLORS`):

| Index | Color | Use |
|-------|-------|-----|
| 0 | `#2c99d4` | Primary (Octane blue) |
| 1 | `#d62728` | Comparison 1 (red) |
| 2 | `#9467bd` | Comparison 2 (purple) |
| 3 | `#2ca02c` | Comparison 3 (green) |
| 4 | `#e6c200` | Comparison 4 (yellow) |
| 5 | `#ff7f0e` | Comparison 5 (orange) |

---

## 10. Timeline View

Shown when user toggles "Timeline" mode. 6 metrics for hitting (`getTimelineMetricKeys("hitting")`):

| Order | Key |
|-------|-----|
| 1 | `PROCESSED\|Max_Pelvis_Ang_Vel` |
| 2 | `PROCESSED\|Max_Thorax_Ang_Vel` |
| 3 | `PROCESSED\|Max_Lead_Forearm_Ang_Vel` |
| 4 | `PROCESSED\|Max_Lead_Hand_Ang_Vel` |
| 5 | `PROCESSED\|Max_Bat_Ang_Vel` |
| 6 | `PROCESSED\|Pelvis_Shoulders_Separation@Lead_Foot_Down` |

Each renders as an independent 130px line chart in a responsive grid (min 220px per chart, auto-fill columns).

---

## 11. Highlights vs Lowlights

Shown on Tab 0 before any domain tab. Aggregates across **all domains** (hitting, pitching, mobility, etc.).

**Algorithm:**
1. Collect all `MetricWithPercentile` across all domains
2. Filter: `percentile != null && isFinite(percentile) && mobilityMetricKind !== "GROUP" && mobilityMetricKind !== "COMPONENT"`
3. Exclude keys in `HIGHLIGHTS_EXCLUDE_KEYS` (pitching-specific progress metrics)
4. Sort descending by percentile
5. **Highlights** = top 3; **Lowlights** = bottom 3, reversed (worst first)

Displayed as two lists side by side: metric display name + domain label (dimmed) + percentile value (color-coded).

---

## 12. Styling & CSS Variables

All CSS variables defined in `app/globals.css` (dark theme):

```css
--bg-primary:       #0f1419   /* page background */
--bg-secondary:     #1a2332   /* card background */
--bg-tertiary:      #243044   /* input / button background */
--bg-elevated:      #2d3a4d   /* hover / modal */
--text-primary:     #e6edf3   /* main text */
--text-secondary:   #8b949e   /* secondary */
--text-muted:       #6e7681   /* dimmed labels */
--accent:           #2c99d4   /* Octane blue — primary CTA, links, active states */
--accent-secondary: #d62728   /* red — alerts, lowlights, ≤15th %ile */
--border:           #30363d   /* dividers */
```

### Typography Scale (hitting report)

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Section title (h3) | 1rem | 600 | `--text-primary` |
| Section description | 0.82rem | 400 | `--text-muted` |
| Table header label | 0.9rem | 600 | `--text-primary` |
| Metric value | inherit | bold | `--text-primary` |
| Unit suffix | inherit | 400 | `--text-secondary` |
| Percentile line | 0.78rem | 400 | threshold color |
| Comparison label | 0.68rem | 400 | `--text-muted` |

### Section Card HTML Structure

```html
<div class="card" style="margin-bottom: 1rem;">
  <h3>{section.title}</h3>
  <p class="text-muted" style="font-size: 0.82rem">{section.description}</p>
  <div class="table-scroll-wrapper">
    <table style="border-collapse: collapse; width: 100%">
      <thead>
        <tr>
          <th>{metric.label}</th>  <!-- one <th> per metric in section -->
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>{value}</strong>{unit}
            <!-- e.g. <strong>1042</strong> °/s -->
            <div style="font-size: 0.78rem; margin-top: 0.2rem; color: {percentileColor}">
              {percentile}th %ile
            </div>
            <!-- if comparisons active, stacked below: -->
            <div style="border-top: 1px solid var(--border); margin-top: 0.4rem;">
              <div style="font-size: 0.68rem; color: var(--text-muted)">{compareLabel}</div>
              <span>{compareValue}{compareUnit}</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

---

## Appendix — Relevant File Paths

| File | Role |
|------|------|
| `uais/R/hitting/hitting_processing.R` | Core R data processing script |
| `uais/R/hitting/main.R` | GUI entry point |
| `lib/octane/hittingPayload.ts` | 29-metric spec + `buildHittingPayload()` |
| `lib/athlete-tracking/percentiles.ts` | `getHittingWithPercentiles()` + population cache |
| `lib/athlete-tracking/percentile.ts` | `computePercentileRank()` |
| `lib/athlete-tracking/displayNames.ts` | `formatMetricDisplayName()`, `formatValueWithUnit()` |
| `app/dashboard/athlete-tracking/constants.ts` | `HITTING_TABLE_SECTIONS`, `HITTING_RADAR_ALLOWLIST` |
| `app/dashboard/athlete-tracking/domainHelpers.ts` | `getPercentileStyle()`, `metricsToRadarData()`, `getTimelineMetricKeys()` |
| `app/dashboard/athlete-tracking/AthleteTrackingContent.tsx` | Master UI component |
| `app/dashboard/athlete-tracking/components/GenericDomain.tsx` | Hitting table rendering |
| `app/dashboard/athlete-tracking/MetricRadarChart.tsx` | Recharts radar |
| `app/dashboard/athlete-tracking/MetricLineChart.tsx` | Recharts timeline |
| `app/api/dashboard/athlete-tracking/report/route.ts` | Main report endpoint |
| `app/api/dashboard/athlete-tracking/sessions/route.ts` | Available session dates |
| `prisma/schema.prisma` | `f_kinematics_hitting`, `f_hitting_trials`, `d_athletes` models |
