#!/usr/bin/env python3
"""
Inspect Readiness Screen Database Structure
"""

import sqlite3
import json
from pathlib import Path

db_path = Path(__file__).parent.parent / "readinessScreen" / "Readiness_Screen_Data_v2.db"

conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

# Get all tables
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cursor.fetchall()

print("=" * 80)
print("READINESS SCREEN DATABASE STRUCTURE")
print("=" * 80)
print()

db_structure = {}

for table_name, in tables:
    print(f"Table: {table_name}")
    print("-" * 80)
    
    # Get column info
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = cursor.fetchall()
    
    table_info = []
    for col in columns:
        col_id, name, col_type, not_null, default_val, pk = col
        nullable = "NULL" if not not_null else "NOT NULL"
        pk_str = "PRIMARY KEY" if pk else ""
        default_str = f"DEFAULT {default_val}" if default_val else ""
        
        print(f"  {name:30} {col_type:15} {nullable:10} {pk_str:12} {default_str}")
        
        table_info.append({
            "name": name,
            "type": col_type,
            "nullable": not not_null,
            "primary_key": bool(pk),
            "default": default_val
        })
    
    # Get sample data count
    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
    count = cursor.fetchone()[0]
    print(f"  Rows: {count}")
    
    db_structure[table_name] = table_info
    print()

# Save structure to JSON for reference
output_path = Path(__file__).parent.parent.parent / "docs" / "readiness_screen_db_structure.json"
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w') as f:
    json.dump(db_structure, f, indent=2)

print("=" * 80)
print(f"Structure saved to: {output_path}")
print("=" * 80)

conn.close()

