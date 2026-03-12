"""
Quick test script to verify reference data update is working.
"""

import sqlite3
from config import DB_PATH

# Check before
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("SELECT COUNT(*) FROM reference_data")
before_count = c.fetchone()[0]
print(f"Before: {before_count} reference records")

# Try a simple update
c.execute("SELECT filename FROM reference_data LIMIT 1")
result = c.fetchone()
if result:
    test_filename = result[0]
    print(f"Test filename: {test_filename}")
    
    # Try updating a field
    c.execute("""
        UPDATE reference_data 
        SET participant_name = participant_name || ' [TEST]'
        WHERE filename = ?
    """, (test_filename,))
    conn.commit()
    
    # Check if it updated
    c.execute("SELECT participant_name FROM reference_data WHERE filename = ?", (test_filename,))
    updated_name = c.fetchone()[0]
    print(f"Updated name: {updated_name}")
    
    # Revert it
    c.execute("""
        UPDATE reference_data 
        SET participant_name = REPLACE(participant_name, ' [TEST]', '')
        WHERE filename = ?
    """, (test_filename,))
    conn.commit()
    print("Reverted test change")

c.execute("SELECT COUNT(*) FROM reference_data")
after_count = c.fetchone()[0]
print(f"After: {after_count} reference records")

conn.close()

print("\nDatabase is writable. If updates aren't showing, check:")
print("1. Are you looking at the correct database file?")
print(f"   Database path: {DB_PATH}")
print("2. Is your database viewer refreshing?")
print("3. Are there any errors in the updateReferenceData.py output?")

