"""
File parsing utilities for Readiness Screen.
Handles XML and ASCII file parsing.
Session XML height/weight are metric (m, kg); we convert to imperial (inches, lbs) for storage.
"""
import os
import re
import xml.etree.ElementTree as ET
import pandas as pd
from typing import Optional, Dict

try:
    from common.units import meters_to_inches, kg_to_lbs
except ImportError:
    from python.common.units import meters_to_inches, kg_to_lbs


# ASCII file mapping
ASCII_FILES = {
    "I": "i_data.txt",
    "Y": "y_data.txt",
    "T": "t_data.txt",
    "IR90": "ir90_data.txt",
    "CMJ": "cmj_data.txt",
    "PPU": "ppu_data.txt"
}

# ---------- Helper functions (like Athletic Screen) ----------

def extract_name(line: str) -> Optional[str]:
    """
    Extract athlete name from file path line.
    
    Args:
        line: First line of the file containing path information.
    
    Returns:
        Extracted name or None if not found.
    """
    # The line contains paths separated by tabs
    # Format: "\tD:\Athletic Screen 2.0\Data\Name_MS_2\2024-11-24__2\..."
    # Split by backslash (chr(92) is backslash) and find the part after "Data"
    try:
        parts = line.split(chr(92))  # Split by backslash character
        
        # Find the index of the part that is exactly "Data"
        data_idx = None
        for i, part in enumerate(parts):
            if part == 'Data':
                data_idx = i
                break
        
        if data_idx is not None and data_idx + 1 < len(parts):
            # The name should be in the next part after Data
            name_part = parts[data_idx + 1]
            # Clean up the name (remove any trailing underscores or spaces)
            name = name_part.strip().strip('_')
            if name:
                return name
    except Exception as e:
        pass
    
    # Fallback: try regex pattern (using raw string to handle backslashes)
    # Pattern: Data\Name\ or Data\Name_
    m = re.search(r'Data\\([^\\]+?)(?=\\|\t|$)', line)
    if m:
        name = m.group(1).strip().strip('_')
        if name:
            return name
    
    return None


def extract_date(line: str) -> Optional[str]:
    """
    Extract date from file path line.
    
    Args:
        line: First line of the file containing path information.
    
    Returns:
        Extracted date (YYYY-MM-DD format) or None if not found.
    """
    # The line contains paths with dates like: "\2024-11-24_" or "\2024-11-24"
    # Split by backslash and find part matching YYYY-MM-DD pattern
    try:
        parts = line.split(chr(92))  # Split by backslash character
        
        # Find part that matches date pattern
        for part in parts:
            m = re.match(r'^(\d{4}-\d{2}-\d{2})', part)
            if m:
                return m.group(1)
    except:
        pass
    
    # Fallback: try regex pattern
    m = re.search(r'(\d{4}-\d{2}-\d{2})', line)
    if m:
        return m.group(1)
    
    return None


def read_first_numeric_row_values(fobj) -> list:
    """
    Read the first numeric row from a file object.
    
    Args:
        fobj: File object to read from.
    
    Returns:
        List of float values from the first numeric line.
    """
    for line in fobj:
        line = line.strip()
        if not line:
            continue
        if re.match(r'^[-+]?\d', line):   # numeric line
            return [float(tok) for tok in line.split()]
    return []

# Headers for different file types
CMJ_PPU_HEADERS = [
    "JH_IN", "LEWIS_PEAK_POWER", "Max_Force",
    "PP_W_per_kg", "PP_FORCEPLATE", "Force_at_PP", "Vel_at_PP"
]

FORCE_HEADERS = [
    "Max_Force", "Max_Force_Norm",
    "Avg_Force", "Avg_Force_Norm", "Time_to_Max"
]


def find_session_xml(folder_path: str) -> Optional[str]:
    """
    Find the Session XML file in a folder.
    
    Args:
        folder_path: Directory to search.
    
    Returns:
        Path to Session XML file or None if not found.
    """
    for root_dir, _, files in os.walk(folder_path):
        for file in files:
            if file.lower().startswith('session') and file.lower().endswith('.xml'):
                return os.path.join(root_dir, file)
    return None


def find_text(element: ET.Element, tag: str) -> Optional[str]:
    """
    Safely find and return text from an XML element.
    
    Args:
        element: XML element to search.
        tag: Tag name to find.
    
    Returns:
        Text content or None if not found.
    """
    found = element.find(tag)
    return found.text if found is not None else None


def parse_xml_file(xml_file_path: str) -> Dict:
    """
    Parse Session XML file and extract participant information.
    
    Args:
        xml_file_path: Path to Session XML file.
    
    Returns:
        Dictionary with parsed XML data.
    """
    tree = ET.parse(xml_file_path)
    xml_root = tree.getroot()
    
    session_fields = xml_root.find(".//Session/Fields")
    if session_fields is None:
        raise ValueError("Session/Fields not found in XML file")
    
    name = find_text(session_fields, "Name")
    gender = find_text(session_fields, "Gender")
    height = find_text(session_fields, "Height")
    weight = find_text(session_fields, "Weight")
    plyo_day = find_text(session_fields, "Plyo_Day")
    creation_date = find_text(session_fields, "Creation_date")
    
    if None in [name, height, weight, plyo_day, creation_date]:
        raise ValueError("Missing required data in XML file")
    
    # Session XML provides height in m, weight in kg; convert to inches and lbs for storage
    h_m = float(height) if height else None
    w_kg = float(weight) if weight else None
    height_in = meters_to_inches(h_m) if h_m is not None else None
    weight_lb = kg_to_lbs(w_kg) if w_kg is not None else None
    return {
        'name': name,
        'gender': gender,
        'height': height_in,
        'weight': weight_lb,
        'plyo_day': plyo_day,
        'creation_date': creation_date
    }


