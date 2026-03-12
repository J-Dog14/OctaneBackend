"""
Legacy process_raw.py - DEPRECATED

This file has been refactored into multiple modules:
- database.py: Database setup and management
- file_parsers.py: File parsing utilities
- power_analysis.py: Power curve analysis
- database_replication.py: Database replication
- report_generation.py: Report generation (placeholder)
- main.py: Main orchestration script

Please use main.py instead of this file.

To maintain backward compatibility, this file imports and runs main():
"""

if __name__ == "__main__":
    from main import main
    main()
else:
    # For imports, provide the original functions
    # These redirect to the new modular structure
    from file_parsers import (
        extract_name,
        extract_date,
        read_first_numeric_row_values,
        peak_power_from_pow_file,
        classify_movement_type,
        parse_movement_file
    )
    
    from database import (
        create_database,
        create_tables,
        insert_row,
        get_connection
    )
    
    from power_analysis import (
        load_power_txt,
        analyze_power_curve,
        analyze_power_curve_advanced
    )
