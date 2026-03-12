#!/usr/bin/env python3
"""
Export an anonymized copy of public.f_pitching_trials for sharing outside the organization.

Creates a copy of the table with:
- athlete_uuid replaced by a stable synthetic id (anon_1, anon_2, ...) so recipients can
  group by athlete without identifying anyone
- source_athlete_id, owner_filename, session_xml_path, session_data_xml_path set to null
- Optional row filtering to exclude specific athletes or date ranges

Output: SQLite (.db), CSV, or Excel (.xlsx). SQLite is recommended: one file, metrics
stored cleanly as JSON, queryable in any SQLite client (DB Browser, Python, R).

Usage:
  # Export to SQLite (recommended – clean, single file, queryable)
  python python/scripts/export_anonymized_pitching_trials.py -o pitching_trials_anon.db

  # Export to CSV or Excel
  python python/scripts/export_anonymized_pitching_trials.py -o pitching_trials_anon.csv
  python python/scripts/export_anonymized_pitching_trials.py -o pitching_trials_anon.xlsx

  # Exclude specific athletes (one athlete_uuid per line)
  python python/scripts/export_anonymized_pitching_trials.py -o out.db --exclude-athletes uuids.txt

  # Only include trials on or after a date
  python python/scripts/export_anonymized_pitching_trials.py -o out.db --after-date 2024-01-01

  # Limit number of rows (e.g. sample)
  python python/scripts/export_anonymized_pitching_trials.py -o out.db --limit 5000
"""

import argparse
import csv
import json
import sqlite3
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from python.common.athlete_manager import get_warehouse_connection


# Columns we export. PII/sensitive columns are omitted or anonymized in the query.
EXPORT_COLUMNS = [
    "anon_athlete_id",  # replaced athlete_uuid
    "session_date",
    "source_system",
    "trial_index",
    "velocity_mph",
    "score",
    "age_at_collection",
    "age_group",
    "height",
    "weight",
    "metrics",
    "created_at",
]
# Columns we null out (never export raw): source_athlete_id, owner_filename,
# session_xml_path, session_data_xml_path. athlete_uuid -> anon_athlete_id.


def load_exclude_uuids(path: Path) -> set:
    if not path.exists():
        return set()
    with open(path, encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip()}


def _to_sqlite_numeric(val):
    """Convert Decimal/int/float to float for SQLite; None stays None."""
    if val is None:
        return None
    if hasattr(val, "__float__"):
        return float(val)
    return val


