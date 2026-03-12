"""
Database replication utilities for Athletic Screen.
Handles copying data from source database to target databases with schema sync.
"""
import sqlite3
import time
import os
from typing import List, Dict


# Unique keys per table for idempotent UPSERTs
UNIQUE_KEYS = {
    "CMJ": ["name", "date", "trial_name"],
    "DJ": ["name", "date", "trial_name"],
    "PPU": ["name", "date", "trial_name"],
    "SLV": ["name", "date", "trial_name", "side"],
    "NMT": ["name", "date", "trial_name"],
}

# Tables to replicate
TABLES_TO_COPY = ["CMJ", "DJ", "PPU", "SLV", "NMT"]


def retry_execute(func, retries: int = 5, delay: float = 1.0):
    """
    Retry a function call if database is locked.
    
    Args:
        func: Function to execute.
        retries: Number of retry attempts.
        delay: Delay between retries in seconds.
    """
    while retries > 0:
        try:
            func()
            return
        except sqlite3.OperationalError as e:
            if "database is locked" in str(e).lower():
                print("Database is locked, retrying...")
                time.sleep(delay)
                retries -= 1
            else:
                raise
    raise Exception("Max retries reached. Database is still locked.")


def prep_connection(conn: sqlite3.Connection):
    """
    Prepare a connection with WAL mode and timeout settings.
    
    Args:
        conn: SQLite connection.
    """
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    """
    Check if a table exists.
    
    Args:
        conn: SQLite connection.
        table: Table name.
    
    Returns:
        True if table exists, False otherwise.
    """
    try:
        conn.execute(f"SELECT 1 FROM {table} LIMIT 1")
        return True
    except sqlite3.OperationalError:
        return False


def get_columns(conn: sqlite3.Connection, table: str) -> List[tuple]:
    """
    Get column information for a table.
    
    Args:
        conn: SQLite connection.
        table: Table name.
    
    Returns:
        List of (column_name, column_type) tuples.
    """
    cur = conn.cursor()
    cur.execute(f"PRAGMA table_info({table})")
    return [(r[1], r[2]) for r in cur.fetchall()]


def dedupe_on_keys(conn: sqlite3.Connection, table: str, key_cols: List[str]):
    """
    Remove duplicate rows keeping the latest (highest rowid) per unique key.
    
    Args:
        conn: SQLite connection.
        table: Table name.
        key_cols: List of key column names.
    """
    cols = ", ".join(key_cols)
    sql = f"""
        DELETE FROM {table}
        WHERE rowid NOT IN (
            SELECT MAX(rowid)
            FROM {table}
            GROUP BY {cols}
        )
    """
    conn.execute(sql)
    conn.commit()


