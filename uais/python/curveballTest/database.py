"""
Database initialization and data ingestion functions for Curveball Test data.
Now integrated with warehouse database.
"""

import sys
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any

# Add parent directory to path for imports
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from common.athlete_manager import get_or_create_athlete, get_warehouse_connection
from common.session_duplicate_prompt import session_exists, prompt_duplicate_session
from common.athlete_manager import normalize_name_for_matching
from common.athlete_utils import extract_source_athlete_id
from common.session_xml import get_dob_from_session_xml_next_to_file
from config import LINK_MODEL_BASED_PATH, ACCEL_DATA_PATH
from parsers import parse_events, parse_link_model_based_long, parse_accel_long
from utils import compute_pitch_stability_score, parse_file_info

import psycopg2
from psycopg2.extras import execute_values
import pandas as pd


def get_temp_table_name() -> str:
    """Get the name of the temporary table for current session data."""
    return "temp_curveball_test_current_session"


def init_temp_table(conn):
    """
    Create a temporary table for current session data (used for report generation).
    This table matches the structure of f_curveball_test with all individual columns.
    """
    with conn.cursor() as cur:
        # Drop existing temp table if it exists
        cur.execute(f"DROP TABLE IF EXISTS {get_temp_table_name()}")
        
        # Generate all angle/accel column definitions
        offsets = list(range(-20, 31))
        angle_cols = []
        for off in offsets:
            lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
            angle_cols.extend([
                f"x_{lbl} NUMERIC",
                f"y_{lbl} NUMERIC",
                f"z_{lbl} NUMERIC",
                f"ax_{lbl} NUMERIC",
                f"ay_{lbl} NUMERIC",
                f"az_{lbl} NUMERIC"
            ])
        
        # Create temp table with all columns
        create_sql = f"""
        CREATE TEMPORARY TABLE {get_temp_table_name()} (
            id SERIAL PRIMARY KEY,
            athlete_uuid VARCHAR(36) NOT NULL,
            participant_name TEXT,
            session_date DATE NOT NULL,
            filename TEXT,
            pitch_type TEXT,
            foot_contact_frame INTEGER,
            release_frame INTEGER,
            pitch_stability_score NUMERIC,
            {", ".join(angle_cols)}
        )
        """
        cur.execute(create_sql)
        conn.commit()


def clear_temp_table(conn):
    """
    Clear all data from the temporary table.
    This function is called at the start of each analysis run.
    """
    with conn.cursor() as cur:
        cur.execute(f"DELETE FROM {get_temp_table_name()}")
        conn.commit()


def _ingest_pitches_dry_run(events_dict):
    """Print what would be ingested; no DB writes."""
    athlete_dob_cache = {}
    seen_athletes = set()
    print("\n[DRY RUN] Curveball Test - would process:\n")
    for pitch_fp in events_dict.keys():
        p_name, p_date_str, pitch_type = parse_file_info(pitch_fp)
        if p_name not in athlete_dob_cache:
            athlete_dob_cache[p_name] = get_dob_from_session_xml_next_to_file(pitch_fp)
        dob = athlete_dob_cache[p_name]
        if p_name not in seen_athletes:
            seen_athletes.add(p_name)
            print(f"  Athlete: {p_name}")
            print(f"    DOB (session.xml): {dob or '(not found)'}")
        print(f"    Pitch: {pitch_fp}  |  date={p_date_str}  type={pitch_type}")
    print(f"\n  -> Would create/update {len(seen_athletes)} athlete(s), insert {len(events_dict)} row(s) into f_curveball_test")
    print()
    return []


