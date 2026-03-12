# Sharing `f_pitching_trials` Outside the Organization

This guide describes how to create an **anonymized copy** of `f_pitching_trials` and share it externally while preserving client anonymity.

## Best course of action

1. **Create an anonymized export** (no live DB access for the recipient).
2. **Remove or redact identifying data** (athlete IDs, file paths, source IDs).
3. **Optionally exclude rows** (specific athletes or date ranges you don’t want to share).
4. **Share a single file** (SQLite, CSV, or Excel) via email, Google Drive, OneDrive, or similar.

## Quick start

From the project root, with your warehouse DB configured:

```bash
# SQLite (recommended) – one file, metrics stored as JSON, queryable in DB Browser / Python / R
python python/scripts/export_anonymized_pitching_trials.py -o pitching_trials_anon.db

# CSV or Excel (if preferred)
python python/scripts/export_anonymized_pitching_trials.py -o pitching_trials_anon.csv
python python/scripts/export_anonymized_pitching_trials.py -o pitching_trials_anon.xlsx
```

Then share the output file (e.g. upload to Google Drive or OneDrive and send a link, or attach to email if size allows). Recipients can open the `.db` file in [DB Browser for SQLite](https://sqlitebrowser.org/), or query it from Python/R.

## What gets anonymized

| Original column              | In export                          |
|----------------------------|-------------------------------------|
| `athlete_uuid`             | Replaced by `anon_athlete_id` (e.g. `anon_1`, `anon_2`) so recipients can group by athlete without identifying anyone. |
| `source_athlete_id`        | Omitted (not exported).            |
| `owner_filename`           | Omitted (not exported).             |
| `session_xml_path`         | Omitted (not exported).             |
| `session_data_xml_path`    | Omitted (not exported).             |
| All other columns          | Exported as-is (dates, velocity, score, age_group, height, weight, metrics, etc.). |

The script **does not** modify your live table; it only reads from it and writes a new file.

## Excluding rows (preserving anonymity)

To remove specific athletes or limit what you share:

**Exclude specific athletes** (one `athlete_uuid` per line in a text file):

```bash
python python/scripts/export_anonymized_pitching_trials.py -o out.db --exclude-athletes uuids_to_exclude.txt
```

**Limit to a date range:**

```bash
python python/scripts/export_anonymized_pitching_trials.py -o out.db --after-date 2024-01-01 --before-date 2025-12-31
```

**Cap the number of rows** (e.g. for a sample):

```bash
python python/scripts/export_anonymized_pitching_trials.py -o out.db --limit 5000
```

You can combine these (e.g. `--exclude-athletes` + `--after-date`).

## Sharing the file

- **Email:** Attach the SQLite/CSV/Excel file if it’s small enough for your mail server.
- **Google Drive / OneDrive / Dropbox:** Upload the file and share a link with “anyone with the link” or specific people.
- **Internal sharepoint or shared drive:** Place the file in a folder and grant the external party access to that folder only.

The recipient does **not** need database access; they only need the exported file. For SQLite (`.db`), they can open it in [DB Browser for SQLite](https://sqlitebrowser.org/) or use it from Python (`sqlite3`) or R (`RSQLite`).

## Optional: stripping more columns

If you want to omit **height**, **weight**, or **age_at_collection** (quasi-identifiers), you can either:

- Edit `EXPORT_COLUMNS` in `python/scripts/export_anonymized_pitching_trials.py` and remove those names, and adjust the `SELECT` and row-building logic to match, or  
- Post-process the CSV/Excel (delete those columns) before sharing.

For most use cases, replacing `athlete_uuid` and dropping paths/source IDs is sufficient.
