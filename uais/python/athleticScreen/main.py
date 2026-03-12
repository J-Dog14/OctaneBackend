"""
Main orchestration script for Athletic Screen data processing.
Processes all txt files in a directory and inserts data directly into PostgreSQL.
Uses athlete matching logic to prevent duplicates and update existing records.
"""
import os
import sys
import shutil
from pathlib import Path
from datetime import datetime
from typing import List, Tuple

# Add python directory to path so imports work
project_root = Path(__file__).parent.parent.parent
python_dir = project_root / "python"
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from common.config import get_raw_paths
from common.age_utils import (
    calculate_age_at_collection,
    calculate_age_group,
    normalize_session_date,
    parse_date,
)
from common.athlete_manager import (
    get_warehouse_connection,
    get_or_create_athlete,
    update_athlete_in_warehouse,
    update_athlete_age_group_from_insert,
    merge_by_email,
    normalize_email,
    normalize_name_for_matching,
)
from common.athlete_matcher import update_athlete_data_flag
from common.athlete_utils import extract_source_athlete_id
from common.duplicate_detector import check_and_merge_duplicates
from common.session_duplicate_prompt import prompt_duplicate_session
from common.session_xml import get_dob_from_session_xml_next_to_file, parse_email_from_session_xml, parse_gender_from_session_xml, normalize_gender
from file_parsers import parse_movement_file
from power_analysis import load_power_txt, analyze_power_curve_advanced

# Map movement types to PostgreSQL table names
MOVEMENT_TO_PG_TABLE = {
    'CMJ': 'f_athletic_screen_cmj',
    'DJ': 'f_athletic_screen_dj',
    'PPU': 'f_athletic_screen_ppu',
    'SLV': 'f_athletic_screen_slv',
    'NMT': 'f_athletic_screen_nmt'
}


def get_athletes_with_athletic_screen_data(conn, athlete_name_filter=None):
    """
    Return list of (athlete_uuid, name, session_date) for athletes that have
    any athletic screen fact data, using their most recent session date.
    Optionally filter by athlete name (ILIKE).
    """
    with conn.cursor() as cur:
        cur.execute("""
            WITH sessions AS (
                SELECT athlete_uuid, session_date FROM public.f_athletic_screen_cmj
                UNION ALL
                SELECT athlete_uuid, session_date FROM public.f_athletic_screen_dj
                UNION ALL
                SELECT athlete_uuid, session_date FROM public.f_athletic_screen_ppu
                UNION ALL
                SELECT athlete_uuid, session_date FROM public.f_athletic_screen_slv
            ),
            latest AS (
                SELECT athlete_uuid, MAX(session_date) AS session_date
                FROM sessions
                GROUP BY athlete_uuid
            )
            SELECT a.athlete_uuid, a.name, l.session_date::text
            FROM analytics.d_athletes a
            JOIN latest l ON l.athlete_uuid = a.athlete_uuid
            ORDER BY l.session_date DESC
        """)
        rows = cur.fetchall()
    def _date_str(d):
        if d is None:
            return None
        if hasattr(d, 'strftime'):
            return d.strftime('%Y-%m-%d')
        return str(d)[:10]
    out = [(r[0], r[1], _date_str(r[2])) for r in rows if r[2]]
    if athlete_name_filter:
        needle = athlete_name_filter.strip().lower()
        out = [(u, n, d) for u, n, d in out if n and needle in n.lower()]
    return out


