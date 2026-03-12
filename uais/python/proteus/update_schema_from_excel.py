"""Script to read Excel file and generate Prisma schema updates."""
import pandas as pd
import re
from pathlib import Path

excel_file = Path(__file__).parent / "proteus-export-12-09-2025_06-08PM.xlsx"

print("Reading Excel file...")
df = pd.read_excel(excel_file, nrows=1)

# Get all columns
all_columns = list(df.columns)
print(f"\nTotal columns: {len(all_columns)}")

# Columns to omit
omit_columns = ['Session Name', 'ProteusAttachment', 'User ID', 'Sport']
columns_to_keep = [col for col in all_columns if col not in omit_columns]

# Priority columns (at the beginning)
priority_cols = ['User Name', 'Birth Date', 'Weight', 'Height', 'Sex', 'Position', 'Movement']
other_cols = [col for col in columns_to_keep if col not in priority_cols]

# Build column order
ordered_cols = []
for col in priority_cols:
    if col in columns_to_keep:
        ordered_cols.append(col)

for col in other_cols:
    if col not in ordered_cols:
        ordered_cols.append(col)

print("\n" + "=" * 80)
print("COLUMN ORDER (for Prisma schema):")
print("=" * 80)
print("\nPriority columns (first):")
for col in priority_cols:
    if col in ordered_cols:
        print(f"  ✓ {col}")

print("\nOther columns:")
for col in ordered_cols:
    if col not in priority_cols:
        print(f"  - {col}")

print("\n" + "=" * 80)
print("PRISMA SCHEMA FIELDS:")
print("=" * 80)

def sanitize_column_name(name):
    """Convert column name to Prisma field name."""
    # Replace spaces with underscores, lowercase
    name = str(name).strip()
    name = re.sub(r'[^a-zA-Z0-9_]', '_', name)
    name = re.sub(r'_+', '_', name)
    name = name.lower()
    # Remove leading/trailing underscores
    name = name.strip('_')
    return name

def infer_type(col_name, sample_data=None):
    """Infer Prisma type from column name and sample data."""
    col_lower = col_name.lower()
    
    # Check sample data if available
    if sample_data is not None:
        if pd.api.types.is_integer_dtype(sample_data):
            return 'Int?'
        elif pd.api.types.is_float_dtype(sample_data):
            return 'Decimal?'
        elif pd.api.types.is_bool_dtype(sample_data):
            return 'Boolean?'
        elif pd.api.types.is_datetime64_any_dtype(sample_data):
            return 'DateTime? @db.Date'
    
    # Infer from column name
    if any(word in col_lower for word in ['id', 'number', 'num', 'count', 'reps', 'set']):
        return 'Int?'
    elif any(word in col_lower for word in ['date', 'time', 'created', 'updated']):
        return 'DateTime? @db.Date'
    elif any(word in col_lower for word in ['weight', 'height', 'power', 'force', 'velocity', 'acceleration', 'braking', 'deceleration', 'explosiveness', 'consistency', 'range', 'rom']):
        return 'Decimal?'
    elif any(word in col_lower for word in ['record', 'is_', 'has_']):
        return 'Boolean?'
    else:
        return 'String? @db.Text'

# Read a sample row to infer types
df_sample = pd.read_excel(excel_file, nrows=3)

print("\n// Priority columns (at beginning)")
for col in priority_cols:
    if col in ordered_cols:
        field_name = sanitize_column_name(col)
        prisma_type = infer_type(col, df_sample[col] if col in df_sample.columns else None)
        print(f"  {field_name:30s} {prisma_type:25s} @map(\"{col.replace(' ', '_').lower()}\")")

print("\n// Other columns")
for col in ordered_cols:
    if col not in priority_cols:
        field_name = sanitize_column_name(col)
        prisma_type = infer_type(col, df_sample[col] if col in df_sample.columns else None)
        print(f"  {field_name:30s} {prisma_type:25s} @map(\"{col.replace(' ', '_').lower()}\")")

print("\n" + "=" * 80)
print("All columns saved to excel_columns_ordered.txt")
print("=" * 80)

with open(Path(__file__).parent / "excel_columns_ordered.txt", "w") as f:
    f.write("Ordered columns:\n")
    for i, col in enumerate(ordered_cols, 1):
        f.write(f"{i:3d}. {col}\n")
