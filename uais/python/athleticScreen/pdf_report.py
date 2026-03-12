import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend for PDF generation
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
# GridSpec removed - using direct positioning instead
from matplotlib import image as mpimg
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle
from sqlalchemy import text
from scipy.stats import linregress, percentileofscore
from scipy.interpolate import interp1d
from datetime import datetime
import os
import glob

# ------------------------------------------------
# CONFIG
# ------------------------------------------------
ACCENT_COLOR = '#2c99d4'  # Light blue accent color

TABLES = {
    "DJ": "DJ",
    "CMJ": "CMJ",
    "PPU": "PPU",
    "SLV": "SLV"
}

RADAR_METRICS = [
    "JH_IN",
    "PP_W_per_kg",
    "auc_j",
    "kurtosis",
    "rpd_max_w_per_s",
    "time_to_rpd_max_s"
]

BAR_METRICS = ["JH_IN", "PP_W_per_kg"]

# Metric label mapping for display
METRIC_LABELS = {
    "JH_IN": "Jump Height",
    "PP_W_per_kg": "Peak Power (Norm)",
    "auc_j": "Work (AUC)",
    "kurtosis": "Kurtosis",
    "rpd_max_w_per_s": "Max RPD",
    "time_to_rpd_max_s": "Time to Max RPD"
}

# ------------------------------------------------
# Database Pull - PostgreSQL
# ------------------------------------------------
from pathlib import Path
import sys
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from common.config import get_warehouse_engine

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

def query_athlete_data(engine, athlete_uuid, session_date, movement_type):
    """Query athlete data from PostgreSQL for a specific movement."""
    pg_table = MOVEMENT_TO_PG_TABLE.get(movement_type)
    if not pg_table:
        return pd.DataFrame()
    
    try:
        columns = ['trial_name', 'jh_in', 'pp_w_per_kg', 'pp_forceplate', 'force_at_pp', 'vel_at_pp', 
                  'auc_j', 'kurtosis', 'rpd_max_w_per_s', 'time_to_rpd_max_s']
        
        if movement_type == 'DJ':
            columns.extend(['ct', 'rsi'])
        elif movement_type == 'SLV':
            columns.append('side')
        
        query = f"""
            SELECT {', '.join(columns)}
            FROM public.{pg_table}
            WHERE athlete_uuid = :athlete_uuid AND session_date = :session_date
        """
        
        # Use SQLAlchemy text() for proper parameter handling
        with engine.connect() as conn:
            result = conn.execute(text(query), {'athlete_uuid': athlete_uuid, 'session_date': session_date})
            df = pd.DataFrame(result.fetchall(), columns=result.keys())
        
        if not df.empty:
            df = normalize_column_names(df)
            df['name'] = ''  # Will be set by caller
            # Convert numeric columns to float (PostgreSQL returns Decimal types)
            numeric_cols = ['JH_IN', 'PP_W_per_kg', 'PP_FORCEPLATE', 'Force_at_PP', 'Vel_at_PP',
                           'auc_j', 'kurtosis', 'rpd_max_w_per_s', 'time_to_rpd_max_s']
            if 'CT' in df.columns:
                numeric_cols.append('CT')
            if 'RSI' in df.columns:
                numeric_cols.append('RSI')
            for col in numeric_cols:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
        
        return df
    except Exception as e:
        print(f"Error querying {movement_type} data: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()

def query_population_data(engine, movement_type):
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
        
        df = pd.read_sql_query(query, engine)
        
        if not df.empty:
            df = normalize_column_names(df)
            # Convert numeric columns to float (PostgreSQL returns Decimal types)
            numeric_cols = ['JH_IN', 'PP_W_per_kg', 'PP_FORCEPLATE', 'Force_at_PP', 'Vel_at_PP',
                           'auc_j', 'kurtosis', 'rpd_max_w_per_s', 'time_to_rpd_max_s']
            if 'CT' in df.columns:
                numeric_cols.append('CT')
            if 'RSI' in df.columns:
                numeric_cols.append('RSI')
            for col in numeric_cols:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
        
        return df
    except Exception as e:
        print(f"Error querying population data for {movement_type}: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()


# ------------------------------------------------
# Helper functions to add headers (page-specific)
# ------------------------------------------------
def add_header_dj(fig, athlete_name, test_date, logo_path):
    """Add header for DJ page - can be adjusted independently"""
    # Vertical accent bar on the left
    bar_width = 0.03
    bar = Rectangle((0, 0), bar_width, 1, transform=fig.transFigure, 
                    facecolor=ACCENT_COLOR, zorder=1001)
    fig.add_artist(bar)
    
    # Athlete name and date positioned just above the blue line - removed "Name:" and "Test Date:" labels
    # Blue line moved up 0.2 (from 0.925 to 0.725), name positioned just above it
    # Using Helvetica-BoldOblique font (same as pro sup test report)
    fig.text(0.07, 0.965, athlete_name, 
            fontsize=72, color='white', ha='left', va='top', fontweight='bold', 
            fontfamily='sans-serif', style='italic', zorder=1002)
    fig.text(0.07, 0.950, test_date, 
            fontsize=72, color='white', ha='left', va='top', fontweight='bold', 
            fontfamily='sans-serif', style='italic', zorder=1002)
    
    # Horizontal accent line below header - moved up 0.2 (from 0.925 to 0.725)
    header_line = Line2D([0.05, 0.98], [0.928, 0.928], transform=fig.transFigure, 
                        color=ACCENT_COLOR, linewidth=9, zorder=1002)
    fig.add_artist(header_line)
    
    # Logo in top right
    add_logo(fig, logo_path, position='top-right')

def add_header_cmj_ppu(fig, athlete_name, test_date, logo_path):
    """Add header for CMJ and PPU pages - can be adjusted independently"""
    # Vertical accent bar on the left
    bar_width = 0.03
    bar = Rectangle((0, 0), bar_width, 1, transform=fig.transFigure, 
                    facecolor=ACCENT_COLOR, zorder=1001)
    fig.add_artist(bar)
    
    # Athlete name and date positioned just above the blue line - removed "Name:" and "Test Date:" labels
    # Blue line moved up 0.2 (from 0.89 to 0.69), name positioned just above it
    # Using Helvetica-BoldOblique font (same as pro sup test report)
    fig.text(0.07, 0.960, athlete_name, 
            fontsize=72, color='white', ha='left', va='top', fontweight='bold', 
            fontfamily='sans-serif', style='italic', zorder=1002)
    fig.text(0.07, 0.935, test_date, 
            fontsize=72, color='white', ha='left', va='top', fontweight='bold', 
            fontfamily='sans-serif', style='italic', zorder=1002)
    
    # Horizontal accent line below header - moved up 0.2 (from 0.89 to 0.69)
    header_line = Line2D([0.05, 0.98], [0.900,0.900], transform=fig.transFigure, 
                        color=ACCENT_COLOR, linewidth=9, zorder=1002)
    fig.add_artist(header_line)
    
    # Logo in top right
    add_logo(fig, logo_path, position='top-right')

def add_header_slv(fig, athlete_name, test_date, logo_path):
    """Add header for SLV page - can be adjusted independently"""
    # Vertical accent bar on the left
    bar_width = 0.03
    bar = Rectangle((0, 0), bar_width, 1, transform=fig.transFigure, 
                    facecolor=ACCENT_COLOR, zorder=1001)
    fig.add_artist(bar)
    
    # Athlete name and date positioned just above the blue line - removed "Name:" and "Test Date:" labels
    # Blue line moved up 0.2 (from 0.89 to 0.69), name positioned just above it
    # Using Helvetica-BoldOblique font (same as pro sup test report)
    fig.text(0.07, 0.965, athlete_name, 
            fontsize=72, color='white', ha='left', va='top', fontweight='bold', 
            fontfamily='sans-serif', style='italic', zorder=1002)
    fig.text(0.07, 0.942, test_date, 
            fontsize=72, color='white', ha='left', va='top', fontweight='bold', 
            fontfamily='sans-serif', style='italic', zorder=1002)
    
    # Horizontal accent line below header - moved up 0.2 (from 0.89 to 0.69)
    header_line = Line2D([0.05, 0.98], [0.90, 0.90], transform=fig.transFigure, 
                        color=ACCENT_COLOR, linewidth=9, zorder=1002)
    fig.add_artist(header_line)
    
    # Logo in top right
    add_logo(fig, logo_path, position='top-right')

# ------------------------------------------------
# Helper function to add logo
# ------------------------------------------------
def add_logo(fig, logo_path, position='top-right'):
    """Add 8ctane logo to figure"""
    if logo_path and os.path.exists(logo_path):
        try:
            img = mpimg.imread(logo_path)
        
            logo_size = 0.28  # Increased from 0.18 to make logo larger 
            
            if position == 'top-right':
                # Position moved more to the left and lower to prevent cutoff
                # Using anchor='NE' means the position is the top-right corner of the logo
                # Lower y position to ensure full visibility
                ax_logo = fig.add_axes([0.70, 0.88, logo_size, logo_size * (img.shape[0]/img.shape[1])], 
                                      anchor='NE', zorder=1000)
            elif position == 'top-left':
                # Position in top-left corner
                ax_logo = fig.add_axes([0.02, 0.92, logo_size, logo_size * (img.shape[0]/img.shape[1])], 
                                      anchor='NW', zorder=1000)
            
            ax_logo.imshow(img)
            ax_logo.axis('off')
        except Exception as e:
            print(f"Warning: Could not load logo: {e}")

# ------------------------------------------------
# Radar Plot (Spider/Radial Chart) - Percentile-based
# ------------------------------------------------
def radar_chart(ax, row, title, population=None):
    labels = RADAR_METRICS
    values = [row.get(m, None) for m in labels]

    N = len(labels)
    angles = np.linspace(0, 2 * np.pi, N, endpoint=False)
    
    # Convert values to percentiles if population data is provided
    if population is not None:
        percentile_values = []
        for i, metric in enumerate(labels):
            if metric in population.columns:
                pop_values = population[metric].dropna()
                if len(pop_values) > 0 and values[i] is not None:
                    pct = percentileofscore(pop_values, values[i])
                    percentile_values.append(pct / 100.0)  # Convert to 0-1 scale
                else:
                    percentile_values.append(0)
            else:
                percentile_values.append(0)
    else:
        # Fallback to normalization if no population data
        max_val = max(values) if max(values) > 0 else 1
        percentile_values = [v / max_val for v in values]
    
    percentile_values += [percentile_values[0]]
    angles = np.append(angles, angles[0])

    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)

    # Set radial limits and add grid circles (0-100 percentile)
    ax.set_ylim(0, 1)
    ax.set_yticks([0.2, 0.4, 0.6, 0.8, 1.0])
    ax.set_yticklabels(['20th', '40th', '60th', '80th', '100th'], color='white', fontsize=21)
    ax.grid(True, color='white', alpha=0.3, linestyle='--')

    ax.plot(angles, percentile_values, linewidth=4.0, color='#2c99d4', marker='o', markersize=5)  # Blue line - increased from 2.0 to 4.0
    ax.fill(angles, percentile_values, alpha=0.25, color='#d62728')  # Red shading
    ax.set_xticks(angles[:-1])
    # Use display labels instead of raw metric names (bigger font)
    display_labels = [METRIC_LABELS.get(label, label) for label in labels]
    ax.set_xticklabels(display_labels, fontsize=36, color='white')  # Increased from 27 to 36
    # Move labels further from chart using tick_params pad
    ax.tick_params(colors='white', pad=60)
    # Removed title
    ax.spines['polar'].set_color('white')
    ax.set_facecolor('#373e43')

# ------------------------------------------------
# SLV Radar Chart (consolidated - shows both left and right)
# ------------------------------------------------
def slv_radar_chart(ax, left_row, right_row, population=None):
    """Create a consolidated radar chart for SLV showing both left (dark blue) and right (red) legs"""
    labels = RADAR_METRICS
    
    # Process left leg
    left_values = [left_row.get(m, None) for m in labels] if left_row is not None else None
    # Process right leg
    right_values = [right_row.get(m, None) for m in labels] if right_row is not None else None
    
    N = len(labels)
    angles = np.linspace(0, 2 * np.pi, N, endpoint=False)
    
    def get_percentile_values(values, population):
        """Convert values to percentiles"""
        if population is not None and values is not None:
            percentile_values = []
            for i, metric in enumerate(labels):
                if metric in population.columns:
                    pop_values = population[metric].dropna()
                    if len(pop_values) > 0 and values[i] is not None:
                        pct = percentileofscore(pop_values, values[i])
                        percentile_values.append(pct / 100.0)  # Convert to 0-1 scale
                    else:
                        percentile_values.append(0)
                else:
                    percentile_values.append(0)
        elif values is not None:
            # Fallback to normalization if no population data
            max_val = max(values) if max(values) > 0 else 1
            percentile_values = [v / max_val for v in values]
        else:
            percentile_values = [0] * N
        return percentile_values
    
    left_percentiles = get_percentile_values(left_values, population)
    right_percentiles = get_percentile_values(right_values, population)
    
    # Close the loop
    left_percentiles += [left_percentiles[0]]
    right_percentiles += [right_percentiles[0]]
    angles_closed = np.append(angles, angles[0])
    
    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)
    
    # Set radial limits and add grid circles (0-100 percentile)
    ax.set_ylim(0, 1)
    ax.set_yticks([0.2, 0.4, 0.6, 0.8, 1.0])
    ax.set_yticklabels(['20th', '40th', '60th', '80th', '100th'], color='white', fontsize=21)
    ax.grid(True, color='white', alpha=0.3, linestyle='--')
    
    # Plot left leg in red - much bolder line with red shading
    if left_row is not None:
        ax.plot(angles_closed, left_percentiles, linewidth=8.0, color='#d62728', marker='o', markersize=5, label='Left Leg')  # Increased from 3.0 to 8.0
        ax.fill(angles_closed, left_percentiles, alpha=0.7, color='#d62728')  # Red shading with increased opacity (0.5 to 0.7)
    
    # Plot right leg in blue - much bolder line with blue shading
    if right_row is not None:
        ax.plot(angles_closed, right_percentiles, linewidth=8.0, color='#2c99d4', marker='o', markersize=5, label='Right Leg')  # Increased from 3.0 to 8.0, changed to blue
        ax.fill(angles_closed, right_percentiles, alpha=0.7, color='#2c99d4')  # Blue shading with increased opacity (0.5 to 0.7)
    
    ax.set_xticks(angles)
    display_labels = [METRIC_LABELS.get(label, label) for label in labels]
    ax.set_xticklabels(display_labels, fontsize=36, color='white')  # Increased from 29 to 36
    # Move labels further from chart using tick_params pad
    ax.tick_params(colors='white', pad=60)
    # Removed title
    ax.spines['polar'].set_color('white')
    ax.set_facecolor('#373e43')
    
    # Add legend if both legs are present
    if left_row is not None and right_row is not None:
        ax.legend(loc='upper right', facecolor='#373e43', edgecolor='white', labelcolor='white', fontsize=21)