def run_report_generation(athletes_to_report, folder_path):
    """
    Generate PDF reports for the given athletes.
    athletes_to_report: dict mapping athlete_uuid -> (name, date_str)
    folder_path: base directory for Power files (e.g. Output Files).
    """
    from athleticScreen.pdf_report import generate_pdf_report
    reports_dir_1 = os.getenv('ATHLETIC_SCREEN_REPORTS_GOOGLE_DRIVE', r'G:\My Drive\Athletic Screen 2.0 Reports\Reports 2.0')
    reports_dir_2 = os.getenv('ATHLETIC_SCREEN_REPORTS_DIR', r'D:\Athletic Screen 2.0\Reports')
    os.makedirs(reports_dir_1, exist_ok=True)
    os.makedirs(reports_dir_2, exist_ok=True)
    logo_path = Path(__file__).parent / "8ctnae - Faded 8 to Blue.png"
    if not logo_path.exists():
        logo_path = None
    for athlete_uuid, (name, date_str) in athletes_to_report.items():
        try:
            report_path = generate_pdf_report(
                athlete_uuid=athlete_uuid,
                athlete_name=name,
                session_date=date_str,
                output_dir=reports_dir_1,
                logo_path=logo_path,
                power_files_dir=folder_path,
            )
            if report_path:
                try:
                    clean_name = name.replace(' ', '_').replace(',', '')
                    report_filename = f"{clean_name}_{date_str}_report.pdf"
                    report_path_2 = os.path.join(reports_dir_2, report_filename)
                    shutil.copy2(report_path, report_path_2)
                except Exception as copy_error:
                    print(f"Warning: Could not copy report to second location: {copy_error}")
            else:
                print(f"Warning: Failed to generate PDF report for {name}")
        except Exception as e:
            print(f"Warning: Could not generate PDF report for {name}: {e}")
            import traceback
            traceback.print_exc()


def _safe_convert_to_python_type(val):
    """ 
    Safely convert any value to Python native type for PostgreSQL.
    Handles numpy types, NaN, infinity, and None.
    """
    if val is None:
        return None
    
    try:
        # If it has 'item' method, it's a numpy scalar - convert it
        if hasattr(val, 'item'):
            val = val.item()
        
        # Check if it's still a numpy type by type name
        type_name = str(type(val))
        if 'numpy' in type_name or 'np.' in type_name:
            # Force conversion to Python float
            val = float(val)
        
        # Convert to appropriate Python type
        if isinstance(val, (int, float)):
            # Check for NaN or infinity
            if val != val or val == float('inf') or val == float('-inf'):
                return None
            return float(val) if isinstance(val, float) else int(val)
        
        if isinstance(val, str):
            return val
        
        # Try to convert to float
        return float(val)
    except (ValueError, TypeError, AttributeError):
        return None


def _process_txt_files_dry_run(folder_path: str, txt_files: list) -> list:
    """Parse all txt files and print what would be done; no DB or file moves."""
    seen_athletes = set()  # (name, date_str)
    processed = []
    errors = []
    for file_path in txt_files:
        file_name = os.path.basename(file_path)
        parsed_data = parse_movement_file(file_path, folder_path)
        if not parsed_data:
            errors.append(file_path)
            continue
        name = parsed_data.get("name")
        date_str = parsed_data.get("date")
        movement_type = parsed_data.get("movement_type")
        source_path = parsed_data.get("source_path")
        if not name or not date_str or not movement_type:
            errors.append(file_path)
            continue
        athlete_key = (name, date_str)
        seen_athletes.add(athlete_key)
        processed.append((name, "(dry-run)", file_name))
    print(f"DRY RUN: {len(processed)} file(s) would be processed, {len(seen_athletes)} unique athlete(s)" + (f"; {len(errors)} skipped/errors" if errors else ""))
    return processed


