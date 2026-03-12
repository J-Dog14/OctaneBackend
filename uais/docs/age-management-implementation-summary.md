# Age Management Implementation Summary

## What Has Been Implemented

### 1. Universal Age Utilities Module (`python/common/age_utils.py`)
✅ Created comprehensive age calculation functions:
- `calculate_age()` - Calculate age from DOB
- `calculate_age_at_collection()` - Calculate age at time of collection
- `calculate_age_group()` - Determine age group (YOUTH, HIGH SCHOOL, COLLEGE, PRO)
- `standardize_age_group()` - Convert variations to standard format
- `parse_date()` - Parse dates in various formats
- `get_athlete_dob_for_age_calculation()` - Helper for ETL scripts

### 2. Comprehensive Backfill Script (`python/scripts/backfill_age_and_age_groups.py`)
✅ Implements top-down approach:
- **Step 1**: Backfills DOB from fact tables to d_athletes (if missing)
- **Step 2**: Calculates age_at_collection for all fact tables
- **Step 3**: Updates age and age_group in d_athletes (current age)
- **Step 4**: Standardizes existing age_group values

### 3. Updated athlete_manager (`python/common/athlete_manager.py`)
✅ Automatic age/age_group calculation:
- `create_athlete_in_warehouse()` - Auto-calculates age and age_group from DOB
- `update_athlete_in_warehouse()` - Recalculates when DOB or age changes
- `get_or_create_athlete()` - Uses updated functions automatically

### 4. Updated Existing Backfill Script
✅ Updated `backfill_age_group_columns.py` to use new age group definitions

### 5. Documentation
✅ Created comprehensive guides:
- `docs/age-management-guide.md` - Full implementation guide
- This summary document

## Age Group Definitions

- **YOUTH**: < 13 years
- **HIGH SCHOOL**: 14-18 years (inclusive)
- **COLLEGE**: 18-22 years (inclusive)
- **PRO**: 22+ years

## Next Steps

### 1. Run One-Time Backfill (Required)

```bash
# Test first with dry-run
python python/scripts/backfill_age_and_age_groups.py --dry-run

# Run for real
python python/scripts/backfill_age_and_age_groups.py
```

This will:
- Backfill DOB from fact tables to d_athletes
- Calculate age_at_collection for all existing rows
- Update age and age_group in d_athletes
- Standardize existing age_group values

### 2. Update ETL Scripts to Use New Utilities

All ETL scripts should be updated to:

1. **Import age utilities**:
   ```python
   from python.common.age_utils import (
       get_athlete_dob_for_age_calculation,
       calculate_age_at_collection
   )
   ```

2. **Calculate age_at_collection when inserting data**:
   ```python
   # Get DOB from d_athletes
   dob = get_athlete_dob_for_age_calculation(athlete_uuid, conn)
   
   # Calculate age_at_collection
   if dob and session_date:
       age_at_collection = calculate_age_at_collection(session_date, dob)
   else:
       age_at_collection = None
   
   # Include in INSERT statement
   ```

3. **Do NOT populate age_group in fact tables**
   - Only store age_at_collection
   - age_group is automatically maintained in d_athletes

### 3. Scripts That Need Updates

The following scripts should be updated to use the new age utilities:

- ✅ `R/pitching/pitching_processing.R` - Already calculates age_at_collection, but should use utilities
- `R/hitting/hitting_processing.R` - Needs update
- `python/athleticScreen/main.py` - Needs update
- `python/readinessScreen/main.py` - Already has some age calculation, needs standardization
- `python/proSupTest/main.py` - Needs update
- `python/proteus/etl_proteus.py` - Needs update
- `R/athleticScreen/migrate_athletic_screen_to_postgres.R` - Needs update
- `R/proSupTest/migrate_pro_sup_to_postgres.R` - Needs update
- `R/readinessScreen/migrate_readiness_screen_to_postgres.R` - Needs update

## Key Principles

1. **Top-Down Approach**: d_athletes is source of truth for DOB
2. **age_at_collection**: Stored in fact tables, represents age at time of collection
3. **age_group**: Only in d_athletes, based on CURRENT age
4. **No Retroactive Updates**: age_group only updates when new data is inserted
5. **Historical Accuracy**: age_at_collection preserves age at time of assessment

## Testing Checklist

- [ ] Run backfill script with --dry-run
- [ ] Verify DOB backfill logic works
- [ ] Verify age_at_collection calculation
- [ ] Verify age_group calculation in d_athletes
- [ ] Test with new data insertion
- [ ] Verify age_group doesn't retroactively change for old data
- [ ] Verify age_at_collection is preserved for historical data

## Notes

- The backfill script handles one-time standardization
- Future ETL scripts should use the age utilities
- age_group in fact tables (if present) should not be populated going forward
- All age calculations use the same standardized functions
