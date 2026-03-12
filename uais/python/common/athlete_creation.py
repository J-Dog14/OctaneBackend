"""
Interactive athlete creation utilities for UAIS.
Handles prompting for demographic info when new athletes are detected.
"""
import uuid
import pandas as pd
from sqlalchemy import Engine
from typing import Optional, Dict, List
from datetime import datetime
from common.config import get_app_engine
from common.db_utils import read_table_as_df, write_df, table_exists


def prompt_for_athlete_info(source_athlete_id: str, source_system: str) -> Optional[Dict]:
    """
    Interactively prompt user for athlete demographic information.
    
    Args:
        source_athlete_id: The source athlete ID that was not found.
        source_system: The source system name (e.g., 'pitching', 'hitting', 'pro_sup').
    
    Returns:
        Dictionary with athlete information, or None if user cancels.
    """
    print("\n" + "=" * 60)
    print(f"NEW ATHLETE DETECTED")
    print("=" * 60)
    print(f"Source System: {source_system}")
    print(f"Source Athlete ID: {source_athlete_id}")
    print("\nPlease provide demographic information for this athlete.")
    print("(Press Enter to skip optional fields, type 'cancel' to skip this athlete)\n")
    
    athlete_info = {
        'source_athlete_id': source_athlete_id,
        'source_system': source_system
    }
    
    # Required fields
    name = input("Full Name (required): ").strip()
    if name.lower() == 'cancel' or not name:
        print("Skipping athlete creation.")
        return None
    athlete_info['name'] = name
    
    # Optional demographic fields
    dob = input("Date of Birth (YYYY-MM-DD, optional): ").strip()
    if dob:
        try:
            datetime.strptime(dob, '%Y-%m-%d')
            athlete_info['date_of_birth'] = dob
        except ValueError:
            print("Warning: Invalid date format. Skipping DOB.")
    
    gender = input("Gender (M/F/Other, optional): ").strip().upper()
    if gender:
        athlete_info['gender'] = gender
    
    height_input = input("Height (inches or cm, optional): ").strip()
    if height_input:
        try:
            athlete_info['height'] = float(height_input)
        except ValueError:
            print("Warning: Invalid height. Skipping.")
    
    weight_input = input("Weight (lbs or kg, optional): ").strip()
    if weight_input:
        try:
            athlete_info['weight'] = float(weight_input)
        except ValueError:
            print("Warning: Invalid weight. Skipping.")
    
    email = input("Email (optional): ").strip()
    if email:
        athlete_info['email'] = email
    
    phone = input("Phone (optional): ").strip()
    if phone:
        athlete_info['phone'] = phone
    
    notes = input("Notes (optional): ").strip()
    if notes:
        athlete_info['notes'] = notes
    
    print(f"\nAthlete information collected for: {name}")
    confirm = input("Create this athlete? (y/n): ").strip().lower()
    
    if confirm != 'y':
        print("Cancelled athlete creation.")
        return None
    
    return athlete_info


