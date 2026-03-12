"""
Database initialization and data ingestion functions for Arm Action data.
Now integrated with warehouse database.
"""

import sys
import re
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any

# Add parent directory to path for imports
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from common.athlete_manager import get_or_create_athlete, get_warehouse_connection
from common.athlete_manager import normalize_name_for_matching
from common.athlete_utils import extract_source_athlete_id
from common.session_duplicate_prompt import session_exists, prompt_duplicate_session
from common.session_xml import get_dob_from_session_xml_next_to_file
from config import CAPTURE_RATE
from parsers import parse_events_from_aPlus, parse_aplus_kinematics, parse_file_info
from utils import compute_score

import psycopg2
from psycopg2.extras import execute_values


def get_temp_table_name() -> str:
    """Get the name of the temporary table for current session data."""
    return "temp_arm_action_current_session"


def init_temp_table(conn):
    """
    Create a temporary table for current session data (used for report generation).
    This table is cleared at the start of each run.
    """
    with conn.cursor() as cur:
        # Drop existing temp table if it exists
        cur.execute(f"DROP TABLE IF EXISTS {get_temp_table_name()}")
        
        # Create temp table with same structure as f_arm_action
        create_sql = f"""
        CREATE TEMPORARY TABLE {get_temp_table_name()} (
            id SERIAL PRIMARY KEY,
            athlete_uuid VARCHAR(36) NOT NULL,
            participant_name TEXT,
            session_date DATE NOT NULL,
            filename TEXT,
            movement_type TEXT,
            foot_contact_frame INTEGER,
            release_frame INTEGER,
            arm_abduction_at_footplant NUMERIC,
            max_abduction NUMERIC,
            shoulder_angle_at_footplant NUMERIC,
            max_er NUMERIC,
            arm_velo NUMERIC,
            max_torso_rot_velo NUMERIC,
            torso_angle_at_footplant NUMERIC,
            score NUMERIC
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


def _ingest_data_dry_run(events_dict, kinematics):
    """Print what would be ingested; no DB writes."""
    athlete_dob_cache = {}
    seen_athletes = set()
    row_count = 0
    print("\n[DRY RUN] Arm Action - would process:\n")
    for row in kinematics:
        fn = row.get("filename", "").strip()
        if not fn:
            continue
        p_name, p_date_str, m_type = parse_file_info(fn)
        if p_name not in athlete_dob_cache:
            athlete_dob_cache[p_name] = get_dob_from_session_xml_next_to_file(fn)
        dob = athlete_dob_cache[p_name]
        if p_name not in seen_athletes:
            seen_athletes.add(p_name)
            print(f"  Athlete: {p_name}")
            print(f"    DOB (session.xml): {dob or '(not found)'}")
        print(f"    Row: {fn}  |  date={p_date_str}  movement={m_type}")
        row_count += 1
    print(f"\n  -> Would create/update {len(seen_athletes)} athlete(s), insert {row_count} row(s) into f_arm_action")
    print()
    return ([], [])


def ingest_data(aPlusDataPath: str, aPlusEventsPath: str, dry_run: bool = False, athlete_uuid: str = None):
    """
    Ingest data into the warehouse f_arm_action table and temp table.

    Args:
        aPlusDataPath: Path to APlusData.txt file
        aPlusEventsPath: Path to aPlus_events.txt file
        dry_run: If True, only parse and print what would be done; no DB writes.
        athlete_uuid: Optional. When provided (e.g. Existing Athlete from Octane), use this UUID
            for all rows and do not create a new athlete.
    """
    events_dict = parse_events_from_aPlus(aPlusEventsPath, capture_rate=CAPTURE_RATE)
    kinematics = parse_aplus_kinematics(aPlusDataPath)

    if dry_run:
        _ingest_data_dry_run(events_dict, kinematics)
        return ([], [])

    conn = get_warehouse_connection()

    try:
        # Initialize temp table
        init_temp_table(conn)

        # Prepare data for bulk insert
        warehouse_rows = []
        temp_rows = []
        processed_athlete_uuids = set()  # Track unique athlete UUIDs processed
        athlete_dob_cache = {}  # p_name -> date_of_birth (from session.xml, once per athlete)
        seen_athlete_names = set()
        athlete_first_seen = []  # (name, created bool or None if provided uuid)

        processed_count = 0
        for row in kinematics:
            fn = row.get("filename", "").strip()
            if not fn:
                continue

            fc = events_dict.get(fn, {}).get("foot_contact_frame")
            rel = events_dict.get(fn, {}).get("release_frame")
            p_name, p_date_str, m_type = parse_file_info(fn)

            # Parse date string to date object
            try:
                # Try to parse date (format may vary)
                if p_date_str and p_date_str != "UnknownDate":
                    # Try common date formats
                    for fmt in ["%Y-%m-%d", "%m-%d-%Y", "%m/%d/%Y", "%Y_%m_%d"]:
                        try:
                            session_date = datetime.strptime(p_date_str, fmt).date()
                            break
                        except ValueError:
                            continue
                    else:
                        # If no format matched, use today's date
                        session_date = datetime.now().date()
                else:
                    session_date = datetime.now().date()
            except Exception:
                session_date = datetime.now().date()

            # DOB from session.xml in same folder as file (first row of export has path to .c3d; session.xml is there)
            if p_name not in athlete_dob_cache:
                athlete_dob_cache[p_name] = get_dob_from_session_xml_next_to_file(fn)

            # Use provided athlete_uuid (Existing Athlete flow) or get/create by name
            source_athlete_id = extract_source_athlete_id(p_name)
            if athlete_uuid:
                uuid_to_use = athlete_uuid
                if p_name not in seen_athlete_names:
                    seen_athlete_names.add(p_name)
                    athlete_first_seen.append((p_name, None))  # None = provided, treat as match
            else:
                uuid_to_use, created = get_or_create_athlete(
                    name=p_name,
                    date_of_birth=athlete_dob_cache.get(p_name),
                    source_system="arm_action",
                    source_athlete_id=source_athlete_id
                )
                if p_name not in seen_athlete_names:
                    seen_athlete_names.add(p_name)
                    athlete_first_seen.append((p_name, created))
            processed_athlete_uuids.add(uuid_to_use)
            
            # Pull the numeric fields from row
            abd_fp = row.get("Arm_Abduction@Footplant") or 0
            max_abd = row.get("Max_Abduction") or 0
            shld_fp = row.get("Shoulder_Angle@Footplant") or 0
            max_er = row.get("Max_ER") or 0
            arm_velo = row.get("Arm_Velo") or 0
            torso_velo = row.get("Max_Torso_Rot_Velo") or 0
            torso_ang = row.get("Torso_Angle@Footplant") or 0
            
            # Compute the score
            score_val = compute_score(
                arm_velo,
                torso_velo,
                abd_fp,
                shld_fp,
                max_er
            )
            
            # Prepare row for warehouse
            warehouse_row = (
                uuid_to_use,
                session_date,
                "arm_action",  # source_system
                source_athlete_id,  # source_athlete_id (initials if extracted)
                fn,  # filename
                m_type,  # movement_type
                fc,  # foot_contact_frame
                rel,  # release_frame
                abd_fp,  # arm_abduction_at_footplant
                max_abd,  # max_abduction
                shld_fp,  # shoulder_angle_at_footplant
                max_er,  # max_er
                arm_velo,  # arm_velo
                torso_velo,  # max_torso_rot_velo
                torso_ang,  # torso_angle_at_footplant
                score_val  # score
            )
            warehouse_rows.append(warehouse_row)
            
            # Prepare row for temp table (includes participant_name for reports)
            temp_row = (
                uuid_to_use,
                p_name,  # participant_name (for reports)
                session_date,
                fn,
                m_type,
                fc,
                rel,
                abd_fp,
                max_abd,
                shld_fp,
                max_er,
                arm_velo,
                torso_velo,
                torso_ang,
                score_val
            )
            temp_rows.append(temp_row)
            
            processed_count += 1
        
        # Safeguard 4 (Existing Athlete): prompt before overwriting existing session(s)
        if athlete_uuid and warehouse_rows:
            unique_sessions = set((row[0], row[1]) for row in warehouse_rows)
            skip_sessions = set()
            for auuid, sdate in unique_sessions:
                if session_exists(conn, "f_arm_action", auuid, sdate):
                    if not prompt_duplicate_session(sdate):
                        skip_sessions.add((auuid, sdate))
            if skip_sessions:
                warehouse_rows = [r for r in warehouse_rows if (r[0], r[1]) not in skip_sessions]
                temp_rows = [r for r in temp_rows if (r[0], r[2]) not in skip_sessions]
        
        # Bulk insert into warehouse
        if warehouse_rows:
            with conn.cursor() as cur:
                insert_sql = """
                INSERT INTO public.f_arm_action (
                    athlete_uuid, session_date, source_system, source_athlete_id,
                    filename, movement_type, foot_contact_frame, release_frame,
                    arm_abduction_at_footplant, max_abduction,
                    shoulder_angle_at_footplant, max_er,
                    arm_velo, max_torso_rot_velo, torso_angle_at_footplant,
                    score
                ) VALUES %s
                """
                execute_values(cur, insert_sql, warehouse_rows)
                conn.commit()
        
        # Bulk insert into temp table
        if temp_rows:
            with conn.cursor() as cur:
                insert_sql = f"""
                INSERT INTO {get_temp_table_name()} (
                    athlete_uuid, participant_name, session_date,
                    filename, movement_type, foot_contact_frame, release_frame,
                    arm_abduction_at_footplant, max_abduction,
                    shoulder_angle_at_footplant, max_er,
                    arm_velo, max_torso_rot_velo, torso_angle_at_footplant,
                    score
                ) VALUES %s
                """
                execute_values(cur, insert_sql, temp_rows)
                conn.commit()
        
        # Return (list of unique athlete UUIDs, list of (name, created) for first-seen athletes)
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
                SELECT 
                    participant_name, session_date, movement_type,
                    foot_contact_frame, release_frame,
                    arm_abduction_at_footplant, max_abduction,
                    shoulder_angle_at_footplant, max_er,
                    arm_velo, max_torso_rot_velo, torso_angle_at_footplant,
                    score
                FROM {get_temp_table_name()}
                ORDER BY id DESC
            """)
            
            columns = [desc[0] for desc in cur.description]
            rows = cur.fetchall()
            
            return [dict(zip(columns, row)) for row in rows]
    finally:
        if close_conn:
            conn.close()