# ------------------------------------------------
# Performance Table (for all movements)
# ------------------------------------------------
def performance_table(ax, row, movement_name=None):
    """Create a table showing CMJ variables with performance tiers"""
    
    # Define thresholds and tier names
    rpd_thresholds = {
        'Low': (float('-inf'), 8400),
        'Below Average': (8400, 12280),
        'Average': (12280, 17846),
        'High': (17846, 25000),
        'Elite': (25000, float('inf'))
    }
    
    kurtosis_thresholds = {
        'Very Flat': (float('-inf'), -1.3),
        'Moderately Flat': (-1.3, -0.4),
        'Typical': (-0.4, 0.5),
        'Spiky': (0.5, float('inf'))
    }
    
    auc_thresholds = {
        'Low': (float('-inf'), 366),
        'Below Average': (366, 513),
        'Average': (513, 773),
        'High': (773, 1100),
        'Elite': (1100, float('inf'))
    }
    
    # Color mapping - pastel colors with reduced opacity for boxes, text stays white
    # Convert hex to RGB and make pastel (lighter) versions with opacity
    def hex_to_pastel_rgba(hex_color, alpha=0.3):
        """Convert hex color to pastel RGBA with opacity"""
        hex_color = hex_color.lstrip('#')
        r = int(hex_color[0:2], 16) / 255.0
        g = int(hex_color[2:4], 16) / 255.0
        b = int(hex_color[4:6], 16) / 255.0
        # Make pastel by blending with white (lighter, softer colors)
        white = 1.0
        r = r * 0.5 + white * 0.5
        g = g * 0.5 + white * 0.5
        b = b * 0.5 + white * 0.5
        return (r, g, b, alpha)
    
    color_map = {
        'Elite': hex_to_pastel_rgba('#00ff00', 0.5),  # pastel green with opacity
        'High': hex_to_pastel_rgba('#90ee90', 0.5),   # pastel light green with opacity
        'Average': hex_to_pastel_rgba('#808080', 0.5), # pastel gray with opacity
        'Below Average': hex_to_pastel_rgba('#ffff00', 0.5), # pastel yellow with opacity
        'Low': hex_to_pastel_rgba('#d62728', 0.5),    # pastel red with opacity
        'Very Flat': hex_to_pastel_rgba('#d62728', 0.5),
        'Moderately Flat': hex_to_pastel_rgba('#ffff00', 0.5),
        'Typical': hex_to_pastel_rgba('#808080', 0.5),
        'Spiky': hex_to_pastel_rgba('#90ee90', 0.5)
    }
    
    def get_tier(value, thresholds):
        """Determine tier based on value and thresholds"""
        for tier, (min_val, max_val) in thresholds.items():
            if min_val <= value < max_val:
                return tier
        return 'Unknown'
    
    # Get values from row
    rpd_value = row.get('rpd_max_w_per_s', 0)
    kurtosis_value = row.get('kurtosis', 0)
    auc_value = row.get('auc_j', 0)
    
    # Determine tiers
    rpd_tier = get_tier(rpd_value, rpd_thresholds)
    kurtosis_tier = get_tier(kurtosis_value, kurtosis_thresholds)
    auc_tier = get_tier(auc_value, auc_thresholds)
    
    # Helper function to format numbers with significant figures
    def format_sigfig(value, sigfigs):
        """Format a number with specified significant figures"""
        if value == 0:
            return "0"
        # Calculate the order of magnitude
        import math
        order = math.floor(math.log10(abs(value)))
        # Round to the appropriate number of significant figures
        rounded = round(value, sigfigs - 1 - order)
        # Format to avoid scientific notation for reasonable ranges
        if abs(rounded) >= 1:
            # For numbers >= 1, use integer formatting if no decimals needed
            if rounded == int(rounded):
                return str(int(rounded))
            # Otherwise format with appropriate decimal places
            decimal_places = max(0, sigfigs - len(str(int(abs(rounded)))))
            format_str = "{:." + str(decimal_places) + "f}"
            return format_str.format(rounded).rstrip('0').rstrip('.')
        else:
            # For numbers < 1, use decimal formatting
            decimal_places = sigfigs - 1 - order
            format_str = "{:." + str(decimal_places) + "f}"
            return format_str.format(rounded).rstrip('0').rstrip('.')
    
    # Get threshold values - just the values, no labels, based on movement type
    def get_threshold_text(thresholds, var_type, movement_name):
        """Get elite/typical threshold values only, based on movement type"""
        if var_type == 'rpd':
            # Elite RPD Max values by movement
            elite_rpd = {
                "DJ": 32708,
                "CMJ": 25189,
                "PPU": 7980,
                "SLV": 18212
            }
            elite_min = elite_rpd.get(movement_name, 25000)
            return f">{format_sigfig(elite_min, 4)}"  # 4 significant figures
        elif var_type == 'kurtosis':
            # Typical Kurtosis ranges by movement - format with 3 significant figures
            typical_ranges_raw = {
                "DJ": (-1.43, -1.12),
                "CMJ": (-1.30, -0.40),
                "PPU": (-1.58, -1.25),
                "SLV": (-1.02, -0.19)
            }
            if movement_name in typical_ranges_raw:
                low, high = typical_ranges_raw[movement_name]
                low_str = format_sigfig(low, 3)
                high_str = format_sigfig(high, 3)
                return f"{low_str} to {high_str}"
            return "-0.4 to 0.5"
        elif var_type == 'auc':
            # Elite AUC values by movement
            elite_auc = {
                "DJ": 571.55,
                "CMJ": 1261.33,
                "PPU": 701.51,
                "SLV": 1027.56
            }
            elite_min = elite_auc.get(movement_name, 1100)
            return f">{format_sigfig(elite_min, 4)}"  # 4 significant figures
        return ""
    
    # Create table data with significant figures formatting
    table_data = [
        ['Variable', 'Athlete Value', 'Tier / Threshold', 'Ideal Values'],
        ['Max RPD (W/s)', format_sigfig(rpd_value, 4), rpd_tier, get_threshold_text(rpd_thresholds, 'rpd', movement_name)],  # 4 significant figures
        ['Kurtosis', format_sigfig(kurtosis_value, 3), kurtosis_tier, get_threshold_text(kurtosis_thresholds, 'kurtosis', movement_name)],  # 3 significant figures
        ['Work (AUC)', format_sigfig(auc_value, 4), auc_tier, get_threshold_text(auc_thresholds, 'auc', movement_name)]  # 4 significant figures
    ]
    
    # Create table
    ax.axis('off')
    ax.set_facecolor('#373e43')
    # Adjust bbox height for DJ to make rows shorter
    if movement_name == "DJ":
        bbox_height = 0.4  # Shorter height for DJ
    else:
        bbox_height = 0.4  # Full height for other movements
    table = ax.table(cellText=table_data[1:], colLabels=table_data[0],
                    cellLoc='center', loc='center',
                    colWidths=[0.12, 0.12, 0.12, 0.12],  # All columns same size as Ideal Values column
                    bbox=[0.1, 0.3, 0.8, bbox_height])  # Adjustable height based on movement
    
    # Style the table
    table.auto_set_font_size(False)
    table.set_fontsize(36)  # Reduced from 38 to 36 (another 2 font sizes smaller)
    
    # Apply colors and styling first
    for i in range(len(table_data[0])):
        # Header row
        cell = table[(0, i)]
        cell.set_facecolor('#373e43')
        if i == 3:  # Ideal Values column header
            cell.set_text_props(weight='bold', color='white', fontsize=36)  # Reduced from 38 to 36
        else:
            cell.set_text_props(weight='bold', color='white')
        cell.set_edgecolor('white')
        cell.set_linewidth(1.5)
    
    # Data rows
    for i, (var, value, tier, thresholds) in enumerate(table_data[1:], 1):
        # Variable name
        cell = table[(i, 0)]
        cell.set_facecolor('#373e43')
        cell.set_text_props(color='white')
        cell.set_edgecolor('white')
        
        # Athlete value
        cell = table[(i, 1)]
        cell.set_facecolor('#373e43')
        cell.set_text_props(color='white')
        cell.set_edgecolor('white')
        
        # Tier cell with color (pastel with opacity, text stays white)
        cell = table[(i, 2)]
        tier_color = color_map.get(tier, (0.22, 0.24, 0.27, 0.3))  # Default to pastel #373e43 with opacity
        cell.set_facecolor(tier_color)
        # Text always white at full opacity
        cell.set_text_props(color='white', weight='bold')
        cell.set_edgecolor('white')
        
        # Elite/Average thresholds column
        cell = table[(i, 3)]
        cell.set_facecolor('#373e43')
        cell.set_text_props(color='white', fontsize=36)  # Reduced from 38 to 36 (another 2 font sizes smaller)
        cell.set_edgecolor('white')
    
    # Set all cell edges
    for key, cell in table.get_celld().items():
        cell.set_edgecolor('white')
        cell.set_linewidth(1)
    
    # Apply scaling AFTER all styling - use different scaling for DJ vs other movements
    # Reduce vertical scale to have less empty space around words
    if movement_name == "DJ":
        # DJ-specific scaling - make rows less tall
        table.scale(1, 0.7)  # DJ-specific scaling (smaller value = shorter rows)
    else:
        table.scale(1, 0.7)  # Same scaling for CMJ and PPU (can be adjusted separately if needed)

