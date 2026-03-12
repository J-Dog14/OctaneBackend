"""
Initialize PostgreSQL warehouse database with schema.
This script creates all warehouse fact tables if they don't exist.
"""
from pathlib import Path
import sys

# Add python directory to path BEFORE importing common modules
# This allows imports like "from common.config import ..." to work
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from sqlalchemy import create_engine, text, inspect
from common.config import get_warehouse_engine


def create_warehouse_schema():
    """Create warehouse database schema if tables don't exist."""
    engine = get_warehouse_engine()
    
    # Read PostgreSQL schema file
    # sql/ folder is at project root, so go up 2 levels from scripts/ to get there
    project_root = Path(__file__).parent.parent.parent
    schema_file = project_root / "sql" / "create_warehouse_schema_postgres.sql"
    
    if not schema_file.exists():
        print(f"Error: Schema file not found at {schema_file}")
        return False
    
    with open(schema_file, 'r') as f:
        schema_sql = f.read()
    
    # Split by semicolons and execute each statement
    # PostgreSQL doesn't like executing multiple statements at once via SQLAlchemy
    statements = [s.strip() for s in schema_sql.split(';') if s.strip() and not s.strip().startswith('--')]
    
    try:
        with engine.connect() as conn:
            # Check if tables already exist
            inspector = inspect(engine)
            existing_tables = inspector.get_table_names()
            
            print(f"Existing tables: {existing_tables}")
            
            # Separate CREATE TABLE and CREATE INDEX statements
            table_statements = []
            index_statements = []
            
            for statement in statements:
                if statement.upper().startswith('CREATE TABLE'):
                    table_statements.append(statement)
                elif statement.upper().startswith('CREATE INDEX'):
                    index_statements.append(statement)
            
            # Execute CREATE TABLE statements first
            for statement in table_statements:
                # Extract table name
                table_name = None
                parts = statement.split()
                for i, part in enumerate(parts):
                    if part.upper() == 'TABLE' and i + 1 < len(parts):
                        table_name = parts[i + 1].split('(')[0].strip()
                        break
                
                if table_name and table_name in existing_tables:
                    print(f"Table {table_name} already exists, skipping...")
                    continue
                
                try:
                    # Each CREATE TABLE needs its own transaction
                    conn.execute(text(statement))
                    conn.commit()
                    print(f"Created table: {table_name}")
                except Exception as e:
                    conn.rollback()  # Rollback on error
                    if 'already exists' not in str(e).lower():
                        print(f"Warning creating table {table_name}: {e}")
            
            # Execute CREATE INDEX statements after tables exist
            for statement in index_statements:
                try:
                    conn.execute(text(statement))
                    conn.commit()
                except Exception as e:
                    conn.rollback()  # Rollback on error
                    if 'already exists' not in str(e).lower():
                        print(f"Warning creating index: {e}")
            
            print("\nWarehouse schema initialization complete!")
            return True
            
    except Exception as e:
        print(f"Error initializing warehouse schema: {e}")
        return False


if __name__ == "__main__":
    success = create_warehouse_schema()
    sys.exit(0 if success else 1)

