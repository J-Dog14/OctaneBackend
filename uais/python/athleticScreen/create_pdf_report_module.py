"""
Script to create pdf_report.py from CreateAthleticScreenReport.py
Adapts the code to work with PostgreSQL instead of SQLite
"""
import re
from pathlib import Path

# Read the original file
original_file = Path(__file__).parent / "CreateAthleticScreenReport.py"
with open(original_file, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the config section
content = re.sub(
    r'# ------------------------------------------------\n# CONFIG\n# ------------------------------------------------.*?ACCENT_COLOR = .*?\n',
    '''# ------------------------------------------------
# CONFIG
# ------------------------------------------------
ACCENT_COLOR = '#2c99d4'  # Light blue accent color
''',
    content,
    flags=re.DOTALL
)

# Replace database pull section
old_db_section = r'# ------------------------------------------------\n# Database Pull\n# ------------------------------------------------.*?all_data = pull_all_data\(\)'
new_db_section = '''# ------------------------------------------------
# Database Pull - PostgreSQL
# ------------------------------------------------
from pathlib import Path
import sys
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from common.athlete_manager import get_warehouse_connection

# Map PostgreSQL column names to expected format (uppercase for compatibility)
COLUMN_MAPPING = {
    'jh_in': 'JH_IN',
    'pp_w_per_kg': 'PP_W_per_kg',
    'pp_forceplate': 'PP_FORCEPLATE',
    'force_at_pp': 'Force_at_PP',
    'vel_at_pp': 'Vel_at_PP',
    'ct': 'CT',
    'rsi': 'RSI',
    'auc_j': 'auc_j',
    'kurtosis': 'kurtosis',
    'rpd_max_w_per_s': 'rpd_max_w_per_s',
    'time_to_rpd_max_s': 'time_to_rpd_max_s',
    'side': 'side',
}

MOVEMENT_TO_PG_TABLE = {
    'CMJ': 'f_athletic_screen_cmj',
    'DJ': 'f_athletic_screen_dj',
    'PPU': 'f_athletic_screen_ppu',
    'SLV': 'f_athletic_screen_slv',
}

def normalize_column_names(df):
    """Convert PostgreSQL lowercase column names to expected uppercase format."""
    df = df.copy()
    rename_map = {}
    for pg_col, expected_col in COLUMN_MAPPING.items():
        if pg_col in df.columns:
            rename_map[pg_col] = expected_col
    df.rename(columns=rename_map, inplace=True)
    return df

def query_athlete_data(conn, athlete_uuid, session_date, movement_type):
    """Query athlete data from PostgreSQL for a specific movement."""
    pg_table = MOVEMENT_TO_PG_TABLE.get(movement_type)
    if not pg_table:
        return pd.DataFrame()
    
    try:
        columns = ['jh_in', 'pp_w_per_kg', 'pp_forceplate', 'force_at_pp', 'vel_at_pp', 
                  'auc_j', 'kurtosis', 'rpd_max_w_per_s', 'time_to_rpd_max_s']
        
        if movement_type == 'DJ':
            columns.extend(['ct', 'rsi'])
        elif movement_type == 'SLV':
            columns.append('side')
        
        query = f"""
            SELECT {', '.join(columns)}
            FROM public.{pg_table}
            WHERE athlete_uuid = %s AND session_date = %s
        """
        
        df = pd.read_sql_query(query, conn, params=(athlete_uuid, session_date))
        
        if not df.empty:
            df = normalize_column_names(df)
            df['name'] = ''  # Will be set by caller
        
        return df
    except Exception as e:
        print(f"Error querying {movement_type} data: {e}")
        return pd.DataFrame()

def query_population_data(conn, movement_type):
    """Query all population data from PostgreSQL for percentile calculations."""
    pg_table = MOVEMENT_TO_PG_TABLE.get(movement_type)
    if not pg_table:
        return pd.DataFrame()
    
    try:
        columns = ['jh_in', 'pp_w_per_kg', 'pp_forceplate', 'force_at_pp', 'vel_at_pp',
                  'auc_j', 'kurtosis', 'rpd_max_w_per_s', 'time_to_rpd_max_s']
        
        if movement_type == 'DJ':
            columns.extend(['ct', 'rsi'])
        elif movement_type == 'SLV':
            columns.append('side')
        
        query = f"""
            SELECT {', '.join(columns)}
            FROM public.{pg_table}
            WHERE jh_in IS NOT NULL
        """
        
        df = pd.read_sql_query(query, conn)
        
        if not df.empty:
            df = normalize_column_names(df)
        
        return df
    except Exception as e:
        print(f"Error querying population data for {movement_type}: {e}")
        return pd.DataFrame()
'''

content = re.sub(old_db_section, new_db_section, content, flags=re.DOTALL)

# Update add_logo to accept logo_path parameter
content = content.replace(
    'def add_logo(fig, position=\'top-right\'):',
    'def add_logo(fig, logo_path, position=\'top-right\'):'
)
content = content.replace(
    'if os.path.exists(LOGO_PATH):',
    'if logo_path and os.path.exists(logo_path):'
)
content = content.replace(
    'img = mpimg.imread(LOGO_PATH)',
    'img = mpimg.imread(logo_path)'
)

# Update header functions to accept logo_path
content = content.replace(
    'add_logo(fig, position=\'top-right\')',
    'add_logo(fig, logo_path, position=\'top-right\')'
)

# Update movement_page to accept athlete_name and report_date
content = re.sub(
    r'def movement_page\(pdf, movement_name, df, pop_df\):',
    r'def movement_page(pdf, movement_name, df, pop_df, athlete_name, report_date, logo_path):',
    content
)
content = content.replace(
    'df_ath = df[df["name"] == ATHLETE_NAME]',
    'df_ath = df.copy()  # df already filtered for this athlete'
)
content = content.replace(
    'add_header_dj(fig, ATHLETE_NAME, REPORT_DATE)',
    'add_header_dj(fig, athlete_name, report_date, logo_path)'
)
content = content.replace(
    'add_header_cmj_ppu(fig, ATHLETE_NAME, REPORT_DATE)',
    'add_header_cmj_ppu(fig, athlete_name, report_date, logo_path)'
)

# Update slv_page similarly
content = re.sub(
    r'def slv_page\(pdf, df, pop_df\):',
    r'def slv_page(pdf, df, pop_df, athlete_name, report_date, logo_path):',
    content
)
content = content.replace(
    'df_ath = df[df["name"] == ATHLETE_NAME]',
    'df_ath = df.copy()  # df already filtered for this athlete'
)
content = content.replace(
    'add_header_slv(fig, ATHLETE_NAME, REPORT_DATE)',
    'add_header_slv(fig, athlete_name, report_date, logo_path)'
)

# Replace the main execution section with a function
old_main = r'# ------------------------------------------------\n# Build PDF\n# ------------------------------------------------.*?traceback\.print_exc\(\)'
new_main = '''# ------------------------------------------------
# Main PDF Generation Function
# ------------------------------------------------
def generate_pdf_report(athlete_uuid, athlete_name, session_date, output_dir, logo_path=None):
    """
    Generate PDF report for an athlete.
    
    Args:
        athlete_uuid: UUID of the athlete
        athlete_name: Name of the athlete
        session_date: Session date (YYYY-MM-DD)
        output_dir: Directory to save the PDF
        logo_path: Optional path to logo image
    """
    import os
    from pathlib import Path
    
    # Set default logo path if not provided
    if logo_path is None:
        logo_path = Path(__file__).parent / "8ctnae - Faded 8 to Blue.png"
        if not logo_path.exists():
            logo_path = None
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Build output filename
    clean_name = athlete_name.replace(' ', '_').replace(',', '')
    output_pdf = os.path.join(output_dir, f"{clean_name}_{session_date}_report.pdf")
    
    # Delete old PDF if it exists
    if os.path.exists(output_pdf):
        os.remove(output_pdf)
        print(f"Deleted old PDF: {output_pdf}")
    
    # Connect to database
    conn = get_warehouse_connection()
    
    try:
        # Pull athlete data and population data for each movement
        all_data = {}
        all_pop_data = {}
        
        for movement_type in ["DJ", "CMJ", "PPU", "SLV"]:
            # Get athlete data
            athlete_df = query_athlete_data(conn, athlete_uuid, session_date, movement_type)
            if not athlete_df.empty:
                athlete_df['name'] = athlete_name  # Set name for filtering
                all_data[movement_type] = athlete_df
            
            # Get population data
            pop_df = query_population_data(conn, movement_type)
            if not pop_df.empty:
                all_pop_data[movement_type] = pop_df
        
        # Generate report date string
        report_date = session_date
        
        # Create PDF
        with PdfPages(output_pdf) as pdf:
            # DJ, CMJ, PPU are identical page structures
            for key in ["DJ", "CMJ", "PPU"]:
                if key in all_data and key in all_pop_data:
                    movement_page(pdf, key, all_data[key], all_pop_data[key], 
                                 athlete_name, report_date, logo_path)
                else:
                    print(f"Skipping {key} - no data available")
            
            # SLV special
            if "SLV" in all_data and "SLV" in all_pop_data:
                slv_page(pdf, all_data["SLV"], all_pop_data["SLV"], 
                        athlete_name, report_date, logo_path)
            else:
                print("Skipping SLV - no data available")
        
        print("PDF created successfully:", output_pdf)
        if os.path.exists(output_pdf):
            print(f"PDF file exists at: {os.path.abspath(output_pdf)}")
            print(f"File size: {os.path.getsize(output_pdf)} bytes")
        else:
            print("ERROR: PDF file was not created!")
        
        return output_pdf
        
    except Exception as e:
        print(f"ERROR creating PDF: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        conn.close()
'''

content = re.sub(old_main, new_main, content, flags=re.DOTALL)

# Remove sqlalchemy import and add pandas read_sql_query
content = content.replace(
    'from sqlalchemy import create_engine',
    '# from sqlalchemy import create_engine  # Not needed for PostgreSQL'
)

# Write the new file
output_file = Path(__file__).parent / "pdf_report.py"
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Created {output_file}")

