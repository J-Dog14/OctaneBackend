"""
ETL pipeline for Athletic Screen data.
Loads cleaned data, attaches athlete_uuid, and writes to warehouse.
"""
import pandas as pd
import logging
from datetime import datetime
from common.config import get_warehouse_engine
from common.db_utils import write_df, table_exists
from common.id_utils import attach_athlete_uuid

# Note: athleticScreen/process_raw.py contains existing parsing logic
# This ETL module will need to integrate with that existing code
# For now, providing a template that can be adapted

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def load_raw_athletic_screen():
    """
    Load raw Athletic Screen data.
    
    Note: This function should integrate with existing process_raw.py logic.
    For now, returns empty DataFrame as placeholder.
    """
    # TODO: Integrate with existing athleticScreen/process_raw.py
    # The existing code processes files from 'D:/Athletic Screen 2.0/Output Files/'
    # and creates tables in movement_database_v2.db
    # This ETL should read from that database or directly from files
    return pd.DataFrame()


def clean_athletic_screen(df: pd.DataFrame) -> pd.DataFrame:
    """
    Clean and normalize Athletic Screen data.
    
    Args:
        df: Raw Athletic Screen DataFrame.
    
    Returns:
        Cleaned DataFrame with standardized columns.
    """
    if df.empty:
        return df
    
    clean_df = df.copy()
    
    # Normalize column names
    clean_df.columns = clean_df.columns.str.lower().str.replace(' ', '_')
    
    # Extract athlete identifier
    athlete_cols = ['name', 'athlete_name', 'athlete_id']
    for col in athlete_cols:
        if col in clean_df.columns:
            clean_df['source_athlete_id'] = clean_df[col].astype(str)
            break
    else:
        clean_df['source_athlete_id'] = None
    
    # Extract session date
    date_cols = ['date', 'test_date', 'session_date']
    for col in date_cols:
        if col in clean_df.columns:
            clean_df['session_date'] = pd.to_datetime(clean_df[col]).dt.date
            break
    else:
        clean_df['session_date'] = None
    
    return clean_df


def etl_athletic_screen():
    """
    Main ETL function for Athletic Screen data.
    
    Steps:
    1. Load raw data using process_raw module
    2. Clean and normalize
    3. Attach athlete_uuid
    4. Write to warehouse fact table
    """
    logger.info("Starting Athletic Screen ETL...")
    
    try:
        # Load raw data
        logger.info("Loading raw Athletic Screen data...")
        raw_df = load_raw_athletic_screen()
        
        if raw_df.empty:
            logger.warning("No raw data found. Skipping ETL.")
            return
        
        # Clean data
        logger.info("Cleaning Athletic Screen data...")
        clean_df = clean_athletic_screen(raw_df)
        
        # Attach athlete_uuid
        logger.info("Attaching athlete_uuid...")
        clean_df = attach_athlete_uuid(
            clean_df,
            source_system='athletic_screen',
            source_id_column='source_athlete_id'
        )
        
        # Ensure required columns exist
        required_cols = ['athlete_uuid', 'session_date', 'source_system']
        for col in required_cols:
            if col not in clean_df.columns:
                if col == 'source_system':
                    clean_df['source_system'] = 'athletic_screen'
                elif col == 'session_date':
                    # Try to infer from date column
                    if 'date' in clean_df.columns:
                        clean_df['session_date'] = pd.to_datetime(clean_df['date']).dt.date
                    else:
                        logger.error("No session_date or date column found")
                        return
                else:
                    logger.error(f"Required column '{col}' missing")
                    return
        
        # Add metadata
        clean_df['created_at'] = datetime.now()
        
        # Write to warehouse
        logger.info("Writing to warehouse database...")
        engine = get_warehouse_engine()
        
        # Ensure table exists (create if needed)
        if not table_exists(engine, 'f_athletic_screen'):
            logger.info("Creating f_athletic_screen table...")
            # Table will be created automatically by to_sql with appropriate schema
            # For production, use proper DDL from sql/create_athlete_tables.sql
        
        write_df(
            clean_df,
            'f_athletic_screen',
            engine,
            if_exists='append'
        )
        
        logger.info(f"Successfully loaded {len(clean_df)} rows to f_athletic_screen")
        
    except Exception as e:
        logger.error(f"Error in Athletic Screen ETL: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    etl_athletic_screen()

