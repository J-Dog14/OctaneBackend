"""
ETL pipeline for Readiness Screen data.
"""
import logging
from datetime import datetime
from common.config import get_warehouse_engine
from common.db_utils import write_df
from common.id_utils import attach_athlete_uuid
from readinessScreen.process_raw import clean_readiness, load_raw_readiness

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def etl_readiness():
    """Main ETL function for Readiness Screen data."""
    logger.info("Starting Readiness Screen ETL...")
    
    try:
        raw_df = load_raw_readiness()
        if raw_df.empty:
            logger.warning("No raw data found. Skipping ETL.")
            return
        
        clean_df = clean_readiness(raw_df)
        clean_df = attach_athlete_uuid(
            clean_df,
            source_system='readiness_screen',
            source_id_column='source_athlete_id'
        )
        
        clean_df['source_system'] = 'readiness_screen'
        clean_df['created_at'] = datetime.now()
        
        engine = get_warehouse_engine()
        write_df(clean_df, 'f_readiness_screen', engine, if_exists='append')
        
        logger.info(f"Successfully loaded {len(clean_df)} rows to f_readiness_screen")
        
    except Exception as e:
        logger.error(f"Error in Readiness Screen ETL: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    etl_readiness()

