#!/usr/bin/env python3
"""
Diagnostic script to inspect Athletic Screen SQLite database
Shows table structure, column names, and sample data to help debug migration issues
"""

import sqlite3
import json
from pathlib import Path
from collections import defaultdict

# Path to SQLite database
db_path = Path(__file__).parent.parent / "athleticScreen" / "Athletic_Screen_UNIFIED_v2.db"

if not db_path.exists():
    print(f"ERROR: Database not found at: {db_path}")
    exit(1)

print("=" * 80)
print("ATHLETIC SCREEN DATABASE DIAGNOSTIC")
print("=" * 80)
print(f"\nDatabase: {db_path}")
print()

conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

# Get all tables
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = [row[0] for row in cursor.fetchall()]

print(f"Found {len(tables)} tables: {', '.join(tables)}")
print()

# Columns we're looking for in R script
expected_columns = {
    "CMJ": ["Trial_Name", "JH_in", "PP_Forceplate", "Peak_Power_W", "Time_to_Peak_s", "RPD_Max_W_per_s", 
            "Peak_Power", "Force_at_PP", "Vel_at_PP", "PP_W_per_kg"],
    "DJ": ["Trial_Name", "JH_in", "PP_Forceplate", "Peak_Power_W", "CT", "RSI", 
           "Peak_Power", "Force_at_PP", "Vel_at_PP", "PP_W_per_kg"],
    "SLV": ["Trial_Name", "Side", "JH_in", "PP_Forceplate", "Peak_Power_W", "Time_to_Peak_s", "RPD_Max_W_per_s",
            "Force_at_PP", "Vel_at_PP", "PP_W_per_kg"],
    "NMT": ["Trial_Name", "Num_Taps_10s", "Num_Taps_20s", "Num_Taps_30s", "Num_Taps", "Demographic"],
    "PPU": ["Trial_Name", "JH_in", "PP_Forceplate", "Peak_Power_W", "Time_to_Peak_s", "RPD_Max_W_per_s",
            "Peak_Power", "Force_at_PP", "Vel_at_PP", "PP_W_per_kg"],
}

# Common columns for all tables
common_expected = ["Name", "Session_Date"]

for table_name in tables:
    if table_name not in expected_columns:
        continue
        
    print("=" * 80)
    print(f"TABLE: {table_name}")
    print("=" * 80)
    
    # Get column info
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = cursor.fetchall()
    
    # Get actual column names
    actual_columns = [col[1] for col in columns]
    
    print(f"\nTotal columns: {len(actual_columns)}")
    print(f"Total rows: ", end="")
    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
    row_count = cursor.fetchone()[0]
    print(row_count)
    
    print("\nACTUAL COLUMNS IN DATABASE:")
    for col in actual_columns:
        print(f"  - {col}")
    
    # Check for expected columns
    print("\nCOLUMN MATCHING:")
    all_expected = common_expected + expected_columns.get(table_name, [])
    missing = []
    found = []
    
    for expected_col in all_expected:
        # Check exact match
        if expected_col in actual_columns:
            found.append(expected_col)
            print(f"  ✓ FOUND (exact): {expected_col}")
        else:
            # Check case-insensitive
            found_ci = None
            for actual_col in actual_columns:
                if actual_col.lower() == expected_col.lower():
                    found_ci = actual_col
                    break
            
            if found_ci:
                print(f"  ⚠ FOUND (case diff): {expected_col} -> {found_ci}")
                found.append(expected_col)
            else:
                # Check partial match
                found_partial = None
                for actual_col in actual_columns:
                    if expected_col.lower().replace("_", "") in actual_col.lower().replace("_", ""):
                        found_partial = actual_col
                        break
                
                if found_partial:
                    print(f"  ? PARTIAL MATCH: {expected_col} -> {found_partial}")
                else:
                    print(f"  ✗ NOT FOUND: {expected_col}")
                    missing.append(expected_col)
    
    # Show sample data
    if row_count > 0:
        print("\nSAMPLE DATA (first row):")
        cursor.execute(f"SELECT * FROM {table_name} LIMIT 1")
        sample_row = cursor.fetchone()
        
        for i, col_name in enumerate(actual_columns):
            val = sample_row[i] if i < len(sample_row) else None
            if val is None:
                val_str = "NULL"
            elif isinstance(val, str) and len(val) > 50:
                val_str = val[:50] + "..."
            else:
                val_str = str(val)
            print(f"  {col_name:30} = {val_str}")
    
    # Check for NULL values in key columns
    if row_count > 0:
        print("\nNULL VALUE CHECK:")
        for col in all_expected:
            if col in actual_columns:
                cursor.execute(f"SELECT COUNT(*) FROM {table_name} WHERE {col} IS NULL")
                null_count = cursor.fetchone()[0]
                if null_count > 0:
                    pct = (null_count / row_count) * 100
                    print(f"  {col:30} : {null_count:5} NULL ({pct:.1f}%)")
                else:
                    print(f"  {col:30} : All values present")
    
    print()

# Also check for any tables we might be missing
print("=" * 80)
print("ALL TABLES SUMMARY")
print("=" * 80)
for table_name in tables:
    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
    count = cursor.fetchone()[0]
    cursor.execute(f"PRAGMA table_info({table_name})")
    cols = [c[1] for c in cursor.fetchall()]
    print(f"{table_name:20} : {count:6} rows, {len(cols):3} columns")
    if table_name not in expected_columns and table_name != "sqlite_sequence":
        print(f"  (Not in expected tables list)")

conn.close()

print("\n" + "=" * 80)
print("DIAGNOSTIC COMPLETE")
print("=" * 80)

