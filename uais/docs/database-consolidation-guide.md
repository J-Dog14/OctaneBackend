# Database Consolidation Guide

## Overview

This guide explains how to consolidate your scattered source databases into a unified warehouse database with UUID matching.

## Recommended Approach

### Option 1: Reference Original Files (Recommended)

**Pros:**
- No duplication of data
- Always reads latest data
- Saves disk space
- Simpler workflow

**Cons:**
- Requires original files to remain accessible
- Paths must be correct

**How to set up:**
1. Add source database paths to `config/db_connections.yaml` under `source_databases`
2. Run the consolidation script
3. Original files stay where they are

### Option 2: Copy Files to Project Folder

**Pros:**
- Isolated from original files
- Can work offline
- Easier to version control paths

**Cons:**
- Duplicates data (uses more disk space)
- Need to keep copies updated

**How to set up:**
1. Create `data/source_databases/` folder in project
2. Copy your database files there
3. Update `config/db_connections.yaml` to point to copied files

## Folder Structure Recommendation

```
UAIS/
├── config/
│   └── db_connections.yaml          # Config with all DB paths
├── data/                             # Optional: for copied DBs
│   └── source_databases/
│       ├── athletic_screen.db
│       ├── pro_sup.db
│       └── ...
├── python/
│   └── scripts/
│       └── consolidate_source_databases.py
└── ...
```

## Configuration

Add your source databases to `config/db_connections.yaml`:

```yaml
source_databases:
  athletic_screen: "D:/Athletic Screen 2.0/Output Files/movement_database_v2.db"
  pro_sup: "D:/Pro-Sup Test/pro-sup_data.sqlite"
  mobility: "path/to/mobility_database.db"
  # Add more as needed
```

## Running Consolidation

### Dry Run (Preview)
```bash
python python/scripts/consolidate_source_databases.py --dry-run
```

This will:
- Scan all source databases
- Show what tables and rows would be consolidated
- Report unmapped athletes
- **Not write anything** to warehouse

### Actual Consolidation
```bash
python python/scripts/consolidate_source_databases.py
```

This will:
- Scan all source databases
- Normalize athlete IDs and dates
- Attach athlete_uuid using source_athlete_map
- Write to warehouse fact tables

## Table Naming Strategy

The script supports two strategies:

### Strategy 1: One Table Per Source System (Default)
- All tables from `athletic_screen` DB → `f_athletic_screen`
- All tables from `pro_sup` DB → `f_pro_sup`
- **Pros:** Simple, all data from one system together
- **Cons:** Mixed movement types in one table

### Strategy 2: One Table Per Movement
- CMJ table → `f_CMJ`
- DJ table → `f_DJ`
- **Pros:** Clean separation by movement type
- **Cons:** Need to modify script (uncomment the alternative target_table logic)

## Handling Unmapped Athletes

The script will:
1. Report unmapped athletes (those without athlete_uuid)
2. Still write the rows (with NULL athlete_uuid)
3. Flag them for manual mapping

To map unmapped athletes:
1. Check the logs for unmapped source_athlete_id values
2. Add mappings to `source_athlete_map` table in app database
3. Re-run consolidation

## Workflow

1. **Initial Setup:**
   ```bash
   # Configure source databases in db_connections.yaml
   # Ensure app database has athletes table with athlete_uuid
   ```

2. **Build Source Map:**
   ```bash
   python python/scripts/rebuild_source_map.py
   ```

3. **Dry Run Consolidation:**
   ```bash
   python python/scripts/consolidate_source_databases.py --dry-run
   ```

4. **Review Unmapped Athletes:**
   - Check logs for unmapped source IDs
   - Manually map them in Beekeeper or via script

5. **Run Actual Consolidation:**
   ```bash
   python python/scripts/consolidate_source_databases.py
   ```

6. **Verify in Warehouse:**
   - Check warehouse database
   - Verify athlete_uuid matching
   - Check data quality

## Tips

- **Start with dry-run** to see what will happen
- **Keep Beekeeper open** to monitor the process (it's safe!)
- **Backup your databases** before first consolidation
- **Run consolidation regularly** to keep warehouse updated
- **Use read-only mode** when just scanning (script does this automatically)

