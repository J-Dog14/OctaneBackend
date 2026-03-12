"""
Create the warehouse database if it doesn't exist.
Run this before init_warehouse_db.py
"""
from pathlib import Path
import sys

# Add python directory to path BEFORE importing common modules
python_dir = Path(__file__).parent.parent
if str(python_dir) not in sys.path:
    sys.path.insert(0, str(python_dir))

from sqlalchemy import create_engine, text
from common.config import _load_config


def create_warehouse_database():
    """Create the warehouse database if it doesn't exist."""
    config = _load_config()
    warehouse_config = config.get('databases', {}).get('warehouse', {})
    
    if 'postgres' not in warehouse_config:
        print("Error: Warehouse database is not configured for PostgreSQL")
        return False
    
    pg = warehouse_config['postgres']
    db_name = pg['database']
    
    # Use postgres superuser from app config to create database
    # (regular users may not have CREATE DATABASE permission)
    app_config = config.get('databases', {}).get('app', {})
    if 'postgres' in app_config:
        admin_pg = app_config['postgres']
        admin_user = admin_pg['user']
        admin_password = admin_pg['password']
        admin_host = admin_pg['host']
        admin_port = admin_pg['port']
    else:
        # Fallback to warehouse user (may not work if user lacks privileges)
        admin_user = pg['user']
        admin_password = pg['password']
        admin_host = pg['host']
        admin_port = pg['port']
    
    # Connect to default 'postgres' database to create the new database
    # (can't create a database while connected to it)
    admin_conn_str = f"postgresql://{admin_user}:{admin_password}@{admin_host}:{admin_port}/postgres"
    
    try:
        admin_engine = create_engine(admin_conn_str, echo=False)
        
        with admin_engine.connect() as conn:
            # Check if database exists
            result = conn.execute(text(
                "SELECT 1 FROM pg_database WHERE datname = :db_name"
            ), {"db_name": db_name})
            
            exists = result.fetchone() is not None
            
            if exists:
                print(f"Database '{db_name}' already exists. Skipping creation.")
                return True
            
            # CREATE DATABASE cannot run inside a transaction block
            # Use autocommit mode
            conn.execute(text("COMMIT"))  # End any existing transaction
            conn.execute(text(f'CREATE DATABASE "{db_name}"'))
            print(f"Successfully created database '{db_name}'")
            return True
            
    except Exception as e:
        print(f"Error creating database: {e}")
        print(f"\nYou can also create it manually:")
        print(f"  psql -h {pg['host']} -p {pg['port']} -U {pg['user']} -d postgres")
        print(f"  CREATE DATABASE {db_name};")
        return False


if __name__ == "__main__":
    success = create_warehouse_database()
    sys.exit(0 if success else 1)

