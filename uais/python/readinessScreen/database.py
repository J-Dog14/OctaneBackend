"""
Database operations for Readiness Screen.
Handles database setup, schema creation, and table operations.
"""
import os
import sqlite3
from typing import Optional


# Table schemas for Readiness Screen
TABLE_SCHEMAS = {
    'Participant': """
    CREATE TABLE IF NOT EXISTS Participant (
        Participant_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Name TEXT,
        Height REAL,
        Weight REAL,
        Plyo_Day TEXT,
        Creation_Date TEXT
    )
    """,
    'I': """
    CREATE TABLE IF NOT EXISTS I (
        Trial_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Name TEXT,
        Participant_ID INTEGER,
        Avg_Force REAL,
        Avg_Force_Norm REAL,
        Max_Force REAL,
        Max_Force_Norm REAL,
        Time_to_Max REAL,
        Creation_Date TEXT,
        FOREIGN KEY (Participant_ID) REFERENCES Participant(Participant_ID)
    )
    """,
    'Y': """
    CREATE TABLE IF NOT EXISTS Y (
        Trial_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Name TEXT,
        Participant_ID INTEGER,
        Avg_Force REAL,
        Avg_Force_Norm REAL,
        Max_Force REAL,
        Max_Force_Norm REAL,
        Time_to_Max REAL,
        Creation_Date TEXT,
        FOREIGN KEY (Participant_ID) REFERENCES Participant(Participant_ID)
    )
    """,
    'T': """
    CREATE TABLE IF NOT EXISTS T (
        Trial_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Name TEXT,
        Participant_ID INTEGER,
        Avg_Force REAL,
        Avg_Force_Norm REAL,
        Max_Force REAL,
        Max_Force_Norm REAL,
        Time_to_Max REAL,
        Creation_Date TEXT,
        FOREIGN KEY (Participant_ID) REFERENCES Participant(Participant_ID)
    )
    """,
    'IR90': """
    CREATE TABLE IF NOT EXISTS IR90 (
        Trial_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Name TEXT,
        Participant_ID INTEGER,
        Avg_Force REAL,
        Avg_Force_Norm REAL,
        Max_Force REAL,
        Max_Force_Norm REAL,
        Time_to_Max REAL,
        Creation_Date TEXT,
        FOREIGN KEY (Participant_ID) REFERENCES Participant(Participant_ID)
    )
    """,
    'CMJ': """
    CREATE TABLE IF NOT EXISTS CMJ (
        Trial_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Name TEXT,
        Participant_ID INTEGER,
        Jump_Height REAL,
        Peak_Power REAL,
        Peak_Force REAL,
        Creation_Date TEXT,
        FOREIGN KEY (Participant_ID) REFERENCES Participant(Participant_ID)
    )
    """,
    'PPU': """
    CREATE TABLE IF NOT EXISTS PPU (
        Trial_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        Name TEXT,
        Participant_ID INTEGER,
        Jump_Height REAL,
        Peak_Power REAL,
        Peak_Force REAL,
        Creation_Date TEXT,
        FOREIGN KEY (Participant_ID) REFERENCES Participant(Participant_ID)
    )
    """
}

# Additional columns to add to CMJ and PPU tables
CMJ_PPU_ADDITIONAL_COLS = [
    "ADD COLUMN Jump_Height        REAL",
    "ADD COLUMN Peak_Power         REAL",
    "ADD COLUMN Peak_Force         REAL",
    "ADD COLUMN PP_W_per_kg        REAL",
    "ADD COLUMN PP_FORCEPLATE      REAL",
    "ADD COLUMN Force_at_PP        REAL",
    "ADD COLUMN Vel_at_PP          REAL",
    "ADD COLUMN Creation_Date      TEXT"
]


def get_connection(db_path: str) -> sqlite3.Connection:
    """
    Get a connection to the Readiness Screen database.
    
    Args:
        db_path: Path to the database file.
    
    Returns:
        SQLite connection object.
    """
    # Ensure directory exists
    db_dir = os.path.dirname(os.path.abspath(db_path))
    if not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    
    # Use absolute path to avoid issues
    abs_path = os.path.abspath(db_path)
    return sqlite3.connect(abs_path)


def create_tables(conn: sqlite3.Connection):
    """
    Create all tables in the database.
    
    Args:
        conn: SQLite connection object.
    """
    cursor = conn.cursor()
    # Execute each CREATE TABLE statement separately
    for table_name, schema in TABLE_SCHEMAS.items():
        # Strip whitespace and ensure statement ends with semicolon
        schema_clean = schema.strip()
        if not schema_clean.endswith(';'):
            schema_clean += ';'
        cursor.execute(schema_clean)
    conn.commit()


