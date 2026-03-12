"""
Script to manually archive pitch_data and update athletes summary.

This is useful if you need to populate the archive and athletes tables
with existing pitch_data without running the full main.py pipeline.
"""

from database import archive_pitch_data
from athletes import update_athletes_summary
import sqlite3
from config import DB_PATH


def manual_archive_and_update():
    """Archive pitch_data and update athletes summary."""
    print("=" * 80)
    print("MANUAL ARCHIVE AND ATHLETES UPDATE")
    print("=" * 80)
    
    # Check current state
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute("SELECT COUNT(*) FROM pitch_data")
    pitch_count = c.fetchone()[0]
    
    c.execute("SELECT COUNT(*) FROM pitch_data_archive")
    archive_count_before = c.fetchone()[0]
    
    c.execute("SELECT COUNT(*) FROM athletes")
    athletes_count_before = c.fetchone()[0]
    
    conn.close()
    
    print(f"\nCurrent state:")
    print(f"  pitch_data: {pitch_count} record(s)")
    print(f"  pitch_data_archive: {archive_count_before} record(s)")
    print(f"  athletes: {athletes_count_before} record(s)")
    
    if pitch_count == 0:
        print("\nNo pitch_data to archive. Exiting.")
        return
    
    print(f"\nArchiving {pitch_count} record(s) from pitch_data...")
    archive_pitch_data()
    
    print("\nUpdating athletes summary...")
    update_athletes_summary()
    
    # Check final state
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute("SELECT COUNT(*) FROM pitch_data_archive")
    archive_count_after = c.fetchone()[0]
    
    c.execute("SELECT COUNT(*) FROM athletes")
    athletes_count_after = c.fetchone()[0]
    
    conn.close()
    
    print(f"\nFinal state:")
    print(f"  pitch_data_archive: {archive_count_after} record(s) (+{archive_count_after - archive_count_before})")
    print(f"  athletes: {athletes_count_after} record(s) (+{athletes_count_after - athletes_count_before})")
    
    print("\n" + "=" * 80)
    print("Archive and update complete!")
    print("=" * 80)


if __name__ == "__main__":
    manual_archive_and_update()

