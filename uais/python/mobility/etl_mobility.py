"""
ETL pipeline for Mobility data.
"""
import pandas as pd
import logging
from datetime import datetime
from common.config import get_warehouse_engine
from common.db_utils import write_df
from common.id_utils import attach_athlete_uuid
from mobility.process_raw import clean_mobility, load_raw_mobility

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def etl_mobility():
    """Main ETL function for Mobility data."""
    logger.info("Starting Mobility ETL...")
    
    try:
        raw_df = load_raw_mobility()
        if raw_df.empty:
            logger.warning("No raw data found. Skipping ETL.")
            return
        
        clean_df = clean_mobility(raw_df)
        clean_df = attach_athlete_uuid(
            clean_df,
            source_system='mobility',
            source_id_column='source_athlete_id'
        )
        
        clean_df['source_system'] = 'mobility'
        clean_df['created_at'] = datetime.now()
        
        engine = get_warehouse_engine()
        write_df(clean_df, 'f_mobility', engine, if_exists='append')
        
        logger.info(f"Successfully loaded {len(clean_df)} rows to f_mobility")
        
    except Exception as e:
        logger.error(f"Error in Mobility ETL: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    etl_mobility()

