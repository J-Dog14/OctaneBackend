"""
Pro-Sup Test Main Processing Script

Processes a single athlete's data from a selected folder:
1. Prompts user to select a folder containing Session.xml
2. Parses XML data (demographics, test metadata)
3. Parses ASCII data (performance metrics)
4. Inserts/updates data in PostgreSQL with athlete matching
5. Generates PDF report
"""
import os
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict
import pandas as pd
import numpy as np

# Add python directory to path for imports
python_dir = Path(__file__).parent.parent
sys.path.insert(0, str(python_dir))

from common.config import get_raw_paths, get_warehouse_engine
from common.age_utils import (
    calculate_age_at_collection,
    calculate_age_group,
    normalize_session_date,
    parse_date,
)
from common.athlete_manager import get_warehouse_connection, get_or_create_athlete, update_athlete_in_warehouse, update_athlete_age_group_from_insert
from common.athlete_matcher import update_athlete_data_flag
from common.athlete_utils import extract_source_athlete_id
from common.duplicate_detector import check_and_merge_duplicates
from common.session_duplicate_prompt import session_exists, prompt_duplicate_session
from common.session_xml import normalize_gender
from common.units import meters_to_inches, kg_to_lbs
from common.db_utils import write_df
from proSupTest.file_parsers import (
    select_folder_dialog,
    find_session_xml,
    extract_test_date_from_folder,
    parse_xml_file,
    parse_ascii_file,
    extract_test_date_from_ascii
)
from proSupTest.score_calculation import calculate_all_scores, add_percentile_columns


