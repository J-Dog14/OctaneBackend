"""
Google Drive and Sheets API utilities for downloading mobility assessment files.
"""
import os
import json
from pathlib import Path
from typing import Optional, Dict, Any
import pickle

try:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
    import io
    GOOGLE_API_AVAILABLE = True
except ImportError:
    GOOGLE_API_AVAILABLE = False
    print("Warning: Google API libraries not installed. Install with: pip install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client")


# Scopes required for Google Drive and Sheets
SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly'
]


def get_google_credentials(credentials_path: str, token_path: Optional[str] = None) -> Optional[Credentials]:
    """
    Authenticate with Google using OAuth 2.0.
    
    Args:
        credentials_path: Path to client_secret JSON file
        token_path: Path to store/load token (defaults to token.pickle in same dir)
        
    Returns:
        Credentials object if successful, None otherwise
    """
    if not GOOGLE_API_AVAILABLE:
        print("Error: Google API libraries not available")
        return None
    
    if token_path is None:
        token_path = str(Path(credentials_path).parent / "token.pickle")
    
    creds = None
    
    # Load existing token if available
    if os.path.exists(token_path):
        try:
            with open(token_path, 'rb') as token:
                creds = pickle.load(token)
        except Exception as e:
            print(f"Warning: Could not load existing token: {e}")
    
    # If there are no (valid) credentials available, let the user log in
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception as e:
                print(f"Error refreshing token: {e}")
                creds = None
        
        if not creds:
            try:
                flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
                creds = flow.run_local_server(port=0)
            except Exception as e:
                print(f"Error during authentication: {e}")
                return None
        
        # Save the credentials for the next run
        try:
            with open(token_path, 'wb') as token:
                pickle.dump(creds, token)
        except Exception as e:
            print(f"Warning: Could not save token: {e}")
    
    return creds


