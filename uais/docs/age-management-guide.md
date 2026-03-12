# Age and Age Group Management Guide

## Overview

This guide explains the comprehensive age management system implemented across all UAIS ETL scripts and the warehouse database.

**Canonical rules (single source of truth):** See **[age_group_audit_rules.md](age_group_audit_rules.md)** for the current audit rules: d_athletes.age_group = most recent insert; fact tables = age at assessment; session_date auto-correction; canonical bounds (YOUTH &lt; 14, HIGH SCHOOL 14–18, COLLEGE 18–22, PRO &gt; 22).

## Age Group Definitions

Age groups are standardized to one of four categories (align with `python/common/age_utils.py` and R):

- **YOUTH**: age &lt; 14
- **HIGH SCHOOL**: 14 ≤ age ≤ 18
- **COLLEGE**: 18 &lt; age ≤ 22
- **PRO**: age &gt; 22

## Data Storage Strategy

### d_athletes Table (Dimension Table)
- **`date_of_birth`**: Source of truth for athlete DOB
- **`age`**: Current age (calculated from DOB and current date); may be filled when NULL
- **`age_group`**: **Age group of the most recently inserted fact data** for that athlete (updated on each pipeline run that inserts into a fact table; not "current" age)
- **`age_at_collection`**: NOT stored here (this is for fact tables only)

### Fact Tables (f_* tables)
- **`age_at_collection`**: Age at time of data collection (calculated from DOB and session_date)
- **`age_group`**: Age group at assessment (same bounds as above; stored per row)

## Top-Down Approach

1. **d_athletes is the source of truth for DOB**
   - If DOB exists in d_athletes, use it
   - If DOB is NULL in d_athletes, search fact tables and backfill; every pipeline that has DOB must propagate it when d_athletes.date_of_birth is null

2. **age_at_collection and age_group are calculated for each fact table row**
   - Uses DOB (from d_athletes or pipeline) + session_date from fact row
   - If session_date is more than 2 years from today, it is auto-set to the run date
   - Canonical categories: YOUTH, HIGH SCHOOL, COLLEGE, PRO

3. **d_athletes.age_group = most recent insert**
   - After each successful fact-table insert, the pipeline updates d_athletes.age_group to the age_group just written (so the dimension reflects the latest assessment level, not "today’s" age)

## Implementation

### Python Functions

Use `python/common/age_utils.py` for all age calculations:

```python
from python.common.age_utils import (
    calculate_age,
    calculate_age_at_collection,
    calculate_age_group,
    get_athlete_dob_for_age_calculation
)

# Calculate age from DOB
age = calculate_age(date_of_birth)

# Calculate age at collection
age_at_collection = calculate_age_at_collection(session_date, date_of_birth)

# Calculate age group
age_group = calculate_age_group(age)

# Get DOB from d_athletes (for ETL scripts)
dob = get_athlete_dob_for_age_calculation(athlete_uuid)
```

### Automatic Calculation in athlete_manager

The `get_or_create_athlete()` and `update_athlete_in_warehouse()` functions automatically:
- Calculate `age` from `date_of_birth` if DOB is provided
- Calculate `age_group` from calculated age
- Update `age_group` when DOB or age changes

### ETL Script Requirements

When inserting new data into fact tables:

1. **Always calculate `age_at_collection`**:
   ```python
   from python.common.age_utils import get_athlete_dob_for_age_calculation, calculate_age_at_collection
   
   dob = get_athlete_dob_for_age_calculation(athlete_uuid, conn)
   if dob and session_date:
       age_at_collection = calculate_age_at_collection(session_date, dob)
   else:
       age_at_collection = None
   ```

2. **Do NOT populate `age_group` in fact tables**
   - Only `age_at_collection` should be stored
   - `age_group` is only in d_athletes

3. **DOB backfill happens automatically**
   - If DOB is NULL in d_athletes, the backfill script will search fact tables
   - ETL scripts should still try to provide DOB when available

## Backfill Script

Run the comprehensive backfill script to:
1. Backfill DOB from fact tables to d_athletes
2. Calculate age_at_collection for all fact tables
3. Update age and age_group in d_athletes
4. Standardize existing age_group values

```bash
# Dry run first
python python/scripts/backfill_age_and_age_groups.py --dry-run

# Run for real
python python/scripts/backfill_age_and_age_groups.py
```

## Important Rules

1. **Age group only updates when new data is inserted**
   - Prevents athletes from being reclassified as "PRO" in 10 years
   - Old assessments keep their original age_at_collection
   - New data will update age_group based on current age

2. **age_at_collection is historical**
   - Represents age at time of data collection
   - Never changes once set
   - Critical for accurate historical analysis

3. **DOB is the source of truth**
   - Always check d_athletes first
   - Backfill from fact tables if missing
   - Update d_athletes when DOB is found

## Migration Notes

- Existing `age_group` columns in fact tables will be standardized but not populated going forward
- The backfill script handles one-time standardization
- Future ETL scripts should only populate `age_at_collection` in fact tables