def _safe_float(value) -> Optional[float]:
    """Safely convert value to float."""
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def generate_report_from_postgres(
    athlete_uuid: str,
    athlete_name: str,
    test_date: str,
    output_dir: str,
    conn
):
    import tempfile
    import uuid
    """
    Generate PDF report from PostgreSQL data.
    
    Args:
        athlete_uuid: UUID of the athlete
        athlete_name: Name of the athlete (for display)
        test_date: Test date string (YYYY-MM-DD)
        output_dir: Directory for output report
        conn: PostgreSQL connection
    """
    # Query ALL data from PostgreSQL for percentile calculation
    query_all = """
    SELECT 
        ps.athlete_uuid,
        a.name,
        ps.session_date as test_date,
        ps.tot_rom_0to10,
        ps.tot_rom_10to20,
        ps.tot_rom_20to30,
        ps.fatigue_index_10,
        ps.fatigue_index_20,
        ps.fatigue_index_30,
        ps.total_score,
        ps.forearm_rom_0to10,
        ps.forearm_rom_10to20,
        ps.forearm_rom_20to30
    FROM public.f_pro_sup ps
    JOIN analytics.d_athletes a ON ps.athlete_uuid = a.athlete_uuid
    WHERE ps.tot_rom_0to10 IS NOT NULL
    """
    
    df_all = pd.read_sql_query(query_all, conn)
    
    if df_all.empty:
        raise RuntimeError("No data found in database for percentile calculation")
    
    # Convert test_date to datetime
    df_all["test_date"] = pd.to_datetime(df_all["test_date"])
    
    # Convert numeric columns
    numeric_cols = [
        "tot_rom_0to10", "tot_rom_10to20", "tot_rom_20to30",
        "forearm_rom_0to10", "forearm_rom_10to20", "forearm_rom_20to30",
        "fatigue_index_10", "fatigue_index_20", "fatigue_index_30",
        "total_score"
    ]
    for col in numeric_cols:
        if col in df_all.columns:
            df_all[col] = pd.to_numeric(df_all[col], errors="coerce")
    
    # Add percentile columns (based on all data)
    df_all = add_percentile_columns(df_all)
    
    # Filter for the specific athlete and date using athlete_uuid
    target_date = pd.to_datetime(test_date)
    df = df_all[
        (df_all["athlete_uuid"] == athlete_uuid) &
        (df_all["test_date"] == target_date)
    ].copy()  # Use .copy() to avoid SettingWithCopyWarning
    
    if df.empty:
        raise RuntimeError(f"No data found for athlete {athlete_name} (UUID: {athlete_uuid}) on {test_date}")
    
    # Convert test_date to datetime
    df.loc[:, "test_date"] = pd.to_datetime(df["test_date"])
    
    # Convert numeric columns
    numeric_cols = [
        "tot_rom_0to10", "tot_rom_10to20", "tot_rom_20to30",
        "forearm_rom_0to10", "forearm_rom_10to20", "forearm_rom_20to30",
        "fatigue_index_10", "fatigue_index_20", "fatigue_index_30",
        "total_score"
    ]
    for col in numeric_cols:
        if col in df.columns:
            df.loc[:, col] = pd.to_numeric(df[col], errors="coerce")
    
    # Add percentile columns (already calculated on df_all, but ensure they're in df)
    # The percentile columns should already be in df_all, so they should be in df too
    
    # Get the row
    row = df.iloc[0]
    date_str = row["test_date"].date().isoformat()
    
    # Create output path
    os.makedirs(output_dir, exist_ok=True)
    pdf_out = os.path.join(output_dir, f"{athlete_name} {date_str} Performance Report.pdf")
    
    # Import report generation functions
    from proSupTest.report_generation import (
        ring_gauge, rom_bars, pct_color, ACCENT_HEX, SHADOW_HEX
    )
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.lib.utils import ImageReader
    
    # Create a unique temp directory for this report's images
    temp_dir = os.path.join(tempfile.gettempdir(), f"pro_sup_report_{uuid.uuid4().hex[:8]}")
    os.makedirs(temp_dir, exist_ok=True)
    
    # Build PDF
    c = canvas.Canvas(pdf_out, pagesize=letter)
    W, H = letter
    tmp = []  # collect temp PNGs for cleanup
    
    # Background
    c.setFillColor(colors.HexColor("#0e1116"))  # deep slate-gray
    c.rect(0, 0, W, H, stroke=0, fill=1)
    
    # Vertical teal bar
    ACCENT = colors.HexColor(ACCENT_HEX)
    c.setFillColor(ACCENT)
    c.rect(10, 0, 6, H, stroke=0, fill=1)
    
    # Header
    c.setFont("Helvetica-BoldOblique", 18)
    c.setFillColor(colors.white)
    c.drawString(30, H-40, f"Name: {athlete_name}")
    c.drawString(30, H-60, f"Test Date: {date_str}")
    
    c.setStrokeColor(ACCENT)
    c.setLineWidth(2)
    c.line(20, H-75, W-20, H-75)
    
    # Card layout helpers
    card_x, card_w = 40, W - 80
    shadow_off, card_radius = 4, 10
    y = H - 100
    
    SHADOW = colors.HexColor(SHADOW_HEX)
    
    def draw_card_shadow(y_top, h):
        c.setFillColor(SHADOW)
        c.roundRect(card_x+shadow_off, y_top-h-shadow_off,
                    card_w, h, card_radius, fill=1, stroke=0)
    
    def draw_card(y_top, h):
        c.setFillColor(colors.black)
        c.setStrokeColor(colors.white)
        c.roundRect(card_x, y_top-h, card_w, h, card_radius, fill=1, stroke=1)
    
    # Score card
    score_h = 124
    draw_card_shadow(y, score_h)
    draw_card(y, score_h)
    
    c.setFont("Helvetica-BoldOblique", 24)
    c.setFillColor(ACCENT)
    c.drawString(card_x+140, y-45, "Score")
    c.setFont("Helvetica-BoldOblique", 46)
    c.setFillColor(colors.white)
    score_val = row.get("total_score", 0)
    if pd.isna(score_val):
        score_val = 0
    c.drawString(card_x+140, y-92, f"{score_val:.1f}")
    
    score_pct = row.get("total_score_pct", 0)
    if pd.isna(score_pct):
        score_pct = 0
    png = ring_gauge(score_pct, os.path.join(temp_dir, "_score.png"), size=230)
    tmp.append(png)
    c.drawImage(ImageReader(png), card_x+card_w-210, y-score_h+8,
                width=108, height=108, mask='auto')
    
    y -= score_h + 28
    
    # Interval cards
    intervals = [
        ("0–10 Seconds", 0, "tot_rom_0to10", "fatigue_index_10", "forearm_rom_0to10"),
        ("10–20 Seconds", 1, "tot_rom_10to20", "fatigue_index_20", "forearm_rom_10to20"),
        ("20–30 Seconds", 2, "tot_rom_20to30", "fatigue_index_30", "forearm_rom_20to30"),
    ]
    
    for title, idx, rom_col, fat_col, rom_col2 in intervals:
        card_h = 150
        draw_card_shadow(y, card_h)
        draw_card(y, card_h)
        
        # Titles & data
        c.setFont("Helvetica-BoldOblique", 18)
        c.setFillColor(ACCENT)
        c.drawString(card_x+40, y-35, title)
        
        c.setFont("Helvetica-Oblique", 16)
        c.setFillColor(colors.white)
        rom_val = row.get(rom_col, 0)
        if pd.isna(rom_val):
            rom_val = 0
        c.drawString(card_x+40, y-65, f"Cumulative ROM: {rom_val:.1f}°")
        
        fat_val = row.get(fat_col, 0)
        if pd.isna(fat_val):
            fat_val = 0
        c.drawString(card_x+40, y-90, f"Fatigue Index:       {fat_val:.1f}%")
        
        rom2_val = row.get(rom_col2, 0)
        if pd.isna(rom2_val):
            rom2_val = 0
        c.drawString(card_x+40, y-115, f"ROM:                     {rom2_val:.1f}°")
        
        # Mini bar chart
        rom_0to10 = row.get("tot_rom_0to10", 0) or 0
        rom_10to20 = row.get("tot_rom_10to20", 0) or 0
        rom_20to30 = row.get("tot_rom_20to30", 0) or 0
        bars_png = rom_bars(rom_0to10, rom_10to20, rom_20to30, idx,
                            os.path.join(temp_dir, f"_bars_{idx}.png"), size=(110, 110))
        tmp.append(bars_png)
        c.drawImage(ImageReader(bars_png),
                    card_x+card_w/2-0, y-card_h+25,
                    width=110, height=110, mask='auto')
        
        # Ring gauge
        rom_pct_col = f"{rom_col}_pct"
        rom_pct = row.get(rom_pct_col, 0)
        if pd.isna(rom_pct):
            rom_pct = 0
        ring_png = ring_gauge(rom_pct, os.path.join(temp_dir, f"_ring_{idx}.png"), size=240)
        tmp.append(ring_png)
        c.drawImage(ImageReader(ring_png), card_x+card_w-110, y-card_h+30,
                    width=90, height=90, mask='auto')
        
        y -= card_h + 28
    
    # Finalize
    c.showPage()
    c.save()
    print(f"Saved {pdf_out}")
    
    # Cleanup temp files and directory
    for p in tmp:
        if os.path.exists(p):
            os.remove(p)
    # Remove temp directory if empty
    try:
        if os.path.exists(temp_dir) and not os.listdir(temp_dir):
            os.rmdir(temp_dir)
    except:
        pass
    
    return pdf_out