# ------------------------------------------------
# SLV Performance Table (shows L: and R: values)
# ------------------------------------------------
def slv_performance_table(ax, left_df, right_df, movement_name):
    """Create a table showing SLV variables with L: and R: values"""
    
    # Get best trials
    if not left_df.empty:
        left_best = left_df.iloc[left_df["PP_FORCEPLATE"].argmax()]
    else:
        left_best = None
    if not right_df.empty:
        right_best = right_df.iloc[right_df["PP_FORCEPLATE"].argmax()]
    else:
        right_best = None
    
    # Helper function to format numbers with significant figures
    def format_sigfig(value, sigfigs):
        """Format a number with specified significant figures"""
        if value == 0:
            return "0"
        # Calculate the order of magnitude
        import math
        order = math.floor(math.log10(abs(value)))
        # Round to the appropriate number of significant figures
        rounded = round(value, sigfigs - 1 - order)
        # Format to avoid scientific notation for reasonable ranges
        if abs(rounded) >= 1:
            # For numbers >= 1, use integer formatting if no decimals needed
            if rounded == int(rounded):
                return str(int(rounded))
            # Otherwise format with appropriate decimal places
            decimal_places = max(0, sigfigs - len(str(int(abs(rounded)))))
            format_str = "{:." + str(decimal_places) + "f}"
            return format_str.format(rounded).rstrip('0').rstrip('.')
        else:
            # For numbers < 1, use decimal formatting
            decimal_places = sigfigs - 1 - order
            format_str = "{:." + str(decimal_places) + "f}"
            return format_str.format(rounded).rstrip('0').rstrip('.')
    
    # Get threshold values function (same as regular performance table)
    def get_threshold_text(var_type, movement_name):
        """Get elite/typical threshold values only, based on movement type"""
        if var_type == 'rpd':
            elite_rpd = {"SLV": 18212}
            elite_min = elite_rpd.get(movement_name, 25000)
            return f">{format_sigfig(elite_min, 4)}"  # 4 significant figures
        elif var_type == 'kurtosis':
            # Format with 3 significant figures
            typical_ranges_raw = {"SLV": (-1.02, -0.19)}
            if movement_name in typical_ranges_raw:
                low, high = typical_ranges_raw[movement_name]
                low_str = format_sigfig(low, 3)
                high_str = format_sigfig(high, 3)
                return f"{low_str} to {high_str}"
            return "-0.4 to 0.5"
        elif var_type == 'auc':
            elite_auc = {"SLV": 1027.56}
            elite_min = elite_auc.get(movement_name, 1100)
            return f">{format_sigfig(elite_min, 4)}"  # 4 significant figures
        return ""
    
    # Define thresholds and tier names (same as regular performance table)
    rpd_thresholds = {
        'Low': (float('-inf'), 8400),
        'Below Average': (8400, 12280),
        'Average': (12280, 17846),
        'High': (17846, 25000),
        'Elite': (25000, float('inf'))
    }
    
    kurtosis_thresholds = {
        'Very Flat': (float('-inf'), -1.3),
        'Moderately Flat': (-1.3, -0.4),
        'Typical': (-0.4, 0.5),
        'Spiky': (0.5, float('inf'))
    }
    
    auc_thresholds = {
        'Low': (float('-inf'), 366),
        'Below Average': (366, 513),
        'Average': (513, 773),
        'High': (773, 1100),
        'Elite': (1100, float('inf'))
    }
    
    # Color mapping - pastel colors with reduced opacity for boxes, text stays white
    # Convert hex to RGB and make pastel (lighter) versions with opacity
    def hex_to_pastel_rgba(hex_color, alpha=0.3):
        """Convert hex color to pastel RGBA with opacity"""
        hex_color = hex_color.lstrip('#')
        r = int(hex_color[0:2], 16) / 255.0
        g = int(hex_color[2:4], 16) / 255.0
        b = int(hex_color[4:6], 16) / 255.0
        # Make pastel by blending with white (lighter, softer colors)
        white = 1.0
        r = r * 0.5 + white * 0.5
        g = g * 0.5 + white * 0.5
        b = b * 0.5 + white * 0.5
        return (r, g, b, alpha)
    
    color_map = {
        'Elite': hex_to_pastel_rgba('#00ff00', 0.3),  # pastel green with opacity
        'High': hex_to_pastel_rgba('#90ee90', 0.3),   # pastel light green with opacity
        'Average': hex_to_pastel_rgba('#808080', 0.3), # pastel gray with opacity
        'Below Average': hex_to_pastel_rgba('#ffff00', 0.3), # pastel yellow with opacity
        'Low': hex_to_pastel_rgba('#d62728', 0.3),    # pastel red with opacity
        'Very Flat': hex_to_pastel_rgba('#d62728', 0.3),
        'Moderately Flat': hex_to_pastel_rgba('#ffff00', 0.3),
        'Typical': hex_to_pastel_rgba('#808080', 0.3),
        'Spiky': hex_to_pastel_rgba('#90ee90', 0.3)
    }
    
    def get_tier(value, thresholds):
        """Determine tier based on value and thresholds"""
        for tier, (min_val, max_val) in thresholds.items():
            if min_val <= value < max_val:
                return tier
        return 'Unknown'
    
    # Get values from left and right
    rpd_left = left_best.get('rpd_max_w_per_s', 0) if left_best is not None else 0
    rpd_right = right_best.get('rpd_max_w_per_s', 0) if right_best is not None else 0
    kurtosis_left = left_best.get('kurtosis', 0) if left_best is not None else 0
    kurtosis_right = right_best.get('kurtosis', 0) if right_best is not None else 0
    auc_left = left_best.get('auc_j', 0) if left_best is not None else 0
    auc_right = right_best.get('auc_j', 0) if right_best is not None else 0
    
    # Determine tiers for left and right
    rpd_tier_left = get_tier(rpd_left, rpd_thresholds) if left_best is not None else 'N/A'
    rpd_tier_right = get_tier(rpd_right, rpd_thresholds) if right_best is not None else 'N/A'
    kurtosis_tier_left = get_tier(kurtosis_left, kurtosis_thresholds) if left_best is not None else 'N/A'
    kurtosis_tier_right = get_tier(kurtosis_right, kurtosis_thresholds) if right_best is not None else 'N/A'
    auc_tier_left = get_tier(auc_left, auc_thresholds) if left_best is not None else 'N/A'
    auc_tier_right = get_tier(auc_right, auc_thresholds) if right_best is not None else 'N/A'
    
    # Create table data with L: and R: values vertically aligned - using significant figures
    table_data = [
        ['Variable', 'Athlete Value', 'Tier / Threshold', 'Ideal Values'],
        ['Max RPD (W/s)', f'L: {format_sigfig(rpd_left, 4)}\nR: {format_sigfig(rpd_right, 4)}', f'L: {rpd_tier_left}\nR: {rpd_tier_right}', get_threshold_text('rpd', movement_name)],  # 4 significant figures
        ['Kurtosis', f'L: {format_sigfig(kurtosis_left, 3)}\nR: {format_sigfig(kurtosis_right, 3)}', f'L: {kurtosis_tier_left}\nR: {kurtosis_tier_right}', get_threshold_text('kurtosis', movement_name)],  # 3 significant figures
        ['Work (AUC)', f'L: {format_sigfig(auc_left, 4)}\nR: {format_sigfig(auc_right, 4)}', f'L: {auc_tier_left}\nR: {auc_tier_right}', get_threshold_text('auc', movement_name)]  # 4 significant figures
    ]
    
    # Create table - same size as other pages
    ax.axis('off')
    ax.set_facecolor('#373e43')
    table = ax.table(cellText=table_data[1:], colLabels=table_data[0],
                    cellLoc='center', loc='center',
                    colWidths=[0.12, 0.12, 0.16, 0.12],  # Made tier/threshold column (index 2) wider: 0.12 -> 0.16
                    bbox=[0.1, 0, 0.8, 1])
    
    # Style the table
    table.auto_set_font_size(False)
    table.set_fontsize(35)  # Reduced from 40 to 35 for column titles
    
    # Apply colors and styling
    for i in range(len(table_data[0])):
        cell = table[(0, i)]
        cell.set_facecolor('#373e43')
        if i == 3:
            cell.set_text_props(weight='bold', color='white', fontsize=35)  # Reduced from 40
        else:
            cell.set_text_props(weight='bold', color='white', fontsize=35)  # Reduced from default
        cell.set_edgecolor('white')
        cell.set_linewidth(1.5)
    
    # Data rows - apply tier colors to tier column
    for i in range(1, len(table_data)):
        for j in range(len(table_data[0])):
            cell = table[(i, j)]
            cell.set_facecolor('#373e43')
            
            # For tier column (j == 2), apply colors based on tiers
            if j == 2:
                # Extract left and right tiers from the cell text
                cell_text = table_data[i][j]
                if 'L:' in cell_text and 'R:' in cell_text:
                    # Get left tier (first tier after "L: ")
                    left_tier = cell_text.split('L: ')[1].split('\n')[0] if 'L:' in cell_text else ''
                    # Get right tier (after "R: ")
                    right_tier = cell_text.split('R: ')[1] if 'R:' in cell_text else ''
                    
                    # For now, use the left tier color (or we could use a gradient)
                    tier_color = color_map.get(left_tier, (0.22, 0.24, 0.27, 0.3))  # Default to pastel #373e43 with opacity
                    cell.set_facecolor(tier_color)
                    # Text always white at full opacity
                    cell.set_text_props(color='white', weight='bold', fontsize=35)
                else:
                    cell.set_text_props(color='white', fontsize=35)
            elif j == 3:
                cell.set_text_props(color='white', fontsize=35)
            else:
                cell.set_text_props(color='white', fontsize=35)
            cell.set_edgecolor('white')
    
    # Set all cell edges
    for key, cell in table.get_celld().items():
        cell.set_edgecolor('white')
        cell.set_linewidth(1)
    
    # Apply scaling - same as other pages
    table.scale(1, 0.7)

