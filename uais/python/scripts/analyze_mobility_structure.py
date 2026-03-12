#!/usr/bin/env python3
"""
Analyze Mobility Assessment Excel Structure in Detail
"""

import pandas as pd
from pathlib import Path

excel_path = Path(__file__).parent.parent / "mobility" / "Jordan Driver Mobility Assessment.xlsx"

print("=" * 80)
print("DETAILED MOBILITY ASSESSMENT STRUCTURE")
print("=" * 80)
print()

# Read main assessment sheet (62625)
print("Sheet: 62625 (Main Assessment)")
print("-" * 80)
df = pd.read_excel(excel_path, sheet_name='62625', header=None)

# Find where actual data starts
print("First 30 rows:")
for i in range(min(30, len(df))):
    row_data = [str(x) if pd.notna(x) else 'NaN' for x in df.iloc[i]]
    print(f"Row {i}: {row_data[:5]}")  # Show first 5 columns

print("\n" + "=" * 80)
print("Sheet: RAST")
print("-" * 80)
df_rast = pd.read_excel(excel_path, sheet_name='RAST', header=None)
print("RAST data:")
for i in range(min(20, len(df_rast))):
    row_data = [str(x) if pd.notna(x) else 'NaN' for x in df_rast.iloc[i]]
    print(f"Row {i}: {row_data}")

print("\n" + "=" * 80)
print("Sheet: Timeline")
print("-" * 80)
df_timeline = pd.read_excel(excel_path, sheet_name='Timeline', header=None)
print("Timeline data (first 15 rows):")
for i in range(min(15, len(df_timeline))):
    row_data = [str(x) if pd.notna(x) else 'NaN' for x in df_timeline.iloc[i]]
    print(f"Row {i}: {row_data}")

