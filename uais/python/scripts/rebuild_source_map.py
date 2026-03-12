"""
Rebuild the source_athlete_map table from athletes table and raw source IDs.
"""
import pandas as pd
import logging
from common.config import get_app_engine, get_warehouse_engine
from common.db_utils import read_table_as_df, write_df, execute_query

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def rebuild_source_map():
    """
    Rebuild source_athlete_map by scanning all fact tables in warehouse
    and matching source_athlete_id values to athlete_uuid from athletes table.
    """
    logger.info("Rebuilding source_athlete_map...")
    
    app_engine = get_app_engine()
    warehouse_engine = get_warehouse_engine()
    
    # Load athletes table
    try:
        athletes_df = read_table_as_df(app_engine, 'athletes')
        logger.info(f"Loaded {len(athletes_df)} athletes from app database")
    except Exception as e:
        logger.error(f"Could not load athletes table: {e}")
        return
    
    if 'athlete_uuid' not in athletes_df.columns:
        logger.error("athletes table missing 'athlete_uuid' column")
        return
    
    # Get all fact tables from warehouse
    from sqlalchemy import inspect
    inspector = inspect(warehouse_engine)
    fact_tables = [t for t in inspector.get_table_names() if t.startswith('f_')]
    
    logger.info(f"Found {len(fact_tables)} fact tables: {fact_tables}")
    
    # Collect mappings from each fact table
    all_mappings = []
    
    for table_name in fact_tables:
        try:
            df = read_table_as_df(warehouse_engine, table_name)
            
            # Determine source_system from table name
            source_system = table_name.replace('f_', '').replace('_', ' ')
            
            # Look for source_athlete_id column
            source_id_cols = ['source_athlete_id', 'athlete_id', 'name']
            source_id_col = None
            for col in source_id_cols:
                if col in df.columns:
                    source_id_col = col
                    break
            
            if not source_id_col:
                logger.warning(f"No source ID column found in {table_name}, skipping")
                continue
            
            # Extract unique mappings
            if 'athlete_uuid' in df.columns:
                mappings = df[[source_id_col, 'athlete_uuid']].dropna()
                mappings['source_system'] = source_system
                mappings = mappings.rename(columns={source_id_col: 'source_athlete_id'})
                mappings = mappings[['source_system', 'source_athlete_id', 'athlete_uuid']].drop_duplicates()
                
                all_mappings.append(mappings)
                logger.info(f"Extracted {len(mappings)} mappings from {table_name}")
            
        except Exception as e:
            logger.warning(f"Could not process {table_name}: {e}")
    
    if not all_mappings:
        logger.warning("No mappings found. source_athlete_map will be empty.")
        return
    
    # Combine all mappings
    source_map_df = pd.concat(all_mappings, ignore_index=True)
    source_map_df = source_map_df.drop_duplicates(subset=['source_system', 'source_athlete_id'])
    
    logger.info(f"Total unique mappings: {len(source_map_df)}")
    
    # Write to app database
    logger.info("Writing source_athlete_map to app database...")
    write_df(
        source_map_df,
        'source_athlete_map',
        app_engine,
        if_exists='replace',
        index=False
    )
    
    logger.info("source_athlete_map rebuilt successfully")
    
    # Print summary by source system
    summary = source_map_df.groupby('source_system').size()
    logger.info("\nMappings by source system:")
    for system, count in summary.items():
        logger.info(f"  {system}: {count}")


if __name__ == "__main__":
    rebuild_source_map()

