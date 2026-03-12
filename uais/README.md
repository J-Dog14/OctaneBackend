# UAIS - Unified Athlete Identity System

Unified Athlete Identity System (UAIS) for unifying all athlete data across 8ctane's systems under a single athlete UUID.

## Project Structure

```
UAIS/
├── config/              # Database connection configuration
├── docs/                # Documentation and guides
├── python/              # Python codebase
│   ├── common/         # Shared utilities (config, db, id, io)
│   ├── athleticScreen/ # Athletic Screen domain
│   ├── proSupTest/     # Pro-Sup Test domain
│   ├── readinessScreen/# Readiness Screen domain
│   ├── mobility/       # Mobility domain
│   ├── proteus/        # Proteus domain
│   └── scripts/        # Orchestration scripts
├── R/                   # R codebase
│   ├── common/         # Shared R utilities
│   ├── pitching/       # Pitching kinematics
│   ├── hitting/        # Hitting kinematics
│   └── [domain]/       # Domain-specific R scripts
└── sql/                 # SQL schema definitions
```

## Quick Start

1. **Configure databases**: Copy `config/db_connections.example.yaml` to `config/db_connections.yaml` and update paths
2. **Install dependencies**: `pip install -r python/requirements.txt`
3. **Run ETL**: `python python/scripts/run_all_etl.py`

## Key Features

- **Unified Identity**: Single `athlete_uuid` across all systems
- **Modular Design**: Organized by domain with shared utilities
- **Interactive Athlete Creation**: Prompts for demographic info when new athletes detected
- **Dual Language Support**: Python and R codebases
- **Safe Database Access**: WAL mode and read-only support for Beekeeper Studio

## Documentation

See `docs/` directory for detailed guides:
- Database architecture
- Interactive athlete creation
- Beekeeper Studio access
- Database consolidation
