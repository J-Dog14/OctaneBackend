"""
Main orchestration script for Readiness Screen data processing.
Coordinates XML parsing, ASCII file processing, and optional dashboard launch.
"""
import os
import sys
from pathlib import Path

# Add python directory to path so imports work
project_root = Path(__file__).parent.parent.parent
python_dir = project_root / "python"
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from common.config import get_raw_paths
from common.units import inches_to_meters
from common.age_utils import (
    calculate_age_at_collection,
    calculate_age_group,
    normalize_session_date,
    parse_date,
)
from common.athlete_manager import get_warehouse_connection, get_or_create_athlete, update_athlete_age_group_from_insert, verify_athlete_uuid, normalize_name_for_matching
from common.athlete_matcher import update_athlete_data_flag
from common.athlete_utils import extract_source_athlete_id
from common.duplicate_detector import check_and_merge_duplicates
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime

from database import initialize_database, insert_participant, insert_trial_data, get_participant_id
from file_parsers import (
    find_session_xml, parse_xml_file, parse_ascii_file, parse_txt_file,
    extract_name, extract_date, read_first_numeric_row_values,
    select_folder_dialog, ASCII_FILES, find_cmj_ppu_trial_files
)
from athleticScreen.power_analysis import load_power_txt, analyze_power_curve_advanced
from common.session_duplicate_prompt import prompt_duplicate_session
from common.session_xml import normalize_gender
from database_utils import reorder_all_tables
from dashboard import run_dashboard

# Map movement types to PostgreSQL table names
MOVEMENT_TO_PG_TABLE = {
    "I": "f_readiness_screen_i",
    "Y": "f_readiness_screen_y",
    "T": "f_readiness_screen_t",
    "IR90": "f_readiness_screen_ir90",
    "CMJ": "f_readiness_screen_cmj",
    "PPU": "f_readiness_screen_ppu"
}


def _safe_convert(v):
    """Convert numpy scalar types to Python native types for psycopg2 compatibility."""
    if v is None:
        return None
    try:
        import numpy as np
        if isinstance(v, np.integer):
            return int(v)
        if isinstance(v, np.floating):
            return float(v)
        if isinstance(v, np.ndarray):
            return v.tolist()
    except ImportError:
        pass
    return v


def process_xml_and_ascii(folder_path: str, db_path: str,
                          output_path: str, use_dialog: bool = True):
    """
    Process XML and ASCII files for a session.
    
    Args:
        folder_path: Path to folder containing Session XML file.
        db_path: Path to database file.
        output_path: Path to directory containing ASCII output files.
        use_dialog: If True, show folder selection dialog.
    
    Returns:
        Tuple of (participant_name, participant_id).
    """
    print("=" * 60)
    print("Readiness Screen Data Processing")
    print("=" * 60)
    
    # Select folder if using dialog
    if use_dialog:
        selected_folder = select_folder_dialog()
        if not selected_folder:
            print("No folder selected. Exiting...")
            return None, None
        folder_path = selected_folder
    
    # Initialize database
    print("\n1. Initializing database...")
    conn = initialize_database(db_path)
    
    # Find and parse XML file
    print("\n2. Processing XML file...")
    xml_file_path = find_session_xml(folder_path)
    if not xml_file_path:
        print("No XML file found. Exiting...")
        conn.close()
        return None, None
    
    xml_data = parse_xml_file(xml_file_path)
    name = xml_data['name']
    
    # Insert participant (will use existing if found)
    participant_id = insert_participant(
        conn,
        name=xml_data['name'],
        height=xml_data['height'],
        weight=xml_data['weight'],
        plyo_day=xml_data['plyo_day'],
        creation_date=xml_data['creation_date'],
        skip_if_exists=True
    )
    print(f"   Participant: {name} (ID: {participant_id})")
    
    # Process ASCII files
    print("\n3. Processing ASCII files...")
    processed_count = 0
    skipped_count = 0
    
    for movement_type, filename in ASCII_FILES.items():
        file_path = os.path.join(output_path, filename)
        
        if not os.path.exists(file_path):
            print(f"   (skip) {filename} not found")
            skipped_count += 1
            continue
        
        # Parse ASCII file
        df = parse_ascii_file(file_path, movement_type)
        print(f"   {filename} preview:\n{df.head()}")
        
        # Insert each row
        for _, row in df.iterrows():
            insert_trial_data(
                conn,
                table_name=movement_type,
                name=name,
                participant_id=participant_id,
                data=row.to_dict(),
                creation_date=xml_data['creation_date']
            )
        
        processed_count += 1
        print(f"   Processed {filename} -> {movement_type}")
    
    conn.close()
    print(f"\n   Processed: {processed_count} files")
    print(f"   Skipped: {skipped_count} files")
    
    return name, participant_id


