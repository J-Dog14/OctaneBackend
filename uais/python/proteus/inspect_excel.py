"""Quick script to inspect the Proteus Excel file structure."""
import pandas as pd
from pathlib import Path

excel_file = Path(__file__).parent / "proteus-export-12-09-2025_06-08PM.xlsx"

print("=" * 80)
print("Reading Proteus Excel file...")
print("=" * 80)

df = pd.read_excel(excel_file, nrows=5)

print(f"\nTotal columns: {len(df.columns)}")
print(f"Total rows (sample): {len(df)}")

print("\n" + "=" * 80)
print("All Columns:")
print("=" * 80)
for i, col in enumerate(df.columns, 1):
    print(f"{i:3d}. {col}")

print("\n" + "=" * 80)
print("Sample Data (first 3 rows):")
print("=" * 80)
print(df.head(3).to_string())

print("\n" + "=" * 80)
print("Data Types:")
print("=" * 80)
print(df.dtypes)

print("\n" + "=" * 80)
print("Sport values (if Sport column exists):")
print("=" * 80)
if 'Sport' in df.columns:
    print(df['Sport'].value_counts())
else:
    print("Sport column not found")
