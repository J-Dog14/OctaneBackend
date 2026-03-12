"""
Temporary test script for generating PDF reports.
Processes txt files from the normal folder and generates a test report.
NOTE: Inserts data into database (required for report generation) but does NOT delete files.
"""
import os
import sys
from pathlib import Path
from datetime import datetime

# Add python directory to path so imports work
project_root = Path(__file__).parent.parent.parent
python_dir = project_root / "python"
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from common.config import get_raw_paths
from common.athlete_manager import get_warehouse_connection, get_or_create_athlete
from common.athlete_utils import extract_source_athlete_id
from file_parsers import parse_movement_file
from power_analysis import load_power_txt, analyze_power_curve_advanced
from athleticScreen.pdf_report import generate_pdf_report

# Map movement types to PostgreSQL table names
MOVEMENT_TO_PG_TABLE = {
    'CMJ': 'f_athletic_screen_cmj',
    'DJ': 'f_athletic_screen_dj',
    'PPU': 'f_athletic_screen_ppu',
    'SLV': 'f_athletic_screen_slv',
}

def _safe_convert_to_python_type(val):
    """Safely convert any value to Python native type for PostgreSQL."""
    if val is None:
        return None
    try:
        if hasattr(val, 'item'):
            val = val.item()
        type_name = str(type(val))
        if 'numpy' in type_name or 'np.' in type_name:
            val = float(val)
        if isinstance(val, (int, float)):
            if val != val or val == float('inf') or val == float('-inf'):
                return None
            return float(val) if isinstance(val, float) else int(val)
        if isinstance(val, str):
            return val
        return float(val)
    except (ValueError, TypeError, AttributeError):
        return None