def find_ascii_file_for_folder(folder_path: str) -> Optional[str]:
    """
    Find ASCII file for a specific folder.
    Checks multiple locations:
    1. In the folder itself
    2. In D:/Pro-Sup Test/ (shared location)
    
    Args:
        folder_path: Path to the folder containing Session.xml
    
    Returns:
        Path to ASCII file or None if not found.
    """
    # Check for ASCII file in the same folder
    folder_ascii = os.path.join(folder_path, "pro-sup_data.txt")
    if os.path.exists(folder_ascii):
        return folder_ascii
    
    # Check for shared ASCII file
    shared_ascii = os.getenv('PRO_SUP_SHARED_ASCII', "D:/Pro-Sup Test/pro-sup_data.txt")
    if os.path.exists(shared_ascii):
        return shared_ascii
    
    return None


def process_single_folder(folder_path: str, athlete_uuid: str = None, profile: dict = None):
    """
    Process a single folder containing Session.xml and insert data into PostgreSQL.

    Args:
        folder_path: Path to folder containing Session.xml
        athlete_uuid: Optional. When provided (e.g. Existing Athlete from Octane), use this UUID
            for inserts and do not create a new athlete. Missing profile fields are filled from XML.
        profile: Optional dict of existing profile fields; only missing fields are filled from XML.
    """
    print("Pro-Sup Test")
    
    # Find Session.xml
    xml_file_path = find_session_xml(folder_path)
    if not xml_file_path:
        raise FileNotFoundError(f"No 'Session' XML file found in: {folder_path}")
    
    # Extract test date from folder name
    test_date = extract_test_date_from_folder(folder_path)
    
    # Parse XML data
    try:
        xml_data = parse_xml_file(xml_file_path, test_date)
        athlete_name = xml_data['name']
        print(f"Athlete: {athlete_name}")
    except Exception as e:
        print(f"Error: {e}")
        raise
    
    print("Processing 1 file")
    
    pg_conn = get_warehouse_connection()
    pg_engine = get_warehouse_engine()
    
    try:
        # Get or create athlete in PostgreSQL
        dob_str = xml_data.get('dob')
        gender = normalize_gender(xml_data.get('gender'))
        # Session XML height/weight are metric (m, kg); convert to imperial for warehouse (inches, lbs)
        height_m = _safe_float(xml_data.get('height'))
        weight_kg = _safe_float(xml_data.get('weight'))
        height = meters_to_inches(height_m) if height_m is not None else None
        weight = kg_to_lbs(weight_kg) if weight_kg is not None else None
        age = xml_data.get('age')
        
        source_athlete_id = extract_source_athlete_id(athlete_name)
        if athlete_uuid:
            # Fill missing profile from XML (non-destructive)
            updates = {}
            if dob_str and (not profile or not profile.get("date_of_birth")):
                updates["date_of_birth"] = dob_str
            if age is not None and (not profile or profile.get("age") is None):
                updates["age"] = age
            if gender and (not profile or profile.get("gender") is None):
                updates["gender"] = gender
            if height is not None and (not profile or profile.get("height") is None):
                updates["height"] = height
            if weight is not None and (not profile or profile.get("weight") is None):
                updates["weight"] = weight
            if updates:
                update_athlete_in_warehouse(athlete_uuid, conn=pg_conn, **updates)
            print("Successful match with athlete in DB")
        else:
            athlete_uuid, created = get_or_create_athlete(
                name=athlete_name,
                source_system="pro_sup",
                source_athlete_id=source_athlete_id,
                date_of_birth=dob_str,
                age=age,
                gender=gender,
                height=height,
                weight=weight
            )
            print("New athlete profile created" if created else "Successful match with athlete in DB")
            try:
                check_and_merge_duplicates(conn=pg_conn, athlete_uuids=[athlete_uuid])
            except Exception as e:
                print(f"Warning: Could not check for duplicates: {str(e)}")
                import traceback
                traceback.print_exc()
        update_athlete_data_flag(pg_conn, athlete_uuid, "pro_sup", has_data=True)
        
        # Find and parse ASCII file
        ascii_file_path = find_ascii_file_for_folder(folder_path)
        
        ascii_data = {}
        if ascii_file_path:
            try:
                # Verify test date matches
                ascii_test_date = extract_test_date_from_ascii(ascii_file_path)
                if ascii_test_date == test_date:
                    ascii_data = parse_ascii_file(ascii_file_path)
                else:
                    print(f"Warning: ASCII test date ({ascii_test_date}) doesn't match folder date ({test_date})")
            except Exception as e:
                print(f"Warning: Could not parse ASCII file: {e}")
        
        # Combine XML and ASCII data
        insert_data = {
            'athlete_uuid': athlete_uuid,
            'session_date': test_date,
            'source_system': 'pro_sup',
            'source_athlete_id': source_athlete_id,  # Use extracted initials or cleaned name
            'age': age,
            'height': height,
            'weight': weight,
            'injury_history': xml_data.get('injury_history'),
            'season_phase': xml_data.get('season_phase'),
            'dynomometer_score': str(xml_data.get('dynomometer_score')) if xml_data.get('dynomometer_score') else None,
            'comments': xml_data.get('comments'),
        }
        
        # Add ASCII metrics
        for key in ['forearm_rom_0to10', 'forearm_rom_10to20', 'forearm_rom_20to30', 'forearm_rom',
                    'tot_rom_0to10', 'tot_rom_10to20', 'tot_rom_20to30', 'tot_rom',
                    'num_of_flips_0_10', 'num_of_flips_10_20', 'num_of_flips_20_30', 'num_of_flips',
                    'avg_velo_0_10', 'avg_velo_10_20', 'avg_velo_20_30', 'avg_velo']:
            value = ascii_data.get(key)
            insert_data[key] = _safe_float(value) if value is not None else None
        
        # Add missing columns to match table schema (must be before age_at_collection and age_group)
        insert_data['cumulative_rom'] = None
        insert_data['raw_total_score'] = None
        
        # Calculate age_at_collection and age_group (canonical: YOUTH, HIGH SCHOOL, COLLEGE, PRO)
        if dob_str:
            try:
                dob_date = parse_date(dob_str) or (datetime.strptime(dob_str, "%Y-%m-%d").date() if dob_str else None)
                session_date = datetime.strptime(test_date, "%Y-%m-%d").date() if test_date else None
                if dob_date and session_date:
                    session_date = normalize_session_date(session_date)
                    if session_date:
                        test_date = session_date.strftime("%Y-%m-%d")
                        insert_data['session_date'] = test_date
                    age_at_collection = calculate_age_at_collection(session_date, dob_date)
                    if age_at_collection is not None and (age_at_collection < 0 or age_at_collection > 120):
                        age_at_collection = None
                    insert_data['age_at_collection'] = age_at_collection
                    insert_data['age_group'] = calculate_age_group(age_at_collection) if age_at_collection is not None else None
                else:
                    insert_data['age_at_collection'] = None
                    insert_data['age_group'] = None
            except Exception:
                insert_data['age_at_collection'] = None
                insert_data['age_group'] = None
        else:
            insert_data['age_at_collection'] = None
            insert_data['age_group'] = None
        
        # Calculate fatigue indices and consistency penalty
        # Following the notebook logic: Move_Pro-Sup_Data_MASSdb.ipynb
        rom_0to10 = insert_data.get('tot_rom_0to10')
        rom_10to20 = insert_data.get('tot_rom_10to20')
        rom_20to30 = insert_data.get('tot_rom_20to30')
        
        # fatigue_index_10 is always 0 (first interval has no prior data to compare)
        insert_data['fatigue_index_10'] = 0.0
        
        # fatigue_index_20 = ((tot_rom_10to20 - tot_rom_0to10) / tot_rom_0to10) * 100
        if rom_0to10 is not None and rom_0to10 > 0 and rom_10to20 is not None:
            insert_data['fatigue_index_20'] = ((rom_10to20 - rom_0to10) / rom_0to10) * 100
        else:
            insert_data['fatigue_index_20'] = None
        
        # fatigue_index_30 = ((tot_rom_20to30 - tot_rom_10to20) / tot_rom_10to20) * 100
        if rom_10to20 is not None and rom_10to20 > 0 and rom_20to30 is not None:
            insert_data['fatigue_index_30'] = ((rom_20to30 - rom_10to20) / rom_10to20) * 100
        else:
            insert_data['fatigue_index_30'] = None
        
        # Calculate consistency penalty (std dev of ROM values)
        # Matching notebook: df[rom_columns].std(axis=1) which uses sample std (ddof=1)
        rom_values = [v for v in [rom_0to10, rom_10to20, rom_20to30] if v is not None]
        if len(rom_values) > 1:
            # Use ddof=1 to match pandas std() default (sample standard deviation)
            insert_data['consistency_penalty'] = float(np.std(rom_values, ddof=1))
        else:
            insert_data['consistency_penalty'] = None
        
        # Total fatigue score (sum of absolute fatigue indices) - following notebook logic
        fatigue_scores = [
            abs(insert_data.get('fatigue_index_10', 0) or 0),
            abs(insert_data.get('fatigue_index_20', 0) or 0),
            abs(insert_data.get('fatigue_index_30', 0) or 0)
        ]
        insert_data['total_fatigue_score'] = sum(fatigue_scores) if any(fatigue_scores) else None
        
        # Calculate total_score using max values from entire dataset (following notebook logic exactly)
        # Formula from notebook: (sum_rom / max_rom) * w1 - (total_fatigue_score / max_fatigue_score) * w2 - (consistency_penalty / max_consistency_penalty) * w3
        # Weights: w1=70, w2=15, w3=15
        try:
            # Query all existing data to get max values (matching notebook: df[rom_columns].max().sum())
            # This gets the max of each column separately, then sums them
            max_query = """
            SELECT 
                COALESCE(MAX(tot_rom_0to10), 0) + COALESCE(MAX(tot_rom_10to20), 0) + COALESCE(MAX(tot_rom_20to30), 0) as max_rom,
                COALESCE(MAX(total_fatigue_score), 0) as max_fatigue_score,
                COALESCE(MAX(consistency_penalty), 0) as max_consistency_penalty
            FROM public.f_pro_sup
            WHERE tot_rom_0to10 IS NOT NULL
            """
            
            with pg_conn.cursor() as max_cur:
                max_cur.execute(max_query)
                max_row = max_cur.fetchone()
                max_rom_db = float(max_row[0]) if max_row[0] and max_row[0] > 0 else 0.0
                max_fatigue_score_db = float(max_row[1]) if max_row[1] and max_row[1] > 0 else 0.0
                max_consistency_penalty_db = float(max_row[2]) if max_row[2] and max_row[2] > 0 else 0.0
            
            # Calculate current row's values
            sum_rom = (rom_0to10 or 0) + (rom_10to20 or 0) + (rom_20to30 or 0)
            total_fatigue = insert_data.get('total_fatigue_score') or 0
            consistency = insert_data.get('consistency_penalty') or 0
            
            # For max_rom, we need to check if any individual column max needs updating
            # Get individual column maxes to properly calculate max_rom
            col_max_query = """
            SELECT 
                COALESCE(MAX(tot_rom_0to10), 0) as max_col1,
                COALESCE(MAX(tot_rom_10to20), 0) as max_col2,
                COALESCE(MAX(tot_rom_20to30), 0) as max_col3
            FROM public.f_pro_sup
            WHERE tot_rom_0to10 IS NOT NULL
            """
            
            with pg_conn.cursor() as col_cur:
                col_cur.execute(col_max_query)
                col_row = col_cur.fetchone()
                max_col1_db = float(col_row[0]) if col_row[0] else 0.0
                max_col2_db = float(col_row[1]) if col_row[1] else 0.0
                max_col3_db = float(col_row[2]) if col_row[2] else 0.0
            
            # Update individual column maxes if current row has higher values
            max_col1 = max(max_col1_db, rom_0to10 or 0)
            max_col2 = max(max_col2_db, rom_10to20 or 0)
            max_col3 = max(max_col3_db, rom_20to30 or 0)
            
            # Calculate max_rom as sum of individual column maxes (matching notebook)
            max_rom = max_col1 + max_col2 + max_col3
            max_fatigue_score = max(max_fatigue_score_db, total_fatigue) if total_fatigue > 0 else max_fatigue_score_db
            max_consistency_penalty = max(max_consistency_penalty_db, consistency) if consistency > 0 else max_consistency_penalty_db
            
            # Weights from notebook: w1=70, w2=15, w3=15
            w1, w2, w3 = 70, 15, 15
            
            # Calculate total_score (following notebook formula exactly)
            if max_rom > 0:
                # Calculate normalized components
                rom_component = (sum_rom / max_rom) * w1 if max_rom > 0 else 0
                fatigue_component = (total_fatigue / max_fatigue_score) * w2 if max_fatigue_score > 0 else 0
                consistency_component = (consistency / max_consistency_penalty) * w3 if max_consistency_penalty > 0 else 0
                
                # Total score = ROM component - fatigue penalty - consistency penalty
                total_score = rom_component - fatigue_component - consistency_component
                
                # Ensure score is not negative (can happen with large penalties)
                insert_data['total_score'] = max(0.0, float(total_score))
            else:
                # No ROM data available
                insert_data['total_score'] = None
        except Exception as e:
            print(f"Warning: Could not calculate total_score: {e}")
            insert_data['total_score'] = None
        
        # Safeguard 4 (Existing Athlete): if this session already exists, prompt before overwriting
        if os.environ.get("ATHLETE_UUID", "").strip():
            if session_exists(pg_conn, "f_pro_sup", athlete_uuid, test_date):
                if not prompt_duplicate_session(test_date):
                    print("Skipping insert (user chose not to continue).")
                    return
        # UPSERT into PostgreSQL using ON CONFLICT
        with pg_conn.cursor() as cur:
            # Check if row exists
            cur.execute("""
                SELECT COUNT(*) FROM public.f_pro_sup
                WHERE athlete_uuid = %s AND session_date = %s
            """, (athlete_uuid, test_date))
            
            exists = cur.fetchone()[0] > 0
            
            if exists:
                # Update existing row - update all columns except keys
                update_cols = [k for k in insert_data.keys() if k not in ['athlete_uuid', 'session_date']]
                set_parts = [f"{col} = %s" for col in update_cols]
                update_values = [insert_data[col] for col in update_cols]
                update_values.extend([athlete_uuid, test_date])
                
                cur.execute(f"""
                    UPDATE public.f_pro_sup
                    SET {', '.join(set_parts)}
                    WHERE athlete_uuid = %s AND session_date = %s
                """, update_values)
                update_athlete_age_group_from_insert(athlete_uuid, insert_data.get('age_group'), conn=pg_conn)
                pg_conn.commit()
            else:
                # Insert new row - ensure column order matches table schema exactly
                # Table column order (excluding id and created_at which are auto-generated):
                table_column_order = [
                    'athlete_uuid', 'session_date', 'source_system', 'source_athlete_id',
                    'age', 'height', 'weight', 'injury_history', 'season_phase', 'dynomometer_score', 'comments',
                    'forearm_rom_0to10', 'forearm_rom_10to20', 'forearm_rom_20to30', 'forearm_rom',
                    'tot_rom_0to10', 'tot_rom_10to20', 'tot_rom_20to30', 'tot_rom',
                    'num_of_flips_0_10', 'num_of_flips_10_20', 'num_of_flips_20_30', 'num_of_flips',
                    'avg_velo_0_10', 'avg_velo_10_20', 'avg_velo_20_30', 'avg_velo',
                    'fatigue_index_10', 'fatigue_index_20', 'fatigue_index_30', 'total_fatigue_score',
                    'consistency_penalty', 'total_score', 'cumulative_rom', 'raw_total_score',
                    'age_at_collection', 'age_group'
                ]
                
                # Only include columns that exist in both insert_data and table
                cols = [col for col in table_column_order if col in insert_data]
                placeholders = ', '.join(['%s'] * len(cols))
                col_list = ', '.join(cols)
                values = [insert_data[col] for col in cols]
                
                cur.execute(f"""
                    INSERT INTO public.f_pro_sup ({col_list})
                    VALUES ({placeholders})
                """, values)
                update_athlete_age_group_from_insert(athlete_uuid, insert_data.get('age_group'), conn=pg_conn)
                pg_conn.commit()
        
        # Generate report
        try:
            generate_report_from_postgres(
                athlete_uuid=athlete_uuid,
                athlete_name=athlete_name,
                test_date=test_date,
                output_dir=os.getenv('PRO_SUP_REPORTS_DIR', "D:/Pro-Sup Test/Reports"),
                conn=pg_conn
            )
        except Exception as e:
            print(f"Warning: Could not generate report: {e}")
        
        print("Successful run and upload.")
        
    finally:
        pg_conn.close()


def main():
    """
    Main execution function.
    Prompts user to select a folder and processes it.
    """
    # Get default directory from config
    try:
        raw_paths = get_raw_paths()
        default_dir = raw_paths.get('pro_sup', os.getenv('PRO_SUP_DATA_DIR', 'D:/Pro-Sup Test/Data/'))
    except:
        default_dir = os.getenv('PRO_SUP_DATA_DIR', 'D:/Pro-Sup Test/Data/')
    
    # Ensure folder path exists
    if 'path/to' in default_dir or not os.path.exists(default_dir):
        default_dir = os.getenv('PRO_SUP_DATA_DIR', 'D:/Pro-Sup Test/Data/')
    
    # Prompt user to select folder
    print("Please select a folder containing Session.xml...")
    selected_folder = select_folder_dialog(initial_dir=default_dir)
    
    if not selected_folder:
        print("No folder selected. Exiting.")
        return
    
    # Process the selected folder
    try:
        athlete_uuid_env = os.environ.get("ATHLETE_UUID", "").strip() or None
        process_single_folder(selected_folder, athlete_uuid=athlete_uuid_env, profile=None)
    except Exception as e:
        print(f"\nError processing folder: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