def create_athlete_in_app_db(athlete_info: Dict, engine: Optional[Engine] = None) -> str:
    """
    Create a new athlete in the app database and return athlete_uuid.
    
    Args:
        athlete_info: Dictionary with athlete information.
        engine: Optional engine (defaults to app engine).
    
    Returns:
        athlete_uuid string.
    """
    if engine is None:
        engine = get_app_engine(read_only=False)
    
    # Generate UUID
    athlete_uuid = str(uuid.uuid4())
    
    # Prepare athlete record
    athlete_record = {
        'athlete_uuid': athlete_uuid,
        'name': athlete_info.get('name'),
        'date_of_birth': athlete_info.get('date_of_birth'),
        'gender': athlete_info.get('gender'),
        'height': athlete_info.get('height'),
        'weight': athlete_info.get('weight'),
        'email': athlete_info.get('email'),
        'phone': athlete_info.get('phone'),
        'notes': athlete_info.get('notes'),
        'created_at': datetime.now(),
        'updated_at': datetime.now()
    }
    
    # Remove None values
    athlete_record = {k: v for k, v in athlete_record.items() if v is not None}
    
    # Check if athletes table exists, create if not
    if not table_exists(engine, 'athletes'):
        # Create athletes table with standard schema
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS athletes (
                    athlete_uuid TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    date_of_birth TEXT,
                    gender TEXT,
                    height REAL,
                    weight REAL,
                    email TEXT,
                    phone TEXT,
                    notes TEXT,
                    created_at TIMESTAMP,
                    updated_at TIMESTAMP
                )
            """))
            conn.commit()
    
    # Check for duplicate UUID (shouldn't happen, but be safe)
    existing = read_table_as_df(engine, 'athletes')
    if not existing.empty and athlete_uuid in existing['athlete_uuid'].values:
        print(f"Warning: Athlete UUID {athlete_uuid} already exists. Skipping creation.")
        return athlete_uuid
    
    # Insert athlete
    athlete_df = pd.DataFrame([athlete_record])
    write_df(athlete_df, 'athletes', engine, if_exists='append', index=False)
    
    print(f"Created athlete in app database: {athlete_info.get('name')} ({athlete_uuid})")
    
    return athlete_uuid


def create_source_mapping(source_athlete_id: str, athlete_uuid: str, 
                          source_system: str, engine: Optional[Engine] = None):
    """
    Create or update source_athlete_map entry.
    
    Args:
        source_athlete_id: Source athlete ID.
        athlete_uuid: Athlete UUID.
        source_system: Source system name.
        engine: Optional engine (defaults to app engine).
    """
    if engine is None:
        engine = get_app_engine(read_only=False)
    
    # Check if source_athlete_map table exists, create if not
    if not table_exists(engine, 'source_athlete_map'):
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS source_athlete_map (
                    source_system TEXT NOT NULL,
                    source_athlete_id TEXT NOT NULL,
                    athlete_uuid TEXT NOT NULL,
                    created_at TIMESTAMP,
                    PRIMARY KEY (source_system, source_athlete_id),
                    FOREIGN KEY (athlete_uuid) REFERENCES athletes(athlete_uuid)
                )
            """))
            conn.commit()
    
    # Check if mapping already exists
    try:
        existing_map = read_table_as_df(engine, 'source_athlete_map')
        if not existing_map.empty:
            existing = existing_map[
                (existing_map['source_system'] == source_system) &
                (existing_map['source_athlete_id'] == str(source_athlete_id))
            ]
            if not existing.empty:
                print(f"Mapping already exists: {source_system}/{source_athlete_id}")
                return
    except Exception:
        pass  # Table might not exist yet, will be created above
    
    # Insert mapping
    mapping_df = pd.DataFrame([{
        'source_system': source_system,
        'source_athlete_id': str(source_athlete_id),
        'athlete_uuid': athlete_uuid,
        'created_at': datetime.now()
    }])
    
    # Use append (duplicates handled by PRIMARY KEY constraint)
    write_df(mapping_df, 'source_athlete_map', engine, if_exists='append', index=False)
    
    print(f"Created mapping: {source_system}/{source_athlete_id} -> {athlete_uuid}")


def handle_unmapped_athletes_interactive(df: pd.DataFrame, source_system: str,
                                        source_id_column: str = 'source_athlete_id',
                                        engine: Optional[Engine] = None,
                                        interactive: bool = True) -> pd.DataFrame:
    """
    Handle unmapped athletes by interactively creating them in the app database.
    
    Args:
        df: DataFrame with unmapped athletes (athlete_uuid is None).
        source_system: Source system name.
        source_id_column: Column name containing source athlete IDs.
        engine: Optional engine (defaults to app engine).
        interactive: If True, prompt for info. If False, skip silently.
    
    Returns:
        DataFrame with athlete_uuid filled in for newly created athletes.
    """
    if df.empty or source_id_column not in df.columns:
        return df
    
    unmapped = df[df['athlete_uuid'].isna() & df[source_id_column].notna()]
    if unmapped.empty:
        return df
    
    unique_unmapped = unmapped[source_id_column].unique()
    
    if not interactive:
        print(f"Found {len(unique_unmapped)} unmapped athletes. Run with interactive=True to create them.")
        return df
    
    if engine is None:
        engine = get_app_engine(read_only=False)
    
    # Process each unmapped athlete
    created_mappings = {}
    
    for source_id in unique_unmapped:
        if source_id in created_mappings:
            # Already created in this session
            continue
        
        # Prompt for athlete info
        athlete_info = prompt_for_athlete_info(str(source_id), source_system)
        
        if athlete_info is None:
            print(f"Skipping athlete: {source_id}")
            continue
        
        # Create athlete in app database
        try:
            athlete_uuid = create_athlete_in_app_db(athlete_info, engine)
            
            # Create source mapping
            create_source_mapping(source_id, athlete_uuid, source_system, engine)
            
            # Store mapping for this session
            created_mappings[source_id] = athlete_uuid
            
        except Exception as e:
            print(f"Error creating athlete {source_id}: {e}")
            continue
    
    # Update DataFrame with new UUIDs
    if created_mappings:
        df = df.copy()
        for source_id, athlete_uuid in created_mappings.items():
            mask = (df[source_id_column] == source_id) & (df['athlete_uuid'].isna())
            df.loc[mask, 'athlete_uuid'] = athlete_uuid
    
    return df