def upsert_grip(athlete_uuid: str, session_date, left_kg: float, right_kg: float,
                dominant_hand: str = None, notes: str = None, conn=None) -> None:
    """
    Insert or update one grip row in f_readiness_screen_grip.
    Computed fields (avg_kg, max_kg, asymmetry_pct) are derived here, not by a DB trigger.
    """
    close_conn = conn is None
    if conn is None:
        conn = get_warehouse_connection()
    try:
        avg_kg = (left_kg + right_kg) / 2 if (left_kg is not None and right_kg is not None) else None
        max_kg = max(left_kg, right_kg) if (left_kg is not None and right_kg is not None) else None
        asym_pct = (
            100.0 * abs(left_kg - right_kg) / max_kg
            if max_kg and max_kg > 0 else None
        )
        row = {
            'athlete_uuid': athlete_uuid,
            'session_date': session_date,
            'source_system': 'readiness_screen',
            'left_kg': left_kg,
            'right_kg': right_kg,
            'avg_kg': avg_kg,
            'max_kg': max_kg,
            'asymmetry_pct': asym_pct,
            'dominant_hand': dominant_hand,
            'entry_source': 'manual',
            'notes': notes,
        }
        with conn.cursor() as cur:
            cur.execute("""
                SELECT 1 FROM public.f_readiness_screen_grip
                WHERE athlete_uuid = %s AND session_date = %s
            """, (athlete_uuid, session_date))
            exists = cur.fetchone() is not None
            if exists:
                update_cols = ['left_kg', 'right_kg', 'avg_kg', 'max_kg', 'asymmetry_pct',
                               'dominant_hand', 'entry_source', 'notes']
                set_parts = ", ".join(f"{c} = %s" for c in update_cols)
                vals = [row[c] for c in update_cols] + [athlete_uuid, session_date]
                cur.execute(
                    f"UPDATE public.f_readiness_screen_grip SET {set_parts} "
                    f"WHERE athlete_uuid = %s AND session_date = %s",
                    vals
                )
            else:
                cols = list(row.keys())
                cur.execute(
                    f"INSERT INTO public.f_readiness_screen_grip ({', '.join(cols)}) "
                    f"VALUES ({', '.join(['%s'] * len(cols))})",
                    [row[c] for c in cols]
                )
            conn.commit()
    finally:
        if close_conn:
            conn.close()


