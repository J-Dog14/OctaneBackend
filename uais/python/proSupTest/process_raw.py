"""
Legacy process_raw.py - DEPRECATED

This file has been refactored into multiple modules:
- database.py: Database operations
- file_parsers.py: XML and ASCII file parsing
- score_calculation.py: Fatigue indices and scoring
- report_generation.py: PDF report generation
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
        extract_test_date_from_folder,
        extract_test_date_from_ascii,
        parse_xml_file,
        parse_ascii_file,
        select_folder_dialog
    )
    
    from database import (
        get_connection,
        insert_xml_data,
        update_ascii_data,
        load_all_data,
        save_dataframe
    )
    
    from score_calculation import (
        calculate_fatigue_indices,
        calculate_total_fatigue_score,
        calculate_consistency_penalty,
        calculate_total_score,
        calculate_all_scores
    )