def main():
    """Test script to generate a PDF report without modifying files or database."""
    print("=" * 60)
    print("Athletic Screen PDF Report Test")
    print("=" * 60)
    
    # Get folder path (same as main.py)
    try:
        raw_paths = get_raw_paths()
        folder_path = raw_paths.get('athletic_screen', r'D:/Athletic Screen 2.0/Output Files/')
    except:
        folder_path = r'D:/Athletic Screen 2.0/Output Files/'
    
    # Ensure folder path exists
    if 'path/to' in folder_path or not os.path.exists(folder_path):
        folder_path = r'D:/Athletic Screen 2.0/Output Files/'
    
    folder_path = os.path.abspath(folder_path)
    print(f"\nScanning directory: {folder_path}")
    
    if not os.path.exists(folder_path):
        print(f"ERROR: Directory not found: {folder_path}")
        return
    
    # Connect to PostgreSQL (only to get athlete UUID, not to insert)
    print("Connecting to PostgreSQL warehouse...")
    pg_conn = get_warehouse_connection()
    
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
        pg_conn.close()
        return
    
    print(f"Found {len(txt_files)} txt files")
    
    # Process files and insert into database (required for report generation)
    processed_athletes = {}  # Track athletes by (name, date) -> athlete_uuid
    
    for file_path in txt_files:
        try:
            file_name = os.path.basename(file_path)
            print(f"\nProcessing: {file_name}")
            
            # Parse movement file - extracts name, date, and metrics
            parsed_data = parse_movement_file(file_path, folder_path)
            
            if not parsed_data:
                print(f"   Skipping {file_name} - failed to parse")
                continue
            
            name = parsed_data.get('name')
            date_str = parsed_data.get('date')
            movement_type = parsed_data.get('movement_type')
            
            if not name or not date_str or not movement_type:
                print(f"   Skipping {file_name} - missing required data")
                continue
            
            athlete_key = (name, date_str)
            
            print(f"   Extracted: {name} ({date_str}) - {movement_type}")
            
            # Get or create athlete in PostgreSQL
            if athlete_key not in processed_athletes:
                try:
                    source_athlete_id = extract_source_athlete_id(name)
                    
                    athlete_uuid, _ = get_or_create_athlete(
                        name=name,
                        source_system="athletic_screen",
                        source_athlete_id=source_athlete_id
                    )
                    processed_athletes[athlete_key] = athlete_uuid
                    print(f"   Got/created athlete UUID: {athlete_uuid}")
                except Exception as e:
                    print(f"   Error getting athlete UUID: {str(e)}")
                    import traceback
                    traceback.print_exc()
                    continue
            
            athlete_uuid = processed_athletes[athlete_key]
            
            # Get table name for this movement type
            pg_table = MOVEMENT_TO_PG_TABLE.get(movement_type)
            if not pg_table:
                print(f"   Skipping {file_name} - unknown movement type: {movement_type}")
                continue
            
            # Load power analysis if Power.txt file exists
            power_metrics = {}
            if movement_type in {'CMJ', 'PPU', 'DJ', 'SLV'}:
                base_name = os.path.splitext(file_name)[0]
                power_file = None
                # Check in main folder and Processed txt Files subdirectory
                for search_dir in [folder_path, os.path.join(folder_path, "Processed txt Files")]:
                    for pattern in [f"{base_name}_Power.txt", f"{base_name}Power.txt"]:
                        pattern_path = os.path.join(search_dir, pattern)
                        if os.path.exists(pattern_path):
                            power_file = pattern_path
                            break
                    if power_file:
                        break
                
                if power_file and os.path.exists(power_file):
                    try:
                        power_data = load_power_txt(power_file)
                        power_analysis = analyze_power_curve_advanced(power_data, fs_hz=1000.0)
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
                    except Exception as e:
                        print(f"   Warning: Could not analyze power file: {e}")
            
            # Prepare insert data based on movement type
            if movement_type in {'CMJ', 'PPU'}:
                insert_data = {
                    'athlete_uuid': athlete_uuid,
                    'session_date': date_str,
                    'source_system': 'athletic_screen',
                    'source_athlete_id': extract_source_athlete_id(name),
                    'trial_name': parsed_data.get('trial_name'),
                    'age_at_collection': None,  # Not available in test
                    'age_group': None,
                    'jh_in': _safe_convert_to_python_type(parsed_data.get('JH_IN')),
                    'peak_power': _safe_convert_to_python_type(parsed_data.get('Peak_Power')),
                    'pp_forceplate': _safe_convert_to_python_type(parsed_data.get('PP_FORCEPLATE')),
                    'force_at_pp': _safe_convert_to_python_type(parsed_data.get('Force_at_PP')),
                    'vel_at_pp': _safe_convert_to_python_type(parsed_data.get('Vel_at_PP')),
                    'pp_w_per_kg': _safe_convert_to_python_type(parsed_data.get('PP_W_per_kg'))
                }
                insert_data.update(power_metrics)
                update_cols = ['jh_in', 'peak_power', 'pp_forceplate', 'force_at_pp', 
                              'vel_at_pp', 'pp_w_per_kg'] + list(power_metrics.keys())
            
            elif movement_type == 'DJ':
                insert_data = {
                    'athlete_uuid': athlete_uuid,
                    'session_date': date_str,
                    'source_system': 'athletic_screen',
                    'source_athlete_id': extract_source_athlete_id(name),
                    'trial_name': parsed_data.get('trial_name'),
                    'age_at_collection': None,
                    'age_group': None,
                    'jh_in': _safe_convert_to_python_type(parsed_data.get('JH_IN')),
                    'pp_forceplate': _safe_convert_to_python_type(parsed_data.get('PP_FORCEPLATE')),
                    'force_at_pp': _safe_convert_to_python_type(parsed_data.get('Force_at_PP')),
                    'vel_at_pp': _safe_convert_to_python_type(parsed_data.get('Vel_at_PP')),
                    'pp_w_per_kg': _safe_convert_to_python_type(parsed_data.get('PP_W_per_kg')),
                    'ct': _safe_convert_to_python_type(parsed_data.get('CT')),
                    'rsi': _safe_convert_to_python_type(parsed_data.get('RSI'))
                }
                insert_data.update(power_metrics)
                update_cols = ['jh_in', 'pp_forceplate', 'force_at_pp', 'vel_at_pp', 
                              'pp_w_per_kg', 'ct', 'rsi'] + list(power_metrics.keys())
            
            elif movement_type == 'SLV':
                insert_data = {
                    'athlete_uuid': athlete_uuid,
                    'session_date': date_str,
                    'source_system': 'athletic_screen',
                    'source_athlete_id': extract_source_athlete_id(name),
                    'trial_name': parsed_data.get('trial_name'),
                    'side': parsed_data.get('side'),
                    'age_at_collection': None,
                    'age_group': None,
                    'jh_in': _safe_convert_to_python_type(parsed_data.get('JH_IN')),
                    'pp_forceplate': _safe_convert_to_python_type(parsed_data.get('PP_FORCEPLATE')),
                    'force_at_pp': _safe_convert_to_python_type(parsed_data.get('Force_at_PP')),
                    'vel_at_pp': _safe_convert_to_python_type(parsed_data.get('Vel_at_PP')),
                    'pp_w_per_kg': _safe_convert_to_python_type(parsed_data.get('PP_W_per_kg'))
                }
                insert_data.update(power_metrics)
                update_cols = ['jh_in', 'pp_forceplate', 'force_at_pp', 'vel_at_pp', 
                              'pp_w_per_kg'] + list(power_metrics.keys())
            else:
                print(f"   Skipping {file_name} - unhandled movement type: {movement_type}")
                continue
            
            # UPSERT: Insert or update data in database
            with pg_conn.cursor() as cur:
                if movement_type == 'SLV':
                    where_clause = "athlete_uuid = %s AND session_date = %s AND trial_name = %s AND side = %s"
                    where_params = (athlete_uuid, date_str, parsed_data.get('trial_name'), parsed_data.get('side'))
                else:
                    where_clause = "athlete_uuid = %s AND session_date = %s AND trial_name = %s"
                    where_params = (athlete_uuid, date_str, parsed_data.get('trial_name'))
                
                # Check if row exists
                cur.execute(f"""
                    SELECT COUNT(*) FROM public.{pg_table}
                    WHERE {where_clause}
                """, where_params)
                
                exists = cur.fetchone()[0] > 0
                
                if exists:
                    # Update existing row
                    set_parts = [f"{col} = %s" for col in update_cols]
                    update_values = [_safe_convert_to_python_type(insert_data[col]) for col in update_cols]
                    update_values.extend(where_params)
                    
                    cur.execute(f"""
                        UPDATE public.{pg_table}
                        SET {', '.join(set_parts)}
                        WHERE {where_clause}
                    """, update_values)
                    print(f"   ✓ Updated {movement_type} data")
                else:
                    # Insert new row
                    cols = list(insert_data.keys())
                    placeholders = ', '.join(['%s'] * len(cols))
                    col_names = ', '.join(cols)
                    values = [_safe_convert_to_python_type(insert_data[col]) for col in cols]
                    
                    cur.execute(f"""
                        INSERT INTO public.{pg_table} ({col_names})
                        VALUES ({placeholders})
                    """, values)
                    print(f"   ✓ Inserted {movement_type} data")
                
                pg_conn.commit()
            
        except Exception as e:
            print(f"   Error processing {file_name}: {e}")
            import traceback
            traceback.print_exc()
            continue
    
    pg_conn.close()
    
    if not processed_athletes:
        print("\nNo athletes found to generate report for.")
        return
    
    # Find the most recent athlete/session to test with
    # Sort by date (most recent first)
    sorted_athletes = sorted(processed_athletes.items(), 
                           key=lambda x: x[0][1],  # Sort by date_str
                           reverse=True)
    
    # Use the most recent athlete
    (name, date_str), athlete_uuid = sorted_athletes[0]
    
    print("\n" + "=" * 60)
    print(f"Generating test report for: {name} ({date_str})")
    print(f"Athlete UUID: {athlete_uuid}")
    print("=" * 60)
    
    # Set output directory and filename
    output_dir = r'D:\Athletic Screen 2.0\Reports'
    os.makedirs(output_dir, exist_ok=True)
    
    # Get logo path
    logo_path = Path(__file__).parent / "8ctnae - Faded 8 to Blue.png"
    if not logo_path.exists():
        logo_path = None
        print("Warning: Logo file not found")
    
    # Generate report
    try:
        report_path = generate_pdf_report(
            athlete_uuid=athlete_uuid,
            athlete_name=name,
            session_date=date_str,
            output_dir=output_dir,
            logo_path=logo_path,
            power_files_dir=folder_path  # Pass the base directory for Power.txt files
        )
        
        if report_path and os.path.exists(report_path):
            # Rename to Test.PDF
            test_pdf_path = os.path.join(output_dir, "Test.PDF")
            if os.path.exists(test_pdf_path):
                os.remove(test_pdf_path)
            os.rename(report_path, test_pdf_path)
            print(f"\n✓ Test report generated: {test_pdf_path}")
        else:
            print("\n✗ Failed to generate PDF report (no data found in database)")
    except Exception as e:
        print(f"\nERROR generating report: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()

