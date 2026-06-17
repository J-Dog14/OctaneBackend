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


def get_google_credentials(credentials_path: str, token_path: Optional[str] = None) -> "Optional[Credentials]":
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


def download_google_sheet_as_excel(credentials: "Credentials", sheet_id: str, output_path: str) -> bool:
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


def _find_drive_folder_id(service, folder_name: str, parent_id: str = 'root') -> Optional[str]:
    """Find a Drive folder by name under a parent, return its ID."""
    q = (
        f"name='{folder_name}'"
        f" and mimeType='application/vnd.google-apps.folder'"
        f" and '{parent_id}' in parents"
        f" and trashed=false"
    )
    resp = service.files().list(q=q, fields='files(id, name)').execute()
    files = resp.get('files', [])
    return files[0]['id'] if files else None


def _list_sheets_in_folder(service, folder_id: str) -> list:
    """Return [{id, name}, ...] for every Google Sheet in folder_id."""
    results = []
    page_token = None
    while True:
        q = (
            f"'{folder_id}' in parents"
            f" and mimeType='application/vnd.google-apps.spreadsheet'"
            f" and trashed=false"
        )
        resp = service.files().list(
            q=q,
            spaces='drive',
            fields='nextPageToken, files(id, name, createdTime)',
            pageToken=page_token
        ).execute()
        results.extend(resp.get('files', []))
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return results


def download_missing_sheets(
    excel_directory: str,
    gsheet_directory: str,
    credentials_path: str
) -> Dict[str, Any]:
    """
    Download missing Google Sheets as Excel files.

    Uses the Drive API to list files in the folder — bypasses reading local
    .gsheet files, which cannot be opened on Windows Google Drive for Desktop.

    Args:
        excel_directory: Directory where Excel files should be stored
        gsheet_directory: Path to the synced Google Drive folder (used to
            derive the folder name for the Drive API search)
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

    # Build Drive service
    service = build('drive', 'v3', credentials=creds)

    # Find the folder in Drive by name.
    # gsheet_directory is something like "G:\My Drive\Data\Mobility Assessments"
    # We search from the root for the leaf folder name.
    folder_name = Path(gsheet_directory).name  # "Mobility Assessments"
    print(f"Searching Drive for folder: {folder_name}")

    folder_id = _find_drive_folder_id(service, folder_name)
    if not folder_id:
        # Try searching under "Data" parent if top-level search fails
        parent_name = Path(gsheet_directory).parent.name  # "Data"
        parent_id = _find_drive_folder_id(service, parent_name)
        if parent_id:
            folder_id = _find_drive_folder_id(service, folder_name, parent_id)

    if not folder_id:
        return {
            'success': False,
            'error': f'Could not find Drive folder "{folder_name}" via API',
            'downloaded': 0,
            'failed': 0
        }

    print(f"[OK] Found Drive folder ID: {folder_id}")

    # Get existing Excel files in the cache directory
    excel_dir = Path(excel_directory)
    excel_dir.mkdir(parents=True, exist_ok=True)
    existing_excel = {f.stem.lower() for f in excel_dir.glob("*.xlsx")}

    # List all Sheets in the Drive folder via API (no local file reading)
    drive_files = _list_sheets_in_folder(service, folder_id)
    print(f"\nFound {len(drive_files)} Google Sheets in Drive folder")
    print(f"Found {len(existing_excel)} existing Excel files in cache")

    # Only download files we don't have yet (compare using sanitized name since that's what's on disk)
    def _safe(n: str) -> str:
        return n.replace('/', '-').replace('\\', '-').replace(':', '-').lower()

    missing = [
        f for f in drive_files
        if _safe(f['name']) not in existing_excel
        and 'template' not in f['name'].lower()
    ]

    if not missing:
        print("All files already downloaded")
        return {'success': True, 'downloaded': 0, 'failed': 0, 'message': 'All files already exist'}

    print(f"\nDownloading {len(missing)} missing files...")

    downloaded = 0
    failed = 0
    errors = []

    for drive_file in missing:
        name = drive_file['name']
        file_id = drive_file['id']
        # Sanitize name for Windows filesystem — "/" is illegal in filenames
        safe_name = name.replace('/', '-').replace('\\', '-').replace(':', '-')
        output_path = excel_dir / (safe_name + '.xlsx')
        print(f"\nProcessing: {name}")

        if download_google_sheet_as_excel(creds, file_id, str(output_path)):
            print(f"   [OK] Downloaded successfully")
            downloaded += 1
            # Write sidecar with Drive createdTime so ingestion uses the real assessment date
            created_date = drive_file.get('createdTime', '')[:10]  # "2026-01-15"
            if created_date:
                (output_path.parent / (output_path.name + '.date')).write_text(created_date)
        else:
            print(f"   [FAIL] Download failed")
            failed += 1
            errors.append(f"{name}: Download failed")

    return {
        'success': True,
        'downloaded': downloaded,
        'failed': failed,
        'errors': errors
    }
