"""
Legacy process_raw.py - DEPRECATED

This file has been refactored into multiple modules:
- database.py: Database setup and operations
- file_parsers.py: XML and ASCII file parsing
- database_utils.py: Database reordering utilities
- dashboard.py: Dash dashboard application
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
        find_session_xml,
        parse_xml_file,
        parse_ascii_file,
        select_folder_dialog
    )
    
    from database import (
        get_connection,
        create_tables,
        ensure_cmj_ppu_columns,
        insert_participant,
        insert_trial_data,
        initialize_database
    )
    
    from database_utils import (
        reorder_table,
        reorder_all_tables
    )
