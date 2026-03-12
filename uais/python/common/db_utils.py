"""
Database utility functions for UAIS.
Provides helpers for reading/writing DataFrames to SQL databases.
"""
import pandas as pd
import logging
from sqlalchemy import Engine, text
from typing import Optional

logger = logging.getLogger(__name__)


def read_table_as_df(engine: Engine, table_name: str, schema: Optional[str] = None) -> pd.DataFrame:
    """
    Read a database table into a pandas DataFrame.
    
    Args:
        engine: SQLAlchemy engine connected to the database.
        table_name: Name of the table to read.
        schema: Optional schema name (for Postgres).
    
    Returns:
        DataFrame containing all rows from the table.
    """
    if schema:
        full_table = f"{schema}.{table_name}"
    else:
        full_table = table_name
    
    return pd.read_sql_table(table_name, engine, schema=schema)


def write_df(df: pd.DataFrame, table_name: str, engine: Engine, 
             if_exists: str = 'append', schema: Optional[str] = None,
             index: bool = False, chunksize: Optional[int] = None) -> None:
    """
    Write a pandas DataFrame to a database table.
    
    Args:
        df: DataFrame to write.
        table_name: Target table name.
        engine: SQLAlchemy engine connected to the database.
        if_exists: Behavior if table exists ('fail', 'replace', 'append').
        schema: Optional schema name (for Postgres).
        index: Whether to write DataFrame index as a column.
        chunksize: Number of rows to write per batch (None = auto-detect based on column count).
    """
    # Auto-calculate chunksize if not provided to avoid PostgreSQL parameter limit
    # PostgreSQL has ~65,535 parameter limit. With method='multi', all rows in a batch
    # are inserted in a single query, so we need to be very conservative.
    # Use 1000 / num_cols to ensure we stay well under the limit (max 25 rows)
    if chunksize is None and len(df) > 0:
        num_cols = len(df.columns)
        # Calculate safe batch size: 1000 / num_cols (very conservative), but cap at 25 rows max
        # This ensures: 25 rows * 40 cols = 1000 params, well under 65535 limit
        # For very wide tables (40+ cols), use even smaller batches
        if num_cols > 40:
            calculated_chunksize = max(1000 // num_cols, 5)  # Minimum 5 rows for very wide tables
        else:
            calculated_chunksize = min(1000 // max(num_cols, 1), 25)
        chunksize = max(calculated_chunksize, 5)  # At least 5 rows per batch
        logger.info(f"Auto-calculated chunksize: {chunksize} rows (columns: {num_cols}, total rows: {len(df)})")
    
    # Manually batch large DataFrames to avoid parameter limit issues
    # With method='multi', pandas inserts all rows in a batch in a single query
    if len(df) > chunksize:
        total_rows = len(df)
        num_batches = (total_rows + chunksize - 1) // chunksize  # Ceiling division
        logger.info(f"Writing {total_rows} rows in {num_batches} batches of ~{chunksize} rows each...")
        
        for i in range(0, total_rows, chunksize):
            batch_df = df.iloc[i:i+chunksize]
            batch_num = (i // chunksize) + 1
            logger.info(f"  Writing batch {batch_num}/{num_batches} ({len(batch_df)} rows)...")
            batch_df.to_sql(
                table_name,
                engine,
                schema=schema,
                if_exists=if_exists if i == 0 else 'append',  # Only use if_exists on first batch
                index=index,
                method='multi',
                chunksize=None  # Don't chunk again since we're already batching
            )
        logger.info(f"✓ All {num_batches} batches written successfully")
    else:
        # Small DataFrame, write directly
        df.to_sql(
            table_name,
            engine,
            schema=schema,
            if_exists=if_exists,
            index=index,
            method='multi',
            chunksize=None  # No need to chunk if already small
        )


def execute_query(engine: Engine, query: str, params: Optional[dict] = None) -> pd.DataFrame:
    """
    Execute a SQL query and return results as a DataFrame.
    
    Args:
        engine: SQLAlchemy engine.
        query: SQL query string.
        params: Optional parameters for parameterized queries.
    
    Returns:
        DataFrame with query results.
    """
    with engine.connect() as conn:
        if params:
            result = conn.execute(text(query), params)
        else:
            result = conn.execute(text(query))
        return pd.DataFrame(result.fetchall(), columns=result.keys())


def table_exists(engine: Engine, table_name: str, schema: Optional[str] = None) -> bool:
    """
    Check if a table exists in the database.
    
    Args:
        engine: SQLAlchemy engine.
        table_name: Name of the table to check.
        schema: Optional schema name.
    
    Returns:
        True if table exists, False otherwise.
    """
    from sqlalchemy import inspect
    inspector = inspect(engine)
    if schema:
        return table_name in inspector.get_table_names(schema=schema)
    return table_name in inspector.get_table_names()


if __name__ == "__main__":
    # Example usage
    from common.config import get_warehouse_engine
    
    engine = get_warehouse_engine()
    print(f"Testing connection to: {engine.url}")
    
    # List tables
    from sqlalchemy import inspect
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    print(f"Available tables: {tables}")