def _write_sqlite(path: Path, rows: list[dict]) -> None:
    """Write anonymized rows to a SQLite database. metrics stored as JSON text."""
    path.unlink(missing_ok=True)  # overwrite: fresh DB each run
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE f_pitching_trials (
            anon_athlete_id TEXT NOT NULL,
            session_date TEXT NOT NULL,
            source_system TEXT NOT NULL,
            trial_index INTEGER NOT NULL,
            velocity_mph REAL,
            score REAL,
            age_at_collection REAL,
            age_group TEXT,
            height REAL,
            weight REAL,
            metrics TEXT,
            created_at TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX idx_f_pitching_trials_anon ON f_pitching_trials(anon_athlete_id)"
    )
    conn.execute(
        "CREATE INDEX idx_f_pitching_trials_session_date ON f_pitching_trials(session_date)"
    )
    def _json_default(obj):
        if hasattr(obj, "__float__"):
            return float(obj)
        raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

    for row in rows:
        metrics_val = row.get("metrics")
        if metrics_val is not None:
            metrics_text = json.dumps(metrics_val, default=_json_default)
        else:
            metrics_text = None
        session_date = row["session_date"]
        if hasattr(session_date, "isoformat"):
            session_date = session_date.isoformat()[:10]
        created_at = row["created_at"]
        if hasattr(created_at, "isoformat"):
            created_at = created_at.isoformat()
        conn.execute(
            """
            INSERT INTO f_pitching_trials
            (anon_athlete_id, session_date, source_system, trial_index, velocity_mph,
             score, age_at_collection, age_group, height, weight, metrics, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["anon_athlete_id"],
                session_date,
                row["source_system"],
                int(row["trial_index"]) if row["trial_index"] is not None else None,
                _to_sqlite_numeric(row["velocity_mph"]),
                _to_sqlite_numeric(row["score"]),
                _to_sqlite_numeric(row["age_at_collection"]),
                row["age_group"],
                _to_sqlite_numeric(row["height"]),
                _to_sqlite_numeric(row["weight"]),
                metrics_text,
                created_at,
            ),
        )
    conn.commit()
    conn.close()


def run(
    output_path: Path,
    exclude_athletes_file: Path | None = None,
    after_date: str | None = None,
    before_date: str | None = None,
    limit: int | None = None,
) -> int:
    conn = get_warehouse_connection()
    exclude_uuids = load_exclude_uuids(exclude_athletes_file) if exclude_athletes_file else set()

    # Build query: select all columns we need, then we'll map athlete_uuid -> anon id
    conditions = []
    params = []
    if after_date:
        conditions.append("t.session_date >= %s")
        params.append(after_date)
    if before_date:
        conditions.append("t.session_date <= %s")
        params.append(before_date)
    if exclude_uuids:
        placeholders = ",".join("%s" for _ in exclude_uuids)
        conditions.append(f"t.athlete_uuid NOT IN ({placeholders})")
        params.extend(exclude_uuids)

    where_sql = (" AND " + " AND ".join(conditions)) if conditions else ""
    limit_sql = f" LIMIT {int(limit)}" if limit else ""

    sql = f"""
        SELECT
            t.athlete_uuid,
            t.session_date,
            t.source_system,
            t.trial_index,
            t.velocity_mph,
            t.score,
            t.age_at_collection,
            t.age_group,
            t.height,
            t.weight,
            t.metrics,
            t.created_at
        FROM public.f_pitching_trials t
        WHERE 1=1
        {where_sql}
        ORDER BY t.session_date, t.athlete_uuid, t.trial_index
        {limit_sql}
    """

    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
    finally:
        conn.close()

    # Map athlete_uuid -> stable anon id (anon_1, anon_2, ...)
    uuid_to_anon = {}
    anon_counter = [0]

    def anon_id(uuid_val):
        if uuid_val not in uuid_to_anon:
            anon_counter[0] += 1
            uuid_to_anon[uuid_val] = f"anon_{anon_counter[0]}"
        return uuid_to_anon[uuid_val]

    # Build export rows: athlete_uuid -> anon_athlete_id, keep rest
    export_rows = []
    for r in rows:
        athlete_uuid, session_date, source_system, trial_index, velocity_mph, score, age_at_collection, age_group, height, weight, metrics, created_at = r
        export_rows.append({
            "anon_athlete_id": anon_id(athlete_uuid),
            "session_date": session_date,
            "source_system": source_system,
            "trial_index": trial_index,
            "velocity_mph": velocity_mph,
            "score": score,
            "age_at_collection": age_at_collection,
            "age_group": age_group,
            "height": height,
            "weight": weight,
            "metrics": metrics,
            "created_at": created_at,
        })

    # Write output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    suffix = output_path.suffix.lower()

    if suffix in (".db", ".sqlite", ".sqlite3"):
        _write_sqlite(output_path, export_rows)
        print(f"Wrote {len(export_rows)} rows to {output_path} (SQLite)")
    elif suffix == ".xlsx":
        try:
            import pandas as pd
        except ImportError:
            print("Excel output requires pandas. Install with: pip install pandas openpyxl", file=sys.stderr)
            return 1
        df = pd.DataFrame(export_rows, columns=EXPORT_COLUMNS)
        # Serialize metrics (JSONB) as string for Excel
        if "metrics" in df.columns and df["metrics"].notna().any():
            df["metrics"] = df["metrics"].apply(lambda x: json.dumps(x) if x is not None else "")
        df.to_excel(output_path, index=False, engine="openpyxl")
        print(f"Wrote {len(export_rows)} rows to {output_path} (Excel)")
    else:
        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=EXPORT_COLUMNS, extrasaction="ignore")
            writer.writeheader()
            for row in export_rows:
                out_row = dict(row)
                if out_row.get("metrics") is not None:
                    out_row["metrics"] = json.dumps(out_row["metrics"])
                writer.writerow(out_row)
        print(f"Wrote {len(export_rows)} rows to {output_path} (CSV)")

    print(f"Anonymized {len(uuid_to_anon)} distinct athletes to anon_1 .. anon_{len(uuid_to_anon)}.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export anonymized f_pitching_trials for external sharing.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("-o", "--output", type=Path, required=True, help="Output file path (.db, .sqlite, .csv, or .xlsx)")
    parser.add_argument("--exclude-athletes", type=Path, default=None, help="File with one athlete_uuid per line to exclude")
    parser.add_argument("--after-date", type=str, default=None, help="Include only session_date >= YYYY-MM-DD")
    parser.add_argument("--before-date", type=str, default=None, help="Include only session_date <= YYYY-MM-DD")
    parser.add_argument("--limit", type=int, default=None, help="Max number of rows to export")
    args = parser.parse_args()
    return run(
        output_path=args.output,
        exclude_athletes_file=args.exclude_athletes,
        after_date=args.after_date,
        before_date=args.before_date,
        limit=args.limit,
    )


if __name__ == "__main__":
    raise SystemExit(main())
