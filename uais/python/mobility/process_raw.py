"""
Raw data processing for Mobility domain.
Reads raw mobility files, cleans, and normalizes data.
"""
import pandas as pd
from pathlib import Path
from typing import Optional
from common.config import get_raw_paths
from common.io_utils import load_csv, load_xml, find_files


def load_raw_mobility(raw_dir: Optional[str] = None) -> pd.DataFrame:
    """
    Load raw mobility data files from the configured directory.
    
    Args:
        raw_dir: Optional override for raw data directory path.
    
    Returns:
        DataFrame with raw mobility data.
    """
    if raw_dir is None:
        paths = get_raw_paths()
        raw_dir = paths.get('mobility')
    
    if not raw_dir:
        raise ValueError("Mobility raw data path not configured")
    
    raw_path = Path(raw_dir)
    
    if not raw_path.exists():
        raise FileNotFoundError(f"Mobility raw data directory not found: {raw_path}")
    
    # Find CSV files (adjust pattern as needed)
    csv_files = find_files(raw_path, "*.csv", recursive=True)
    
    if not csv_files:
        # Try XML files if CSV not found
        xml_files = find_files(raw_path, "*.xml", recursive=True)
        if xml_files:
            # TODO: Implement XML parsing for mobility data
            # For now, return empty DataFrame
            return pd.DataFrame()
        else:
            raise FileNotFoundError(f"No mobility data files found in {raw_path}")
    
    # Load and combine CSV files
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
    
    combined = pd.concat(dfs, ignore_index=True)
    return combined


def clean_mobility(df: pd.DataFrame) -> pd.DataFrame:
    """
    Clean and normalize mobility data.
    
    Args:
        df: Raw mobility DataFrame.
    
    Returns:
        Cleaned DataFrame with standardized columns.
    """
    if df.empty:
        return df
    
    clean_df = df.copy()
    
    # Normalize column names (lowercase, replace spaces with underscores)
    clean_df.columns = clean_df.columns.str.lower().str.replace(' ', '_')
    
    # Extract athlete identifier (adjust column name as needed)
    # Common patterns: 'name', 'athlete_name', 'athlete_id', 'subject_id'
    athlete_cols = ['name', 'athlete_name', 'athlete_id', 'subject_id', 'subject']
    source_athlete_id = None
    for col in athlete_cols:
        if col in clean_df.columns:
            source_athlete_id = col
            break
    
    if source_athlete_id:
        clean_df['source_athlete_id'] = clean_df[source_athlete_id].astype(str)
    else:
        clean_df['source_athlete_id'] = None
        print("Warning: Could not identify athlete ID column")
    
    # Extract session date
    date_cols = ['date', 'test_date', 'session_date', 'assessment_date']
    session_date = None
    for col in date_cols:
        if col in clean_df.columns:
            session_date = col
            break
    
    if session_date:
        clean_df['session_date'] = pd.to_datetime(clean_df[session_date]).dt.date
    else:
        clean_df['session_date'] = None
        print("Warning: Could not identify session date column")
    
    # TODO: Add domain-specific cleaning:
    # - Normalize angle measurements (degrees/radians)
    # - Convert units (inches/cm, lbs/kg)
    # - Handle missing values
    # - Extract mobility-specific metrics (ROM, flexibility scores, etc.)
    
    return clean_df


if __name__ == "__main__":
    # Test loading
    try:
        raw_df = load_raw_mobility()
        print(f"Loaded {len(raw_df)} raw rows")
        print(f"Columns: {list(raw_df.columns)}")
        
        clean_df = clean_mobility(raw_df)
        print(f"\nCleaned {len(clean_df)} rows")
        print(f"Required columns present: 'source_athlete_id' in columns = {'source_athlete_id' in clean_df.columns}")
    except Exception as e:
        print(f"Error: {e}")

