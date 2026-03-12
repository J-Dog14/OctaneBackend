"""
Configuration management for UAIS.
Loads YAML config and provides database engines and raw data paths.
Also loads environment variables from .env file.
"""
import yaml
import os
from pathlib import Path
from sqlalchemy import create_engine, text
from typing import Dict, Any, Optional

# Load environment variables from .env file if it exists
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    # python-dotenv not installed, skip loading .env
    pass


def _load_config() -> Dict[str, Any]:
    """
    Load configuration from db_connections.yaml.
    
    Returns:
        Dict containing database connections and raw data paths.
    """
    config_path = Path(__file__).parent.parent.parent / "config" / "db_connections.yaml"
    
    if not config_path.exists():
        raise FileNotFoundError(
            f"Config file not found at {config_path}. "
            "Copy db_connections.example.yaml to db_connections.yaml and configure."
        )
    
    with open(config_path, 'r') as f:
        config = yaml.safe_load(f)
    
    return config


def get_app_engine(read_only: bool = False):
    """
    Get SQLAlchemy engine for the app database (source of truth for athletes).
    
    Args:
        read_only: If True, opens database in read-only mode (safer when Beekeeper is open).
    
    Returns:
        SQLAlchemy Engine connected to app database.
    """
    config = _load_config()
    app_config = config.get('databases', {}).get('app', {})
    
    if 'sqlite' in app_config:
        db_path = app_config['sqlite']
        # Use WAL mode and longer timeout for concurrent access with Beekeeper
        # WAL mode allows multiple readers and one writer simultaneously
        connect_args = {
            'timeout': 20.0,  # Wait up to 20 seconds if database is locked
            'check_same_thread': False
        }
        
        if read_only:
            # Read-only mode: open with mode='ro' (SQLite 3.8+)
            connect_args['uri'] = True
            db_path = f'file:{db_path}?mode=ro'
        
        engine = create_engine(f'sqlite:///{db_path}', echo=False, connect_args=connect_args)
        
        # Enable WAL mode for better concurrent access (if not read-only)
        if not read_only:
            with engine.connect() as conn:
                conn.execute(text("PRAGMA journal_mode=WAL"))
                conn.execute(text("PRAGMA busy_timeout=20000"))  # 20 second timeout
                conn.commit()
        
        return engine
    elif 'postgres' in app_config:
        pg = app_config['postgres']
        
        # Check for environment variable first (for cloud databases)
        env_conn_str = os.environ.get('APP_DATABASE_URL')
        if env_conn_str:
            # Use connection string from environment (cloud database)
            return create_engine(env_conn_str, echo=False, pool_pre_ping=True, 
                               connect_args={'sslmode': 'require'} if 'sslmode=require' in env_conn_str else {})
        
        # Check for connection_string in config (alternative format)
        if 'connection_string' in pg:
            return create_engine(pg['connection_string'], echo=False, pool_pre_ping=True,
                               connect_args={'sslmode': 'require'} if 'sslmode=require' in pg['connection_string'] else {})
        
        # Build from individual fields (local database)
        conn_str = f"postgresql://{pg['user']}:{pg['password']}@{pg['host']}:{pg['port']}/{pg['database']}"
        # Postgres handles concurrent access natively, no special settings needed
        return create_engine(conn_str, echo=False, pool_pre_ping=True)
    else:
        raise ValueError("No app database configuration found in config file")


def get_warehouse_engine():
    """
    Get SQLAlchemy engine for the warehouse database (centralized fact tables).
    
    Returns:
        SQLAlchemy Engine connected to warehouse database.
    """
    config = _load_config()
    warehouse_config = config.get('databases', {}).get('warehouse', {})
    
    if 'sqlite' in warehouse_config:
        db_path = warehouse_config['sqlite']
        # Use WAL mode for concurrent access
        connect_args = {
            'timeout': 20.0,
            'check_same_thread': False
        }
        engine = create_engine(f'sqlite:///{db_path}', echo=False, connect_args=connect_args)
        
        # Enable WAL mode
        with engine.connect() as conn:
            conn.execute(text("PRAGMA journal_mode=WAL"))
            conn.execute(text("PRAGMA busy_timeout=20000"))
            conn.commit()
        
        return engine
    elif 'postgres' in warehouse_config:
        pg = warehouse_config['postgres']
        
        # Check for environment variable first (for cloud databases)
        env_conn_str = os.environ.get('WAREHOUSE_DATABASE_URL')
        if env_conn_str:
            # Use connection string from environment (cloud database)
            return create_engine(env_conn_str, echo=False, pool_pre_ping=True,
                               connect_args={'sslmode': 'require'} if 'sslmode=require' in env_conn_str else {})
        
        # Check for connection_string in config (alternative format)
        if 'connection_string' in pg:
            return create_engine(pg['connection_string'], echo=False, pool_pre_ping=True,
                               connect_args={'sslmode': 'require'} if 'sslmode=require' in pg['connection_string'] else {})
        
        # Build from individual fields (local database)
        conn_str = f"postgresql://{pg['user']}:{pg['password']}@{pg['host']}:{pg['port']}/{pg['database']}"
        return create_engine(conn_str, echo=False, pool_pre_ping=True)
    else:
        raise ValueError("No warehouse database configuration found in config file")


def get_raw_paths() -> Dict[str, str]:
    """
    Get dictionary of raw data directory paths by domain.
    
    Returns:
        Dict mapping domain names (e.g., 'athletic_screen', 'mobility') to paths.
    """
    config = _load_config()
    return config.get('raw_data_paths', {})


if __name__ == "__main__":
    # Test configuration loading
    print("Testing configuration...")
    try:
        app_eng = get_app_engine()
        print(f"App engine: {app_eng.url}")
        
        warehouse_eng = get_warehouse_engine()
        print(f"Warehouse engine: {warehouse_eng.url}")
        
        paths = get_raw_paths()
        print(f"Raw data paths: {list(paths.keys())}")
    except Exception as e:
        print(f"Configuration error: {e}")