def ensure_cmj_ppu_columns(conn: sqlite3.Connection):
    """
    Ensure CMJ and PPU tables have all required columns.
    
    Args:
        conn: SQLite connection object.
    """
    cursor = conn.cursor()
    
    for tbl in ("CMJ", "PPU"):
        cursor.execute(f"PRAGMA table_info({tbl});")
        cols = {row[1] for row in cursor.fetchall()}
        
        for col_sql in CMJ_PPU_ADDITIONAL_COLS:
            col_name = col_sql.split()[2]
            if col_name not in cols:
                cursor.execute(f"ALTER TABLE {tbl} {col_sql}")
    
    conn.commit()


def get_participant_id(conn: sqlite3.Connection, name: str, creation_date: str) -> Optional[int]:
    """
    Get existing Participant_ID for a participant with the given name and creation_date.
    
    Args:
        conn: SQLite connection.
        name: Participant name.
        creation_date: Creation date string.
    
    Returns:
        Participant_ID if found, None otherwise.
    """
    cursor = conn.cursor()
    cursor.execute("""
        SELECT Participant_ID FROM Participant 
        WHERE Name = ? AND Creation_Date = ?
    """, (name, creation_date))
    result = cursor.fetchone()
    return result[0] if result else None


def insert_participant(conn: sqlite3.Connection, name: str, height: float,
                      weight: float, plyo_day: str, creation_date: str,
                      skip_if_exists: bool = True) -> int:
    """
    Insert a new participant and return the Participant_ID.
    If skip_if_exists is True and participant already exists, returns existing ID.
    
    Args:
        conn: SQLite connection.
        name: Participant name.
        height: Height value.
        weight: Weight value.
        plyo_day: Plyometric day.
        creation_date: Creation date string.
        skip_if_exists: If True, return existing ID if participant already exists.
    
    Returns:
        Participant_ID of the inserted or existing participant.
    """
    cursor = conn.cursor()
    
    # Check if participant already exists
    if skip_if_exists:
        existing_id = get_participant_id(conn, name, creation_date)
        if existing_id is not None:
            print(f"   Participant already exists: {name} ({creation_date}) - ID: {existing_id}")
            return existing_id
    
    # Insert new participant
    cursor.execute("""
        INSERT INTO Participant (Name, Height, Weight, Plyo_Day, Creation_Date)
        VALUES (?, ?, ?, ?, ?)
    """, (name, height, weight, plyo_day, creation_date))
    
    participant_id = cursor.lastrowid
    conn.commit()
    return participant_id


def insert_trial_data(conn: sqlite3.Connection, table_name: str, name: str,
                      participant_id: int, data: dict, creation_date: str):
    """
    Insert trial data into a movement table.
    
    Args:
        conn: SQLite connection.
        table_name: Table name (I, Y, T, IR90, CMJ, or PPU).
        name: Participant name.
        participant_id: Participant_ID foreign key.
        data: Dictionary with trial data.
        creation_date: Creation date string.
    """
    cursor = conn.cursor()
    
    if table_name in {"CMJ", "PPU"}:
        cursor.execute(f"""
            INSERT INTO {table_name}(
                Name, Participant_ID,
                Jump_Height,
                Peak_Power,
                Peak_Force,
                PP_W_per_kg, PP_FORCEPLATE,
                Force_at_PP, Vel_at_PP,
                Creation_Date
            ) VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (
            name, participant_id,
            data.get('JH_IN'),
            data.get('LEWIS_PEAK_POWER'),
            data.get('Max_Force'),
            data.get('PP_W_per_kg'),
            data.get('PP_FORCEPLATE'),
            data.get('Force_at_PP'),
            data.get('Vel_at_PP'),
            creation_date
        ))
    else:
        # I / Y / T / IR90
        cursor.execute(f"""
            INSERT INTO {table_name}(
                Name, Participant_ID, Avg_Force, Avg_Force_Norm,
                Max_Force, Max_Force_Norm, Time_to_Max, Creation_Date)
            VALUES (?,?,?,?,?,?,?,?)
        """, (
            name, participant_id,
            data.get('Avg_Force'),
            data.get('Avg_Force_Norm'),
            data.get('Max_Force'),
            data.get('Max_Force_Norm'),
            data.get('Time_to_Max'),
            creation_date
        ))
    
    conn.commit()


def initialize_database(db_path: str):
    """
    Initialize database with all tables and columns.
    
    Args:
        db_path: Path to database file.
    
    Returns:
        SQLite connection object.
    """
    conn = get_connection(db_path)
    create_tables(conn)
    ensure_cmj_ppu_columns(conn)
    return conn

