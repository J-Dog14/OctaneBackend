09# Safe Database Access with Beekeeper Studio

## Overview

Beekeeper Studio is just a GUI client - it doesn't lock your database. You can safely access the same database programmatically while Beekeeper is open.

## Best Practices

### 1. **Read-Only Access (Safest)**
When you only need to read data (like loading `source_athlete_map`), use read-only mode:

```python
from common.config import get_app_engine

# Read-only connection (won't interfere with Beekeeper)
engine = get_app_engine(read_only=True)
```

### 2. **SQLite WAL Mode**
The config now automatically enables WAL (Write-Ahead Logging) mode, which allows:
- Multiple readers simultaneously
- One writer at a time
- Better performance with concurrent access

### 3. **Connection Timeouts**
The config includes a 20-second timeout, so if the database is temporarily locked, it will wait instead of failing immediately.

### 4. **What to Avoid**
- Don't drop or alter table schemas while Beekeeper has the table open
- Don't run long-running transactions that hold locks
- Do use read-only mode when possible
- Do close connections promptly after use

## Example: Safe Read Access

```python
from common.id_utils import load_source_map

# This automatically uses read-only mode
source_map = load_source_map()
```

## Example: Safe Write Access

```python
from common.config import get_app_engine
from common.db_utils import write_df

# For writes, use normal mode (WAL handles concurrency)
engine = get_app_engine(read_only=False)
write_df(df, 'source_athlete_map', engine)
```

## Postgres Databases

If your app database is Postgres, you don't need to worry - Postgres handles concurrent access natively. Multiple connections (Beekeeper + your scripts) work perfectly together.

## Troubleshooting

**"Database is locked" error:**
- Wait a few seconds and try again
- Close any long-running queries in Beekeeper
- Check if another process has a write lock

**Beekeeper shows stale data:**
- Refresh the view in Beekeeper (F5 or refresh button)
- Beekeeper caches data, so it may not show changes immediately