def ingest_pitches_with_events(events_dict, dry_run: bool = False, athlete_uuid: str = None):
    """
    Ingest new pitch data into the warehouse f_curveball_test table.

    Args:
        events_dict: Dictionary mapping pitch filenames to their foot_contact_frame and release_frame
        dry_run: If True, only parse and print what would be done; no DB writes.
        athlete_uuid: Optional. When provided (e.g. Existing Athlete from Octane), use this UUID
            for all rows and do not create a new athlete.
    """
    if dry_run:
        _ingest_pitches_dry_run(events_dict)
        return ([], [])

    conn = get_warehouse_connection()

    try:
        # Initialize temp table
        init_temp_table(conn)

        # Parse data files
        df_angles = parse_link_model_based_long(LINK_MODEL_BASED_PATH)
        df_accel = parse_accel_long(ACCEL_DATA_PATH)
        df_merged = pd.merge(df_angles, df_accel, on="frame", how="inner", suffixes=("_ang", "_acc"))
        
        offsets = list(range(-20, 31))
        
        # Build column names list (matches original pitch_data structure)
        col_names = [
            "athlete_uuid",
            "session_date",
            "source_system",
            "source_athlete_id",
            "filename",
            "pitch_type",
            "foot_contact_frame",
            "release_frame",
            "pitch_stability_score"
        ]
        for off in offsets:
            lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
            col_names.extend([f"x_{lbl}", f"y_{lbl}", f"z_{lbl}", f"ax_{lbl}", f"ay_{lbl}", f"az_{lbl}"])
        
        # Prepare data for bulk insert
        warehouse_rows = []
        temp_col_names = ["athlete_uuid", "participant_name", "session_date", "filename", "pitch_type",
                          "foot_contact_frame", "release_frame", "pitch_stability_score"]
        temp_col_names.extend([f"x_{f'neg{abs(off)}' if off < 0 else f'pos{off}'}" 
                               for off in offsets for _ in ['x', 'y', 'z', 'ax', 'ay', 'az']])
        # Fix temp_col_names - need proper order
        temp_col_names = ["athlete_uuid", "participant_name", "session_date", "filename", "pitch_type",
                          "foot_contact_frame", "release_frame", "pitch_stability_score"]
        for off in offsets:
            lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
            temp_col_names.extend([f"x_{lbl}", f"y_{lbl}", f"z_{lbl}", f"ax_{lbl}", f"ay_{lbl}", f"az_{lbl}"])
        
        temp_rows = []
        processed_athlete_uuids = set()  # Track unique athlete UUIDs processed
        athlete_dob_cache = {}  # p_name -> date_of_birth (from session.xml, once per athlete)
        seen_athlete_names = set()
        athlete_first_seen = []  # (name, created bool or None if provided uuid)

        for pitch_idx, pitch_fp in enumerate(events_dict.keys()):
            foot_fr = events_dict[pitch_fp]["foot_contact_frame"]
            release_fr = events_dict[pitch_fp]["release_frame"]
            pitch_num = pitch_idx + 1

            x_col = f"x_p{pitch_num}"
            y_col = f"y_p{pitch_num}"
            z_col = f"z_p{pitch_num}"
            ax_col = f"ax_p{pitch_num}"
            ay_col = f"ay_p{pitch_num}"
            az_col = f"az_p{pitch_num}"

            if x_col not in df_merged.columns:
                continue

            start_fr = release_fr - 20
            end_fr = release_fr + 30
            slice_df = df_merged[(df_merged["frame"] >= start_fr) & (df_merged["frame"] <= end_fr)]

            # Parse file info
            p_name, p_date_str, pitch_type = parse_file_info(pitch_fp)

            # DOB from session.xml in same folder as file (first row of export has path to .c3d; session.xml is there)
            if p_name not in athlete_dob_cache:
                athlete_dob_cache[p_name] = get_dob_from_session_xml_next_to_file(pitch_fp)

            # Parse date string to date object
            try:
                if p_date_str and p_date_str != "UnknownDate":
                    for fmt in ["%Y-%m-%d", "%m-%d-%Y", "%m/%d/%Y", "%Y_%m_%d"]:
                        try:
                            session_date = datetime.strptime(p_date_str, fmt).date()
                            break
                        except ValueError:
                            continue
                    else:
                        session_date = datetime.now().date()
                else:
                    session_date = datetime.now().date()
            except Exception:
                session_date = datetime.now().date()

            # Use provided athlete_uuid (Existing Athlete flow) or get/create by name
            source_athlete_id = extract_source_athlete_id(p_name)
            if athlete_uuid:
                uuid_to_use = athlete_uuid
                if p_name not in seen_athlete_names:
                    seen_athlete_names.add(p_name)
                    athlete_first_seen.append((p_name, None))
            else:
                uuid_to_use, created = get_or_create_athlete(
                    name=p_name,
                    date_of_birth=athlete_dob_cache.get(p_name),
                    source_system="curveball_test",
                    source_athlete_id=source_athlete_id
                )
                if p_name not in seen_athlete_names:
                    seen_athlete_names.add(p_name)
                    athlete_first_seen.append((p_name, created))
            processed_athlete_uuids.add(uuid_to_use)
            
            # Build row_dict with all angle/accel data
            row_dict = {
                "filename": pitch_fp,
                "participant_name": p_name,
                "pitch_date": p_date_str,
                "pitch_type": pitch_type,
                "foot_contact_frame": foot_fr,
                "release_frame": release_fr
            }
            
            # Convert numpy types to native Python types
            def to_python_float(val):
                """Convert value to native Python float, handling numpy types."""
                if pd.isna(val):
                    return None
                if hasattr(val, 'item'):  # numpy scalar
                    return float(val.item())
                return float(val)
            
            # Collect all angle/accel values
            for off in offsets:
                lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
                actual_fr = release_fr + off
                match = slice_df[slice_df["frame"] == actual_fr]
                
                if not match.empty:
                    row_dict[f"x_{lbl}"] = to_python_float(match.iloc[0][x_col])
                    row_dict[f"y_{lbl}"] = to_python_float(match.iloc[0][y_col])
                    row_dict[f"z_{lbl}"] = to_python_float(match.iloc[0][z_col])
                    row_dict[f"ax_{lbl}"] = to_python_float(match.iloc[0][ax_col])
                    row_dict[f"ay_{lbl}"] = to_python_float(match.iloc[0][ay_col])
                    row_dict[f"az_{lbl}"] = to_python_float(match.iloc[0][az_col])
                else:
                    row_dict[f"x_{lbl}"] = None
                    row_dict[f"y_{lbl}"] = None
                    row_dict[f"z_{lbl}"] = None
                    row_dict[f"ax_{lbl}"] = None
                    row_dict[f"ay_{lbl}"] = None
                    row_dict[f"az_{lbl}"] = None
            
            # Compute stability score
            pitch_stability_score = compute_pitch_stability_score(row_dict)
            
            # Ensure pitch_stability_score is a native Python float (not numpy)
            if pitch_stability_score is not None:
                if hasattr(pitch_stability_score, 'item'):  # numpy scalar
                    pitch_stability_score = float(pitch_stability_score.item())
                elif not isinstance(pitch_stability_score, (int, float)):
                    pitch_stability_score = float(pitch_stability_score)
                else:
                    pitch_stability_score = float(pitch_stability_score)
            
            # Build warehouse row with all columns
            warehouse_row = [
                uuid_to_use,
                session_date,
                "curveball_test",  # source_system
                source_athlete_id,  # source_athlete_id (initials if extracted)
                pitch_fp,  # filename
                pitch_type,  # pitch_type
                int(foot_fr) if foot_fr is not None else None,  # foot_contact_frame
                int(release_fr) if release_fr is not None else None,  # release_frame
                float(pitch_stability_score) if pitch_stability_score is not None else None,  # pitch_stability_score
            ]
            # Add all angle/accel values
            for off in offsets:
                lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
                warehouse_row.extend([
                    row_dict[f"x_{lbl}"],
                    row_dict[f"y_{lbl}"],
                    row_dict[f"z_{lbl}"],
                    row_dict[f"ax_{lbl}"],
                    row_dict[f"ay_{lbl}"],
                    row_dict[f"az_{lbl}"]
                ])
            warehouse_rows.append(tuple(warehouse_row))
            
            # Build temp row
            temp_row = [
                uuid_to_use,
                p_name,  # participant_name
                session_date,
                pitch_fp,
                pitch_type,
                int(foot_fr) if foot_fr is not None else None,
                int(release_fr) if release_fr is not None else None,
                float(pitch_stability_score) if pitch_stability_score is not None else None,
            ]
            # Add all angle/accel values
            for off in offsets:
                lbl = f"neg{abs(off)}" if off < 0 else f"pos{off}"
                temp_row.extend([
                    row_dict[f"x_{lbl}"],
                    row_dict[f"y_{lbl}"],
                    row_dict[f"z_{lbl}"],
                    row_dict[f"ax_{lbl}"],
                    row_dict[f"ay_{lbl}"],
                    row_dict[f"az_{lbl}"]
                ])
            temp_rows.append(tuple(temp_row))
        
        # Safeguard 4 (Existing Athlete): prompt before overwriting existing session(s)
        if athlete_uuid and warehouse_rows:
            unique_sessions = set((row[0], row[1]) for row in warehouse_rows)
            skip_sessions = set()
            for auuid, sdate in unique_sessions:
                if session_exists(conn, "f_curveball_test", auuid, sdate):
                    if not prompt_duplicate_session(sdate):
                        skip_sessions.add((auuid, sdate))
            if skip_sessions:
                warehouse_rows = [r for r in warehouse_rows if (r[0], r[1]) not in skip_sessions]
                temp_rows = [r for r in temp_rows if (r[0], r[2]) not in skip_sessions]
        
        # Bulk insert into warehouse
        if warehouse_rows:
            with conn.cursor() as cur:
                insert_sql = f"""
                INSERT INTO public.f_curveball_test (
                    {", ".join(col_names)}
                ) VALUES %s
                """
                execute_values(cur, insert_sql, warehouse_rows)
                conn.commit()
        
        # Bulk insert into temp table
        if temp_rows:
            with conn.cursor() as cur:
                insert_sql = f"""
                INSERT INTO {get_temp_table_name()} (
                    {", ".join(temp_col_names)}
                ) VALUES %s
                """
                execute_values(cur, insert_sql, temp_rows)
                conn.commit()
        
        return (list(processed_athlete_uuids), athlete_first_seen)
        
    finally:
        conn.close()


def get_current_session_data(conn=None):
    """
    Get current session data from temp table for report generation.
    
    Args:
        conn: Optional database connection (creates new if not provided)
        
    Returns:
        List of dictionaries with current session data
    """
    close_conn = False
    if conn is None:
        conn = get_warehouse_connection()
        close_conn = True
    
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT *
                FROM {get_temp_table_name()}
                ORDER BY id DESC
            """)
            
            columns = [desc[0] for desc in cur.description]
            rows = cur.fetchall()
            
            return [dict(zip(columns, row)) for row in rows]
    finally:
        if close_conn:
            conn.close()
