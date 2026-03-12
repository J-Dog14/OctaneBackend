"""
ETL pipeline for Proteus data.
"""
import os
import re
import logging
import shutil
from pathlib import Path
from datetime import datetime
from typing import Optional
import pandas as pd
from common.config import get_warehouse_engine
from common.db_utils import write_df
from common.id_utils import attach_athlete_uuid
from common.athlete_manager import get_warehouse_connection, update_athlete_flags, get_or_create_athlete
from common.duplicate_detector import check_and_merge_duplicates
from proteus.process_raw import clean_proteus, load_raw_proteus
from common.io_utils import load_csv, find_files

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_processed_files(conn) -> set:
    """
    Get set of already processed file paths from f_proteus table.
    
    Args:
        conn: PostgreSQL connection
        
    Returns:
        Set of processed file paths
    """
    try:
        with conn.cursor() as cur:
            # Check if source_file column exists
            cur.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'f_proteus' 
                AND column_name = 'source_file'
            """)
            
            if cur.fetchone():
                # Column exists, get all processed files
                cur.execute("""
                    SELECT DISTINCT source_file 
                    FROM public.f_proteus 
                    WHERE source_file IS NOT NULL
                """)
                return {row[0] for row in cur.fetchall()}
            else:
                # Column doesn't exist yet, return empty set
                return set()
    except Exception as e:
        logger.warning(f"Could not get processed files: {e}")
        return set()


def ensure_column_exists(conn, table_name: str, column_name: str, column_type: str = 'TEXT'):
    """Ensure a column exists in a table."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = %s 
            AND column_name = %s
        """, (table_name, column_name))
        
        if cur.fetchone() is None:
            try:
                cur.execute(f"""
                    ALTER TABLE public.{table_name} 
                    ADD COLUMN {column_name} {column_type}
                """)
                conn.commit()
                logger.info(f"Added column {column_name} to {table_name}")
            except Exception as e:
                logger.warning(f"Could not add column {column_name}: {e}")
                conn.rollback()


def process_proteus_file(file_path: Path, conn) -> list:
    """
    Process a single Proteus Excel or CSV file.
    
    Args:
        file_path: Path to Excel or CSV file
        conn: PostgreSQL connection
        
    Returns:
        True if successful, False otherwise
    """
    logger.info(f"Processing: {file_path.name}")
    
    try:
        # Load file (Excel or CSV)
        if file_path.suffix.lower() in ['.xlsx', '.xls']:
            logger.info(f"Reading Excel file: {file_path.name}")
            df = pd.read_excel(file_path)
        else:
            logger.info(f"Reading CSV file: {file_path.name}")
            df = load_csv(file_path)
        
        if df.empty:
            logger.warning(f"File is empty: {file_path.name}")
            return False
        
        # Filter for baseball and softball only (case-insensitive)
        # Handle both 'Sport' and 'sport' column names
        sport_col = None
        for col in df.columns:
            if col.lower() == 'sport':
                sport_col = col
                break
        
        if sport_col:
            before_count = len(df)
            df = df[df[sport_col].astype(str).str.lower().isin(['baseball', 'softball'])]
            after_count = len(df)
            logger.info(f"Filtered Sport: {before_count} rows -> {after_count} rows (baseball/softball only)")
            if df.empty:
                logger.warning(f"No baseball/softball data in file: {file_path.name}")
                return False
        
        # Clean data
        clean_df = clean_proteus(df, file_path)
        if clean_df.empty:
            logger.warning(f"No data after cleaning: {file_path.name}")
            return False
        
        # Add source_file column
        clean_df['source_file'] = str(file_path)
        
        # Create/get athletes and attach UUIDs
        # Use get_or_create_athlete for each unique athlete
        logger.info("Creating/getting athletes...")
        clean_df['athlete_uuid'] = None
        
        # Get unique athletes from the data
        unique_athletes = clean_df[['source_athlete_id', 'user_name', 'birth_date', 'sex', 'height', 'weight']].drop_duplicates(subset=['source_athlete_id'])
        
        athlete_uuid_map = {}
        for _, athlete_row in unique_athletes.iterrows():
            source_id = athlete_row['source_athlete_id']
            if pd.isna(source_id) or source_id == '':
                continue
                
            name = athlete_row.get('user_name') or str(source_id)
            birth_date = athlete_row.get('birth_date')
            sex_val = athlete_row.get('sex')
            # Normalize gender: DB expects text or None. Excel NaN/float breaks COALESCE(gender, %s).
            if pd.isna(sex_val) or not isinstance(sex_val, str):
                gender = None
            else:
                gender = str(sex_val).strip() or None
            height = athlete_row.get('height')
            weight = athlete_row.get('weight')
            
            # Convert birth_date to string if it's a datetime
            # Check for NaT (Not a Time) first, which is pandas' equivalent of NaN for dates
            if pd.isna(birth_date):
                birth_date = None
            elif hasattr(birth_date, 'strftime'):
                try:
                    # Only call strftime if it's not NaT
                    if not pd.isna(birth_date):
                        birth_date = birth_date.strftime('%Y-%m-%d')
                    else:
                        birth_date = None
                except (ValueError, AttributeError, TypeError):
                    # If strftime fails (e.g., NaT), set to None
                    birth_date = None
            elif pd.notna(birth_date):
                birth_date = str(birth_date)
            else:
                birth_date = None
            
            try:
                athlete_uuid, _ = get_or_create_athlete(
                    name=name,
                    date_of_birth=birth_date,
                    gender=gender,
                    height=float(height) if pd.notna(height) else None,
                    weight=float(weight) if pd.notna(weight) else None,
                    source_system='proteus',
                    source_athlete_id=str(source_id),
                    check_app_db=False  # Skip app DB check for backfill
                )
                athlete_uuid_map[source_id] = athlete_uuid
                logger.debug(f"Mapped {name} ({source_id}) -> {athlete_uuid}")
            except Exception as e:
                logger.warning(f"Failed to create/get athlete for {name} ({source_id}): {e}")
                continue
        
        # Map UUIDs back to dataframe
        clean_df['athlete_uuid'] = clean_df['source_athlete_id'].map(athlete_uuid_map)
        
        # Check for rows without UUIDs
        missing_uuids = clean_df['athlete_uuid'].isna().sum()
        if missing_uuids > 0:
            logger.warning(f"{missing_uuids} rows have no athlete_uuid. These will be skipped.")
            clean_df = clean_df[clean_df['athlete_uuid'].notna()].copy()
        
        if clean_df.empty:
            logger.error("No rows with valid athlete_uuid after mapping")
            return False
        
        clean_df['source_system'] = 'proteus'
        clean_df['created_at'] = datetime.now()
        
        # Ensure source_file column exists in database
        ensure_column_exists(conn, 'f_proteus', 'source_file', 'TEXT')
        
        # Dynamically ensure all columns exist in database
        # This allows the schema to grow as new columns appear in Excel exports
        for col in clean_df.columns:
            if col in ['athlete_uuid', 'session_date', 'source_system', 'source_athlete_id', 
                      'age_at_collection', 'age_group', 'created_at', 'source_file']:
                continue  # Skip standard columns
            
            # Infer column type from data
            sample_value = clean_df[col].dropna().iloc[0] if not clean_df[col].dropna().empty else None
            if sample_value is not None:
                if isinstance(sample_value, (int, pd.Int64Dtype)):
                    col_type = 'INTEGER'
                elif isinstance(sample_value, (float, pd.Float64Dtype)):
                    col_type = 'DECIMAL'
                elif isinstance(sample_value, bool):
                    col_type = 'BOOLEAN'
                elif isinstance(sample_value, (pd.Timestamp, datetime)):
                    col_type = 'DATE'
                else:
                    col_type = 'TEXT'
            else:
                col_type = 'TEXT'
            
            # Sanitize column name for SQL
            sql_col_name = col.lower().replace(' ', '_').replace('-', '_')
            sql_col_name = ''.join(c if c.isalnum() or c == '_' else '_' for c in sql_col_name)
            sql_col_name = re.sub(r'_+', '_', sql_col_name).strip('_')
            
            ensure_column_exists(conn, 'f_proteus', sql_col_name, col_type)
        
        # Rename columns to match database (sanitize for SQL)
        clean_df_renamed = clean_df.copy()
        column_mapping = {}
        for col in clean_df.columns:
            sql_col_name = col.lower().replace(' ', '_').replace('-', '_')
            sql_col_name = ''.join(c if c.isalnum() or c == '_' else '_' for c in sql_col_name)
            sql_col_name = re.sub(r'_+', '_', sql_col_name).strip('_')
            if col != sql_col_name:
                column_mapping[col] = sql_col_name
        
        if column_mapping:
            clean_df_renamed = clean_df_renamed.rename(columns=column_mapping)
        
        # Don't insert source 'id' column - warehouse f_proteus uses serial PK. Source id causes UniqueViolation on re-run.
        if 'id' in clean_df_renamed.columns:
            clean_df_renamed = clean_df_renamed.drop(columns=['id'])
        
        # Write to database (write_df will automatically batch to avoid parameter limits)
        engine = get_warehouse_engine()
        logger.info(f"Writing {len(clean_df_renamed)} rows to database...")
        write_df(clean_df_renamed, 'f_proteus', engine, if_exists='append')
        logger.info(f"[OK] Data written successfully")
        
        # Update athlete flags
        processed_uuids = []
        if 'athlete_uuid' in clean_df.columns:
            unique_uuids = clean_df['athlete_uuid'].dropna().unique()
            from common.athlete_matcher import update_athlete_data_flag
            for uuid in unique_uuids:
                try:
                    update_athlete_data_flag(conn, str(uuid), "proteus", has_data=True)
                    processed_uuids.append(str(uuid))
                except:
                    pass
        
        logger.info(f"[OK] Processed {len(clean_df)} rows from {file_path.name}")
        return processed_uuids  # Return processed UUIDs instead of True
        
    except Exception as e:
        logger.error(f"Error processing {file_path.name}: {e}", exc_info=True)
        return False


def run_daily_proteus_ingest(inbox_dir: Optional[Path] = None, archive_dir: Optional[Path] = None):
    """
    Process all new CSV files in the inbox directory.
    
    Args:
        inbox_dir: Directory containing CSV files to process (default: from config)
        archive_dir: Directory to move processed files (default: from config)
    """
    # Get directories from config if not provided
    if inbox_dir is None:
        try:
            from proteus.web.config import get_proteus_inbox_dir
            inbox_dir = get_proteus_inbox_dir()
        except:
            from common.config import get_raw_paths
            paths = get_raw_paths()
            proteus_path = paths.get('proteus')
            if proteus_path:
                inbox_dir = Path(proteus_path) / "inbox"
            else:
                raise ValueError("Proteus inbox directory not configured")
    
    if archive_dir is None:
        try:
            from proteus.web.config import get_proteus_archive_dir
            archive_dir = get_proteus_archive_dir()
        except:
            from common.config import get_raw_paths
            paths = get_raw_paths()
            proteus_path = paths.get('proteus')
            if proteus_path:
                archive_dir = Path(proteus_path) / "archive"
            else:
                archive_dir = inbox_dir.parent / "archive"
    
    archive_dir.mkdir(parents=True, exist_ok=True)
    
    logger.info("=" * 80)
    logger.info("Proteus ETL Processing")
    logger.info("=" * 80)
    logger.info(f"Inbox directory: {inbox_dir}")
    logger.info(f"Archive directory: {archive_dir}")
    
    if not inbox_dir.exists():
        logger.warning(f"Inbox directory does not exist: {inbox_dir}")
        return
    
    # Connect to database
    conn = get_warehouse_connection()
    
    try:
        # Get processed files
        processed_files = get_processed_files(conn)
        logger.info(f"Found {len(processed_files)} already processed files")
        
        # Find Excel files in inbox (Proteus downloads as .xlsx)
        excel_files = list(inbox_dir.glob("*.xlsx")) + list(inbox_dir.glob("*.xls"))
        csv_files = list(inbox_dir.glob("*.csv"))  # Also check for CSV for backward compatibility
        all_files = excel_files + csv_files
        
        if not all_files:
            logger.info("No Excel or CSV files found in inbox")
            return
        
        logger.info(f"Found {len(excel_files)} Excel files and {len(csv_files)} CSV files in inbox")
        
        # Filter out already processed files
        new_files = []
        for file_path in all_files:
            file_path_normalized = os.path.normpath(str(file_path))
            if file_path_normalized not in processed_files:
                new_files.append(file_path)
            else:
                logger.info(f"Skipping already processed: {file_path.name}")
        
        if not new_files:
            logger.info("All files have already been processed")
            return
        
        logger.info(f"Processing {len(new_files)} new files...")
        
        # Process each file
        processed_count = 0
        failed_count = 0
        all_processed_uuids = []
        
        for file_path in new_files:
            result = process_proteus_file(file_path, conn)
            # process_proteus_file returns a list of UUIDs on success, False on failure
            if result is not False and result is not None:
                # Move to archive
                archive_path = archive_dir / file_path.name
                if archive_path.exists():
                    import time
                    timestamp = int(time.time())
                    archive_path = archive_dir / f"{file_path.stem}_{timestamp}{file_path.suffix}"
                
                shutil.move(str(file_path), str(archive_path))
                logger.info(f"[OK] Archived: {archive_path.name}")
                processed_count += 1
                # Collect UUIDs from processed file
                if isinstance(result, list):
                    all_processed_uuids.extend(result)
            else:
                failed_count += 1
                logger.error(f"Failed to process: {file_path.name}")
        
        # Update athlete flags
        logger.info("Updating athlete data flags...")
        try:
            from common.athlete_manager import update_athlete_flags
            update_athlete_flags(conn=conn, verbose=True)
        except Exception as e:
            logger.warning(f"Could not update athlete flags: {e}")
        
        # Check for duplicate athletes
        # In automated runs, use auto_skip=True to avoid blocking on user input
        if all_processed_uuids:
            # Remove duplicates from UUID list
            unique_processed_uuids = list(set(all_processed_uuids))
            try:
                is_automated = os.getenv('AUTOMATED_RUN') == '1'
                if is_automated:
                    logger.info("Checking for similar athlete names (auto-skip mode - no interactive prompts)...")
                else:
                    logger.info("Checking for similar athlete names...")
                check_and_merge_duplicates(
                    conn=conn, 
                    athlete_uuids=unique_processed_uuids, 
                    auto_skip=is_automated  # Skip interactive prompts in automated mode
                )
            except Exception as e:
                logger.warning(f"Could not check for duplicates: {str(e)}")
        
        # Summary
        logger.info("=" * 80)
        logger.info("Processing Summary")
        logger.info("=" * 80)
        logger.info(f"Processed: {processed_count} files")
        logger.info(f"Failed: {failed_count} files")
        
    finally:
        conn.close()


def etl_proteus():
    """
    Legacy ETL function for Proteus data.
    Uses the old method of loading from raw data directory.
    NOTE: This function is deprecated. Use run_daily_proteus_ingest() or process_proteus_file() instead.
    """
    logger.warning("etl_proteus() is deprecated. Use run_daily_proteus_ingest() or process_proteus_file() instead.")
    logger.info("Starting Proteus ETL (legacy mode)...")
    
    try:
        from common.athlete_manager import get_warehouse_connection
        conn = get_warehouse_connection()
        
        try:
            raw_df = load_raw_proteus()
            if raw_df.empty:
                logger.warning("No raw data found. Skipping ETL.")
                return
            
            # Use a temporary file path for processing
            import tempfile
            with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as tmp_file:
                tmp_path = Path(tmp_file.name)
                raw_df.to_csv(tmp_path, index=False)
            
            try:
                # Use the same process_proteus_file() function for consistency
                result = process_proteus_file(tmp_path, conn)
                if result:
                    logger.info(f"Successfully loaded data to f_proteus")
                else:
                    logger.error("Failed to process data")
            finally:
                # Clean up temp file
                if tmp_path.exists():
                    tmp_path.unlink()
        finally:
            conn.close()
        
    except Exception as e:
        logger.error(f"Error in Proteus ETL: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    # Default to inbox/archive mode
    run_daily_proteus_ingest()