# ------------------------------------------------
# Power Curve (synthetic normalized)
# ------------------------------------------------
def power_curve(ax, df, pop_df=None, power_files_dir=None):
    """
    Plot power curves from Power.txt files if available, otherwise synthesize.
    
    Args:
        ax: Matplotlib axes
        df: DataFrame with trial data (must include 'trial_name' column)
        pop_df: Population data (unused but kept for compatibility)
        power_files_dir: Base directory where Power.txt files are stored
    """
    curves = []
    
    # Try to load actual Power.txt files if directory is provided
    if power_files_dir and 'trial_name' in df.columns:
        from power_analysis import load_power_txt
        import glob
        
        processed_dir = os.path.join(power_files_dir, "Processed txt Files")
        
        for _, r in df.iterrows():
            trial_name = r.get('trial_name')
            if not trial_name:
                continue
            
            # Look for Power.txt file - try different patterns
            power_file = None
            patterns = [
                os.path.join(processed_dir, f"{trial_name}_Power.txt"),
                os.path.join(processed_dir, f"{trial_name}*_Power.txt"),
                os.path.join(power_files_dir, f"{trial_name}_Power.txt"),
                os.path.join(power_files_dir, f"{trial_name}*_Power.txt"),
            ]
            
            for pattern in patterns:
                matches = glob.glob(pattern)
                if matches:
                    power_file = matches[0]
                    break
            
            if power_file and os.path.exists(power_file):
                try:
                    power_data = load_power_txt(power_file)
                    # Normalize time to 0-1 and power values
                    if len(power_data) > 0:
                        t_normalized = np.linspace(0, 1, len(power_data))
                        # Normalize power to 0-1 range for visualization
                        power_normalized = (power_data - power_data.min()) / (power_data.max() - power_data.min() + 1e-10)
                        curves.append((t_normalized, power_normalized))
                except Exception as e:
                    # Fall back to synthesized curve if loading fails
                    t = np.linspace(0, 1, 200)
                    shape = np.exp(-((t - 0.35) ** 2) / (0.06)) * r["PP_FORCEPLATE"]
                    curves.append((t, shape / shape.max()))  # Normalize to 0-1
            else:
                # Fall back to synthesized curve if file not found
                t = np.linspace(0, 1, 200)
                shape = np.exp(-((t - 0.35) ** 2) / (0.06)) * r["PP_FORCEPLATE"]
                curves.append((t, shape / shape.max()))  # Normalize to 0-1
    else:
        # Fallback: synthesize curves if no directory provided or no trial_name
        t = np.linspace(0, 1, 200)
        for _, r in df.iterrows():
            shape = np.exp(-((t - 0.35) ** 2) / (0.06)) * r["PP_FORCEPLATE"]
            curves.append((t, shape / shape.max()))  # Normalize to 0-1

    # Plot individual trial curves as dashed blue lines
    for t_vals, power_vals in curves:
        ax.plot(t_vals, power_vals, color="#2c99d4", linewidth=3, alpha=0.6, linestyle='--')  # Increased from 2 to 3

    # Calculate and plot mean power curve as bold red
    if curves:
        # Interpolate all curves to same time points for averaging
        t_common = np.linspace(0, 1, 200)
        interpolated_curves = []
        for t_vals, power_vals in curves:
            from scipy.interpolate import interp1d
            interp_func = interp1d(t_vals, power_vals, kind='linear', 
                                   bounds_error=False, fill_value='extrapolate')
            interpolated_curves.append(interp_func(t_common))
        
        mean_curve = np.mean(interpolated_curves, axis=0)
        ax.plot(t_common, mean_curve, color="#ff0000", linewidth=7, label='Mean Power', linestyle='-')  # Increased from 5 to 7
    
    # Add straight line from 10% to 90% of power along the curve
    if curves:
        max_power = np.max(mean_curve)
        power_10 = 0.1 * max_power
        power_90 = 0.9 * max_power
        
        # Find time points where curve reaches 10% and 90% of max power
        # Find first point where curve crosses 10% (rising phase)
        idx_10 = np.where(mean_curve >= power_10)[0]
        idx_90 = np.where(mean_curve >= power_90)[0]
        
        if len(idx_10) > 0 and len(idx_90) > 0:
            t_10 = t_common[idx_10[0]]  # First time point at 10%
            t_90 = t_common[idx_90[0]]  # First time point at 90%
            p_10 = mean_curve[idx_10[0]]
            p_90 = mean_curve[idx_90[0]]
            
            # Draw straight line between these two points (green, solid, thicker)
            ax.plot([t_10, t_90], [p_10, p_90], color="#00ff00", linewidth=6, linestyle='-', alpha=0.7, label='10-90% rise')  # Changed to green, increased from 4 to 6
    
    # Add single legend at the end (remove any existing legends first, after all plots)
    handles, labels = ax.get_legend_handles_labels()
    if ax.get_legend() is not None:
        ax.get_legend().remove()
    # Only create legend if we have labeled items
    if len(handles) > 0:
        ax.legend(handles, labels, loc='upper right', facecolor='#373e43', edgecolor='white', labelcolor='white', fontsize=27)

    ax.set_title("Power Curve", color='white', fontsize=60, fontweight='bold')  # Reset to 60
    ax.set_xlabel("Normalized Time", color='white', fontsize=27)
    ax.set_ylabel("Power (W)", color='white', fontsize=27)
    ax.tick_params(colors='white', labelsize=24)
    ax.spines['bottom'].set_color('white')
    ax.spines['top'].set_color('white')
    ax.spines['left'].set_color('white')
    ax.spines['right'].set_color('white')
    ax.grid(True, color='white', alpha=0.2)
    ax.set_facecolor('#373e43')

# ------------------------------------------------
# SLV Power Curve (shows left in dark blue and right in red)
# ------------------------------------------------
def slv_power_curve(ax, left_df, right_df, pop_df=None, power_files_dir=None):
    """
    Power curve for SLV showing left and right curves from Power.txt files if available.
    
    Args:
        ax: Matplotlib axes
        left_df: DataFrame with left leg trial data
        right_df: DataFrame with right leg trial data
        pop_df: Population data (unused but kept for compatibility)
        power_files_dir: Base directory where Power.txt files are stored
    """
    from scipy.interpolate import interp1d
    from power_analysis import load_power_txt
    import glob
    
    processed_dir = os.path.join(power_files_dir, "Processed txt Files") if power_files_dir else None
    
    def load_curves_from_files(df, side_name):
        """Load curves from Power.txt files or synthesize if not available."""
        curves = []
        t = np.linspace(0, 1, 200)
        
        for _, r in df.iterrows():
            trial_name = r.get('trial_name')
            power_file = None
            
            if processed_dir and trial_name:
                patterns = [
                    os.path.join(processed_dir, f"{trial_name}_Power.txt"),
                    os.path.join(processed_dir, f"{trial_name}*_Power.txt"),
                    os.path.join(power_files_dir, f"{trial_name}_Power.txt"),
                    os.path.join(power_files_dir, f"{trial_name}*_Power.txt"),
                ]
                for pattern in patterns:
                    matches = glob.glob(pattern)
                    if matches:
                        power_file = matches[0]
                        break
            
            if power_file and os.path.exists(power_file):
                try:
                    power_data = load_power_txt(power_file)
                    if len(power_data) > 0:
                        t_normalized = np.linspace(0, 1, len(power_data))
                        power_normalized = (power_data - power_data.min()) / (power_data.max() - power_data.min() + 1e-10)
                        curves.append((t_normalized, power_normalized))
                except:
                    # Fallback to synthesized
                    shape = np.exp(-((t - 0.35) ** 2) / (0.06)) * r["PP_FORCEPLATE"]
                    curves.append((t, shape / shape.max()))
            else:
                # Synthesize curve
                shape = np.exp(-((t - 0.35) ** 2) / (0.06)) * r["PP_FORCEPLATE"]
                curves.append((t, shape / shape.max()))
        
        return curves
    
    # Left leg curves (dashed blue)
    if not left_df.empty:
        left_curves = load_curves_from_files(left_df, "Left")
        for t_vals, power_vals in left_curves:
            ax.plot(t_vals, power_vals, color="#2c99d4", linewidth=3, alpha=0.6, linestyle='--')  # Increased from 2 to 3
        
        if left_curves:
            t_common = np.linspace(0, 1, 200)
            interpolated = []
            for t_vals, power_vals in left_curves:
                interp_func = interp1d(t_vals, power_vals, kind='linear', 
                                      bounds_error=False, fill_value='extrapolate')
                interpolated.append(interp_func(t_common))
            left_mean = np.mean(interpolated, axis=0)
            ax.plot(t_common, left_mean, color="#2c99d4", linewidth=7, label='Left Mean', linestyle='-')  # Changed to blue, increased from 5 to 7
    
    # Right leg curves (dashed blue)
    if not right_df.empty:
        right_curves = load_curves_from_files(right_df, "Right")
        for t_vals, power_vals in right_curves:
            ax.plot(t_vals, power_vals, color="#2c99d4", linewidth=3, alpha=0.6, linestyle='--')  # Increased from 2 to 3
        
        if right_curves:
            t_common = np.linspace(0, 1, 200)
            interpolated = []
            for t_vals, power_vals in right_curves:
                interp_func = interp1d(t_vals, power_vals, kind='linear', 
                                      bounds_error=False, fill_value='extrapolate')
                interpolated.append(interp_func(t_common))
            right_mean = np.mean(interpolated, axis=0)
            ax.plot(t_common, right_mean, color="#ff0000", linewidth=7, label='Right Mean', linestyle='-')  # Increased from 5 to 7
    
    # Add legend
    handles, labels = ax.get_legend_handles_labels()
    if len(handles) > 0:
        ax.legend(handles, labels, loc='upper right', facecolor='#373e43', edgecolor='white', labelcolor='white', fontsize=27)

    ax.set_title("Power Curve", color='white', fontsize=60, fontweight='bold')  # Reset to 60
    ax.set_xlabel("Normalized Time", color='white', fontsize=27)
    ax.set_ylabel("Power (W)", color='white', fontsize=27)
    ax.tick_params(colors='white', labelsize=24)
    ax.spines['bottom'].set_color('white')
    ax.spines['top'].set_color('white')
    ax.spines['left'].set_color('white')
    ax.spines['right'].set_color('white')
    ax.grid(True, color='white', alpha=0.2)
    ax.set_facecolor('#373e43')