def sync_table_schema_from_source(source_conn: sqlite3.Connection, 
                                   target_conns: Dict[str, sqlite3.Connection],
                                   table_name: str):
    """
    Sync table schema from source to all target databases.
    
    Args:
        source_conn: Source database connection.
        target_conns: Dictionary of target database connections.
        table_name: Table name to sync.
    """
    src_cols = get_columns(source_conn, table_name)
    if not src_cols:
        print(f"Source table {table_name} has no columns; skipping schema sync.")
        return

    for db_name, conn in target_conns.items():
        cur = conn.cursor()

        # Create table if missing
        if not table_exists(conn, table_name):
            cols_sql = ", ".join(
                f"{col} {ctype or 'TEXT'}"
                for col, ctype in src_cols
                if col != "id"
            )
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS {table_name} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    {cols_sql}
                )
            """)
            conn.commit()

        # Add any missing columns
        tgt_cols = dict(get_columns(conn, table_name))
        for col, ctype in src_cols:
            if col == "id":
                continue
            if col not in tgt_cols:
                cur.execute(f"ALTER TABLE {table_name} ADD COLUMN {col} {ctype or 'REAL'}")
        conn.commit()

        # Ensure unique index for upsert
        if table_name in UNIQUE_KEYS:
            dedupe_on_keys(conn, table_name, UNIQUE_KEYS[table_name])
            idx_cols = ",".join(UNIQUE_KEYS[table_name])
            cur.execute(
                f"CREATE UNIQUE INDEX IF NOT EXISTS idx_{table_name.lower()}_uniq "
                f"ON {table_name}({idx_cols})"
            )
            conn.commit()


def copy_table_data(source_conn: sqlite3.Connection,
                    target_conns: Dict[str, sqlite3.Connection],
                    table_name: str):
    """
    Copy data from source table to all target databases.
    
    Args:
        source_conn: Source database connection.
        target_conns: Dictionary of target database connections.
        table_name: Table name to copy.
    """
    source_cursor = source_conn.cursor()
    
    # Pull from source
    try:
        source_cursor.execute(f"SELECT * FROM {table_name}")
    except sqlite3.OperationalError as e:
        print(f"Source table {table_name} not found: {e}. Skipping.")
        return

    rows = source_cursor.fetchall()
    if not rows:
        print(f"No rows to copy for {table_name}. Skipping.")
        return

    src_cols_all = [d[0] for d in source_cursor.description]  # includes 'id'

    # Make sure targets have ALL columns from source
    sync_table_schema_from_source(source_conn, target_conns, table_name)

    # For each target, compute intersection of columns and UPSERT
    for db_name, conn in target_conns.items():
        cur = conn.cursor()
        tgt_cols_all = [c for c, _ in get_columns(conn, table_name)]
        common_cols = [c for c in src_cols_all if c != "id" and c in tgt_cols_all]
        if not common_cols:
            print(f"{db_name}: No common columns for {table_name}. Skipping.")
            continue

        placeholders = ", ".join(["?"] * len(common_cols))
        col_list = ", ".join(common_cols)

        if table_name in UNIQUE_KEYS:
            uk = UNIQUE_KEYS[table_name]
            set_cols = [c for c in common_cols if c not in uk]
            set_clause = ", ".join([f"{c}=excluded.{c}" for c in set_cols]) or ""
            on_conflict = f"ON CONFLICT({', '.join(uk)}) DO " + (f"UPDATE SET {set_clause}" if set_clause else "NOTHING")
        else:
            on_conflict = ""

        sql = f"INSERT INTO {table_name} ({col_list}) VALUES ({placeholders}) {on_conflict}"

        # Align row values to the common column order
        idx_map = {c: src_cols_all.index(c) for c in common_cols}
        data = [tuple(row[idx_map[c]] for c in common_cols) for row in rows]

        retry_execute(lambda: cur.executemany(sql, data))
        conn.commit()
        print(f"Copied/Upserted {len(data)} rows to {table_name} in {db_name}")


def replicate_database(source_db_path: str,
                      target_db_paths: List[str],
                      all_data_db_path: str = None):
    """
    Replicate source database to target databases.
    
    Args:
        source_db_path: Path to source database.
        target_db_paths: List of target database paths.
        all_data_db_path: Optional path for combined "all" database.
    """
    # Open source connection
    source_conn = sqlite3.connect(source_db_path, timeout=10)
    prep_connection(source_conn)

    # Open target connections
    target_conns = {
        os.path.basename(db_path): sqlite3.connect(db_path, timeout=10)
        for db_path in target_db_paths
    }
    
    if all_data_db_path:
        target_conns["all"] = sqlite3.connect(all_data_db_path, timeout=10)

    for conn in target_conns.values():
        prep_connection(conn)

    # Copy each table
    for table in TABLES_TO_COPY:
        copy_table_data(source_conn, target_conns, table)

    # Close connections
    source_conn.close()
    for conn in target_conns.values():
        conn.close()

    print("Data successfully copied to each target and combined database.")


def clear_processed_files(folder_path: str, extensions: List[str] = None):
    """
    Clear processed files after ingestion.
    
    Args:
        folder_path: Directory containing files to clear.
        extensions: List of file extensions to delete (default: ['.txt']).
    """
    if extensions is None:
        extensions = ['.txt']
    
    for filename in os.listdir(folder_path):
        if any(filename.lower().endswith(ext) for ext in extensions):
            file_path = os.path.join(folder_path, filename)
            try:
                os.remove(file_path)
                print(f"Deleted: {file_path}")
            except Exception as e:
                print(f"Failed to delete {file_path}: {e}")

