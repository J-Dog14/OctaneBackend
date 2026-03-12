"""
Script to add or update reference data in the database.

Reference data is used as a baseline for comparison in reports.
This script allows you to add new reference pitches or update existing ones.

Usage:
    python updateReferenceData.py

The script reads reference data from the files specified below (or in config.py).
These are typically the same file paths where your other software exports data.
"""

import sqlite3
import os

# Import paths from config.py (or override them here if needed for this specific update)
from config import DB_PATH, REF_EVENTS_PATH, REF_LINK_MODEL_BASED_PATH, REF_ACCEL_DATA_PATH

# If you need to use different files for this update, you can override the paths here:
# REF_EVENTS_PATH = r"D:\Youth Pitch Design\Exports\reference_events.txt"
# REF_LINK_MODEL_BASED_PATH = r"D:\Youth Pitch Design\Exports\reference_link_model_based.txt"
# REF_ACCEL_DATA_PATH = r"D:\Youth Pitch Design\Exports\reference_accel_data.txt"

from database import init_reference_db, ingest_reference_data


def show_current_reference_data():
    """Display current reference data in the database."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute("SELECT COUNT(*) FROM reference_data")
    count = c.fetchone()[0]
    
    if count == 0:
        print("No reference data currently in database.")
    else:
        print(f"\nCurrent reference data: {count} pitch(es)")
        c.execute("""
            SELECT filename, participant_name, pitch_date, pitch_type, pitch_stability_score 
            FROM reference_data 
            ORDER BY id
        """)
        rows = c.fetchall()
        print("\nExisting reference pitches:")
        print("-" * 100)
        for row in rows:
            filename = row[0].split("\\")[-1] if "\\" in row[0] else row[0]
            print(f"  {filename}")
            print(f"    Participant: {row[1]}, Date: {row[2]}, Type: {row[3]}, Score: {row[4]:.2f}")
        print("-" * 100)
    
    conn.close()
    return count


def update_reference_data():
    """Add or update reference data from the configured reference files."""
    print("=" * 80)
    print("REFERENCE DATA UPDATE SCRIPT")
    print("=" * 80)
    
    # Ensure reference table exists
    init_reference_db()
    
    # Show current state
    initial_count = show_current_reference_data()
    
    print(f"\nReading reference data from:")
    print(f"  Events: {REF_EVENTS_PATH}")
    print(f"  Angles: {REF_LINK_MODEL_BASED_PATH}")
    print(f"  Acceleration: {REF_ACCEL_DATA_PATH}")
    
    # Check if files exist
    missing_files = []
    if not os.path.exists(REF_EVENTS_PATH):
        missing_files.append(f"Events: {REF_EVENTS_PATH}")
    if not os.path.exists(REF_LINK_MODEL_BASED_PATH):
        missing_files.append(f"Angles: {REF_LINK_MODEL_BASED_PATH}")
    if not os.path.exists(REF_ACCEL_DATA_PATH):
        missing_files.append(f"Acceleration: {REF_ACCEL_DATA_PATH}")
    
    clear_first = False
    if missing_files:
        print("\nWARNING: The following files were not found:")
        for f in missing_files:
            print(f"  - {f}")
        print("\nPlease check the file paths in config.py or update them at the top of this script.")
        response = input("\nProceed anyway? (yes/no): ").strip().lower()
    else:
        # Confirm before proceeding
        print("\nOptions:")
        print("  1. Clear existing reference data and insert new data")
        print("  2. Update/insert reference data (keep existing if not in new files)")
        clear_choice = input("\nClear existing data first? (yes/no): ").strip().lower()
        clear_first = clear_choice in ['yes', 'y']
        response = input("\nProceed with updating reference data? (yes/no): ").strip().lower()
    
    if response not in ['yes', 'y']:
        print("Update cancelled.")
        return
    
    # Clear reference data if requested
    if clear_first:
        print("\nClearing existing reference data...")
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("DELETE FROM reference_data")
        conn.commit()
        deleted_count = c.rowcount
        conn.close()
        print(f"Cleared {deleted_count} reference record(s).")
    
    try:
        # Ingest reference data
        print("\nIngesting reference data...")
        ingest_reference_data()
        
        # Show updated state
        print("\nVerifying database state...")
        final_count = show_current_reference_data()
        
        print(f"\n{'='*80}")
        print(f"Update complete!")
        if clear_first:
            print(f"  Cleared: {initial_count} reference pitch(es)")
            print(f"  Inserted: {final_count} reference pitch(es)")
        else:
            print(f"  Before: {initial_count} reference pitch(es)")
            print(f"  After:  {final_count} reference pitch(es)")
        print(f"{'='*80}")
        
    except FileNotFoundError as e:
        print(f"\nERROR: Could not find required file: {e}")
        print("Please check that the file paths in config.py are correct.")
        import traceback
        traceback.print_exc()
    except Exception as e:
        print(f"\nERROR: An error occurred while updating reference data: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    update_reference_data()