# ------------------------------------------------
# F–V scatter
# ------------------------------------------------
def fv_scatter(ax, df, population):
    # Plot all athletes from population as blue dots
    pop_force = population["Force_at_PP"].dropna()
    pop_vel = population["Vel_at_PP"].dropna()
    # Align the arrays by index
    common_idx = pop_force.index.intersection(pop_vel.index)
    ax.scatter(pop_force.loc[common_idx], pop_vel.loc[common_idx], 
              s=720, color='#2c99d4', alpha=0.4, label='All Athletes')  # Increased from 480 to 720
    
    # Calculate average force and velocity from population
    avg_force = pop_force.mean()
    avg_vel = pop_vel.mean()
    
    # Plot current athlete's mean F/V as single bright red dot
    if len(df) > 0:
        athlete_mean_force = df["Force_at_PP"].mean()
        athlete_mean_vel = df["Vel_at_PP"].mean()
        ax.scatter([athlete_mean_force], [athlete_mean_vel], 
                  s=1440, color='#ff0000', alpha=0.9, label='Current Athlete', zorder=5, marker='o', edgecolors='white', linewidths=2.0)  # Changed to bright red, increased size from 960 to 1440
    
    # Add reference lines for average force and velocity (after scatter so they appear on top)
    # Vertical line for average force - gray
    ax.axvline(x=avg_force, color='gray', linestyle='--', linewidth=6.0, alpha=0.7, zorder=3)  # Doubled from 3.0 to 6.0
    # Horizontal line for average velocity - gray
    ax.axhline(y=avg_vel, color='gray', linestyle='--', linewidth=6.0, alpha=0.7, zorder=3)  # Doubled from 3.0 to 6.0

    avg_pp = df["PP_FORCEPLATE"].mean()
    pct = percentileofscore(population["PP_FORCEPLATE"].dropna(), avg_pp)

    ax.text(0.98, 0.98,
            f"PP Percentile:\n{pct:.0f}th",
            transform=ax.transAxes,
            ha="right", va="top",
            color='white',
            fontsize=27)  # Same size as axis titles, no box

    ax.set_xlabel("Force @ PP (N)", color='white', fontsize=27)
    ax.set_ylabel("Vel @ PP (m/s)", color='white', fontsize=27)
    ax.set_title("Force–Velocity Scatter", color='white', fontsize=60, fontweight='bold')  # Reset to 60
    ax.tick_params(colors='white', labelsize=24)
    ax.spines['bottom'].set_color('white')
    ax.spines['top'].set_color('white')
    ax.spines['left'].set_color('white')
    ax.spines['right'].set_color('white')
    ax.grid(True, color='white', alpha=0.2)
    ax.set_facecolor('#373e43')

# ------------------------------------------------
# SLV F-V Scatter (shows left in dark blue and right in red)
# ------------------------------------------------
def slv_fv_scatter(ax, left_df, right_df, population):
    """FV scatter for SLV showing left (dark blue) and right (red) dots"""
    # Plot all athletes from population as blue dots
    pop_force = population["Force_at_PP"].dropna()
    pop_vel = population["Vel_at_PP"].dropna()
    common_idx = pop_force.index.intersection(pop_vel.index)
    ax.scatter(pop_force.loc[common_idx], pop_vel.loc[common_idx], 
              s=720, color='#2c99d4', alpha=0.4, label='All Athletes')  # Increased from 480 to 720
    
    # Calculate average force and velocity from population
    avg_force = pop_force.mean()
    avg_vel = pop_vel.mean()
    
    # Plot left leg mean F/V as dark blue dot (bigger)
    if not left_df.empty and len(left_df) > 0:
        left_mean_force = left_df["Force_at_PP"].mean()
        left_mean_vel = left_df["Vel_at_PP"].mean()
        ax.scatter([left_mean_force], [left_mean_vel], 
                  s=1440, color='#1a5f8a', alpha=0.9, label='Left Mean', zorder=5, marker='o', edgecolors='white', linewidths=2.0)  # Increased from 960 to 1440
    
    # Plot right leg mean F/V as bright red dot (bigger)
    if not right_df.empty and len(right_df) > 0:
        right_mean_force = right_df["Force_at_PP"].mean()
        right_mean_vel = right_df["Vel_at_PP"].mean()
        ax.scatter([right_mean_force], [right_mean_vel], 
                  s=1440, color='#ff0000', alpha=0.9, label='Right Mean', zorder=5, marker='o', edgecolors='white', linewidths=2.0)  # Changed to bright red, increased from 960 to 1440
    
    # Add reference lines for average force and velocity - gray
    ax.axvline(x=avg_force, color='gray', linestyle='--', linewidth=6.0, alpha=0.7, zorder=3)  # Doubled from 3.0 to 6.0
    ax.axhline(y=avg_vel, color='gray', linestyle='--', linewidth=6.0, alpha=0.7, zorder=3)  # Doubled from 3.0 to 6.0
    
    ax.set_xlabel("Force @ PP (N)", color='white', fontsize=27)
    ax.set_ylabel("Vel @ PP (m/s)", color='white', fontsize=27)
    ax.set_title("Force–Velocity Scatter", color='white', fontsize=60, fontweight='bold')  # Reset to 60
    ax.tick_params(colors='white', labelsize=24)
    ax.spines['bottom'].set_color('white')
    ax.spines['top'].set_color('white')
    ax.spines['left'].set_color('white')
    ax.spines['right'].set_color('white')
    ax.grid(True, color='white', alpha=0.2)
    ax.set_facecolor('#373e43')

# ------------------------------------------------
# Force & Velocity Progress Rings
# ------------------------------------------------
def pct_color(p):
    """
    Get color based on percentile value (matching pro-sup test style).
    
    Args:
        p: Percentile value (0-100).
    
    Returns:
        Color name ('red', 'yellow', or 'limegreen').
    """
    if p < 33:
        return "red"
    if p < 67:
        return "yellow"
    return "limegreen"

def joint_radial(ax, row, pop_df, metric=None):
    """
    Draw a single progress circle for Force or Velocity at Peak Power.
    Uses pro-sup test color scheme: red < 33%, yellow 33-67%, limegreen >= 67%.
    
    Args:
        ax: Matplotlib axes
        row: DataFrame row with athlete data
        pop_df: Population DataFrame for percentile calculation
        metric: "force" or "velocity" - if None, draws both (for CMJ/PPU backward compatibility)
    """
    from matplotlib.patches import Arc, Circle
    from scipy.stats import percentileofscore

    # --- Extract metrics ---
    force_at_pp = row["Force_at_PP"]
    vel_at_pp = row["Vel_at_PP"]

    # --- Percentiles (0 to 100 for color, 0 to 1 for display) ---
    force_pct_100 = percentileofscore(pop_df["Force_at_PP"].dropna(), force_at_pp)
    vel_pct_100 = percentileofscore(pop_df["Vel_at_PP"].dropna(), vel_at_pp)
    force_pct_100 = max(0, min(100, force_pct_100))
    vel_pct_100 = max(0, min(100, vel_pct_100))
    force_pct = force_pct_100 / 100
    vel_pct = vel_pct_100 / 100

    # --- Axes formatting ---
    ax.set_facecolor('#373e43')
    ax.set_aspect('equal')
    ax.axis("off")

    # --- FIXED CIRCLE SIZE (px). Adjust this to make circles bigger/smaller ---
    ring_radius = 100
    lw_base = 28
    lw_progress = 56
    fs_value = 54
    fs_unit = 33

    # --- Single circle mode (for DJ with metric parameter) ---
    if metric is not None:
        if metric == "force":
            pct = force_pct
            val = force_at_pp
            unit = "N"
        elif metric == "velocity":
            pct = vel_pct
            val = vel_at_pp
            unit = "m/s"
        else:
            raise ValueError(f"metric must be 'force' or 'velocity', got '{metric}'")
        
        # Center the circle in the axes - no axes limits, size controlled by radius_data and axes physical size
        # The visual size is controlled by: 1) axes physical size (circle_width/circle_height when created)
        # and 2) radius_data value below. To make circles bigger, increase radius_data or make axes bigger.
        cx, cy = 0.5, 0.5  # Center at 0.5, 0.5 in normalized 0-1 coordinates
        
        # Use a fixed radius in normalized coordinates (0-1 space)
        # Increase this value to make circles bigger - can go up to ~0.48 before hitting edges
        radius_data = 0.45  # 45% of axes size - increase this to make circles bigger
        
        # Get color based on percentile (0-100 scale)
        pct_100 = pct * 100
        ring_color = pct_color(pct_100)
        
        # Draw single circle
        # Background ring (dark gray, like pro-sup)
        ax.add_patch(
            Circle((cx, cy), radius_data,
                   fill=False, color='#303030', linewidth=lw_base, alpha=1.0)
        )

        # Progress arc - starts at top (90°) and goes counterclockwise
        if pct > 0:
            # Start at 90° (top) and go counterclockwise (positive angles)
            theta_start = 90
            theta_end = 90 + (pct * 360)
            arc = Arc((cx, cy),
                      radius_data * 2,
                      radius_data * 2,
                      angle=0,
                      theta1=theta_start,
                      theta2=theta_end,
                      color=ring_color,
                      linewidth=lw_progress,
                      alpha=0.9)
            ax.add_patch(arc)

        # Percentile number in center (bigger)
        ax.text(cx, cy + 0.06,
                f"{int(pct*100)}",
                color="white",
                fontsize=72,  # Increased from 56 to 72
                ha="center", va="center", weight="bold")

        # Value + unit inside circle, below percentile number (bigger)
        ax.text(cx, cy - 0.06,
                f"{val:.1f} {unit}",
                color="white",
                fontsize=48,  # Increased from 32 to 48
                ha="center", va="center")
    
    # --- Dual circle mode (for CMJ/PPU backward compatibility) ---
    else:
        fig = ax.figure
        horizontal = 0.4
        centers = [(-horizontal, 0), (horizontal, 0)]
        ax.set_xlim(-1, 1)
        ax.set_ylim(-1, 1)

        # Title inside axes
        ax.set_title("@ Peak Power", color="white", fontsize=fs_unit*2, pad=35)

        labels = ["Force", "Velocity"]
        values = [force_at_pp, vel_at_pp]
        units = ["N", "m/s"]
        pcts = [force_pct, vel_pct]

        # --- DRAW RINGS ---
        for (label, pct, val, unit, (cx, cy)) in zip(labels, pcts, values, units, centers):
            # Get color based on percentile (0-100 scale)
            pct_100 = pct * 100
            ring_color = pct_color(pct_100)

            # Background ring (dark gray, like pro-sup)
            ax.add_patch(
                Circle((cx, cy), ring_radius,
                       fill=False, color='#303030', linewidth=lw_base, alpha=1.0)
            )

            # Progress arc - starts at top (90°) and goes counterclockwise
            if pct > 0:
                # Start at 90° (top) and go counterclockwise (positive angles)
                theta_start = 90
                theta_end = 90 + (pct * 360)
                arc = Arc((cx, cy),
                          ring_radius * 2,
                          ring_radius * 2,
                          angle=0,
                          theta1=theta_start,
                          theta2=theta_end,
                          color=ring_color,
                          linewidth=lw_progress,
                          alpha=0.9)
                ax.add_patch(arc)

            # Percentile number in center (moved up slightly, bigger)
            ax.text(cx, cy + 0.04,
                    f"{int(pct*100)}",
                    color="white",
                    fontsize=fs_value * 1.3,  # Increased by 30%
                    ha="center", va="center", weight="bold")

            # Value + unit inside circle, below percentile number (bigger)
            ax.text(cx, cy - 0.04,
                    f"{val:.1f} {unit}",
                    color="white",
                    fontsize=fs_unit * 1.5,  # Increased by 50%
                    ha="center", va="center")