def process_txt_files(output_path: str, athlete_uuid: str = None, profile: dict = None):
    """
    Process all txt files from Output Files directory and insert into PostgreSQL.
    Extracts name and date from first line of each txt file (like Athletic Screen).

    Args:
        output_path: Path to directory containing txt files (e.g., 'D:/Readiness Screen 3/Output Files/')
        athlete_uuid: Optional. When provided (e.g. Existing Athlete from Octane), use this UUID for all
            inserts and do not create a new athlete.
        profile: Optional dict of existing profile fields; only missing fields are filled from data.

    Returns:
        List of tuples (participant_name, athlete_uuid) for processed files.
    """
    print("Readiness Screen")
    existing_athlete_flow = bool(athlete_uuid)
    
    if not os.path.exists(output_path):
        raise ValueError(f"Directory not found: {output_path}")
    
    pg_conn = get_warehouse_connection()

    # When running for a specific athlete, fetch their canonical name so we can reject
    # files that clearly belong to someone else (e.g. mixed output folder).
    expected_normalized_name = None
    if existing_athlete_flow:
        try:
            with pg_conn.cursor() as cur:
                cur.execute(
                    "SELECT name FROM analytics.d_athletes WHERE athlete_uuid = %s",
                    (athlete_uuid,)
                )
                row = cur.fetchone()
                if row:
                    expected_normalized_name = normalize_name_for_matching(row[0])
                    print(f"Name guard active: only files matching '{row[0]}' will be processed")
        except Exception as e:
            print(f"Warning: Could not fetch athlete name for name guard: {e}")

    # Build ordered list of (movement_type, file_path, trial_id) for all movements.
    # Isometric movements use a single fixed-name file; CMJ/PPU use one file per trial.
    files_to_process = []

    for movement_type, filename in ASCII_FILES.items():
        file_path = os.path.join(output_path, filename)
        if os.path.exists(file_path):
            files_to_process.append((movement_type, file_path, None))

    cmj_ppu = find_cmj_ppu_trial_files(output_path)
    for movement_type, trial_files in cmj_ppu.items():
        for trial_id, file_path in enumerate(trial_files, start=1):
            files_to_process.append((movement_type, file_path, trial_id))

    if not files_to_process:
        print("No txt files found in Output Files directory.")
        pg_conn.close()
        return []

    # Parse session XML once for gender (default Male if missing)
    session_gender = "Male"
    xml_file_path = find_session_xml(output_path)
    if xml_file_path:
        try:
            xml_data = parse_xml_file(xml_file_path)
            session_gender = normalize_gender(xml_data.get("gender"))
        except Exception:
            pass
    
    print(f"Processing {len(files_to_process)} files")

    # Process each txt file - extract name and date from first line
    processed_athletes = {}  # Track athletes by (name, date) -> athlete_uuid
    duplicate_session_prompted = set()
    duplicate_session_skip = set()
    processed = []
    errors = []
    inserted_count = 0
    updated_count = 0
    successfully_processed_files = []  # files to delete after the loop

    for movement_type, file_path, trial_id in files_to_process:
        try:
            # Parse txt file - extracts name and date from first line
            parsed_data = parse_txt_file(file_path, movement_type)
            
            if not parsed_data:
                print(f"Warning: Skipping {file_path} - failed to parse")
                continue
            
            name = parsed_data['name']
            date_str = parsed_data['date']

            # Name guard: when athlete_uuid is provided, skip files that belong to someone else
            if existing_athlete_flow and expected_normalized_name:
                file_norm = normalize_name_for_matching(name)
                if not (file_norm == expected_normalized_name or
                        file_norm.startswith(expected_normalized_name)):
                    print(f"Skipping {os.path.basename(file_path)}: "
                          f"'{name}' does not match target athlete — not inserting")
                    continue

            athlete_key = (normalize_name_for_matching(name), date_str)
            
            # Get or create athlete (or use provided athlete_uuid when running for Existing Athlete)
            if athlete_key not in processed_athletes:
                try:
                    if athlete_uuid:
                        processed_athletes[athlete_key] = athlete_uuid
                        print(f"Athlete: {name}")
                        print("Successful match with athlete in DB")
                    else:
                        source_athlete_id = extract_source_athlete_id(name)
                        athlete_uuid, created = get_or_create_athlete(
                            name=name,
                            source_system="readiness_screen",
                            source_athlete_id=source_athlete_id,
                            gender=session_gender
                        )
                        processed_athletes[athlete_key] = athlete_uuid
                        print(f"Athlete: {name}")
                        print("New athlete profile created" if created else "Successful match with athlete in DB")
                    update_athlete_data_flag(pg_conn, processed_athletes[athlete_key], "readiness_screen", has_data=True)
                except Exception as e:
                    print(f"Error: {str(e)}")
                    import traceback
                    traceback.print_exc()
                    errors.append(f"{file_path}: Failed to get athlete UUID - {str(e)}")
                    continue
            
            athlete_uuid = processed_athletes[athlete_key]
            
            # Get DOB for age calculation
            with pg_conn.cursor() as cur:
                cur.execute("""
                    SELECT date_of_birth FROM analytics.d_athletes 
                    WHERE athlete_uuid = %s
                """, (athlete_uuid,))
                result = cur.fetchone()
                dob = result[0] if result else None
            
            # Calculate age_at_collection and age_group (canonical: YOUTH, HIGH SCHOOL, COLLEGE, PRO)
            age_at_collection = None
            age_group = None
            if dob:
                try:
                    session_date = datetime.strptime(date_str, "%Y-%m-%d").date()
                    dob_date = dob if hasattr(dob, 'year') else parse_date(str(dob))
                    if dob_date:
                        session_date = normalize_session_date(session_date)
                        if session_date:
                            date_str = session_date.strftime("%Y-%m-%d")
                        age_at_collection = calculate_age_at_collection(session_date, dob_date)
                        if age_at_collection is not None and (age_at_collection < 0 or age_at_collection > 120):
                            age_at_collection = None
                        age_group = calculate_age_group(age_at_collection) if age_at_collection is not None else None
                except Exception:
                    pass
            
            # Map to PostgreSQL table
            pg_table = MOVEMENT_TO_PG_TABLE.get(movement_type)
            if not pg_table:
                print(f"Warning: No PostgreSQL table mapping for {movement_type}")
                continue

            # Power analysis (CMJ/PPU only) — run before upsert so phase cols are included
            pa = {}
            power_file = None
            if movement_type in {"CMJ", "PPU"}:
                trial_name = parsed_data.get('trial_name', '')
                power_file = os.path.join(output_path, f"{trial_name}_Power.txt")
                if os.path.exists(power_file):
                    try:
                        power_data = load_power_txt(power_file)
                        jh_m = inches_to_meters(parsed_data.get('JH_IN'))
                        pa = analyze_power_curve_advanced(
                            power_data, fs_hz=1000.0,
                            jump_height_m=jh_m,
                            movement_type=movement_type,
                        )
                    except Exception as e:
                        print(f"Warning: Power file analysis failed for {trial_name}_Power.txt: {e}")

            # Prepare data for insertion
            if movement_type in {"CMJ", "PPU"}:
                insert_data = {
                    'athlete_uuid': athlete_uuid,
                    'session_date': date_str,
                    'source_system': 'readiness_screen',
                    'source_athlete_id': extract_source_athlete_id(name),
                    'trial_id': trial_id,
                    'age_at_collection': age_at_collection,
                    'age_group': age_group,
                    'jump_height': _safe_convert(parsed_data.get('JH_IN')),
                    'pp_w_per_kg': _safe_convert(parsed_data.get('PP_W_per_kg')),
                    'pp_forceplate': _safe_convert(parsed_data.get('PP_FORCEPLATE')),
                    'force_at_pp': _safe_convert(parsed_data.get('Force_at_PP')),
                    'vel_at_pp': _safe_convert(parsed_data.get('Vel_at_PP')),
                    # Phase metrics from power analysis (None if no power file)
                    'contraction_time_s': _safe_convert(pa.get('contraction_time_s')),
                    'eccentric_duration_s': _safe_convert(pa.get('eccentric_duration_s')),
                    'concentric_duration_s': _safe_convert(pa.get('concentric_duration_s')),
                    'ecc_con_duration_ratio': _safe_convert(pa.get('ecc_con_duration_ratio')),
                    'eccentric_mean_power_w': _safe_convert(pa.get('eccentric_mean_power_w')),
                    'eccentric_peak_power_w': _safe_convert(pa.get('eccentric_peak_power_w')),
                    'eccentric_auc_j': _safe_convert(pa.get('eccentric_auc_j')),
                    'concentric_auc_j': _safe_convert(pa.get('concentric_auc_j')),
                    'mrsi': _safe_convert(pa.get('mrsi')),
                }
            else:
                # Y, IR90 columns
                insert_data = {
                    'athlete_uuid': athlete_uuid,
                    'session_date': date_str,
                    'source_system': 'readiness_screen',
                    'source_athlete_id': extract_source_athlete_id(name),
                    'age_at_collection': age_at_collection,
                    'age_group': age_group,
                    'avg_force': parsed_data.get('Avg_Force'),
                    'avg_force_norm': parsed_data.get('Avg_Force_Norm'),
                    'max_force': parsed_data.get('Max_Force'),
                    'max_force_norm': parsed_data.get('Max_Force_Norm'),
                    'time_to_max': parsed_data.get('Time_to_Max')
                }

            # Build WHERE clause — CMJ/PPU key includes trial_id; ISO uses (athlete, date) only
            if movement_type in {"CMJ", "PPU"}:
                where_clause = "athlete_uuid = %s AND session_date = %s AND trial_id = %s"
                where_params = (athlete_uuid, date_str, trial_id)
                update_cols = [
                    'jump_height', 'pp_w_per_kg', 'pp_forceplate', 'force_at_pp',
                    'vel_at_pp', 'age_at_collection', 'age_group',
                    'contraction_time_s', 'eccentric_duration_s', 'concentric_duration_s',
                    'ecc_con_duration_ratio', 'eccentric_mean_power_w', 'eccentric_peak_power_w',
                    'eccentric_auc_j', 'concentric_auc_j', 'mrsi',
                ]
            else:
                where_clause = "athlete_uuid = %s AND session_date = %s"
                where_params = (athlete_uuid, date_str)
                update_cols = ['avg_force', 'avg_force_norm', 'max_force', 'max_force_norm',
                               'time_to_max', 'age_at_collection', 'age_group']

            # Safeguard (Existing Athlete only): prompt before overwriting an existing row
            if existing_athlete_flow:
                key = (athlete_uuid, date_str)
                if key in duplicate_session_skip:
                    continue
                if key not in duplicate_session_prompted:
                    with pg_conn.cursor() as cur:
                        cur.execute(f"""
                            SELECT 1 FROM public.{pg_table}
                            WHERE {where_clause}
                            LIMIT 1
                        """, where_params)
                        row_exists = cur.fetchone() is not None
                    if row_exists:
                        if not prompt_duplicate_session(date_str):
                            duplicate_session_skip.add(key)
                            errors.append(f"{file_path}: User chose not to overwrite existing session {date_str}")
                            continue
                        duplicate_session_prompted.add(key)

            # UPSERT: Check if row exists, then update or insert
            with pg_conn.cursor() as cur:
                cur.execute(f"""
                    SELECT COUNT(*) FROM public.{pg_table}
                    WHERE {where_clause}
                """, where_params)

                exists = cur.fetchone()[0] > 0

                if exists:
                    set_parts = [f"{col} = %s" for col in update_cols]
                    update_values = [insert_data[col] for col in update_cols]
                    update_values.extend(list(where_params))

                    cur.execute(f"""
                        UPDATE public.{pg_table}
                        SET {', '.join(set_parts)}
                        WHERE {where_clause}
                    """, update_values)
                    updated_count += 1
                    update_athlete_age_group_from_insert(athlete_uuid, age_group, conn=pg_conn)
                else:
                    cols = list(insert_data.keys())
                    placeholders = ', '.join(['%s'] * len(cols))
                    col_names = ', '.join(cols)
                    values = [insert_data[col] for col in cols]

                    cur.execute(f"""
                        INSERT INTO public.{pg_table} ({col_names})
                        VALUES ({placeholders})
                    """, values)
                    inserted_count += 1
                    update_athlete_age_group_from_insert(athlete_uuid, age_group, conn=pg_conn)

                pg_conn.commit()
                successfully_processed_files.append(file_path)

            # Power curve upsert for CMJ/PPU (uses pa computed above)
            if movement_type in {"CMJ", "PPU"} and pa:
                try:
                    pc_data = {
                        'athlete_uuid': athlete_uuid,
                        'session_date': date_str,
                        'movement_type': movement_type,
                        'trial_id': trial_id,
                        'source_file': power_file,
                        'fs_hz': 1000,
                        'n_samples': _safe_convert(pa.get('n_samples')),
                        'peak_power_w': _safe_convert(pa.get('peak_power_w')),
                        'time_to_peak_s': _safe_convert(pa.get('time_to_peak_s')),
                        'rise_time_10_90_s': _safe_convert(pa.get('rise_time_10_90_s')),
                        'rise_slope_w_per_s': _safe_convert(pa.get('rise_slope_w_per_s')),
                        'fwhm_s': _safe_convert(pa.get('fwhm_s')),
                        'auc_j': _safe_convert(pa.get('auc_j')),
                        't_com_s': _safe_convert(pa.get('t_com_s')),
                        't_com_norm_0to1': _safe_convert(pa.get('t_com_norm_0to1')),
                        'cv_local_peak': _safe_convert(pa.get('cv_local_peak')),
                        'rpd_max_w_per_s': _safe_convert(pa.get('rpd_max_w_per_s')),
                        'time_to_rpd_max_s': _safe_convert(pa.get('time_to_rpd_max_s')),
                        'auc_pre_j': _safe_convert(pa.get('auc_pre_j')),
                        'auc_post_j': _safe_convert(pa.get('auc_post_j')),
                        'work_early_pct': _safe_convert(pa.get('work_early_pct')),
                        'decay_90_10_s': _safe_convert(pa.get('decay_90_10_s')),
                        'skewness': _safe_convert(pa.get('skewness')),
                        'kurtosis': _safe_convert(pa.get('kurtosis')),
                        'spectral_centroid_hz': _safe_convert(pa.get('spectral_centroid_hz')),
                        # Phase metrics
                        'contraction_time_s': _safe_convert(pa.get('contraction_time_s')),
                        'eccentric_duration_s': _safe_convert(pa.get('eccentric_duration_s')),
                        'concentric_duration_s': _safe_convert(pa.get('concentric_duration_s')),
                        'ecc_con_duration_ratio': _safe_convert(pa.get('ecc_con_duration_ratio')),
                        'eccentric_mean_power_w': _safe_convert(pa.get('eccentric_mean_power_w')),
                        'eccentric_peak_power_w': _safe_convert(pa.get('eccentric_peak_power_w')),
                        'eccentric_auc_j': _safe_convert(pa.get('eccentric_auc_j')),
                        'concentric_auc_j': _safe_convert(pa.get('concentric_auc_j')),
                        'mrsi': _safe_convert(pa.get('mrsi')),
                    }
                    with pg_conn.cursor() as cur:
                        cur.execute("""
                            SELECT COUNT(*) FROM public.f_readiness_screen_power_curve
                            WHERE athlete_uuid = %s AND session_date = %s
                              AND movement_type = %s AND trial_id = %s
                        """, (athlete_uuid, date_str, movement_type, trial_id))
                        pc_exists = cur.fetchone()[0] > 0

                        if pc_exists:
                            pc_update_cols = [c for c in pc_data if c not in
                                              ('athlete_uuid', 'session_date', 'movement_type', 'trial_id')]
                            set_parts = [f"{c} = %s" for c in pc_update_cols]
                            vals = [pc_data[c] for c in pc_update_cols]
                            vals.extend([athlete_uuid, date_str, movement_type, trial_id])
                            cur.execute(f"""
                                UPDATE public.f_readiness_screen_power_curve
                                SET {', '.join(set_parts)}
                                WHERE athlete_uuid = %s AND session_date = %s
                                  AND movement_type = %s AND trial_id = %s
                            """, vals)
                        else:
                            pc_cols = list(pc_data.keys())
                            cur.execute(f"""
                                INSERT INTO public.f_readiness_screen_power_curve ({', '.join(pc_cols)})
                                VALUES ({', '.join(['%s'] * len(pc_cols))})
                            """, [pc_data[c] for c in pc_cols])

                        pg_conn.commit()
                except Exception as e:
                    print(f"Warning: Could not upsert power curve for trial {trial_id}: {e}")
            
            if athlete_key not in [p[0:2] for p in processed]:
                processed.append((name, athlete_uuid, date_str))
                
        except Exception as e:
            error_msg = f"{file_path}: {str(e)}"
            errors.append(error_msg)
            print(f"Error: {str(e)}")
            import traceback
            traceback.print_exc()
    
    # Delete successfully processed files to prevent re-processing on the next run
    if successfully_processed_files:
        print(f"Deleting {len(successfully_processed_files)} processed file(s)...")
        for _fp in successfully_processed_files:
            try:
                os.remove(_fp)
                # Also remove the corresponding power file if it exists
                _base = os.path.splitext(os.path.basename(_fp))[0]
                _pw = os.path.join(output_path, f"{_base}_Power.txt")
                if os.path.exists(_pw):
                    os.remove(_pw)
            except Exception as _de:
                print(f"Warning: Could not delete {os.path.basename(_fp)}: {_de}")

    # Update athlete flags for all successfully processed athletes
    try:
        pg_conn = get_warehouse_connection()
        for _, athlete_uuid, _ in processed:
            update_athlete_data_flag(pg_conn, athlete_uuid, "readiness_screen", has_data=True)
        pg_conn.close()
    except Exception as e:
        print(f"Warning: Could not update athlete flags: {str(e)}")
    
    # Check for duplicate athletes and prompt to merge
    if processed:
        try:
            pg_conn = get_warehouse_connection()
            processed_uuids = [uuid for _, uuid, _ in processed]
            check_and_merge_duplicates(conn=pg_conn, athlete_uuids=processed_uuids)
            pg_conn.close()
        except Exception as e:
            print(f"Warning: Could not check for duplicates: {str(e)}")
    
    if errors:
        for error in errors:
            print(f"Error: {error}")
    
    if inserted_count + updated_count > 0:
        print("Successful run and upload.")

    # Score each unique athlete-session
    try:
        from scoring import compute_and_upsert_score
    except ImportError:
        try:
            from readinessScreen.scoring import compute_and_upsert_score
        except ImportError:
            compute_and_upsert_score = None

    if compute_and_upsert_score and processed:
        scored_sessions = set()
        for _n, uuid_s, date_s in processed:
            key = (uuid_s, date_s)
            if key in scored_sessions:
                continue
            scored_sessions.add(key)
            try:
                from datetime import date as _date_cls
                session_date_obj = datetime.strptime(date_s, "%Y-%m-%d").date()
                compute_and_upsert_score(uuid_s, session_date_obj)
                print(f"Scored: {uuid_s} {date_s}")
            except Exception as _se:
                print(f"Warning: Scoring failed for {uuid_s} {date_s}: {_se}")

    return [(name, uuid) for name, uuid, _ in processed]