def parse_ascii_file(file_path: str, movement_type: str) -> pd.DataFrame:
    """
    Parse an ASCII data file for a specific movement type.
    
    Args:
        file_path: Path to ASCII file.
        movement_type: Movement type (I, Y, T, IR90, CMJ, or PPU).
    
    Returns:
        DataFrame with parsed data.
    """
    if movement_type in {"CMJ", "PPU"}:
        headers = CMJ_PPU_HEADERS
    else:
        headers = FORCE_HEADERS
    
    df = pd.read_csv(file_path, sep=r'\s+', skiprows=5, names=headers)
    return df


def parse_txt_file(file_path: str, movement_type: str) -> Optional[Dict]:
    """
    Parse a txt file and extract participant info and data.
    Similar to Athletic Screen's parse_movement_file.
    
    Args:
        file_path: Path to txt file.
        movement_type: Movement type (I, Y, T, IR90, CMJ, or PPU).
    
    Returns:
        Dictionary with parsed data including name, date, and movement metrics.
    """
    try:
        # Read file with proper encoding
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
            
            if not lines:
                print(f"File is empty: {os.path.basename(file_path)}")
                return None
            
            # Read first line to extract name and date
            first_line = lines[0]
            name = extract_name(first_line)
            date = extract_date(first_line)
            
            if not name:
                print(f"Name extraction failed for {os.path.basename(file_path)}, skipping.")
                print(f"  First line: {first_line[:100]}")
                return None
            
            if not date:
                print(f"Date extraction failed for {os.path.basename(file_path)}, skipping.")
                print(f"  First line: {first_line[:100]}")
                return None
            
            # Find first numeric row (skip header rows)
            # Format: line 0 = paths, line 1 = headers, line 2-4 = metadata, line 5+ = data
            # Data row format: "1\t127.4\t1.7\t105.7\t1.38\t2.73" (tab-separated, first col is row number)
            v = None
            for i, line in enumerate(lines[5:], start=5):  # Start from line 5 (0-indexed)
                line = line.strip()
                if not line:
                    continue
                if re.match(r'^\d', line):   # numeric line (starts with digit)
                    try:
                        # Split by tab (not space) and skip first column (row number)
                        parts = line.split('\t')
                        if len(parts) > 1:
                            v = [float(tok) for tok in parts[1:]]  # Skip first column
                        else:
                            # Fallback: split by whitespace
                            v = [float(tok) for tok in line.split()[1:]]  # Skip first column
                        break
                    except (ValueError, IndexError):
                        continue
            
            if not v:
                print(f"No numeric data found in {os.path.basename(file_path)}, skipping.")
                return None
            
            # Build data dictionary based on movement type
            if movement_type in {"CMJ", "PPU"}:
                if len(v) < 7:
                    print(f"Unexpected column count for {os.path.basename(file_path)}: {len(v)}; skipping.")
                    return None
                
                data = {
                    'name': name,
                    'date': date,
                    'movement_type': movement_type,
                    'JH_IN': v[0] if len(v) > 0 else None,
                    'LEWIS_PEAK_POWER': v[1] if len(v) > 1 else None,
                    'Max_Force': v[2] if len(v) > 2 else None,
                    'PP_W_per_kg': v[3] if len(v) > 3 else None,
                    'PP_FORCEPLATE': v[4] if len(v) > 4 else None,
                    'Force_at_PP': v[5] if len(v) > 5 else None,
                    'Vel_at_PP': v[6] if len(v) > 6 else None
                }
            else:
                # I, Y, T, IR90
                if len(v) < 5:
                    print(f"Unexpected column count for {os.path.basename(file_path)}: {len(v)}; skipping.")
                    return None
                
                data = {
                    'name': name,
                    'date': date,
                    'movement_type': movement_type,
                    'Max_Force': v[0] if len(v) > 0 else None,
                    'Max_Force_Norm': v[1] if len(v) > 1 else None,
                    'Avg_Force': v[2] if len(v) > 2 else None,
                    'Avg_Force_Norm': v[3] if len(v) > 3 else None,
                    'Time_to_Max': v[4] if len(v) > 4 else None
                }
            
            return data
            
    except Exception as e:
        print(f"Unexpected error with file {os.path.basename(file_path)}: {e}")
        return None


def select_folder_dialog(initial_dir: Optional[str] = None) -> Optional[str]:
    """
    Open a folder selection dialog.
    
    Args:
        initial_dir: Initial directory for the dialog. If None, uses READINESS_SCREEN_DATA_DIR env var.
    
    Returns:
        Selected folder path or None if cancelled.
    """
    if initial_dir is None:
        initial_dir = os.getenv('READINESS_SCREEN_DATA_DIR', 'D:/Readiness Screen 3/Data/')
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.lift()
        root.attributes("-topmost", True)
        selected_folder = filedialog.askdirectory(initialdir=initial_dir)
        root.attributes("-topmost", False)
        root.destroy()
        return selected_folder
    except Exception as e:
        print(f"Error opening folder dialog: {e}")
        return None