def process_txt_files(folder_path: str, dry_run: bool = False, athlete_uuid: str = None, profile: dict = None):
    """
    Process all txt files from folder and insert into PostgreSQL.
    Extracts name and date from first line of each txt file.

    Args:
        folder_path: Path to directory containing txt files (e.g., 'D:/Athletic Screen 2.0/Output Files/')
        dry_run: If True, only parse and print what would be done; no DB writes, no file moves.
        athlete_uuid: Optional. When provided (e.g. Existing Athlete from Octane), use this UUID for all
            inserts and do not create a new athlete. Profile is only filled for missing fields.
        profile: Optional dict of existing profile fields (date_of_birth, height, weight, etc.); only
            missing fields are filled from session.xml.

    Returns:
        List of tuples (athlete_name, athlete_uuid) for processed files (uuid is placeholder in dry_run).
    """
    print("Athletic Screen" + (" [DRY RUN]" if dry_run else ""))
    existing_athlete_flow = bool(athlete_uuid)

    if not os.path.exists(folder_path):
        raise ValueError(f"Directory not found: {folder_path}")

    # Find all txt files (excluding Power.txt files)
    txt_files = []
    for file_name in os.listdir(folder_path):
        if not file_name.endswith('.txt'):
            continue
        if file_name.endswith('_Power.txt'):
            continue

        file_path = os.path.join(folder_path, file_name)
        txt_files.append(file_path)

    if not txt_files:
        print("No txt files found in directory.")
        return []

    print(f"Processing {len(txt_files)} files")

    if dry_run:
        return _process_txt_files_dry_run(folder_path, txt_files)

    pg_conn = get_warehouse_connection()
    
    # Process each txt file
    processed_athletes = {}  # Track athletes by (name, date) -> athlete_uuid
    duplicate_session_prompted = set()  # (athlete_uuid, date_str) already prompted and user said yes
    duplicate_session_skip = set()  # (athlete_uuid, date_str) user said no - skip all files for this session
    processed = []
    errors = []
    inserted_count = 0
    updated_count = 0
    
    for file_path in txt_files:
        # Use a savepoint for each file so one error doesn't abort the whole transaction
        savepoint_created = False
        try:
            file_name = os.path.basename(file_path)
            
            # Create a savepoint for this file
            with pg_conn.cursor() as sp_cur:
                sp_cur.execute("SAVEPOINT file_processing")
                savepoint_created = True
            
            # Parse movement file - extracts name, date, and metrics
            parsed_data = parse_movement_file(file_path, folder_path)
            
            if not parsed_data:
                print(f"Warning: Skipping {file_name} - failed to parse")
                errors.append(f"{file_path}: Failed to parse")
                continue
            
            name = parsed_data.get('name')
            date_str = parsed_data.get('date')
            movement_type = parsed_data.get('movement_type')
            
            if not name or not date_str or not movement_type:
                print(f"Warning: Skipping {file_name} - missing required data")
                errors.append(f"{file_path}: Missing required data")
                continue
            
            athlete_key = (name, date_str)
            
            # Get or create athlete (or use provided athlete_uuid when running for Existing Athlete)
            if athlete_key not in processed_athletes:
                try:
                    if athlete_uuid:
                        # Existing-athlete flow: use provided UUID; only fill missing profile from session.xml
                        source_path = parsed_data.get("source_path")
                        date_of_birth = get_dob_from_session_xml_next_to_file(source_path) if source_path else None
                        session_xml_path = (Path(source_path).parent / "session.xml") if source_path else None
                        email = parse_email_from_session_xml(session_xml_path) if session_xml_path and Path(session_xml_path).exists() else None
                        norm_email = normalize_email(email)
                        raw_gender = parse_gender_from_session_xml(session_xml_path) if session_xml_path else None
                        gender = normalize_gender(raw_gender)
                        profile_updates = {}
                        if date_of_birth and (not profile or not profile.get("date_of_birth")):
                            profile_updates["date_of_birth"] = date_of_birth
                        if norm_email:
                            profile_updates["email"] = norm_email
                        if gender and (not profile or not profile.get("gender")):
                            profile_updates["gender"] = gender
                        # If adding height/weight from session XML: convert to imperial first (common.units: meters_to_inches, kg_to_lbs)
                        if profile_updates:
                            update_athlete_in_warehouse(athlete_uuid, conn=pg_conn, **profile_updates)
                        processed_athletes[athlete_key] = athlete_uuid
                        print(f"Athlete: {name}")
                        print("Successful match with athlete in DB")
                    else:
                        source_athlete_id = extract_source_athlete_id(name)
                        source_path = parsed_data.get("source_path")
                        date_of_birth = get_dob_from_session_xml_next_to_file(source_path) if source_path else None
                        session_xml_path = (Path(source_path).parent / "session.xml") if source_path else None
                        email = parse_email_from_session_xml(session_xml_path) if session_xml_path and Path(session_xml_path).exists() else None
                        normalized_email = normalize_email(email) if email else None
                        raw_gender = parse_gender_from_session_xml(session_xml_path) if session_xml_path else None
                        gender = normalize_gender(raw_gender)
                        # If adding height/weight from session XML: convert to imperial first (common.units: meters_to_inches, kg_to_lbs)

                        athlete_uuid, created = get_or_create_athlete(
                            name=name,
                            date_of_birth=date_of_birth,
                            email=normalized_email,
                            gender=gender,
                            source_system="athletic_screen",
                            source_athlete_id=source_athlete_id,
                        )
                        if normalized_email:
                            athlete_uuid = merge_by_email(normalized_email, pg_conn) or athlete_uuid
                        processed_athletes[athlete_key] = athlete_uuid
                        print(f"Athlete: {name}")
                        print("New athlete profile created" if created else "Successful match with athlete in DB")
                    update_athlete_data_flag(pg_conn, processed_athletes[athlete_key], "athletic_screen", has_data=True)
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
                errors.append(f"{file_path}: Unknown movement type {movement_type}")
                continue
            
            # Try to load and analyze power file if it exists
            power_metrics = {}
            trial_name = parsed_data.get('trial_name')
            if trial_name and movement_type in {'CMJ', 'DJ', 'PPU', 'SLV'}:
                # Look for Power.txt file - trial_name is the filename without extension
                # So if file is "CMJ1.txt", trial_name is "CMJ1", power file is "CMJ1_Power.txt"
                power_file = os.path.join(folder_path, f"{trial_name}_Power.txt")
                
                if not os.path.exists(power_file):
                    # Try alternative patterns
                    alt_patterns = [
                        os.path.join(folder_path, f"{file_name.replace('.txt', '_Power.txt')}"),
                        os.path.join(folder_path, f"{movement_type}_Power.txt"),
                    ]
                    for pattern in alt_patterns:
                        if os.path.exists(pattern):
                            power_file = pattern
                            break
                    else:
                        power_file = None
                
                if power_file and os.path.exists(power_file):
                    try:
                        power_data = load_power_txt(power_file)
                        power_analysis = analyze_power_curve_advanced(power_data, fs_hz=1000.0)
                        
                        # Map analysis results to database columns, converting numpy types
                        power_metrics = {
                            'peak_power_w': _safe_convert_to_python_type(power_analysis.get('peak_power_w')),
                            'time_to_peak_s': _safe_convert_to_python_type(power_analysis.get('time_to_peak_s')),
                            'rpd_max_w_per_s': _safe_convert_to_python_type(power_analysis.get('rpd_max_w_per_s')),
                            'time_to_rpd_max_s': _safe_convert_to_python_type(power_analysis.get('time_to_rpd_max_s')),
                            'rise_time_10_90_s': _safe_convert_to_python_type(power_analysis.get('rise_time_10_90_s')),
                            'fwhm_s': _safe_convert_to_python_type(power_analysis.get('fwhm_s')),
                            'auc_j': _safe_convert_to_python_type(power_analysis.get('auc_j')),
                            'work_early_pct': _safe_convert_to_python_type(power_analysis.get('work_early_pct')),
                            'decay_90_10_s': _safe_convert_to_python_type(power_analysis.get('decay_90_10_s')),
                            't_com_norm_0to1': _safe_convert_to_python_type(power_analysis.get('t_com_norm_0to1')),
                            'skewness': _safe_convert_to_python_type(power_analysis.get('skewness')),
                            'kurtosis': _safe_convert_to_python_type(power_analysis.get('kurtosis')),
                            'spectral_centroid_hz': _safe_convert_to_python_type(power_analysis.get('spectral_centroid_hz')),
                        }
                        pass
                    except Exception as e:
                        print(f"Warning: Could not analyze power file {os.path.basename(power_file)}: {e}")
                        import traceback
                        traceback.print_exc()
                        # Continue without power metrics
                else:
                    # No power file found - this is okay, just skip power metrics
                    pass
            
            # Prepare data for insertion based on movement type
            if movement_type in {'CMJ', 'PPU'}:
                insert_data = {
                    'athlete_uuid': athlete_uuid,
                    'session_date': date_str,
                    'source_system': 'athletic_screen',
                    'source_athlete_id': extract_source_athlete_id(name),
                    'trial_name': parsed_data.get('trial_name'),
                    'age_at_collection': _safe_convert_to_python_type(age_at_collection),
                    'age_group': age_group,
                    'jh_in': _safe_convert_to_python_type(parsed_data.get('JH_IN')),
                    'peak_power': _safe_convert_to_python_type(parsed_data.get('Peak_Power')),
                    'pp_forceplate': _safe_convert_to_python_type(parsed_data.get('PP_FORCEPLATE')),
                    'force_at_pp': _safe_convert_to_python_type(parsed_data.get('Force_at_PP')),
                    'vel_at_pp': _safe_convert_to_python_type(parsed_data.get('Vel_at_PP')),
                    'pp_w_per_kg': _safe_convert_to_python_type(parsed_data.get('PP_W_per_kg'))
                }
                # Add power analysis metrics
                insert_data.update(power_metrics)
                update_cols = ['jh_in', 'peak_power', 'pp_forceplate', 'force_at_pp', 
                              'vel_at_pp', 'pp_w_per_kg', 'age_at_collection', 'age_group']
                # Add power metric columns to update list
                update_cols.extend([k for k in power_metrics.keys() if k not in update_cols])
            
            elif movement_type == 'DJ':
                insert_data = {
                    'athlete_uuid': athlete_uuid,
                    'session_date': date_str,
                    'source_system': 'athletic_screen',
                    'source_athlete_id': extract_source_athlete_id(name),
                    'trial_name': parsed_data.get('trial_name'),
                    'age_at_collection': _safe_convert_to_python_type(age_at_collection),
                    'age_group': age_group,
                    'jh_in': _safe_convert_to_python_type(parsed_data.get('JH_IN')),
                    'pp_forceplate': _safe_convert_to_python_type(parsed_data.get('PP_FORCEPLATE')),
                    'force_at_pp': _safe_convert_to_python_type(parsed_data.get('Force_at_PP')),
                    'vel_at_pp': _safe_convert_to_python_type(parsed_data.get('Vel_at_PP')),
                    'pp_w_per_kg': _safe_convert_to_python_type(parsed_data.get('PP_W_per_kg')),
                    'ct': _safe_convert_to_python_type(parsed_data.get('CT')),
                    'rsi': _safe_convert_to_python_type(parsed_data.get('RSI'))
                }
                # Add power analysis metrics
                insert_data.update(power_metrics)
                update_cols = ['jh_in', 'pp_forceplate', 'force_at_pp', 'vel_at_pp', 
                              'pp_w_per_kg', 'ct', 'rsi', 'age_at_collection', 'age_group']
                # Add power metric columns to update list
                update_cols.extend([k for k in power_metrics.keys() if k not in update_cols])
            
            elif movement_type == 'SLV':
                insert_data = {
                    'athlete_uuid': athlete_uuid,
                    'session_date': date_str,
                    'source_system': 'athletic_screen',
                    'source_athlete_id': extract_source_athlete_id(name),
                    'trial_name': parsed_data.get('trial_name'),
                    'side': parsed_data.get('side'),
                    'age_at_collection': _safe_convert_to_python_type(age_at_collection),
                    'age_group': age_group,
                    'jh_in': _safe_convert_to_python_type(parsed_data.get('JH_IN')),
                    'pp_forceplate': _safe_convert_to_python_type(parsed_data.get('PP_FORCEPLATE')),
                    'force_at_pp': _safe_convert_to_python_type(parsed_data.get('Force_at_PP')),
                    'vel_at_pp': _safe_convert_to_python_type(parsed_data.get('Vel_at_PP')),
                    'pp_w_per_kg': _safe_convert_to_python_type(parsed_data.get('PP_W_per_kg'))
                }
                # Add power analysis metrics
                insert_data.update(power_metrics)
                update_cols = ['jh_in', 'pp_forceplate', 'force_at_pp', 'vel_at_pp', 
                              'pp_w_per_kg', 'age_at_collection', 'age_group']
                # Add power metric columns to update list
                update_cols.extend([k for k in power_metrics.keys() if k not in update_cols])
            
            elif movement_type == 'NMT':
                insert_data = {
                    'athlete_uuid': athlete_uuid,
                    'session_date': date_str,
                    'source_system': 'athletic_screen',
                    'source_athlete_id': extract_source_athlete_id(name),
                    'trial_name': parsed_data.get('trial_name'),
                    'age_at_collection': _safe_convert_to_python_type(age_at_collection),
                    'age_group': age_group,
                    'num_taps_10s': _safe_convert_to_python_type(parsed_data.get('NUM_TAPS_10s')),
                    'num_taps_20s': _safe_convert_to_python_type(parsed_data.get('NUM_TAPS_20s')),
                    'num_taps_30s': _safe_convert_to_python_type(parsed_data.get('NUM_TAPS_30s')),
                    'num_taps': _safe_convert_to_python_type(parsed_data.get('NUM_TAPS'))
                }
                update_cols = ['num_taps_10s', 'num_taps_20s', 'num_taps_30s', 'num_taps',
                              'age_at_collection', 'age_group']
            else:
                # Unknown movement type - should not reach here if pg_table check worked
                print(f"Warning: Unhandled movement type {movement_type}")
                errors.append(f"{file_path}: Unhandled movement type {movement_type}")
                continue
            
            # Build WHERE clause based on movement type
            if movement_type == 'SLV':
                # SLV uses athlete_uuid, session_date, trial_name, and side
                where_clause = "athlete_uuid = %s AND session_date = %s AND trial_name = %s AND side = %s"
                where_params = (athlete_uuid, date_str, parsed_data.get('trial_name'), parsed_data.get('side'))
            else:
                # Other movements use athlete_uuid, session_date, and trial_name
                where_clause = "athlete_uuid = %s AND session_date = %s AND trial_name = %s"
                where_params = (athlete_uuid, date_str, parsed_data.get('trial_name'))

            # Safeguard 4 (Existing Athlete only): prompt before overwriting an existing row
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
                # Check if row exists
                cur.execute(f"""
                    SELECT COUNT(*) FROM public.{pg_table}
                    WHERE {where_clause}
                """, where_params)
                
                exists = cur.fetchone()[0] > 0
                
                if exists:
                    # Update existing row
                    set_parts = [f"{col} = %s" for col in update_cols]
                    
                    # Convert all values to Python native types (already converted, but ensure)
                    update_values = [_safe_convert_to_python_type(insert_data[col]) for col in update_cols]
                    update_values.extend(where_params)
                    
                    cur.execute(f"""
                        UPDATE public.{pg_table}
                        SET {', '.join(set_parts)}
                        WHERE {where_clause}
                    """, update_values)
                    updated_count += 1
                    # d_athletes.age_group = age_group of most recently written data
                    update_athlete_age_group_from_insert(athlete_uuid, age_group, conn=pg_conn)
                else:
                    # Insert new row
                    cols = list(insert_data.keys())
                    placeholders = ', '.join(['%s'] * len(cols))
                    col_names = ', '.join(cols)
                    
                    # Convert all values to Python native types (already converted, but ensure)
                    values = [_safe_convert_to_python_type(insert_data[col]) for col in cols]
                    
                    cur.execute(f"""
                        INSERT INTO public.{pg_table} ({col_names})
                        VALUES ({placeholders})
                    """, values)
                    inserted_count += 1
                # d_athletes.age_group = age_group of most recently inserted data
                update_athlete_age_group_from_insert(athlete_uuid, age_group, conn=pg_conn)
                # Commit the transaction (this automatically releases all savepoints)
                pg_conn.commit()
                
                # Move processed file and corresponding Power.txt file to "Processed txt Files" subdirectory
                try:
                    processed_dir = os.path.join(folder_path, "Processed txt Files")
                    os.makedirs(processed_dir, exist_ok=True)
                    
                    # Create new filename with _NAME_DATE format
                    # Clean name for filename (remove commas, replace spaces with underscores)
                    clean_name = name.replace(',', '').replace(' ', '_')
                    base_name, ext = os.path.splitext(file_name)
                    new_filename = f"{base_name}_{clean_name}_{date_str}{ext}"
                    dest_path = os.path.join(processed_dir, new_filename)
                    
                    # If file already exists in destination, add a counter
                    counter = 1
                    original_dest = dest_path
                    while os.path.exists(dest_path):
                        base_new, ext_new = os.path.splitext(new_filename)
                        dest_path = os.path.join(processed_dir, f"{base_new}_{counter}{ext_new}")
                        counter += 1
                    
                    # Move the main txt file
                    shutil.move(file_path, dest_path)
                    
                    # Also move the corresponding Power.txt file if it exists
                    trial_name = parsed_data.get('trial_name')
                    if trial_name and movement_type in {'CMJ', 'DJ', 'PPU', 'SLV'}:
                        # Look for Power.txt file - try different naming patterns
                        power_file = os.path.join(folder_path, f"{trial_name}_Power.txt")
                        
                        if not os.path.exists(power_file):
                            # Try alternative patterns
                            alt_patterns = [
                                os.path.join(folder_path, f"{file_name.replace('.txt', '_Power.txt')}"),
                                os.path.join(folder_path, f"{movement_type}_Power.txt"),
                            ]
                            for pattern in alt_patterns:
                                if os.path.exists(pattern):
                                    power_file = pattern
                                    break
                            else:
                                power_file = None
                        
                        if power_file and os.path.exists(power_file):
                            try:
                                # Create corresponding Power.txt filename
                                power_base_name = os.path.basename(power_file)
                                power_base, power_ext = os.path.splitext(power_base_name)
                                
                                # Extract the trial name part (e.g., "CMJ1" from "CMJ1_Power.txt")
                                if '_Power' in power_base:
                                    trial_part = power_base.replace('_Power', '')
                                else:
                                    trial_part = base_name
                                
                                # Create new Power.txt filename matching the main file pattern
                                new_power_filename = f"{trial_part}_{clean_name}_{date_str}_Power{power_ext}"
                                power_dest_path = os.path.join(processed_dir, new_power_filename)
                                
                                # Handle duplicates
                                power_counter = 1
                                while os.path.exists(power_dest_path):
                                    base_power_new, ext_power_new = os.path.splitext(new_power_filename)
                                    power_dest_path = os.path.join(processed_dir, f"{base_power_new}_{power_counter}{ext_power_new}")
                                    power_counter += 1
                                
                                # Move the Power.txt file
                                shutil.move(power_file, power_dest_path)
                            except Exception as power_move_error:
                                print(f"Warning: Could not move Power file: {power_move_error}")
                except Exception as move_error:
                    print(f"Warning: Could not move file to processed directory: {move_error}")
                    # Continue - file processing was successful even if move failed
            
            if athlete_key not in [p[0:2] for p in processed]:
                processed.append((name, athlete_uuid, date_str))
                
        except Exception as e:
            # Rollback to savepoint to allow processing of next file
            if savepoint_created:
                try:
                    with pg_conn.cursor() as sp_cur:
                        sp_cur.execute("ROLLBACK TO SAVEPOINT file_processing")
                        sp_cur.execute("RELEASE SAVEPOINT file_processing")
                except Exception as sp_error:
                    # If savepoint doesn't exist or transaction is aborted, rollback entire transaction
                    try:
                        pg_conn.rollback()
                    except:
                        # If rollback fails, the connection is in a bad state - try to reset it
                        try:
                            # Close and reopen connection
                            pg_conn.close()
                            pg_conn = get_warehouse_connection()
                        except:
                            pass
            
            error_msg = f"{file_path}: {str(e)}"
            errors.append(error_msg)
            print(f"Error: {str(e)}")
            import traceback
            traceback.print_exc()
    
    pg_conn.close()
    
    # Update athlete flags for all successfully processed athletes
    try:
        pg_conn = get_warehouse_connection()
        for _, athlete_uuid, _ in processed:
            update_athlete_data_flag(pg_conn, athlete_uuid, "athletic_screen", has_data=True)
        pg_conn.close()
    except Exception as e:
        print(f"Warning: Could not update athlete flags: {str(e)}")
    
    # Check for duplicate athletes and prompt to merge
    merge_map = {}
    if processed:
        try:
            pg_conn = get_warehouse_connection()
            processed_uuids = [uuid for _, uuid, _ in processed]
            result = check_and_merge_duplicates(conn=pg_conn, athlete_uuids=processed_uuids)
            merge_map = result.get('merge_map', {})
            pg_conn.close()
        except Exception as e:
            print(f"Warning: Could not check for duplicates: {str(e)}")
            import traceback
            traceback.print_exc()
    
    # Generate reports for all processed athletes (use canonical UUID after merge so data is found)
    if processed:
        try:
            athletes_to_report = {}
            for name, athlete_uuid, date_str in processed:
                report_uuid = merge_map.get(athlete_uuid, athlete_uuid)
                if report_uuid not in athletes_to_report:
                    athletes_to_report[report_uuid] = (name, date_str)
                else:
                    existing_date = athletes_to_report[report_uuid][1]
                    if date_str > existing_date:
                        athletes_to_report[report_uuid] = (name, date_str)
            run_report_generation(athletes_to_report, folder_path)
        except Exception as e:
            print(f"Warning: Report generation failed: {e}")
            import traceback
            traceback.print_exc()
    
    if errors:
        for error in errors:
            print(f"Error: {error}")
    
    if inserted_count + updated_count > 0:
        print("Successful run and upload.")
    
    return [(name, uuid) for name, uuid, _ in processed]


