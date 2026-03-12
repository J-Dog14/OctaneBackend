"""
File parsing utilities for Athletic Screen raw data files.
Handles extraction of athlete names, dates, and movement metrics from text files.
"""
import os
import re
from math import inf
from typing import Optional, List


def extract_name(line: str) -> Optional[str]:
    """
    Extract athlete name from file path line.
    
    Args:
        line: First line of the file containing path information.
    
    Returns:
        Extracted name or None if not found.
    """
    m = re.search(r'Data\\(.*?)[_\\]', line)
    return m.group(1) if m else None


def extract_date(line: str) -> Optional[str]:
    """
    Extract date from file path line.
    
    Args:
        line: First line of the file containing path information.
    
    Returns:
        Extracted date (YYYY-MM-DD format) or None if not found.
    """
    m = re.search(r'\\(\d{4}-\d{2}-\d{2})_', line)
    return m.group(1) if m else None


def read_first_numeric_row_values(fobj) -> List[float]:
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


def peak_power_from_pow_file(trial_name_base: str, folder_path: str) -> Optional[float]:
    """
    Look for '{trial_name_base}_Power.txt' and parse peak power.
    
    Args:
        trial_name_base: Base name of the trial (without extension).
        folder_path: Directory containing power files.
    
    Returns:
        Peak power value or None if not found/empty.
    """
    power_file = os.path.join(folder_path, f"{trial_name_base}_Power.txt")
    power_file = os.path.normpath(os.path.abspath(power_file))
    if not os.path.exists(power_file):
        return None

    peak = -inf
    try:
        with open(power_file, 'r', encoding='utf-8', errors='ignore') as pf:
            # Skip header lines until numeric rows start
            for line in pf:
                line = line.strip()
                if not line:
                    continue
                if re.match(r'^\d+\s+', line):  # rows like "1\t0.00000"
                    parts = line.split()
                    if len(parts) >= 2:
                        val = float(parts[1])
                        if val > peak:
                            peak = val
                    break
            # Continue consuming rest of numeric rows
            for line in pf:
                line = line.strip()
                if not line or not re.match(r'^\d+\s+', line):
                    continue
                parts = line.split()
                if len(parts) >= 2:
                    val = float(parts[1])
                    if val > peak:
                        peak = val
    except Exception:
        return None

    return None if peak == -inf else peak


def classify_movement_type(trial_name: str) -> Optional[str]:
    """
    Classify movement type based on trial name.
    
    Args:
        trial_name: Name of the trial file (without extension).
    
    Returns:
        Movement type ('CMJ', 'DJ', 'PPU', 'SLV', 'NMT') or None.
    """
    if 'CMJ' in trial_name:
        return 'CMJ'
    elif 'PPU' in trial_name:
        return 'PPU'
    elif 'DJ' in trial_name:
        return 'DJ'
    elif 'SLVL' in trial_name or 'SLVR' in trial_name:
        return 'SLV'
    elif 'NMT' in trial_name:
        return 'NMT'
    return None