# ------------------------------------------------
# SLV Joint Radial (with custom title and smaller percentile text)
# ------------------------------------------------
def slv_joint_radial(ax, row, pop_df, title="Left Leg"):
    from matplotlib.patches import Arc, Circle
    
    # Calculate percentiles for Force and Velocity at Peak Power
    force_at_pp = row["Force_at_PP"]
    vel_at_pp = row["Vel_at_PP"]
    
    # Calculate percentiles (0-100 scale, convert to 0-1 for ring display)
    force_percentile = percentileofscore(pop_df["Force_at_PP"].dropna(), force_at_pp) / 100.0
    vel_percentile = percentileofscore(pop_df["Vel_at_PP"].dropna(), vel_at_pp) / 100.0
    
    # Ensure percentiles are between 0 and 1
    force_percentile = max(0, min(1, force_percentile))
    vel_percentile = max(0, min(1, vel_percentile))
    
    ax.set_aspect('equal')
    ax.set_facecolor('#373e43')
    ax.axis('off')
    
    # Scale factor for text and linewidth (keep original sizing)
    scale_factor = 2.6
    
    # Calculate circle size based on axes dimensions
    fig = ax.figure
    bbox = ax.get_position()
    fig_width = fig.get_figwidth() * fig.dpi
    fig_height = fig.get_figheight() * fig.dpi
    ax_width = bbox.width * fig_width
    ax_height = bbox.height * fig_height
    
    # Use 45% of the smaller dimension for ring radius
    ring_radius = min(ax_width, ax_height) * 0.45
    
    # Vertical spacing between circles (35% of dimension from center)
    vertical_spacing = min(ax_width, ax_height) * 0.35
    centers = [(0, vertical_spacing), (0, -vertical_spacing)]  # Force (top), Velocity (bottom)
    
    # Set axis limits to accommodate the circles
    margin = ring_radius * 0.1
    ax.set_xlim(-ring_radius - margin, ring_radius + margin)
    ax.set_ylim(-ring_radius - vertical_spacing - margin, ring_radius + vertical_spacing + margin)
    labels = ["Force", "Velocity"]
    percentiles = [force_percentile, vel_percentile]
    values = [force_at_pp, vel_at_pp]
    units = ["N", "m/s"]
    
    for i, (label, pct, val, unit, (cx, cy)) in enumerate(zip(labels, percentiles, values, units, centers)):
        # Get color based on percentile (0-100 scale)
        pct_100 = pct * 100
        ring_color = pct_color(pct_100)
        
        # Background circle (full ring) - dark gray like pro-sup
        bg_circle = Circle((cx, cy), ring_radius, fill=False, color='#303030', 
                          linewidth=6 * scale_factor, alpha=1.0)
        ax.add_patch(bg_circle)
        
        # Progress arc - starts at top (90°) and goes counterclockwise
        if pct > 0:
            # Start at 90° (top) and go counterclockwise (positive angles)
            theta_start = 90
            theta_end = 90 + (360 * pct)
            arc = Arc((cx, cy), ring_radius*2, ring_radius*2, 
                     angle=0, theta1=theta_start, theta2=theta_end,
                     color=ring_color, linewidth=12 * scale_factor, alpha=0.9)
            ax.add_patch(arc)
        
        # Label above ring
        ax.text(cx, cy + ring_radius + 0.2 * scale_factor, label, 
               color='white', fontsize=36 * scale_factor, ha='center', va='bottom', fontweight='bold')
        
        # Percentile text in center (moved up slightly, bigger)
        ax.text(cx, cy + 0.06 * scale_factor, f'{int(pct*100)}', 
               color='white', fontsize=44 * scale_factor, ha='center', va='center', fontweight='bold')  # Increased from 34 to 44
        
        # Value inside circle, below percentile number (bigger)
        ax.text(cx, cy - 0.06 * scale_factor, f'{val:.1f} {unit}', 
               color='white', fontsize=42 * scale_factor, ha='center', va='center')  # Increased from 28 to 42
    
    # Custom title (Left Leg or Right Leg)
    ax.set_title(title, color='white', fontsize=33 * scale_factor, pad=45 * scale_factor)

# ------------------------------------------------
# Bar comparisons (Histogram-style with frequency)
# ------------------------------------------------
def bar_graph(ax, metric, df_ath, population):
    # Check if metric exists in dataframes
    if metric not in population.columns or metric not in df_ath.columns:
        ax.text(0.5, 0.5, f"Metric '{metric}' not found", 
                transform=ax.transAxes, ha='center', va='center', color='white', fontsize=20)
        ax.set_facecolor('#373e43')
        return
    
    # Get all population values
    pop_values = population[metric].dropna().values
    
    # Get athlete's values
    athlete_values = df_ath[metric].dropna().values
    athlete_mean = athlete_values.mean() if len(athlete_values) > 0 else 0
    
    # For CT (Contact Time), smaller is better, so use minimum instead of maximum
    if metric == "CT":
        athlete_extreme = athlete_values.min() if len(athlete_values) > 0 else 0
        extreme_label = "Min"
    else:
        athlete_extreme = athlete_values.max() if len(athlete_values) > 0 else 0
        extreme_label = "Max"
    
    # Calculate mean percentile
    mean_pct = percentileofscore(pop_values, athlete_mean) if len(pop_values) > 0 else 0
    
    # Create histogram bins - use automatic binning but ensure reasonable number
    if len(pop_values) > 0:
        # Determine appropriate number of bins (not too many, not too few)
        n_bins = min(30, max(10, int(np.sqrt(len(pop_values)))))
        
        # Create histogram
        counts, bin_edges = np.histogram(pop_values, bins=n_bins)
        bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
        
        # Plot histogram bars - blue
        bars = ax.bar(bin_centers, counts, width=(bin_edges[1] - bin_edges[0]) * 0.8, 
                     color='#2c99d4', alpha=0.6, edgecolor='#2c99d4', linewidth=0.5)
        
        # Add vertical lines for athlete mean and extreme (max or min)
        # For CT, use 2 decimal places; for others, use 1 decimal place
        mean_format = f'{athlete_mean:.2f}' if metric == "CT" else f'{athlete_mean:.1f}'
        extreme_format = f'{athlete_extreme:.2f}' if metric == "CT" else f'{athlete_extreme:.1f}'
        ax.axvline(x=athlete_mean, color='pink', linestyle='--', linewidth=7.5, 
                  label=f'Mean: {mean_format}', alpha=0.9)
        ax.axvline(x=athlete_extreme, color='#d62728', linestyle='--', linewidth=7.5, 
                  label=f'{extreme_label}: {extreme_format}', alpha=0.9)
    
    # Set labels and styling - use display label (reset to original size)
    display_label = METRIC_LABELS.get(metric, metric)
    ax.set_title(display_label, color='white', fontsize=60, pad=8, fontweight='bold')  # Reset to 60
    # Removed xlabel 'Value'
    ax.set_ylabel('Frequency', color='white', fontsize=30)  # Increased from 27 to 30
    ax.tick_params(colors='white', labelsize=24)  # Increased from 21 to 24
    ax.spines['bottom'].set_color('white')
    ax.spines['top'].set_color('white')
    ax.spines['left'].set_color('white')
    ax.spines['right'].set_color('white')
    ax.grid(True, color='white', alpha=0.2, axis='y')
    ax.set_facecolor('#373e43')
    
    # Add summary text at the top right corner - bigger text, no box, with new lines
    # For CT, show Min instead of Max and use 2 decimal places
    mean_format = f'{athlete_mean:.2f}' if metric == "CT" else f'{athlete_mean:.1f}'
    extreme_format = f'{athlete_extreme:.2f}' if metric == "CT" else f'{athlete_extreme:.1f}'
    summary_text = f'Percentile: {int(mean_pct)}th\nMean: {mean_format}\n{extreme_label}: {extreme_format}'
    ax.text(0.98, 0.98, summary_text, transform=ax.transAxes,
            ha='right', va='top', color='white', fontsize=42)  # Removed bbox

# ------------------------------------------------
# SLV Bar Graph (shows dark blue line for mean left, red line for mean right)
# ------------------------------------------------
def slv_bar_graph(ax, metric, left_df, right_df, population):
    """Bar graph for SLV showing dark blue line for mean left, red line for mean right"""
    # Check if metric exists
    if metric not in population.columns:
        ax.text(0.5, 0.5, f"Metric '{metric}' not found", 
                transform=ax.transAxes, ha='center', va='center', color='white', fontsize=20)
        ax.set_facecolor('#373e43')
        return
    
    # Get all population values
    pop_values = population[metric].dropna().values
    
    # Get left and right means
    left_mean = left_df[metric].mean() if not left_df.empty and metric in left_df.columns else 0
    right_mean = right_df[metric].mean() if not right_df.empty and metric in right_df.columns else 0
    
    # Create histogram
    if len(pop_values) > 0:
        n_bins = min(30, max(10, int(np.sqrt(len(pop_values)))))
        counts, bin_edges = np.histogram(pop_values, bins=n_bins)
        bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
        
        # Plot histogram bars - blue
        bars = ax.bar(bin_centers, counts, width=(bin_edges[1] - bin_edges[0]) * 0.8, 
                     color='#2c99d4', alpha=0.6, edgecolor='#2c99d4', linewidth=0.5)
        
        # Add vertical lines for left mean (dark blue) and right mean (red)
        if left_mean > 0:
            ax.axvline(x=left_mean, color='#1a5f8a', linestyle='--', linewidth=7.5, 
                      label=f'Left Mean: {left_mean:.1f}', alpha=0.9)
        if right_mean > 0:
            ax.axvline(x=right_mean, color='#d62728', linestyle='--', linewidth=7.5, 
                      label=f'Right Mean: {right_mean:.1f}', alpha=0.9)
    
    # Set labels and styling - use display label (reset to original size)
    display_label = METRIC_LABELS.get(metric, metric)
    ax.set_title(display_label, color='white', fontsize=60, pad=8, fontweight='bold')  # Reset to 60
    # Removed xlabel 'Value'
    ax.set_ylabel('Frequency', color='white', fontsize=30)  # Increased from 27 to 30
    ax.tick_params(colors='white', labelsize=24)  # Increased from 21 to 24
    ax.spines['bottom'].set_color('white')
    ax.spines['top'].set_color('white')
    ax.spines['left'].set_color('white')
    ax.spines['right'].set_color('white')
    ax.grid(True, color='white', alpha=0.2, axis='y')
    ax.set_facecolor('#373e43')
    
    # Add legend if we have lines - bigger text and less opaque
    handles, labels = ax.get_legend_handles_labels()
    if len(handles) > 0:
        ax.legend(handles, labels, loc='upper right', facecolor='black', edgecolor='white', labelcolor='white', fontsize=27, framealpha=0.5)  # Increased fontsize from 21 to 27, changed facecolor to black, added framealpha=0.5 for transparency

