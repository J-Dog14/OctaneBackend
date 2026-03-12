# Age Group Audit and Standardization Rules

This document states the canonical rules for age and age_group across the UAIS warehouse. All pipelines (Python and R) must follow these rules.

## Canonical categories and bounds

**Standard categories (single source of truth):** `YOUTH`, `HIGH SCHOOL`, `COLLEGE`, `PRO`

**Bounds (aligned in Python `python/common/age_utils.py` and R pitching/hitting):**

| Category     | Age bounds   |
|-------------|--------------|
| YOUTH       | age &lt; 14  |
| HIGH SCHOOL | 14 ≤ age ≤ 18 |
| COLLEGE     | 18 &lt; age ≤ 22 |
| PRO         | age &gt; 22  |

## Two contexts

### d_athletes (dimension)

- **`age_group`** reflects the **age_group of the most recently inserted data** for that athlete.
- Updated **only when new data is run** (any pipeline insert into a fact table). Not "current" age as of today.
- Example: A 15-year-old runs athletic screen → d_athletes.age_group = HIGH SCHOOL. The same athlete returns at 20 for pitching → after that insert, d_athletes.age_group = COLLEGE.
- Implemented by calling `update_athlete_age_group_from_insert(athlete_uuid, age_group)` after each successful fact-table insert.

### Fact tables (f_*)

- **`age_at_collection`** and **`age_group`** reflect **age at assessment**: computed from **session_date** and DOB.
- `age_at_collection = (session_date - date_of_birth) / 365.25`
- `age_group = calculate_age_group(age_at_collection)` using the bounds above.
- Historical rows are never overwritten with "current" age.

## Session date

- Prefer the real collection/assessment date from file or folder.
- If the parsed **session_date is more than two years from the current date**, it is **automatically set to the date of the current run** (today). No flags or prompts—the run continues smoothly.
- Implemented in Python via `normalize_session_date()` in `python/common/age_utils.py`; pipelines use it before computing age_at_collection.

## DOB propagation

- Every pipeline that has DOB (session.xml, XML, file, or folder) must propagate it to `d_athletes` when `d_athletes.date_of_birth` is null (non-destructive fill only).

## Pipelines

- **Python:** Use `python/common/age_utils.py` for `calculate_age_at_collection`, `calculate_age_group`, `normalize_session_date`, and `parse_date`. Do not use local or alternate age-group logic.
- **R:** Use the same bounds (YOUTH &lt; 14, HIGH SCHOOL 14–18, COLLEGE 18–22, PRO &gt; 22) in pitching and hitting processing; ensure DOB and session_date are used correctly for age_at_collection.

## Backfill

- Standardize existing non-null age_group strings to YOUTH / HIGH SCHOOL / COLLEGE / PRO (e.g. U17, "High School" → canonical).
- Set age_at_collection and age_group to NULL where age_at_collection &lt; 0 or &gt; 120.
- Fill null age_group (and age_at_collection where applicable) from d_athletes DOB + session_date.
- Cross-fill: where DOB exists in one source but was missing in d_athletes, fill d_athletes and set age_group from that source; fill other fact tables for that athlete using the new DOB, defaulting to the initial source’s session_date/age_at_collection when a row’s session_date is invalid.

Run the comprehensive backfill with:

```bash
python python/scripts/backfill_age_and_age_groups.py [--dry-run]
```

See also: `python/common/age_utils.py`, `python/common/athlete_manager.py` (`update_athlete_age_group_from_insert`), and the Age Group Audit plan.