def parse_movement_file(file_path: str, folder_path: str) -> Optional[dict]:
    """
    Parse a movement data file and extract all relevant information.
    
    Args:
        file_path: Full path to the movement data file.
        folder_path: Directory containing power files.
    
    Returns:
        Dictionary with parsed data or None if parsing fails.
    """
    trial_name = os.path.splitext(os.path.basename(file_path))[0]
    movement_type = classify_movement_type(trial_name)
    
    if not movement_type:
        return None
    
    try:
        # Normalize the file path and ensure it exists
        file_path = os.path.normpath(os.path.abspath(file_path))
        if not os.path.exists(file_path):
            print(f"File does not exist: {file_path}")
            return None
        
        # Open with explicit encoding to handle Windows paths
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            first_line = f.readline().strip()
            name = extract_name(first_line)
            date = extract_date(first_line)
            # First line (or first column) is the source .c3d path, e.g. D:\Athletic Screen 2.0\Data\Name_ID\2026-01-23_\CMJ 1.c3d
            # Used to find session.xml in the same session folder for DOB
            source_path = first_line.split('\t')[0].strip() if first_line else None
            if source_path and not os.path.isabs(source_path):
                source_path = os.path.normpath(os.path.join(os.path.dirname(file_path), source_path))

            if not name:
                print(f"Name extraction failed for {os.path.basename(file_path)}, skipping.")
                return None

            variables = read_first_numeric_row_values(f)
            if not variables:
                print(f"No numeric data found in {os.path.basename(file_path)}, skipping.")
                return None

            # Drop leading dummy "1" if present
            v = variables[1:] if variables and variables[0] == 1.0 else variables[:]

            # Parse based on movement type
            result = {
                'name': name,
                'date': date,
                'trial_name': trial_name,
                'movement_type': movement_type,
                'source_path': source_path,
            }

            if movement_type in ('CMJ', 'PPU'):
                peak_power = peak_power_from_pow_file(trial_name, folder_path)
                if len(v) == 5:
                    JH, PP_FP, F_at_PP, V_at_PP, Wkg = v
                elif len(v) == 6:
                    JH = v[0]
                    if peak_power is None:
                        peak_power = v[1]
                    PP_FP, F_at_PP, V_at_PP, Wkg = v[-4:]
                else:
                    print(f"Unexpected column count for {os.path.basename(file_path)}: {len(v)}; skipping.")
                    return None
                
                result.update({
                    'JH_IN': JH,
                    'Peak_Power': peak_power,
                    'PP_FORCEPLATE': PP_FP,
                    'Force_at_PP': F_at_PP,
                    'Vel_at_PP': V_at_PP,
                    'PP_W_per_kg': Wkg
                })

            elif movement_type == 'DJ':
                if len(v) != 7:
                    print(f"Unexpected DJ column count for {os.path.basename(file_path)}: {len(v)}; expected 7. Skipping.")
                    return None
                
                JH, PP_FP, F_at_PP, V_at_PP, CT, RSI, Wkg = v
                result.update({
                    'JH_IN': JH,
                    'PP_FORCEPLATE': PP_FP,
                    'Force_at_PP': F_at_PP,
                    'Vel_at_PP': V_at_PP,
                    'PP_W_per_kg': Wkg,
                    'CT': CT,
                    'RSI': RSI
                })

            elif movement_type == 'SLV':
                side = 'Left' if 'SLVL' in trial_name else 'Right'
                if len(v) == 6:
                    # Drop Peak_Power if present
                    JH, PP_FP, F_at_PP, V_at_PP, Wkg = v[0], v[2], v[3], v[4], v[5]
                elif len(v) == 5:
                    JH, PP_FP, F_at_PP, V_at_PP, Wkg = v
                else:
                    print(f"Unexpected SLV column count for {os.path.basename(file_path)}: {len(v)}; skipping.")
                    return None
                
                result.update({
                    'side': side,
                    'JH_IN': JH,
                    'PP_FORCEPLATE': PP_FP,
                    'Force_at_PP': F_at_PP,
                    'Vel_at_PP': V_at_PP,
                    'PP_W_per_kg': Wkg
                })

            elif movement_type == 'NMT':
                if len(v) != 4:
                    print(f"Unexpected NMT column count for {os.path.basename(file_path)}: {len(v)}; skipping.")
                    return None
                
                result.update({
                    'NUM_TAPS_10s': v[0],
                    'NUM_TAPS_20s': v[1],
                    'NUM_TAPS_30s': v[2],
                    'NUM_TAPS': v[3]
                })

            return result

    except Exception as e:
        import traceback
        print(f"Unexpected error with file {os.path.basename(file_path)}: {e}")
        print(f"Full file path: {file_path}")
        print(f"File exists: {os.path.exists(file_path) if 'file_path' in locals() else 'N/A'}")
        traceback.print_exc()
        return None