# ------------------------------------------------
# Page Builder for One Movement
# ------------------------------------------------
def movement_page(pdf, movement_name, df, pop_df, athlete_name, report_date, logo_path, power_files_dir=None):
    df_ath = df.copy()  # df already filtered for this athlete

    if df_ath.empty:
        return

    # Determine bar metrics based on movement type
    if movement_name == "DJ":
        # DJ page layout - 4 bar graphs: JH_IN, PP_W_per_kg, RSI, CT
        dj_bar_metrics = ["JH_IN", "PP_W_per_kg", "RSI", "CT"]
        fig = plt.figure(figsize=(54, 90), facecolor='black')
        fig.patch.set_facecolor('black')
        
        # Top section: JH_IN and PP_W_per_kg bar graphs
        bar_graphs = []
        graph_width = 0.35
        graph_height = 0.16
        
        # Top section boundaries for bar graphs
        top_section_bottom = 0.73
        top_section_height = 0.19
        
        # Calculate horizontal spacing for top section
        top_horizontal_spacing = (1.0 - 2 * graph_width) / 3  # Equal spacing on all sides
        top_vertical_spacing = (top_section_height - graph_height) / 2  # Center vertically
        
        # Create JH_IN and PP_W_per_kg bar graphs in top section
        for i, metric in enumerate(["JH_IN", "PP_W_per_kg"]):
            left_pos = top_horizontal_spacing + i * (graph_width + top_horizontal_spacing)
            bottom_pos = top_section_bottom + top_vertical_spacing
            # [left, bottom, width, height] in figure coordinates
            ax = fig.add_axes([left_pos, bottom_pos, graph_width, graph_height])
            bar_graphs.append(ax)
            bar_graph(ax, metric, df_ath, pop_df)
        
        # Second section: RSI and CT bar graphs (directly below JH_IN and PP_W_per_kg)
        # Position RSI and CT directly below the top bar graphs
        rsi_ct_section_top = top_section_bottom  # Start right below top section
        rsi_ct_section_bottom = 0.55  # Bottom of RSI/CT section (above radar/power curve) - moved up from 0.52
        rsi_ct_section_height = rsi_ct_section_top - rsi_ct_section_bottom
        
        # Calculate vertical spacing for RSI/CT row
        rsi_ct_vertical_spacing = (rsi_ct_section_height - graph_height) / 2  # Center in available space
        
        # Create RSI and CT bar graphs
        for i, metric in enumerate(["RSI", "CT"]):
            left_pos = top_horizontal_spacing + i * (graph_width + top_horizontal_spacing)  # Same horizontal positions as top graphs
            bottom_pos = rsi_ct_section_bottom + rsi_ct_vertical_spacing
            # [left, bottom, width, height] in figure coordinates
            ax = fig.add_axes([left_pos, bottom_pos, graph_width, graph_height])
            bar_graphs.append(ax)
            bar_graph(ax, metric, df_ath, pop_df)
        
        # Third section: Radar chart and Power curve (moved up)
        # Radar chart - left side
        # [left, bottom, width, height] in figure coordinates
        ax_radar = fig.add_axes([0.11, 0.31, 0.29, 0.22], polar=True)  # Moved up from 0.28 to 0.33
        
        # Power curve - right side
        # [left, bottom, width, height] in figure coordinates
        ax_power = fig.add_axes([0.50, 0.385, 0.43, 0.13])  # Moved up from 0.355 to 0.405
        
        # Performance table - positioned directly under power curve
        table_width = 0.56  # Increased from 0.535 to make table slightly larger
        table_height = 0.12  # Increased from 0.10 to make table slightly larger
        table_left = 0.45  # Aligned with power curve left edge
        table_bottom = 0.27  # Positioned directly under power curve - moved up from 0.24 to 0.29
        # [left, bottom, width, height] in figure coordinates
        ax_table = fig.add_axes([table_left, table_bottom, table_width, table_height])
        
        # Bottom section: FV scatter and Progress circles
        # FV scatter - left side
        # [left, bottom, width, height] in figure coordinates
        ax_fv = fig.add_axes([0.09, 0.04, 0.50, 0.24])
        
        # Progress Circles Section - right side, vertically aligned
        # Title above both circles
        progress_circles_x = 0.78  # Right side position
        fig.text(progress_circles_x, 0.28, "@ Peak Power", ha='center', va='center',
                 fontsize=48, color='white', fontweight='bold', transform=fig.transFigure)

        # Positions for circles - vertically aligned, Force above Velocity
        circle_width = 0.16
        circle_height = 0.16
        
        # Force circle (top)
        force_y = 0.13
        force_x = progress_circles_x - circle_width/2
        
        # Velocity circle (bottom)
        velocity_y = 0.005
        velocity_x = progress_circles_x - circle_width/2

        # Labels above each circle
        fig.text(0.78, 0.26, "Force", ha='center', va='bottom',
                 fontsize=41, color='white', fontweight='bold', transform=fig.transFigure)

        fig.text(0.78, 0.14, "Velocity", ha='center', va='bottom',
                 fontsize=41, color='white', fontweight='bold', transform=fig.transFigure)

        # Force circle axis (top)
        # [left, bottom, width, height] in figure coordinates
        ax_force = fig.add_axes([force_x, force_y, circle_width, circle_height])
        ax_force.set_aspect('equal')

        # Velocity circle axis (bottom)
        # [left, bottom, width, height] in figure coordinates
        ax_vel = fig.add_axes([velocity_x, velocity_y, circle_width, circle_height])
        ax_vel.set_aspect('equal')
    else:
        # CMJ and PPU page layout - 2 bar graphs
        dj_bar_metrics = None
        fig = plt.figure(figsize=(54, 65), facecolor='black')
        fig.patch.set_facecolor('black')
        
        # Top section: Bar graphs (JH_IN and PP_W_per_kg)
        graph_width = 0.38
        graph_height = 0.22
        bar_graph_bottom = 0.647  # Direct vertical position - adjust this value to move graphs up/down
        
        # Calculate equal horizontal spacing for 2 graphs
        horizontal_spacing = (1.0 - 2 * graph_width) / 3  # Equal spacing on all sides
        
        bar_graphs = []
        for i, metric in enumerate(BAR_METRICS):
            left_pos = horizontal_spacing + i * (graph_width + horizontal_spacing)
            # [left, bottom, width, height] in figure coordinates
            ax = fig.add_axes([left_pos, bar_graph_bottom, graph_width, graph_height])
            bar_graphs.append(ax)
            bar_graph(ax, metric, df_ath, pop_df)
        
        # Middle section: Radar chart and Power curve
        # Radar chart - left side
        # [left, bottom, width, height] in figure coordinates
        ax_radar = fig.add_axes([0.11, 0.38, 0.29, 0.22], polar=True)
        
        # Power curve - right side
        # [left, bottom, width, height] in figure coordinates
        ax_power = fig.add_axes([0.50, 0.45, 0.43, 0.16])
        
        # Performance table - positioned directly under power curve
        table_width = 0.56  # Increased from 0.53 to make table slightly larger
        table_height = 0.17  # Increased from 0.15 to make table slightly larger
        table_left = 0.435 # Moved left from 0.45 (lower value = more to the left)
        table_bottom = 0.30  # Moved down from 0.32 (lower value = lower on page)
        # [left, bottom, width, height] in figure coordinates
        ax_table = fig.add_axes([table_left, table_bottom, table_width, table_height])
        
        # Bottom section: FV scatter and Progress circles
        # FV scatter - left side
        # [left, bottom, width, height] in figure coordinates
        ax_fv = fig.add_axes([0.09, 0.03, 0.50, 0.283])
        
        # Progress Circles Section - right side, vertically aligned
        # Title above both circles
        progress_circles_x = 0.78  # Right side position
        fig.text(progress_circles_x, 0.33, "@ Peak Power", ha='center', va='center',
                 fontsize=48, color='white', fontweight='bold', transform=fig.transFigure)

        # Positions for circles - vertically aligned, Force above Velocity
        circle_width = 0.16
        circle_height = 0.16
        
        # Force circle (top)
        force_y = 0.16
        force_x = progress_circles_x - circle_width/2
        
        # Velocity circle (bottom)
        velocity_y = 0.005
        velocity_x = progress_circles_x - circle_width/2

        # Labels above each circle
        fig.text(0.78, 0.313, "Force", ha='center', va='bottom',
                 fontsize=41, color='white', fontweight='bold', transform=fig.transFigure)

        fig.text(0.78, 0.153, "Velocity", ha='center', va='bottom',
                 fontsize=41, color='white', fontweight='bold', transform=fig.transFigure)

        # Force circle axis (top)
        # [left, bottom, width, height] in figure coordinates
        ax_force = fig.add_axes([force_x, force_y, circle_width, circle_height])
        ax_force.set_aspect('equal')

        # Velocity circle axis (bottom)
        # [left, bottom, width, height] in figure coordinates
        ax_vel = fig.add_axes([velocity_x, velocity_y, circle_width, circle_height])
        ax_vel.set_aspect('equal')

    # pick best trial
    best = df_ath.loc[df_ath["PP_FORCEPLATE"].idxmax()]

    # Create charts
    radar_chart(ax_radar, best, f"{movement_name} Radar", pop_df)
    performance_table(ax_table, best, movement_name)
    
    power_curve(ax_power, df_ath, pop_df, power_files_dir=power_files_dir)
    fv_scatter(ax_fv, df_ath, pop_df)
    
    # Progress circles - same approach for all movements (separate Force and Velocity)
    if movement_name == "DJ":
        joint_radial(ax_force, best, pop_df, metric="force")
        joint_radial(ax_vel, best, pop_df, metric="velocity")
    else:
        # CMJ and PPU also use separate Force and Velocity circles
        joint_radial(ax_force, best, pop_df, metric="force")
        joint_radial(ax_vel, best, pop_df, metric="velocity")

    # Map movement names to full titles (custom line breaks)
    title_map = {
        "DJ": "Drop\nJump",
        "CMJ": "Counter\nMovement Jump",
        "PPU": "Plyo\nPushup"
    }
    full_title = title_map.get(movement_name, movement_name)
    # Using Helvetica-BoldOblique font (same as pro sup test report)
    # Lower CMJ and PPU titles by 0.02 (y=0.96 instead of default ~0.98)
    title_y = 0.978 if movement_name in ["CMJ", "PPU"] else None
    plt.suptitle(full_title, fontsize=150, color='white', fontweight='bold', 
                 fontfamily='sans-serif', style='italic', y=title_y)  # Increased from 70 to 120
    
    # Add header with vertical bar, name, date, logo, and horizontal line - separate headers for different page types
    if movement_name == "DJ":
        add_header_dj(fig, athlete_name, report_date, logo_path)
    else:
        add_header_cmj_ppu(fig, athlete_name, report_date, logo_path)
    
    # Add blue line between sections
    # COMMENTED OUT - second horizontal blue line between bar graphs and radar/power curve
    # if movement_name == "DJ":
    #     # Line between bar graphs (RSI/CT) section and radar/power curve section
    #     # Positioned between RSI/CT graphs (ending ~0.55) and radar chart (starting ~0.31)
    #     # Line positioned at same distance from edge as header line (0.05 to 0.98)
    #     line2 = Line2D([0.05, 0.98], [0.28, 0.28], transform=fig.transFigure, color='#2c99d4', linewidth=9, zorder=1000)
    #     fig.add_artist(line2)
    # else:
    #     # CMJ/PPU - line between bar graphs section and radar/power curve section
    #     # Positioned between bar graphs (ending ~0.427) and radar chart (starting ~0.38)
    #     # Line positioned at same distance from edge as header line (0.05 to 0.98)
    #     line2 = Line2D([0.05, 0.98], [0.40, 0.40], transform=fig.transFigure, color='#2c99d4', linewidth=9, zorder=1000)
    #     fig.add_artist(line2)
    
    # Set all axes backgrounds to #373e43
    for ax in fig.get_axes():
        if hasattr(ax, 'set_facecolor'):
            ax.set_facecolor('#373e43')
    pdf.savefig(fig, facecolor='black', edgecolor='none')
    plt.close(fig)

