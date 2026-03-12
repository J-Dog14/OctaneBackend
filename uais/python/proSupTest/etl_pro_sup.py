"""
ETL pipeline for Pro-Sup Test data.
"""
import pandas as pd
import logging
from datetime import datetime
from common.config import get_warehouse_engine
from common.db_utils import write_df
from common.id_utils import attach_athlete_uuid

# Note: proSupTest/process_raw.py contains existing XML/ASCII parsing logic
# This ETL module integrates with that existing code

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def load_raw_pro_sup():
    """
    Load raw Pro-Sup Test data.
    
    Note: This should integrate with existing process_raw.py logic
    which reads from XML files and ASCII files.
    """
    # TODO: Integrate with existing proSupTest/process_raw.py
    # The existing code processes Session.xml files and ASCII data files
    # and writes to pro-sup_data.sqlite
    # This ETL should read from that database or directly from files
    return pd.DataFrame()


def clean_pro_sup(df: pd.DataFrame) -> pd.DataFrame:
    """Clean and normalize Pro-Sup Test data."""
    if df.empty:
        return df
    
    clean_df = df.copy()
    clean_df.columns = clean_df.columns.str.lower().str.replace(' ', '_')
    
    # Extract athlete identifier
    if 'name' in clean_df.columns:
        clean_df['source_athlete_id'] = clean_df['name'].astype(str)
    else:
        clean_df['source_athlete_id'] = None
    
    # Extract session date
    if 'test_date' in clean_df.columns:
        clean_df['session_date'] = pd.to_datetime(clean_df['test_date']).dt.date
    elif 'date' in clean_df.columns:
        clean_df['session_date'] = pd.to_datetime(clean_df['date']).dt.date
    else:
        clean_df['session_date'] = None
    
    return clean_df


def etl_pro_sup():
    """Main ETL function for Pro-Sup Test data."""
    logger.info("Starting Pro-Sup Test ETL...")
    
    try:
        raw_df = load_raw_pro_sup()
        if raw_df.empty:
            logger.warning("No raw data found. Skipping ETL.")
            return
        
        clean_df = clean_pro_sup(raw_df)
        clean_df = attach_athlete_uuid(
            clean_df,
            source_system='pro_sup',
            source_id_column='source_athlete_id',
            interactive=True  # Enable interactive athlete creation
        )
        
        clean_df['source_system'] = 'pro_sup'
        clean_df['created_at'] = datetime.now()
        
        engine = get_warehouse_engine()
        write_df(clean_df, 'f_pro_sup', engine, if_exists='append')
        
        logger.info(f"Successfully loaded {len(clean_df)} rows to f_pro_sup")
        
    except Exception as e:
        logger.error(f"Error in Pro-Sup Test ETL: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    etl_pro_sup()

