"""
Athlete identity utilities for UAIS.
Functions to attach athlete_uuid using source_athlete_map.
"""
import pandas as pd
from sqlalchemy import Engine
from typing import Optional, Dict
from common.config import get_app_engine
from common.db_utils import read_table_as_df
from common.athlete_creation import handle_unmapped_athletes_interactive


def load_source_map(engine: Optional[Engine] = None, read_only: bool = True) -> pd.DataFrame:
    """
    Load the source_athlete_map table from the app database.
    
    Args:
        engine: Optional engine (defaults to app engine).
        read_only: If True, opens database in read-only mode (safer when Beekeeper is open).
    
    Returns:
        DataFrame with columns: source_system, source_athlete_id, athlete_uuid
    """
    if engine is None:
        engine = get_app_engine(read_only=read_only)
    
    try:
        return read_table_as_df(engine, 'source_athlete_map')
    except Exception as e:
        print(f"Warning: Could not load source_athlete_map: {e}")
        return pd.DataFrame(columns=['source_system', 'source_athlete_id', 'athlete_uuid'])


def attach_athlete_uuid(df: pd.DataFrame, source_system: str, 
                         source_id_column: str = 'source_athlete_id',
                         engine: Optional[Engine] = None,
                         interactive: bool = False) -> pd.DataFrame:
    """
    Attach athlete_uuid to a DataFrame using source_athlete_map.
    
    If a source_athlete_id is not found in the map:
    - If interactive=True: Prompts user to create new athlete
    - If interactive=False: Row is kept but athlete_uuid will be None (flagged for manual mapping)
    
    Args:
        df: Input DataFrame with source_athlete_id column.
        source_system: Name of the source system (e.g., 'athletic_screen', 'mobility').
        source_id_column: Name of the column containing source athlete IDs.
        engine: Optional engine (defaults to app engine).
        interactive: If True, interactively create new athletes when unmapped IDs are found.
    
    Returns:
        DataFrame with athlete_uuid column added.
    """
    if df.empty:
        return df
    
    if source_id_column not in df.columns:
        print(f"Warning: Column '{source_id_column}' not found in DataFrame. "
              f"Available columns: {list(df.columns)}")
        df['athlete_uuid'] = None
        return df
    
    # Load source map
    source_map = load_source_map(engine)
    
    if source_map.empty:
        print("Warning: source_athlete_map is empty. All athlete_uuid will be None.")
        df['athlete_uuid'] = None
        return df
    
    # Filter map for this source system
    system_map = source_map[
        source_map['source_system'] == source_system
    ][[source_id_column, 'athlete_uuid']].drop_duplicates()
    
    if system_map.empty:
        print(f"Warning: No mappings found for source_system='{source_system}'. "
              "All athlete_uuid will be None.")
        df['athlete_uuid'] = None
        return df
    
    # Merge
    df = df.merge(
        system_map,
        on=source_id_column,
        how='left'
    )
    
    # Handle unmapped IDs
    unmapped = df[df['athlete_uuid'].isna() & df[source_id_column].notna()]
    if not unmapped.empty:
        unique_unmapped = unmapped[source_id_column].unique()
        
        if interactive:
            # Interactively create new athletes
            print(f"\nFound {len(unique_unmapped)} unmapped athletes for {source_system}.")
            df = handle_unmapped_athletes_interactive(
                df, source_system, source_id_column, engine, interactive=True
            )
        else:
            # Just report them
            print(f"Warning: {len(unique_unmapped)} unmapped source IDs for {source_system}: "
                  f"{list(unique_unmapped[:10])}{'...' if len(unique_unmapped) > 10 else ''}")
    
    return df


def flag_unmapped_athletes(df: pd.DataFrame, source_system: str,
                           output_path: Optional[str] = None) -> pd.DataFrame:
    """
    Extract rows with unmapped athlete_uuid for manual review.
    
    Args:
        df: DataFrame that has been through attach_athlete_uuid.
        source_system: Source system name.
        output_path: Optional path to save CSV of unmapped athletes.
    
    Returns:
        DataFrame containing only unmapped rows.
    """
    unmapped = df[df['athlete_uuid'].isna()].copy()
    
    if output_path and not unmapped.empty:
        unmapped.to_csv(output_path, index=False)
        print(f"Saved {len(unmapped)} unmapped athletes to {output_path}")
    
    return unmapped


if __name__ == "__main__":
    # Test with sample data
    test_df = pd.DataFrame({
        'source_athlete_id': ['ATH001', 'ATH002', 'ATH999'],
        'session_date': ['2024-01-01', '2024-01-02', '2024-01-03'],
        'metric1': [10, 20, 30]
    })
    
    print("Original DataFrame:")
    print(test_df)
    
    # This will work if source_athlete_map exists
    try:
        result = attach_athlete_uuid(test_df, 'athletic_screen', 'source_athlete_id')
        print("\nAfter attaching athlete_uuid:")
        print(result)
    except Exception as e:
        print(f"Error (expected if source_athlete_map doesn't exist): {e}")