def main():
    """
    Main execution function.
    Configure paths and processing options here.
    """
    # Get paths from config (or use defaults)
    # Following notebook logic: base_dir is where Data folders are, output_path is shared Output Files
    try:
        raw_paths = get_raw_paths()
        base_dir = raw_paths.get('readiness_screen', os.getenv('READINESS_SCREEN_DATA_DIR', 'D:/Readiness Screen 3/Data/'))
        output_path = raw_paths.get('readiness_screen_output', os.getenv('READINESS_SCREEN_OUTPUT_DIR', 'D:/Readiness Screen 3/Output Files/'))
    except:
        base_dir = os.getenv('READINESS_SCREEN_DATA_DIR', 'D:/Readiness Screen 3/Data/')
        output_path = os.getenv('READINESS_SCREEN_OUTPUT_DIR', 'D:/Readiness Screen 3/Output Files/')
    
    # Database is in the parent directory (following notebook)
    # Use the standard path from the notebook: D:/Readiness Screen 3/Readiness_Screen_Data_v2.db
    # If base_dir is a placeholder path, use the default location
    if 'path/to' in base_dir or not os.path.exists(base_dir):
        # Use default location from environment variable
        db_path = os.getenv('READINESS_SCREEN_DB', 'D:/Readiness Screen 3/Readiness_Screen_Data_v2.db')
    else:
        # Normalize the path to handle trailing slashes
        base_dir_normalized = base_dir.rstrip('/\\')
        if base_dir_normalized.endswith('Data'):
            db_dir = os.path.dirname(base_dir_normalized)
        else:
            db_dir = base_dir_normalized
        
        db_path = os.path.join(db_dir, 'Readiness_Screen_Data_v2.db')
    
    db_path = os.path.abspath(db_path)  # Use absolute path
    
    # Ensure directory exists
    db_dir_abs = os.path.dirname(db_path)
    if not os.path.exists(db_dir_abs):
        os.makedirs(db_dir_abs, exist_ok=True)
    
    # Processing options
    BATCH_PROCESS = True  # Process all folders in directory (False = single folder)
    USE_FOLDER_DIALOG = True  # Show folder selection dialog (only if BATCH_PROCESS=False)
    REORDER_DATABASE = True  # Reorder tables alphabetically
    LAUNCH_DASHBOARD = False  # Launch Dash dashboard after processing
    
    if BATCH_PROCESS:
        # Step 1: Process txt files from Output Files directory
        # Extract name and date from first line of each txt file (like Athletic Screen)
        # Insert directly into PostgreSQL
        athlete_uuid_env = os.environ.get("ATHLETE_UUID", "").strip() or None
        if athlete_uuid_env:
            _vconn = get_warehouse_connection()
            try:
                _rec = verify_athlete_uuid(_vconn, athlete_uuid_env)
                print(f"Athlete UUID verified: {_rec['name']} ({athlete_uuid_env})")
            except ValueError as _ve:
                print(f"Error: {_ve}")
                sys.exit(1)
            finally:
                _vconn.close()
        processed = process_txt_files(output_path, athlete_uuid=athlete_uuid_env, profile=None)
        
        if not processed:
            print("No folders were processed.")
            return
        
        # Step 2: Reorder database (optional)
        if REORDER_DATABASE:
            reorder_all_tables(db_path, sort_column="Name")
        
        # Step 3: Launch dashboard (optional)
        if LAUNCH_DASHBOARD:
            run_dashboard(db_path, port=8051, debug=True)
        else:
            print("All processing complete.")
    else:
        # Single folder processing (original behavior)
        # Step 1: Process XML and ASCII files
        name, participant_id = process_xml_and_ascii(
            folder_path=base_dir,
            db_path=db_path,
            output_path=output_path,
            use_dialog=USE_FOLDER_DIALOG
        )
        
        if name is None:
            print("Processing failed or cancelled.")
            return
        
        # Step 2: Reorder database (optional)
        if REORDER_DATABASE:
            reorder_all_tables(db_path, sort_column="Name")
        
        # Step 3: Launch dashboard (optional)
        if LAUNCH_DASHBOARD:
            run_dashboard(db_path, port=8051, debug=True)
        else:
            print("All processing complete.")


if __name__ == "__main__":
    main()