# ------------------------------------------------
# SLV special page
# ------------------------------------------------
def slv_page(pdf, df, pop_df, athlete_name, report_date, logo_path, power_files_dir=None):
    df_ath = df.copy()  # df already filtered for this athlete
    left = df_ath[df_ath["side"] == "Left"]
    right = df_ath[df_ath["side"] == "Right"]

    if df_ath.empty:
        return

    fig = plt.figure(figsize=(54, 65), facecolor='black')
    fig.patch.set_facecolor('black')
    
    # Get best left and right trials separately for progress circles
    best_left = left.iloc[left["PP_FORCEPLATE"].argmax()] if not left.empty and len(left) > 0 else None
    best_right = right.iloc[right["PP_FORCEPLATE"].argmax()] if not right.empty and len(right) > 0 else None
    left_best_row = left.iloc[left["PP_FORCEPLATE"].argmax()] if not left.empty else None
    right_best_row = right.iloc[right["PP_FORCEPLATE"].argmax()] if not right.empty else None
    
    # Top section: Bar graphs
    graph_width = 0.38
    graph_height = 0.22
    bar_graph_bottom = 0.65  # Direct vertical position - adjust this value to move graphs up/down
    
    # Calculate equal horizontal spacing for 2 graphs
    horizontal_spacing = (1.0 - 2 * graph_width) / 3  # Equal spacing on all sides
    
    for i, metric in enumerate(BAR_METRICS):
        left_pos = horizontal_spacing + i * (graph_width + horizontal_spacing)
        # [left, bottom, width, height] in figure coordinates
        ax = fig.add_axes([left_pos, bar_graph_bottom, graph_width, graph_height])
        slv_bar_graph(ax, metric, left, right, pop_df)
    
    # Middle section: Radar chart and Power curve
    # Radar chart - left side
    # [left, bottom, width, height] in figure coordinates
    ax_radar = fig.add_axes([0.11, 0.38, 0.29, 0.22], polar=True)
    
    # Power curve - right side
    # [left, bottom, width, height] in figure coordinates
    ax_power = fig.add_axes([0.50, 0.495, 0.43, 0.13])
    
    # Performance table - positioned directly under power curve
    table_width = 0.57  # Increased from 0.542 to make table slightly larger
    table_height = 0.12  # Increased from 0.10 to make table slightly larger
    table_left = 0.43  # Moved left from 0.45 (lower value = more to the left)
    table_bottom = 0.35  # Moved down from 0.37 (lower value = lower on page)
    # [left, bottom, width, height] in figure coordinates
    ax_table = fig.add_axes([table_left, table_bottom, table_width, table_height])
    
    # Bottom section: FV scatter and Progress circles
    # FV scatter - left side
    # [left, bottom, width, height] in figure coordinates
    ax_fv = fig.add_axes([0.09, 0.04, 0.49, 0.272])
    
    # Progress circles for both left and right legs - right side, vertically aligned
    progress_circles_x = 0.78  # Right side position
    circle_width = 0.16
    circle_height = 0.16
    
    # Left leg circles - vertically stacked
    left_force_y = 0.16
    left_velocity_y = 0.005
    left_circle_x = progress_circles_x - 0.10 - circle_width/2  # Offset left from center
    
    # Right leg circles - vertically stacked
    right_force_y = 0.16
    right_velocity_y = 0.005
    right_circle_x = progress_circles_x + 0.10 - circle_width/2  # Offset right from center
    
    # Create charts - order matches page layout
    slv_radar_chart(ax_radar, left_best_row, right_best_row, pop_df)
    slv_performance_table(ax_table, left, right, "SLV")
    slv_power_curve(ax_power, left, right, pop_df, power_files_dir=power_files_dir)
    slv_fv_scatter(ax_fv, left, right, pop_df)
    
    if best_left is not None:
        # Left leg Force circle (top)
        # [left, bottom, width, height] in figure coordinates
        ax_joint_left_force = fig.add_axes([left_circle_x, left_force_y, circle_width, circle_height])
        ax_joint_left_force.set_aspect('equal')
        joint_radial(ax_joint_left_force, best_left, pop_df, metric="force")
        
        # Left leg Velocity circle (bottom)
        # [left, bottom, width, height] in figure coordinates
        ax_joint_left_vel = fig.add_axes([left_circle_x, left_velocity_y, circle_width, circle_height])
        ax_joint_left_vel.set_aspect('equal')
        joint_radial(ax_joint_left_vel, best_left, pop_df, metric="velocity")
        
        # Labels for left leg
        fig.text(progress_circles_x - 0.10, 0.315, "Force", ha='center', va='bottom',
                 fontsize=40, color='white', fontweight='bold', transform=fig.transFigure)
        fig.text(progress_circles_x - 0.10, 0.152, "Velocity", ha='center', va='bottom',
                 fontsize=40, color='white', fontweight='bold', transform=fig.transFigure)
        fig.text(progress_circles_x - 0.10, 0.335, "Left Leg", ha='center', va='center',
                 fontsize=48, color='white', fontweight='bold', transform=fig.transFigure)
    
    if best_right is not None:
        # Right leg Force circle (top)
        # [left, bottom, width, height] in figure coordinates
        ax_joint_right_force = fig.add_axes([right_circle_x, right_force_y, circle_width, circle_height])
        ax_joint_right_force.set_aspect('equal')
        joint_radial(ax_joint_right_force, best_right, pop_df, metric="force")
        
        # Right leg Velocity circle (bottom)
        # [left, bottom, width, height] in figure coordinates
        ax_joint_right_vel = fig.add_axes([right_circle_x, right_velocity_y, circle_width, circle_height])
        ax_joint_right_vel.set_aspect('equal')
        joint_radial(ax_joint_right_vel, best_right, pop_df, metric="velocity")
        
        # Labels for right leg
        fig.text(progress_circles_x + 0.10, 0.315, "Force", ha='center', va='bottom',
                 fontsize=40, color='white', fontweight='bold', transform=fig.transFigure)
        fig.text(progress_circles_x + 0.10, 0.152, "Velocity", ha='center', va='bottom',
                 fontsize=40, color='white', fontweight='bold', transform=fig.transFigure)
        fig.text(progress_circles_x + 0.10, 0.335, "Right Leg", ha='center', va='center',
                 fontsize=48, color='white', fontweight='bold', transform=fig.transFigure)

    # Using Helvetica-BoldOblique font (same as pro sup test report)
    plt.suptitle("Single Leg\nVertical", fontsize=150, color='white', fontweight='bold', 
                 fontfamily='sans-serif', style='italic', y=0.978)  # Increased from 70 to 120, lowered to y=0.975

    # Add header with vertical bar, name, date, logo, and horizontal line
    add_header_slv(fig, athlete_name, report_date, logo_path)
    
    # Add blue line between bar graphs section and bottom section
    # COMMENTED OUT - second horizontal blue line removed
    # line2 = Line2D([0.05, 0.98], [0.35, 0.35], transform=fig.transFigure, color='#2c99d4', linewidth=9, zorder=1000)
    # fig.add_artist(line2)
    
    # Set all axes backgrounds to #373e43
    for ax in fig.get_axes():
        if hasattr(ax, 'set_facecolor'):
            ax.set_facecolor('#373e43')
    pdf.savefig(fig, facecolor='black', edgecolor='none')
    plt.close(fig)

# ------------------------------------------------
# Main PDF Generation Function
# ------------------------------------------------
def generate_pdf_report(athlete_uuid, athlete_name, session_date, output_dir, logo_path=None, power_files_dir=None):
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
    
    # Do not delete the old PDF here. Build the new report first; we only replace
    # the destination file after successful generation (see temp write + move below).
    
    # Connect to database
    engine = get_warehouse_engine()
    
    try:
        # Pull athlete data and population data for each movement
        all_data = {}
        all_pop_data = {}
        
        for movement_type in ["DJ", "CMJ", "PPU", "SLV"]:
            # Get athlete data
            athlete_df = query_athlete_data(engine, athlete_uuid, session_date, movement_type)
            if not athlete_df.empty:
                athlete_df['name'] = athlete_name  # Set name for filtering
                all_data[movement_type] = athlete_df
            
            # Get population data
            pop_df = query_population_data(engine, movement_type)
            if not pop_df.empty:
                all_pop_data[movement_type] = pop_df
        
        # Generate report date string - convert from YYYY-MM-DD to MM/DD/YYYY for readability
        try:
            # Parse the date and reformat it
            date_obj = datetime.strptime(session_date, '%Y-%m-%d')
            report_date = date_obj.strftime('%m/%d/%Y')
        except (ValueError, TypeError):
            # If parsing fails, use the original date
            report_date = session_date
        
        # Create PDF - write to temp location first if Google Drive path
        # (Google Drive sync can interfere with direct writes)
        import tempfile
        import shutil
        use_temp = 'My Drive' in output_dir or 'Google Drive' in output_dir
        if use_temp:
            temp_dir = tempfile.gettempdir()
            temp_pdf = os.path.join(temp_dir, os.path.basename(output_pdf))
        else:
            temp_pdf = output_pdf
        
        with PdfPages(temp_pdf) as pdf:
            # DJ, CMJ, PPU are identical page structures
            for key in ["DJ", "CMJ", "PPU"]:
                if key in all_data and key in all_pop_data:
                    movement_page(pdf, key, all_data[key], all_pop_data[key], 
                                 athlete_name, report_date, logo_path, power_files_dir)
                else:
                    print(f"Skipping {key} - no data available")
            
            # SLV special
            if "SLV" in all_data and "SLV" in all_pop_data:
                slv_page(pdf, all_data["SLV"], all_pop_data["SLV"], 
                        athlete_name, report_date, logo_path, power_files_dir)
            else:
                print("Skipping SLV - no data available")
        
        # Move from temp location to final location if needed
        if use_temp:
            if os.path.exists(temp_pdf):
                if os.path.exists(output_pdf):
                    os.remove(output_pdf)  # Remove old file if exists
                shutil.move(temp_pdf, output_pdf)
            else:
                # No pages were added (e.g. no data for this athlete/session), so temp file was never created
                print("No report content generated - skipping PDF save.")
                return None
        
        return output_pdf
        
    except Exception as e:
        print(f"ERROR creating PDF: {e}")
        import traceback
        traceback.print_exc()
        return None

