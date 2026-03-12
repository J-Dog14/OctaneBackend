"""
I/O utilities for UAIS.
Generic file loaders for CSV, XML, Excel, and safe path utilities.
"""
import pandas as pd
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Optional, Union
import os


def safe_path(path: Union[str, Path]) -> Path:
    """
    Convert a path string to a Path object and expand user/home.
    
    Args:
        path: Path string or Path object.
    
    Returns:
        Path object with expanded user directory.
    """
    return Path(path).expanduser().resolve()


def load_csv(file_path: Union[str, Path], **kwargs) -> pd.DataFrame:
    """
    Load a CSV file into a pandas DataFrame.
    
    Args:
        file_path: Path to CSV file.
        **kwargs: Additional arguments passed to pd.read_csv.
    
    Returns:
        DataFrame containing CSV data.
    """
    path = safe_path(file_path)
    
    if not path.exists():
        raise FileNotFoundError(f"CSV file not found: {path}")
    
    return pd.read_csv(path, **kwargs)


def load_excel(file_path: Union[str, Path], sheet_name: Optional[Union[str, int]] = None,
               **kwargs) -> pd.DataFrame:
    """
    Load an Excel file into a pandas DataFrame.
    
    Args:
        file_path: Path to Excel file.
        sheet_name: Sheet name or index (defaults to first sheet).
        **kwargs: Additional arguments passed to pd.read_excel.
    
    Returns:
        DataFrame containing Excel data.
    """
    path = safe_path(file_path)
    
    if not path.exists():
        raise FileNotFoundError(f"Excel file not found: {path}")
    
    return pd.read_excel(path, sheet_name=sheet_name, **kwargs)


def load_xml(file_path: Union[str, Path]) -> ET.ElementTree:
    """
    Load an XML file and return ElementTree.
    
    Args:
        file_path: Path to XML file.
    
    Returns:
        ElementTree object.
    """
    path = safe_path(file_path)
    
    if not path.exists():
        raise FileNotFoundError(f"XML file not found: {path}")
    
    return ET.parse(path)


def find_files(directory: Union[str, Path], pattern: str = "*",
               recursive: bool = True) -> List[Path]:
    """
    Find files matching a pattern in a directory.
    
    Args:
        directory: Directory to search.
        pattern: Glob pattern (e.g., "*.csv", "*.xml").
        recursive: Whether to search subdirectories.
    
    Returns:
        List of matching file paths.
    """
    dir_path = safe_path(directory)
    
    if not dir_path.exists():
        raise FileNotFoundError(f"Directory not found: {dir_path}")
    
    if recursive:
        return list(dir_path.rglob(pattern))
    else:
        return list(dir_path.glob(pattern))


def ensure_directory(path: Union[str, Path]) -> Path:
    """
    Ensure a directory exists, creating it if necessary.
    
    Args:
        path: Directory path.
    
    Returns:
        Path object pointing to the directory.
    """
    dir_path = safe_path(path)
    dir_path.mkdir(parents=True, exist_ok=True)
    return dir_path


if __name__ == "__main__":
    # Example usage
    print("Testing I/O utilities...")
    
    # Test safe_path
    test_path = safe_path("~/test")
    print(f"Safe path: {test_path}")
    
    # Test find_files (will only work if directory exists)
    try:
        files = find_files(".", "*.py", recursive=False)
        print(f"Found {len(files)} Python files in current directory")
    except Exception as e:
        print(f"Error finding files: {e}")

