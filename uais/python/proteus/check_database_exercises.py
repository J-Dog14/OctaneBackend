"""
Check what exercise data is actually in the database and how it's stored.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from common.config import get_warehouse_engine
from sqlalchemy import text
import pandas as pd

def main():
    engine = get_warehouse_engine()
    
    print("=" * 80)
    print("Checking Proteus Database Structure")
    print("=" * 80)
    
    with engine.connect() as conn:
        # Check what columns exist
        query = text("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'f_proteus'
            AND (column_name LIKE '%exercise%' OR column_name LIKE '%movement%')
            ORDER BY column_name
        """)
        result = conn.execute(query)
        print("\nExercise/Movement related columns:")
        for row in result:
            print(f"  - {row[0]}: {row[1]}")
        
        # Check distinct values in movement column
        print("\n" + "=" * 80)
        print("Distinct values in 'movement' column:")
        print("=" * 80)
        query = text("""
            SELECT DISTINCT movement, COUNT(*) as count
            FROM public.f_proteus
            WHERE movement IS NOT NULL
            GROUP BY movement
            ORDER BY movement
        """)
        result = conn.execute(query)
        for row in result:
            print(f"  - {row[0]}: {row[1]} rows")
        
        # Check if there's an exercise_name column
        query = text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'f_proteus'
            AND column_name LIKE '%exercise%name%'
        """)
        result = conn.execute(query)
        exercise_name_cols = [row[0] for row in result]
        
        if exercise_name_cols:
            print("\n" + "=" * 80)
            print(f"Distinct values in '{exercise_name_cols[0]}' column:")
            print("=" * 80)
            query = text(f"""
                SELECT DISTINCT {exercise_name_cols[0]}, COUNT(*) as count
                FROM public.f_proteus
                WHERE {exercise_name_cols[0]} IS NOT NULL
                GROUP BY {exercise_name_cols[0]}
                ORDER BY {exercise_name_cols[0]}
            """)
            result = conn.execute(query)
            for row in result:
                print(f"  - {row[0]}: {row[1]} rows")
        
        # Sample a few rows to see the structure
        print("\n" + "=" * 80)
        print("Sample rows (showing movement and related columns):")
        print("=" * 80)
        query = text("""
            SELECT movement, session_date, athlete_uuid
            FROM public.f_proteus
            WHERE movement IS NOT NULL
            LIMIT 10
        """)
        df = pd.read_sql(query, conn)
        print(df.to_string())

if __name__ == "__main__":
    main()