def extract_sheet_id_from_gsheet(gsheet_path: str) -> Optional[str]:
    """
    Extract Google Sheet ID from a .gsheet file.
    
    .gsheet files are JSON files that contain metadata about the Google Sheet.
    
    Args:
        gsheet_path: Path to .gsheet file
        
    Returns:
        Google Sheet ID if found, None otherwise
    """
    try:
        with open(gsheet_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # .gsheet files can have different structures
        # Try to find the sheet ID or URL
        if isinstance(data, dict):
            # Check for direct ID
            if 'id' in data:
                return data['id']
            
            # Check for URL
            for key in ['url', 'urlKey', 'alternateUrl', 'webViewLink', 'webContentLink']:
                if key in data and isinstance(data[key], str):
                    url = data[key]
                    if 'docs.google.com/spreadsheets/d/' in url:
                        # Extract ID from URL
                        parts = url.split('/d/')
                        if len(parts) > 1:
                            sheet_id = parts[1].split('/')[0]
                            return sheet_id
            
            # Check nested structures
            if 'drive' in data and isinstance(data['drive'], dict):
                for key in ['id', 'url', 'alternateUrl']:
                    if key in data['drive']:
                        value = data['drive'][key]
                        if isinstance(value, str):
                            if 'docs.google.com/spreadsheets/d/' in value:
                                parts = value.split('/d/')
                                if len(parts) > 1:
                                    return parts[1].split('/')[0]
                            elif len(value) > 20:  # Might be a direct ID
                                return value
            
            # Check for fileReference or similar
            if 'fileReference' in data:
                ref = data['fileReference']
                if isinstance(ref, dict) and 'id' in ref:
                    return ref['id']
                elif isinstance(ref, str):
                    return ref
        
        # If it's a string, try to parse as URL
        elif isinstance(data, str):
            if 'docs.google.com/spreadsheets/d/' in data:
                parts = data.split('/d/')
                if len(parts) > 1:
                    return parts[1].split('/')[0]
    
    except Exception as e:
        # Don't print full path in error (might contain sensitive info or cause encoding issues)
        file_name = os.path.basename(gsheet_path) if os.path.exists(gsheet_path) else "unknown"
        print(f"   [WARN] Error reading .gsheet file {file_name}: {type(e).__name__}: {str(e)}")
    
    return None


def download_google_sheet_as_excel(credentials: Credentials, sheet_id: str, output_path: str) -> bool:
    """
    Download a Google Sheet as an Excel file using Google Drive API.
    
    Args:
        credentials: Google API credentials
        sheet_id: Google Sheet ID
        output_path: Path where to save the Excel file
        
    Returns:
        True if successful, False otherwise
    """
    if not GOOGLE_API_AVAILABLE:
        return False
    
    try:
        # Build the Drive API service
        service = build('drive', 'v3', credentials=credentials)
        
        # Request to export as Excel
        request = service.files().export_media(
            fileId=sheet_id,
            mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        
        # Download the file
        with open(output_path, 'wb') as f:
            downloader = MediaIoBaseDownload(f, request)
            done = False
            while done is False:
                status, done = downloader.next_chunk()
                if status:
                    print(f"   Download progress: {int(status.progress() * 100)}%")
        
        return True
        
    except Exception as e:
        print(f"Error downloading Google Sheet {sheet_id}: {e}")
        return False


def find_gsheet_file_by_name(gsheet_name: str, gsheet_directory: str) -> Optional[str]:
    """
    Find a .gsheet file by name (without extension) in the directory.
    
    Args:
        gsheet_name: Name of the file (with or without .gsheet extension)
        gsheet_directory: Directory to search in
        
    Returns:
        Full path to .gsheet file if found, None otherwise
    """
    # Remove .gsheet extension if present
    if gsheet_name.lower().endswith('.gsheet'):
        gsheet_name = gsheet_name[:-7]
    
    # Also remove .xlsx extension if present (for matching)
    if gsheet_name.lower().endswith('.xlsx'):
        gsheet_name = gsheet_name[:-5]
    
    gsheet_path = Path(gsheet_directory) / f"{gsheet_name}.gsheet"
    
    if gsheet_path.exists():
        return str(gsheet_path)
    
    return None


def download_missing_sheets(
    excel_directory: str,
    gsheet_directory: str,
    credentials_path: str
) -> Dict[str, Any]:
    """
    Download missing Google Sheets as Excel files.
    
    Compares .gsheet files in gsheet_directory with .xlsx files in excel_directory,
    and downloads any missing ones.
    
    Args:
        excel_directory: Directory where Excel files should be stored
        gsheet_directory: Directory containing .gsheet files
        credentials_path: Path to Google API credentials JSON file
        
    Returns:
        Dictionary with download results
    """
    if not GOOGLE_API_AVAILABLE:
        return {
            'success': False,
            'error': 'Google API libraries not available',
            'downloaded': 0,
            'failed': 0
        }
    
    # Authenticate
    print("Authenticating with Google...")
    creds = get_google_credentials(credentials_path)
    if not creds:
        return {
            'success': False,
            'error': 'Failed to authenticate with Google',
            'downloaded': 0,
            'failed': 0
        }
    print("[OK] Authentication successful")
    
    # Get list of existing Excel files
    excel_dir = Path(excel_directory)
    existing_excel = set()
    if excel_dir.exists():
        for file in excel_dir.glob("*.xlsx"):
            # Remove extension for matching
            name_without_ext = file.stem
            existing_excel.add(name_without_ext.lower())
    
    # Get list of .gsheet files
    gsheet_dir = Path(gsheet_directory)
    if not gsheet_dir.exists():
        return {
            'success': False,
            'error': f'Google Sheets directory not found: {gsheet_directory}',
            'downloaded': 0,
            'failed': 0
        }
    
    gsheet_files = list(gsheet_dir.glob("*.gsheet"))
    
    print(f"\nFound {len(gsheet_files)} .gsheet files")
    print(f"Found {len(existing_excel)} existing Excel files")
    
    # Find missing files
    missing_files = []
    for gsheet_file in gsheet_files:
        name_without_ext = gsheet_file.stem.lower()
        if name_without_ext not in existing_excel:
            missing_files.append(gsheet_file)
    
    if not missing_files:
        print("All files already downloaded")
        return {
            'success': True,
            'downloaded': 0,
            'failed': 0,
            'message': 'All files already exist'
        }
    
    print(f"\nDownloading {len(missing_files)} missing files...")
    
    # Download missing files
    downloaded = 0
    failed = 0
    errors = []
    
    for gsheet_file in missing_files:
        print(f"\nProcessing: {gsheet_file.name}")
        
        # Extract sheet ID
        sheet_id = extract_sheet_id_from_gsheet(str(gsheet_file))
        if not sheet_id:
            print(f"   [FAIL] Could not extract sheet ID from .gsheet file")
            failed += 1
            errors.append(f"{gsheet_file.name}: Could not extract sheet ID")
            continue
        
        print(f"   Found sheet ID: {sheet_id}")
        
        # Determine output filename (use .gsheet name but with .xlsx extension)
        output_filename = gsheet_file.stem + ".xlsx"
        output_path = excel_dir / output_filename
        
        # Download
        print(f"   Downloading to: {output_filename}")
        if download_google_sheet_as_excel(creds, sheet_id, str(output_path)):
            print(f"   [OK] Downloaded successfully")
            downloaded += 1
        else:
            print(f"   [FAIL] Download failed")
            failed += 1
            errors.append(f"{gsheet_file.name}: Download failed")
    
    return {
        'success': True,
        'downloaded': downloaded,
        'failed': failed,
        'errors': errors
    }