def main():
    """
    Main execution function.
    Configure paths and processing options here.
    """
    import argparse
    parser = argparse.ArgumentParser(description="Athletic Screen data processing to PostgreSQL")
    parser.add_argument("--dry-run", action="store_true", help="Parse and print what would be done; no DB writes, no file moves")
    parser.add_argument("--report-only", action="store_true", help="Skip data processing; generate PDF reports from existing DB data only")
    parser.add_argument("--athlete", type=str, default=None, metavar="NAME", help="With --report-only: only generate report for this athlete (name substring match)")
    args = parser.parse_args()

    # Get paths from config (or use defaults)
    try:
        raw_paths = get_raw_paths()
        folder_path = raw_paths.get('athletic_screen', os.getenv('ATHLETIC_SCREEN_DATA_DIR', r'D:/Athletic Screen 2.0/Output Files/'))
    except Exception:
        folder_path = os.getenv('ATHLETIC_SCREEN_DATA_DIR', r'D:/Athletic Screen 2.0/Output Files/')

    # Ensure folder path exists
    if 'path/to' in folder_path or not os.path.exists(folder_path):
        folder_path = os.getenv('ATHLETIC_SCREEN_DATA_DIR', r'D:/Athletic Screen 2.0/Output Files/')

    folder_path = os.path.abspath(folder_path)

    if args.report_only:
        print("Athletic Screen – report only")
        try:
            pg_conn = get_warehouse_connection()
            athletes = get_athletes_with_athletic_screen_data(pg_conn, athlete_name_filter=args.athlete)
            pg_conn.close()
        except Exception as e:
            print(f"Failed to load athletes from DB: {e}")
            import traceback
            traceback.print_exc()
            return
        if not athletes:
            print("No athletes with Athletic Screen data found." + (" Try a different --athlete name." if args.athlete else ""))
            return
        athletes_to_report = {}
        for athlete_uuid, name, date_str in athletes:
            if athlete_uuid not in athletes_to_report:
                athletes_to_report[athlete_uuid] = (name, date_str)
            else:
                existing_date = athletes_to_report[athlete_uuid][1]
                if date_str > existing_date:
                    athletes_to_report[athlete_uuid] = (name, date_str)
        run_report_generation(athletes_to_report, folder_path)
        print("Report generation complete.")
        return

    # Processing options
    BATCH_PROCESS = True  # Process all files in directory

    if BATCH_PROCESS:
        athlete_uuid_env = os.environ.get("ATHLETE_UUID", "").strip() or None
        processed = process_txt_files(
            folder_path,
            dry_run=args.dry_run,
            athlete_uuid=athlete_uuid_env,
            profile=None,
        )

        if not processed:
            print("No files were processed.")
            return
        if not args.dry_run:
            print("All processing complete.")
    else:
        print("Batch processing is disabled. Set BATCH_PROCESS = True to process all files.")


if __name__ == "__main__":
    main()
