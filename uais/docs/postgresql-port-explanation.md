# PostgreSQL Port and Database Connection Explained

## The Short Answer

**YES, it's perfectly fine for both databases to use port 5432!**

Port 5432 is where the **PostgreSQL server** listens, not individual databases. You can have many databases on the same server, all accessible through the same port.

## How It Works

### Port = Server, Not Database

```
PostgreSQL Server (localhost:5432)
├── Database: "local" (app database)
├── Database: "uais_warehouse" (warehouse database)
├── Database: "postgres" (default database)
└── ... (any other databases)
```

**Port 5432** = The PostgreSQL server's address
**Database name** = Which database you want to connect to

### Your Current Setup

```yaml
app:
  postgres:
    host: "localhost"
    port: 5432          # ← Same port
    database: "local"    # ← Different database name

warehouse:
  postgres:
    host: "localhost"
    port: 5432          # ← Same port
    database: "uais_warehouse"  # ← Different database name
```

Both connections:
- Use the **same server** (localhost:5432)
- Connect to **different databases** ("local" vs "uais_warehouse")
- Are **completely independent**

## Why This Works

### 1. Database Name in Connection String

When you connect, PostgreSQL uses the `database` parameter to route you:

```python
# Connection 1: App database
conn1 = psycopg2.connect(
    host="localhost",
    port=5432,
    database="local"  # ← Connects to "local" database
)

# Connection 2: Warehouse database  
conn2 = psycopg2.connect(
    host="localhost",
    port=5432,
    database="uais_warehouse"  # ← Connects to "uais_warehouse" database
)
```

### 2. Independent Connections

Each connection is separate:
- **Connection 1** → "local" database
- **Connection 2** → "uais_warehouse" database
- They don't interfere with each other
- You can have both open simultaneously

### 3. Standard Practice

This is **exactly how PostgreSQL is designed to work**:
- One PostgreSQL server = one port
- Multiple databases = multiple database names
- Very common setup

## Real-World Example

Think of it like an apartment building:
- **Port 5432** = The building address
- **Database name** = Which apartment (database) you want
- You can visit different apartments, but they're all at the same address

## Your Code Handles This Automatically

Your `config.py` already handles this correctly:

```python
def get_app_engine():
    # Connects to "local" database on port 5432
    conn_str = f"postgresql://user:pass@localhost:5432/local"
    
def get_warehouse_engine():
    # Connects to "uais_warehouse" database on port 5432
    conn_str = f"postgresql://user:pass@localhost:5432/uais_warehouse"
```

Both use port 5432, but different database names!

## When You'd Use Different Ports

You'd only use different ports if:
- **Multiple PostgreSQL servers** (different installations)
- **Different PostgreSQL versions** running simultaneously
- **Special configuration** requiring separate servers

For your use case (same server, different databases), **same port is correct!**

## Summary

✅ **Same port (5432) = Same PostgreSQL server**
✅ **Different database names = Different databases**
✅ **This is standard and recommended**
✅ **Your code already handles this correctly**

**No changes needed** - your setup is perfect!

