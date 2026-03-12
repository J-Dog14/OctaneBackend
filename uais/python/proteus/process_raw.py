"""
Raw data processing for Proteus domain.
"""
import pandas as pd
import logging
from pathlib import Path
from typing import Optional
from common.config import get_raw_paths
from common.io_utils import load_csv, find_files

logger = logging.getLogger(__name__)


def load_raw_proteus(raw_dir: Optional[str] = None) -> pd.DataFrame:
    """Load raw Proteus data files."""
    if raw_dir is None:
        paths = get_raw_paths()
        raw_dir = paths.get('proteus')
    
    if not raw_dir:
        raise ValueError("Proteus raw data path not configured")
    
    raw_path = Path(raw_dir)
    if not raw_path.exists():
        raise FileNotFoundError(f"Proteus raw data directory not found: {raw_path}")
    
    csv_files = find_files(raw_path, "*.csv", recursive=True)
    
    if not csv_files:
        return pd.DataFrame()
    
    dfs = []
    for csv_file in csv_files:
        try:
            df = load_csv(csv_file)
            df['source_file'] = str(csv_file)
            dfs.append(df)
        except Exception as e:
            print(f"Warning: Could not load {csv_file}: {e}")
    
    if not dfs:
        return pd.DataFrame()
    
    return pd.concat(dfs, ignore_index=True)


def clean_proteus(df: pd.DataFrame, file_path: Optional[Path] = None) -> pd.DataFrame:
    """
    Clean and normalize Proteus data from Excel export.
    
    Args:
        df: Raw DataFrame from Excel file
        file_path: Optional path to file for logging
        
    Returns:
        Cleaned DataFrame with columns reordered and filtered
    """
    if df.empty:
        return df
    
    clean_df = df.copy()
    
    # Filter for baseball and softball only (case-insensitive)
    # Handle both 'Sport' and 'sport' column names
    sport_col = None
    for col in clean_df.columns:
        if col.lower() == 'sport':
            sport_col = col
            break
    
    if sport_col:
        before_count = len(clean_df)
        clean_df = clean_df[
            clean_df[sport_col].astype(str).str.lower().isin(['baseball', 'softball'])
        ]
        after_count = len(clean_df)
        if file_path:
            logger.info(f"Filtered Sport: {before_count} rows -> {after_count} rows (baseball/softball only)")
        if clean_df.empty:
            return clean_df
    
    # Remove columns to omit (handle case-insensitive matching)
    # Columns to exclude: session name, exercise createdAt, proteusAttachment, user_id, sport
    # Normalize column names for matching (remove spaces, underscores, convert to lowercase)
    def normalize_col_name(col_name):
        return col_name.lower().replace(' ', '').replace('_', '').replace('-', '')
    
    columns_to_omit_normalized = [
        normalize_col_name('session name'),
        normalize_col_name('exercise createdAt'),
        normalize_col_name('proteusAttachment'),
        normalize_col_name('user id'),
        normalize_col_name('sport')
    ]
    
    # Find and remove matching columns (case-insensitive)
    cols_to_drop = []
    for col in clean_df.columns:
        col_normalized = normalize_col_name(col)
        if col_normalized in columns_to_omit_normalized:
            cols_to_drop.append(col)
    
    if cols_to_drop:
        clean_df = clean_df.drop(columns=cols_to_drop)
        if file_path:
            logger.info(f"Dropped columns: {cols_to_drop}")
    
    # Normalize column names (lowercase, replace spaces with underscores)
    # But keep original names for mapping
    column_mapping = {col: col.lower().replace(' ', '_') for col in clean_df.columns}
    clean_df = clean_df.rename(columns=column_mapping)
    
    # Extract athlete identifier (use User Name as source_athlete_id)
    if 'user_name' in clean_df.columns:
        clean_df['source_athlete_id'] = clean_df['user_name'].astype(str)
    elif 'name' in clean_df.columns:
        clean_df['source_athlete_id'] = clean_df['name'].astype(str)
    else:
        clean_df['source_athlete_id'] = None
    
    # Extract session date from session createdAt (case-insensitive search)
    session_date_col = None
    for col in clean_df.columns:
        if 'session' in col.lower() and 'created' in col.lower() and 'at' in col.lower():
            session_date_col = col
            break
    
    if session_date_col:
        try:
            clean_df['session_date'] = pd.to_datetime(clean_df[session_date_col], errors='coerce').dt.date
            if clean_df['session_date'].notna().any():
                logger.info(f"Using '{session_date_col}' for session_date")
            else:
                # Fallback to current date if parsing failed
                clean_df['session_date'] = pd.Timestamp.now().date()
        except Exception as e:
            logger.warning(f"Could not parse session date from {session_date_col}: {e}")
            clean_df['session_date'] = pd.Timestamp.now().date()
    else:
        # If no date column found, use current date
        clean_df['session_date'] = pd.Timestamp.now().date()
    
    # Convert birth_date to datetime if it exists
    if 'birth_date' in clean_df.columns:
        try:
            clean_df['birth_date'] = pd.to_datetime(clean_df['birth_date'], errors='coerce')
        except:
            pass
    
    # Reorder columns: user_name, birth_date, weight, height, sex, position, movement first
    priority_cols = ['user_name', 'birth_date', 'weight', 'height', 'sex', 'position', 'movement']
    other_cols = [col for col in clean_df.columns if col not in priority_cols and col not in ['source_athlete_id', 'session_date']]
    
    # Build final column order
    final_cols = []
    for col in priority_cols:
        if col in clean_df.columns:
            final_cols.append(col)
    
    # Add other columns (excluding ones we already added)
    for col in other_cols:
        if col not in final_cols:
            final_cols.append(col)
    
    # Add metadata columns at the end
    if 'source_athlete_id' in clean_df.columns:
        final_cols.append('source_athlete_id')
    if 'session_date' in clean_df.columns:
        final_cols.append('session_date')
    
    # Reorder dataframe
    clean_df = clean_df[final_cols]
    
    return clean_df


if __name__ == "__main__":
    try:
        raw_df = load_raw_proteus()
        print(f"Loaded {len(raw_df)} raw rows")
        clean_df = clean_proteus(raw_df)
        print(f"Cleaned {len(clean_df)} rows")
    except Exception as e:
        print(f"Error: {e}")

