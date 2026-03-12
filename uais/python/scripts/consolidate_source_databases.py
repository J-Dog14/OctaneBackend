"""
Consolidate data from scattered source databases into the warehouse.
Reads from multiple source databases, attaches athlete_uuid, and writes to warehouse.
"""
import sqlite3
import pandas as pd
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional
from sqlalchemy import inspect

from common.config import get_warehouse_engine, get_app_engine, _load_config
from common.db_utils import write_df, table_exists, read_table_as_df
from common.id_utils import attach_athlete_uuid

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_source_databases() -> Dict[str, str]:
    """
    Get dictionary of source database paths from config.
    
    Returns:
        Dict mapping domain names to database file paths.
    """
    config = _load_config()
    return config.get('source_databases', {})


def scan_source_database(db_path: str, source_system: str) -> Dict[str, pd.DataFrame]:
    """
    Scan a source database and extract all tables as DataFrames.
    
    Args:
        db_path: Path to source SQLite database.
        source_system: Name of the source system (for tagging).
    
    Returns:
        Dict mapping table names to DataFrames.
    """
    if not Path(db_path).exists():
        logger.warning(f"Source database not found: {db_path}")
        return {}
    
    logger.info(f"Scanning {source_system} database: {db_path}")
    
    try:
        conn = sqlite3.connect(db_path, timeout=10.0)
        cursor = conn.cursor()
        
        # Get all table names
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        table_names = [row[0] for row in cursor.fetchall()]
        
        logger.info(f"Found {len(table_names)} tables: {table_names}")
        
        # Read each table
        tables = {}
        for table_name in table_names:
            try:
                df = pd.read_sql_query(f"SELECT * FROM {table_name}", conn)
                df['_source_system'] = source_system
                df['_source_table'] = table_name
                tables[table_name] = df
                logger.info(f"  - {table_name}: {len(df)} rows")
            except Exception as e:
                logger.warning(f"  - Could not read {table_name}: {e}")
        
        conn.close()
        return tables
        
    except Exception as e:
        logger.error(f"Error scanning database {db_path}: {e}")
        return {}


def normalize_athlete_id(df: pd.DataFrame, source_system: str) -> pd.DataFrame:
    """
    Normalize athlete identifier column across different source formats.
    
    Args:
        df: DataFrame to normalize.
        source_system: Source system name.
    
    Returns:
        DataFrame with 'source_athlete_id' column added.
    """
    df = df.copy()
    
    # Common athlete ID column names across different systems
    athlete_id_cols = ['name', 'athlete_name', 'athlete_id', 'subject_id', 'subject', 'Name', 'Athlete_Name']
    
    source_athlete_id = None
    for col in athlete_id_cols:
        if col in df.columns:
            source_athlete_id = col
            break
    
    if source_athlete_id:
        df['source_athlete_id'] = df[source_athlete_id].astype(str)
    else:
        logger.warning(f"No athlete ID column found in {source_system} table. Available columns: {list(df.columns)}")
        df['source_athlete_id'] = None
    
    return df


def normalize_session_date(df: pd.DataFrame) -> pd.DataFrame:
    """
    Normalize session date column.
    
    Args:
        df: DataFrame to normalize.
    
    Returns:
        DataFrame with 'session_date' column added.
    """
    df = df.copy()
    
    date_cols = ['date', 'test_date', 'session_date', 'Date', 'Test_Date', 'assessment_date']
    
    session_date = None
    for col in date_cols:
        if col in df.columns:
            session_date = col
            break
    
    if session_date:
        df['session_date'] = pd.to_datetime(df[session_date], errors='coerce').dt.date
    else:
        df['session_date'] = None
    
    return df


def consolidate_table(df: pd.DataFrame, source_system: str, table_name: str,
                      target_table: Optional[str] = None) -> pd.DataFrame:
    """
    Consolidate a table: normalize columns, attach UUID, prepare for warehouse.
    
    Args:
        df: Source DataFrame.
        source_system: Source system name.
        table_name: Original table name.
        target_table: Target warehouse table name (defaults to f_{source_system}).
    
    Returns:
        Consolidated DataFrame ready for warehouse.
    """
    if df.empty:
        return df
    
    # Normalize athlete ID and date
    df = normalize_athlete_id(df, source_system)
    df = normalize_session_date(df)
    
    # Attach athlete_uuid
    df = attach_athlete_uuid(
        df,
        source_system=source_system,
        source_id_column='source_athlete_id'
    )
    
    # Add required metadata columns
    df['source_system'] = source_system
    df['created_at'] = datetime.now()
    
    # Keep original table name for reference
    df['_source_table'] = table_name
    
    return df


def consolidate_all_databases(dry_run: bool = False):
    """
    Consolidate all source databases into the warehouse.
    
    Args:
        dry_run: If True, only scan and report, don't write to warehouse.
    """
    logger.info("=" * 60)
    logger.info("Starting Database Consolidation")
    logger.info("=" * 60)
    
    source_dbs = get_source_databases()
    
    if not source_dbs:
        logger.warning("No source databases configured in db_connections.yaml")
        return
    
    warehouse_engine = get_warehouse_engine()
    
    total_rows = 0
    
    for source_system, db_path in source_dbs.items():
        logger.info(f"\n{'=' * 60}")
        logger.info(f"Processing {source_system}")
        logger.info(f"{'=' * 60}")
        
        # Scan source database
        tables = scan_source_database(db_path, source_system)
        
        if not tables:
            logger.warning(f"No tables found in {source_system}")
            continue
        
        # Process each table
        for table_name, df in tables.items():
            logger.info(f"\nProcessing table: {table_name}")
            
            # Consolidate
            consolidated = consolidate_table(df, source_system, table_name)
            
            if consolidated.empty:
                logger.warning(f"  No data after consolidation")
                continue
            
            # Determine target table name
            # Option 1: Use source system name (f_athletic_screen, f_pro_sup, etc.)
            target_table = f"f_{source_system}"
            
            # Option 2: Use original table name (if you want separate tables per movement)
            # Uncomment this if you want separate tables like f_CMJ, f_DJ, etc.:
            # target_table = f"f_{table_name}"
            
            logger.info(f"  Rows: {len(consolidated)}")
            logger.info(f"  Target table: {target_table}")
            
            # Report unmapped athletes
            unmapped = consolidated[consolidated['athlete_uuid'].isna() & consolidated['source_athlete_id'].notna()]
            if not unmapped.empty:
                unique_unmapped = unmapped['source_athlete_id'].unique()
                logger.warning(f"  WARNING: {len(unique_unmapped)} unmapped athletes")
            
            if not dry_run:
                # Write to warehouse
                write_df(
                    consolidated,
                    target_table,
                    warehouse_engine,
                    if_exists='append'
                )
                logger.info(f"  Written to {target_table}")
                total_rows += len(consolidated)
            else:
                logger.info(f"  [DRY RUN] Would write {len(consolidated)} rows to {target_table}")
                total_rows += len(consolidated)
    
    logger.info(f"\n{'=' * 60}")
    logger.info(f"Consolidation Complete")
    logger.info(f"Total rows processed: {total_rows}")
    logger.info(f"{'=' * 60}")


if __name__ == "__main__":
    import sys
    
    # Check for dry-run flag
    dry_run = '--dry-run' in sys.argv or '-d' in sys.argv
    
    if dry_run:
        logger.info("Running in DRY RUN mode (no writes will be performed)")
    
    consolidate_all_databases(dry_run=dry_run)

