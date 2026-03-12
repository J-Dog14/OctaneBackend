#!/usr/bin/env python3
"""
ETL Script: Sync Athlete Identity from App DB to Warehouse DB

This script performs an idempotent sync of athlete data from the app database's
public."User" table to the warehouse database's analytics.athlete_dim table.

Features:
- Bulk load using temporary staging table + execute_values
- Idempotent upserts with ON CONFLICT
- Robust handling of quoted table identifiers
- Comprehensive logging and error handling
- Environment variable configuration

Exit codes:
    0: Success
    1: Configuration error (missing env vars)
    2: Database connection error
    3: SQL execution error
    4: Unexpected error
"""

import os
import sys
import time
import logging
from pathlib import Path
from typing import Optional

import psycopg2
from psycopg2.extras import execute_values
import pandas as pd
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


def get_env_var(name: str, required: bool = True) -> Optional[str]:
    """
    Get environment variable, optionally raising error if missing.
    
    Args:
        name: Environment variable name
        required: If True, raise error if variable is missing
        
    Returns:
        Environment variable value or None if not required and missing
        
    Raises:
        ValueError: If required variable is missing
    """
    value = os.getenv(name)
    if required and not value:
        raise ValueError(f"Required environment variable {name} is not set")
    return value


def get_app_connection():
    """
    Create connection to app database using environment variables.
    
    Returns:
        psycopg2 connection object
        
    Raises:
        psycopg2.Error: If connection fails
    """
    host = get_env_var('APP_HOST')
    port = get_env_var('APP_PORT')
    database = get_env_var('APP_DB')
    user = get_env_var('APP_USER')
    password = get_env_var('APP_PASSWORD')
    
    logger.info(f"Connecting to app database: {user}@{host}:{port}/{database}")
    
    conn = psycopg2.connect(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password,
        connect_timeout=10
    )
    
    # Set encoding to UTF-8 explicitly (Postgres defaults to this, but be explicit)
    conn.set_client_encoding('UTF8')
    
    return conn


def get_warehouse_connection():
    """
    Create connection to warehouse database using environment variables.
    
    Returns:
        psycopg2 connection object
        
    Raises:
        psycopg2.Error: If connection fails
    """
    host = get_env_var('WH_HOST')
    port = get_env_var('WH_PORT')
    database = get_env_var('WH_DB')
    user = get_env_var('WH_USER')
    password = get_env_var('WH_PASSWORD')
    
    logger.info(f"Connecting to warehouse database: {user}@{host}:{port}/{database}")
    
    conn = psycopg2.connect(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password,
        connect_timeout=10
    )
    
    conn.set_client_encoding('UTF8')
    
    return conn


