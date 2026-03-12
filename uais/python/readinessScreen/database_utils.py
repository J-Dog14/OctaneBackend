"""
Database utility functions for Readiness Screen.
Handles database reordering and maintenance operations.
"""
import sqlite3
from typing import List


def reorder_table(conn: sqlite3.Connection, table_name: str, sort_column: str):
    """
    Reorder a table by a specified column.
    
    Args:
        conn: SQLite connection.
        table_name: Name of the table to reorder.
        sort_column: Column name to sort by.
    """
    cursor = conn.cursor()
    
    # Check if the column exists
    cursor.execute(f"PRAGMA table_info({table_name});")
    columns = [info[1] for info in cursor.fetchall()]
    
    if sort_column not in columns:
        print(f"Skipping table '{table_name}' - Column '{sort_column}' not found.")
        return
    
    # Create a new sorted table
    temp_table = f"{table_name}_sorted"
    cursor.execute(
        f"CREATE TABLE {temp_table} AS "
        f"SELECT * FROM {table_name} ORDER BY {sort_column} ASC;"
    )
    
    # Drop the old table
    cursor.execute(f"DROP TABLE {table_name};")
    
    # Rename the new table to the original name
    cursor.execute(f"ALTER TABLE {temp_table} RENAME TO {table_name};")
    
    conn.commit()
    print(f"Table '{table_name}' reordered successfully.")


def reorder_all_tables(db_path: str, sort_column: str = "Name"):
    """
    Reorder all tables in the database by a specified column.
    
    Args:
        db_path: Path to database file.
        sort_column: Column name to sort by (default: "Name").
    """
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Fetch all table names
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = cursor.fetchall()
        
        for table in tables:
            table_name = table[0]
            
            # Skip system tables
            if table_name.startswith("sqlite_"):
                continue
            
            print(f"Processing table: {table_name}")
            reorder_table(conn, table_name, sort_column)
        
        print("All tables processed.")
        conn.close()
        
    except sqlite3.Error as e:
        print(f"An error occurred: {e}")
        if 'conn' in locals():
            conn.close()


def get_table_names(conn: sqlite3.Connection) -> List[str]:
    """
    Get list of all user tables in the database.
    
    Args:
        conn: SQLite connection.
    
    Returns:
        List of table names.
    """
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [row[0] for row in cursor.fetchall() 
              if not row[0].startswith("sqlite_")]
    return tables

