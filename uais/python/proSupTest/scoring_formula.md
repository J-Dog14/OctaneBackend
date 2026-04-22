# Pro-Sup Test Scoring Formula

## Weights

| Component         | Weight |
|-------------------|--------|
| ROM               | 70%    |
| Fatigue           | 15%    |
| Consistency       | 15%    |

---

## Step 1 — Fatigue Indices

fatigue_index_10 = 0

fatigue_index_20 = ((ROM_10to20 - ROM_0to10) / ROM_0to10) × 100

fatigue_index_30 = ((ROM_20to30 - ROM_10to20) / ROM_10to20) × 100

---

## Step 2 — Total Fatigue Score

total_fatigue_score = |fatigue_index_10| + |fatigue_index_20| + |fatigue_index_30|

---

## Step 3 — Consistency Penalty

consistency_penalty = std(ROM_0to10, ROM_10to20, ROM_20to30)

---

## Step 4 — Total Score

total_score = (ROM_sum / max_ROM_sum) × 70
            − (total_fatigue_score / max_fatigue) × 15
            − (consistency_penalty / max_consist) × 15

---

### Variable Definitions

| Variable         | Definition                                                                 |
|------------------|----------------------------------------------------------------------------|
| ROM_sum          | ROM_0to10 + ROM_10to20 + ROM_20to30 for the given trial                   |
| max_ROM_sum      | max(ROM_0to10) + max(ROM_10to20) + max(ROM_20to30) across all rows        |
| max_fatigue      | Max value of total_fatigue_score across all rows                          |
| max_consist      | Max value of consistency_penalty across all rows                          |