def ensure_warehouse_schema(conn):
    """
    Ensure analytics schema and athlete_dim table exist in warehouse.
    
    Args:
        conn: psycopg2 connection to warehouse database
    """
    with conn.cursor() as cur:
        # Create schema if not exists
        cur.execute("CREATE SCHEMA IF NOT EXISTS analytics;")
        
        # Create table if not exists
        cur.execute("""
            CREATE TABLE IF NOT EXISTS analytics.athlete_dim (
                athlete_uuid UUID PRIMARY KEY,
                full_name TEXT NOT NULL,
                source_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        """)
        
        # Create index if not exists (for fuzzy lookups)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS ix_athlete_dim_full_name_lower 
            ON analytics.athlete_dim (LOWER(full_name));
        """)
        
        conn.commit()
        logger.info("Verified warehouse schema and table exist")


def fetch_athletes_from_app(conn) -> pd.DataFrame:
    """
    Fetch athlete data from app database public."User" table.
    
    Note: The table name "User" is quoted because it's a reserved word in SQL.
    We must use quoted identifiers: public."User"
    
    Args:
        conn: psycopg2 connection to app database
        
    Returns:
        DataFrame with columns: athlete_uuid, full_name
    """
    query = '''
        SELECT 
            uuid AS athlete_uuid,
            name AS full_name
        FROM public."User"
    '''
    
    logger.info("Fetching athletes from app database...")
    df = pd.read_sql(query, conn)
    
    # Ensure UUIDs are strings (pandas may convert them)
    if 'athlete_uuid' in df.columns:
        df['athlete_uuid'] = df['athlete_uuid'].astype(str)
    
    logger.info(f"Fetched {len(df)} athletes from app database")
    
    return df


def sync_athletes_to_warehouse(df: pd.DataFrame, conn):
    """
    Sync athlete data to warehouse using bulk staging table approach.
    
    This method:
    1. Creates a temporary staging table
    2. Bulk loads data using execute_values (fast batch inserts)
    3. Performs a single upsert with ON CONFLICT
    4. Temporary table is automatically dropped when connection closes
    
    Args:
        df: DataFrame with athlete data (athlete_uuid, full_name)
        conn: psycopg2 connection to warehouse database
    """
    if df.empty:
        logger.warning("No athletes to sync (empty DataFrame)")
        return
    
    with conn.cursor() as cur:
        # Create temporary staging table
        logger.info("Creating temporary staging table...")
        cur.execute("""
            CREATE TEMPORARY TABLE tmp_athlete_dim (
                athlete_uuid UUID PRIMARY KEY,
                full_name TEXT NOT NULL
            );
        """)
        
        # Bulk load into staging table using execute_values (fast and reliable)
        # This is more robust than COPY for handling special characters and NULLs
        logger.info(f"Bulk loading {len(df)} rows into staging table...")
        
        # Convert DataFrame to list of tuples, handling NULLs properly
        # Replace pandas NaN with None (Python None = SQL NULL)
        data_tuples = [
            (row['athlete_uuid'], row['full_name'] if pd.notna(row['full_name']) else None)
            for _, row in df.iterrows()
        ]
        
        # Use execute_values for bulk insert (faster than row-by-row)
        execute_values(
            cur,
            """
            INSERT INTO tmp_athlete_dim (athlete_uuid, full_name)
            VALUES %s
            """,
            data_tuples,
            page_size=1000  # Insert in batches of 1000
        )
        
        logger.info(f"Loaded {len(df)} rows into staging table")
        
        # Perform single upsert from staging table to target table
        logger.info("Performing upsert into analytics.athlete_dim...")
        cur.execute("""
            INSERT INTO analytics.athlete_dim (athlete_uuid, full_name)
            SELECT t.athlete_uuid, t.full_name
            FROM tmp_athlete_dim t
            ON CONFLICT (athlete_uuid) DO UPDATE
            SET 
                full_name = EXCLUDED.full_name,
                source_synced_at = NOW();
        """)
        
        rows_affected = cur.rowcount
        conn.commit()
        
        logger.info(f"Upserted {rows_affected} rows into analytics.athlete_dim")
        
        # Temporary table will be automatically dropped when connection closes


def main():
    """Main ETL execution function."""
    start_time = time.time()
    app_conn = None
    wh_conn = None
    
    try:
        # Load environment variables from .env file
        env_path = Path(__file__).parent.parent.parent / '.env'
        if env_path.exists():
            load_dotenv(env_path)
            logger.info(f"Loaded environment variables from {env_path}")
        else:
            logger.warning(f".env file not found at {env_path}, using system environment variables")
        
        # Connect to databases
        app_conn = get_app_connection()
        wh_conn = get_warehouse_connection()
        
        # Ensure warehouse schema exists
        ensure_warehouse_schema(wh_conn)
        
        # Fetch athletes from app database
        df = fetch_athletes_from_app(app_conn)
        
        # Sync to warehouse
        sync_athletes_to_warehouse(df, wh_conn)
        
        # Log summary
        duration = time.time() - start_time
        logger.info(f"Sync completed successfully in {duration:.2f} seconds")
        logger.info(f"Total athletes processed: {len(df)}")
        
        return 0
        
    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        logger.error("Please check your .env file or environment variables")
        return 1
        
    except psycopg2.OperationalError as e:
        logger.error(f"Database connection error: {e}")
        return 2
        
    except psycopg2.Error as e:
        logger.error(f"SQL execution error: {e}")
        if app_conn:
            app_conn.rollback()
        if wh_conn:
            wh_conn.rollback()
        return 3
        
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
        return 4
        
    finally:
        # Clean up connections
        if app_conn:
            app_conn.close()
            logger.debug("Closed app database connection")
        if wh_conn:
            wh_conn.close()
            logger.debug("Closed warehouse database connection")


if __name__ == '__main__':
    sys.exit(main())

