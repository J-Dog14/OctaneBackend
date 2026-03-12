"""
File parsing utilities for Pro-Sup Test.
Handles XML and ASCII file parsing.
"""
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Optional, Dict
import pandas as pd


def find_session_xml(folder_path: str) -> Optional[str]:
    """
    Find the Session XML file in a folder.
    
    Args:
        folder_path: Directory to search.
    
    Returns:
        Path to Session XML file or None if not found.
    """
    for r, dirs, files in os.walk(folder_path):
        for file in files:
            if file.lower().startswith('session') and file.lower().endswith('.xml'):
                return os.path.join(r, file)
    return None


def extract_test_date_from_folder(folder_path: str) -> str:
    """
    Extract test date from folder name.
    
    Args:
        folder_path: Full path to folder (e.g., '2024-08-13_105_Growth Plate_').
    
    Returns:
        Test date in 'YYYY-MM-DD' format.
    """
    folder_name = os.path.basename(folder_path)
    test_date = folder_name.split('_', 1)[0]  # Extract '2024-08-13'
    return test_date


def extract_test_date_from_ascii(ascii_file_path: str) -> str:
    """
    Extract test date from ASCII file path structure.
    
    Args:
        ascii_file_path: Path to the ASCII file.
    
    Returns:
        Test date in 'YYYY-MM-DD' format.
    """
    with open(ascii_file_path, 'r') as file:
        lines = file.readlines()
        # Extract the first file path
        first_file_path = lines[0].strip().split('\t')[0]
        # Split the path to navigate the folder structure
        parts = first_file_path.split('\\')  # Split by folder structure
        if len(parts) > 4:  # Ensure we have enough subfolders
            date_folder = parts[4]  # Get the folder containing the date
            # Use regex to extract 'YYYY-MM-DD' format
            match = re.match(r'^\d{4}-\d{2}-\d{2}', date_folder)
            if match:
                return match.group(0)  # Return the matched date
            else:
                raise ValueError(f"Unable to extract test date from folder: {date_folder}")
        else:
            raise ValueError("Unexpected file path structure: Unable to extract test date.")


def parse_xml_file(xml_file_path: str, test_date: str) -> Dict:
    """
    Parse Session XML file and extract athlete information.
    
    Args:
        xml_file_path: Path to Session XML file.
        test_date: Test date string.
    
    Returns:
        Dictionary with parsed XML data.
    """
    tree = ET.parse(xml_file_path)
    root_xml = tree.getroot()
    
    # Helper function to safely extract text from XML element
    def safe_get_text(xpath: str, default: Optional[str] = None) -> Optional[str]:
        elem = root_xml.find(xpath)
        return elem.text if elem is not None and elem.text else default
    
    # Extract required fields from XML (handle missing fields gracefully)
    name = safe_get_text(".//Name")
    if not name:
        raise ValueError("Name field is required in XML file")
    
    dob = safe_get_text(".//DOB")
    gender = safe_get_text(".//Gender")
    height = safe_get_text(".//Height")
    weight = safe_get_text(".//Weight")
    injury_history = safe_get_text(".//Injury_History")
    season_phase = safe_get_text(".//Season_Phase")
    dynomometer_score = safe_get_text(".//Dynamometer_Score_Dominant")
    comments = safe_get_text(".//Comments")
    
    # Calculate age from DOB (if available)
    age = None
    if dob:
        try:
            dob_date = datetime.strptime(dob, "%Y-%m-%d")
            today = datetime.today()
            age = today.year - dob_date.year - ((today.month, today.day) < (dob_date.month, dob_date.day))
        except:
            pass
    
    # Create data dictionary with XML data and NULL for ASCII columns
    data = {
        'name': name,
        'test_date': test_date,
        'age': age,
        'gender': gender,
        'height': height,
        'weight': weight,
        'injury_history': injury_history,
        'season_phase': season_phase,
        'dynomometer_score': dynomometer_score,
        'comments': comments,
        'forearm_rom_0to10': None,
        'forearm_rom_10to20': None,
        'forearm_rom_20to30': None,
        'forearm_rom': None,
        'tot_rom_0to10': None,
        'tot_rom_10to20': None,
        'tot_rom_20to30': None,
        'tot_rom': None,
        'num_of_flips_0_10': None,
        'num_of_flips_10_20': None,
        'num_of_flips_20_30': None,
        'num_of_flips': None,
        'avg_velo_0_10': None,
        'avg_velo_10_20': None,
        'avg_velo_20_30': None,
        'avg_velo': None
    }
    
    return data


def parse_ascii_file(ascii_file_path: str) -> Dict:
    """
    Parse ASCII data file and extract metrics.
    
    Args:
        ascii_file_path: Path to ASCII file.
    
    Returns:
        Dictionary with parsed ASCII data (column names as keys).
    """
    with open(ascii_file_path, 'r') as file:
        lines = file.readlines()
        data = [line.strip().split('\t') for line in lines]
    
    # Extract header and data rows
    header = data[1]
    df_data = [row[1:] for row in data[5:]]
    df_ascii = pd.DataFrame(df_data, columns=header)
    
    # Replace hyphens with underscores in column names
    df_ascii.columns = [col.replace('-', '_') for col in df_ascii.columns]
    
    # Get first row (assuming single row of data)
    row_ascii = df_ascii.iloc[0]
    
    # Extract ASCII data as dictionary
    values = {col: row_ascii.get(col) for col in df_ascii.columns}
    
    return values


def select_folder_dialog(initial_dir: Optional[str] = None) -> Optional[str]:
    """
    Open a folder selection dialog.
    
    Args:
        initial_dir: Initial directory for the dialog. If None, uses PRO_SUP_DATA_DIR env var.
    
    Returns:
        Selected folder path or None if cancelled.
    """
    if initial_dir is None:
        initial_dir = os.getenv('PRO_SUP_DATA_DIR', 'D:/Pro-Sup Test/Data/')
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()  # Hide the root window
        root.lift()
        root.attributes("-topmost", True)
        selected_folder = filedialog.askdirectory(initialdir=initial_dir)
        root.attributes("-topmost", False)
        root.destroy()
        return selected_folder
    except Exception as e:
        print(f"Error opening folder dialog: {e}")
        return None

