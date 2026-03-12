#!/usr/bin/env python3
"""
Inspect Proteus Excel File Structure
"""

import pandas as pd
import json
from pathlib import Path

excel_path = Path(__file__).parent.parent / "proteus" / "proteus-export-08-20-2025_09-54AM.xlsx"

print("=" * 80)
print("PROTEUS EXCEL FILE STRUCTURE")
print("=" * 80)
print()

# Read the Excel file
try:
    # Try to read all sheets
    excel_file = pd.ExcelFile(str(excel_path))
    sheet_names = excel_file.sheet_names
    
    print(f"Found {len(sheet_names)} sheet(s):")
    for sheet in sheet_names:
        print(f"  - {sheet}")
    print()
    
    db_structure = {}
    
    # Process each sheet
    for sheet_name in sheet_names:
        print(f"Sheet: {sheet_name}")
        print("-" * 80)
        
        df = pd.read_excel(excel_path, sheet_name=sheet_name)
        
        print(f"  Rows: {len(df)}")
        print(f"  Columns: {len(df.columns)}")
        print()
        print("  Column Details:")
        
        sheet_info = []
        for col in df.columns:
            # Get sample data type
            sample_value = df[col].dropna().iloc[0] if not df[col].dropna().empty else None
            dtype = str(df[col].dtype)
            
            # Determine Prisma type
            if dtype in ['int64', 'Int64']:
                prisma_type = "Int"
            elif dtype in ['float64', 'Float64']:
                prisma_type = "Decimal"
            elif dtype == 'datetime64[ns]':
                prisma_type = "DateTime"
            elif dtype == 'bool':
                prisma_type = "Boolean"
            else:
                prisma_type = "String"
            
            print(f"    {col:40} {dtype:15} -> {prisma_type}")
            
            sheet_info.append({
                "name": col,
                "pandas_dtype": dtype,
                "prisma_type": prisma_type,
                "nullable": True  # Most Excel columns are nullable
            })
        
        # Show first few rows as sample
        print()
        print("  Sample Data (first 3 rows):")
        print(df.head(3).to_string())
        print()
        
        db_structure[sheet_name] = sheet_info
    
    # Save structure to JSON for reference
    output_path = Path(__file__).parent.parent.parent / "docs" / "proteus_excel_structure.json"
    output_path.parent.mkdir(exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(db_structure, f, indent=2)
    
    print("=" * 80)
    print(f"Structure saved to: {output_path}")
    print("=" * 80)
    
except Exception as e:
    print(f"Error reading Excel file: {e}")
    import traceback
    traceback.print_exc()

