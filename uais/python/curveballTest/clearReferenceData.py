"""
Script to clear all reference data from the database.

Usage:
    python clearReferenceData.py
"""

import sqlite3
from config import DB_PATH


def clear_reference_data():
    """Clear all data from the reference_data table."""
    print("=" * 80)
    print("CLEAR REFERENCE DATA")
    print("=" * 80)
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Check current count
    c.execute("SELECT COUNT(*) FROM reference_data")
    count = c.fetchone()[0]
    
    if count == 0:
        print("\nReference data table is already empty.")
        conn.close()
        return
    
    print(f"\nCurrent reference data: {count} pitch(es)")
    
    # Show what will be deleted
    c.execute("""
        SELECT filename, participant_name, pitch_date, pitch_type 
        FROM reference_data 
        ORDER BY id
    """)
    rows = c.fetchall()
    print("\nThe following reference pitches will be deleted:")
    print("-" * 100)
    for row in rows:
        filename = row[0].split("\\")[-1] if "\\" in row[0] else row[0]
        print(f"  {filename} ({row[1]}, {row[2]}, {row[3]})")
    print("-" * 100)
    
    # Confirm before proceeding
    response = input("\nAre you sure you want to delete ALL reference data? (yes/no): ").strip().lower()
    if response not in ['yes', 'y']:
        print("Operation cancelled.")
        conn.close()
        return
    
    # Clear the table
    c.execute("DELETE FROM reference_data")
    conn.commit()
    
    # Verify
    c.execute("SELECT COUNT(*) FROM reference_data")
    final_count = c.fetchone()[0]
    
    conn.close()
    
    print(f"\n{'='*80}")
    print(f"Reference data cleared!")
    print(f"  Before: {count} reference pitch(es)")
    print(f"  After:  {final_count} reference pitch(es)")
    print(f"{'='*80}")


if __name__ == "__main__":
    clear_reference_data()

