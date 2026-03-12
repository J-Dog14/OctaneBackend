"""
Diagnostic script to compare exercises in Proteus Excel files vs database.
This will help identify why some exercises aren't making it into the database.
"""
import pandas as pd
from pathlib import Path
import sys

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from common.config import get_warehouse_engine
from sqlalchemy import text

def get_exercises_from_excel(file_path: Path) -> set:
    """Extract unique exercise names from an Excel file."""
    try:
        df = pd.read_excel(file_path)
        
        if df.empty:
            print(f"  WARNING: {file_path.name} is empty")
            return set()
        
        # Look for exercise name column (could be 'Movement', 'Exercise Name', 'exercise name', etc.)
        exercise_col = None
        for col in df.columns:
            col_lower = str(col).lower()
            if 'exercise' in col_lower and 'name' in col_lower:
                exercise_col = col
                break
            elif col_lower == 'movement':
                exercise_col = col
                break
        
        if exercise_col:
            # Filter for baseball/softball if Sport column exists
            sport_col = None
            for col in df.columns:
                if str(col).lower() == 'sport':
                    sport_col = col
                    break
            
            if sport_col:
                df_filtered = df[df[sport_col].astype(str).str.lower().isin(['baseball', 'softball'])]
                exercises = set(df_filtered[exercise_col].dropna().astype(str).unique())
            else:
                exercises = set(df[exercise_col].dropna().astype(str).unique())
            
            return exercises
        else:
            print(f"  WARNING: Could not find exercise name column in {file_path.name}")
            print(f"  Available columns: {list(df.columns)[:20]}")
            return set()
    except Exception as e:
        print(f"  ERROR reading {file_path.name}: {e}")
        import traceback
        traceback.print_exc()
        return set()

def get_exercises_from_database() -> set:
    """Get unique exercise names from the database."""
    try:
        engine = get_warehouse_engine()
        with engine.connect() as conn:
            # Try different possible column names
            query = text("""
                SELECT DISTINCT 
                    COALESCE(movement, 'NULL') as exercise_name
                FROM public.f_proteus
                WHERE movement IS NOT NULL
                ORDER BY exercise_name
            """)
            result = conn.execute(query)
            exercises = {row[0] for row in result if row[0] != 'NULL'}
            return exercises
    except Exception as e:
        print(f"ERROR querying database: {e}")
        return set()

def main():
    print("=" * 80)
    print("Proteus Exercise Diagnostic Tool")
    print("=" * 80)
    
    # Get exercises from database
    print("\n1. Getting exercises from database...")
    db_exercises = get_exercises_from_database()
    print(f"   Found {len(db_exercises)} unique exercises in database:")
    for ex in sorted(db_exercises):
        print(f"     - {ex}")
    
    # Get exercises from Excel files
    print("\n2. Getting exercises from Excel files...")
    inbox_dir = Path(__file__).parent.parent.parent / "data" / "proteus" / "inbox"
    
    if not inbox_dir.exists():
        print(f"   ERROR: Inbox directory not found: {inbox_dir}")
        return
    
    excel_files = list(inbox_dir.glob("*.xlsx")) + list(inbox_dir.glob("*.xls"))
    
    if not excel_files:
        print(f"   No Excel files found in {inbox_dir}")
        return
    
    print(f"   Found {len(excel_files)} Excel file(s)")
    
    all_excel_exercises = set()
    for excel_file in excel_files:
        print(f"\n   Processing: {excel_file.name}")
        exercises = get_exercises_from_excel(excel_file)
        all_excel_exercises.update(exercises)
        print(f"     Found {len(exercises)} unique exercises:")
        for ex in sorted(exercises):
            print(f"       - {ex}")
    
    # Compare
    print("\n" + "=" * 80)
    print("COMPARISON RESULTS")
    print("=" * 80)
    
    print(f"\nTotal unique exercises in Excel files: {len(all_excel_exercises)}")
    print(f"Total unique exercises in database: {len(db_exercises)}")
    
    missing_in_db = all_excel_exercises - db_exercises
    extra_in_db = db_exercises - all_excel_exercises
    
    if missing_in_db:
        print(f"\n[!] {len(missing_in_db)} exercises in Excel files but NOT in database:")
        for ex in sorted(missing_in_db):
            print(f"     - {ex}")
    else:
        print("\n[OK] All exercises from Excel files are in the database")
    
    if extra_in_db:
        print(f"\n[!] {len(extra_in_db)} exercises in database but NOT in current Excel files:")
        for ex in sorted(extra_in_db):
            print(f"     - {ex}")
    
    # Check for specific exercises mentioned by user
    print("\n" + "=" * 80)
    print("USER-MENTIONED EXERCISES CHECK")
    print("=" * 80)
    
    user_exercises = [
        "shoulder abduction", "scaption up", "external rotation 90", 
        "external rotation 0", "pnf d2 flexion", "pnf d2 extension", 
        "straight arm pulldown", "shot put", "straight arm trunk rotation", "vertical"
    ]
    
    for ex in user_exercises:
        in_excel = any(ex.lower() in e.lower() for e in all_excel_exercises)
        in_db = any(ex.lower() in e.lower() for e in db_exercises)
        
        status = []
        if in_excel:
            status.append("Excel")
        if in_db:
            status.append("DB")
        
        status_str = "[OK]" if status else "[X]"
        print(f"{status_str} {ex:35s} - {' | '.join(status) if status else 'NOT FOUND'}")

if __name__ == "__main__":
    main()
