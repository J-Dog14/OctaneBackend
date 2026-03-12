"""
Database operations for Pro-Sup Test.
Handles database connections, table creation, and data insertion.
"""
import sqlite3
import pandas as pd
from typing import Optional


# Final column schema for pro_sup_data table
FINAL_COLUMNS = [
    'name', 'test_date', 'age', 'height', 'weight', 'injury_history', 
    'season_phase', 'dynomometer_score', 'comments',
    'forearm_rom_0to10', 'forearm_rom_10to20', 'forearm_rom_20to30', 'forearm_rom',
    'tot_rom_0to10', 'tot_rom_10to20', 'tot_rom_20to30', 'tot_rom',
    'num_of_flips_0_10', 'num_of_flips_10_20', 'num_of_flips_20_30', 'num_of_flips',
    'avg_velo_0_10', 'avg_velo_10_20', 'avg_velo_20_30', 'avg_velo'
]


def get_connection(db_path: str) -> sqlite3.Connection:
    """
    Get a connection to the Pro-Sup database.
    
    Args:
        db_path: Path to the database file.
    
    Returns:
        SQLite connection object.
    """
    return sqlite3.connect(db_path)


def ensure_table_exists(conn: sqlite3.Connection, table_name: str = 'pro_sup_data'):
    """
    Ensure the pro_sup_data table exists with correct schema.
    
    Args:
        conn: SQLite connection.
        table_name: Name of the table (default: 'pro_sup_data').
    """
    # Create empty DataFrame with correct columns to ensure table structure
    df_empty = pd.DataFrame(columns=FINAL_COLUMNS)
    df_empty.to_sql(table_name, conn, if_exists='append', index=False)


def check_name_exists(conn: sqlite3.Connection, name: str, test_date: str, 
                     table_name: str = 'pro_sup_data') -> bool:
    """
    Check if a record with the given name and test_date already exists.
    
    Args:
        conn: SQLite connection.
        name: Athlete name.
        test_date: Test date.
        table_name: Name of the table (default: 'pro_sup_data').
    
    Returns:
        True if record exists, False otherwise.
    """
    cursor = conn.cursor()
    cursor.execute(f"SELECT COUNT(*) FROM {table_name} WHERE name = ? AND test_date = ?", 
                   (name, test_date))
    count = cursor.fetchone()[0]
    return count > 0


def insert_xml_data(conn: sqlite3.Connection, data: dict, table_name: str = 'pro_sup_data',
                    skip_if_exists: bool = True):
    """
    Insert XML data into the database.
    
    Args:
        conn: SQLite connection.
        data: Dictionary with data to insert (keys should match FINAL_COLUMNS).
        table_name: Name of the table (default: 'pro_sup_data').
        skip_if_exists: If True, skip insertion if record with same name and test_date exists.
    
    Returns:
        True if data was inserted, False if skipped.
    """
    # Ensure table exists
    ensure_table_exists(conn, table_name)
    
    # Check if record already exists
    if skip_if_exists:
        if check_name_exists(conn, data.get('name'), data.get('test_date'), table_name):
            print(f"   Skipping {data.get('name')} on {data.get('test_date')} - already exists")
            return False
    
    # Create DataFrame with data
    df = pd.DataFrame([data], columns=FINAL_COLUMNS)
    
    # Insert
    df.to_sql(table_name, conn, if_exists='append', index=False)
    return True


def update_ascii_data(conn: sqlite3.Connection, values: dict, 
                     name: str, test_date: str, table_name: str = 'pro_sup_data'):
    """
    Update existing row with ASCII data.
    
    Args:
        conn: SQLite connection.
        values: Dictionary of column names and values to update.
        name: Athlete name (for WHERE clause).
        test_date: Test date (for WHERE clause).
        table_name: Name of the table (default: 'pro_sup_data').
    """
    cursor = conn.cursor()
    
    # Construct UPDATE statement
    set_clause = ", ".join([f"{col} = ?" for col in values.keys()])
    params = list(values.values()) + [name, test_date]
    
    update_sql = f"UPDATE {table_name} SET {set_clause} WHERE name = ? AND test_date = ?;"
    
    cursor.execute(update_sql, params)
    conn.commit()


def load_all_data(conn: sqlite3.Connection, table_name: str = 'pro_sup_data') -> pd.DataFrame:
    """
    Load all data from the database.
    
    Args:
        conn: SQLite connection.
        table_name: Name of the table (default: 'pro_sup_data').
    
    Returns:
        DataFrame with all data.
    """
    query = f"SELECT * FROM {table_name};"
    return pd.read_sql_query(query, conn)


def save_dataframe(conn: sqlite3.Connection, df: pd.DataFrame, 
                  table_name: str = 'pro_sup_data', if_exists: str = 'replace'):
    """
    Save a DataFrame to the database.
    
    Args:
        conn: SQLite connection.
        df: DataFrame to save.
        table_name: Name of the table (default: 'pro_sup_data').
        if_exists: Behavior if table exists ('fail', 'replace', 'append').
    """
    df.to_sql(table_name, conn, if_exists=if_exists, index=False)

