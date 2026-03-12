"""
Database optimization and initialization script.

This script creates an optimized SQLite database with all three tables:
1. movement_data - Current/new data for report generation
2. movement_data_archive - Historical data archive (allows multiple instances per person/date)
3. athletes - Client/athlete summary table (name, date, movements, sessions)

Run this once to initialize/optimize your database structure.
"""

import sqlite3
from config import DB_PATH
from database import init_db, init_archive_db
from athletes import init_athletes_db


def optimize_database():
    """
    Initialize and optimize the database with all tables and indexes.
    This ensures optimal performance for queries.
    """
    print("=" * 80)
    print("DATABASE INITIALIZATION AND OPTIMIZATION")
    print("=" * 80)
    
    # Initialize all tables (this also creates indexes)
    print("\nInitializing tables...")
    init_db()
    print("  [OK] movement_data table initialized")
    
    init_archive_db()
    print("  [OK] movement_data_archive table initialized")
    
    init_athletes_db()
    print("  [OK] athletes table initialized")
    
    # Verify database structure
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Get table info
    c.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in c.fetchall()]
    
    print(f"\nDatabase contains {len(tables)} table(s):")
    for table in tables:
        c.execute(f"SELECT COUNT(*) FROM {table}")
        count = c.fetchone()[0]
        print(f"  - {table}: {count} record(s)")
    
    # Get index info
    c.execute("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
    indexes = [row[0] for row in c.fetchall()]
    
    print(f"\nDatabase contains {len(indexes)} index(es) for query optimization:")
    for idx in indexes:
        print(f"  - {idx}")
    
    conn.close()
    
    print("\n" + "=" * 80)
    print("Database optimization complete!")
    print("=" * 80)
    print("\nDatabase structure:")
    print("  - movement_data: Current session data (cleared each run)")
    print("  - movement_data_archive: Historical data (allows multiple instances)")
    print("  - athletes: Client summary (name, date, movements, sessions)")
    print("\nAll tables are optimized with indexes for fast queries.")


if __name__ == "__main__":
    optimize_database()

