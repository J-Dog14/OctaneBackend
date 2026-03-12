"""Read Excel file and show structure."""
import pandas as pd
import sys
from pathlib import Path

excel_file = Path(__file__).parent / "proteus-export-12-09-2025_06-08PM.xlsx"

try:
    # Read just header
    df = pd.read_excel(excel_file, nrows=0)
    cols = list(df.columns)
    
    print(f"Total columns: {len(cols)}")
    print("\nAll columns:")
    for i, col in enumerate(cols, 1):
        print(f"{i:3d}. {col}")
    
    # Read a few rows to see data
    df_sample = pd.read_excel(excel_file, nrows=3)
    print("\n\nSample data (first 3 rows):")
    print(df_sample.to_string())
    
    # Check Sport column
    if 'Sport' in df_sample.columns:
        print("\n\nSport values:")
        print(df_sample['Sport'].value_counts())
    
    # Save columns to file
    with open(Path(__file__).parent / "excel_columns.txt", "w") as f:
        f.write("\n".join(cols))
    print(f"\n\nColumns saved to excel_columns.txt")
    
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc()
