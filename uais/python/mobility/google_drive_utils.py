"""
Google Drive and Sheets API utilities for downloading mobility assessment files.
"""
import os
import json
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime, timezone
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
            fields='nextPageToken, files(id, name, createdTime, modifiedTime)',
            pageToken=page_token
        ).execute()
        results.extend(resp.get('files', []))
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return results


MANIFEST_NAME = "_drive_manifest.json"


def _safe_name(n: str) -> str:
    """Windows-safe file stem ("/" etc. are illegal in filenames)."""
    return n.replace('/', '-').replace('\\', '-').replace(':', '-').strip()


def _drive_timestamp(iso_str: str) -> float:
    # Drive returns RFC3339, e.g. "2026-09-22T14:23:01.123Z"
    return datetime.strptime(iso_str[:19], '%Y-%m-%dT%H:%M:%S').replace(
        tzinfo=timezone.utc
    ).timestamp()


def load_manifest(excel_dir: Path) -> Dict[str, Dict[str, Any]]:
    """{drive_id: {file, name, createdTime, modifiedTime}} for every sheet we've cached."""
    p = excel_dir / MANIFEST_NAME
    if p.exists():
        try:
            return json.loads(p.read_text(encoding='utf-8'))
        except Exception:
            return {}
    return {}


def save_manifest(excel_dir: Path, manifest: Dict[str, Dict[str, Any]]) -> None:
    (excel_dir / MANIFEST_NAME).write_text(json.dumps(manifest, indent=1, sort_keys=True), encoding='utf-8')


def write_meta_sidecar(xlsx_path: Path, drive_file: Dict[str, Any]) -> None:
    """<file>.xlsx.meta.json — read by sheet_rules.resolve_session_date (Drive created date)."""
    meta = {k: drive_file.get(k) for k in ('id', 'name', 'createdTime', 'modifiedTime')}
    (xlsx_path.parent / (xlsx_path.name + '.meta.json')).write_text(json.dumps(meta), encoding='utf-8')


def plan_cache(drive_files: list, excel_dir: Path, manifest: Dict[str, Dict[str, Any]]):
    """
    Decide the local file for every Drive sheet and whether it needs downloading.

    Sheets are tracked by Drive file ID, not by name, so two sheets with the same
    title (e.g. the director copies "Ryan Weiss Mobility Assessment" for a
    shoulder re-check) no longer overwrite each other in the cache. A sheet keeps
    the local file name it was first given; a new sheet whose plain name is
    already taken gets " [<created date>]" appended.

    Returns (plan, orphans): plan = [(drive_file, local_path, needs_download)],
    orphans = cached .xlsx files that no Drive sheet maps to (deleted on Drive, or
    an ambiguous pre-manifest copy of a duplicated title).
    """
    by_title: Dict[str, list] = {}
    for f in drive_files:
        by_title.setdefault(_safe_name(f['name']).lower(), []).append(f)

    taken = {v['file'].lower(): k for k, v in manifest.items() if v.get('file')}
    plan = []
    for f in sorted(drive_files, key=lambda x: x.get('createdTime', '')):
        fid = f['id']
        entry = manifest.get(fid)
        if entry and entry.get('file'):
            local = excel_dir / entry['file']
            needs = (not local.exists()) or (
                f.get('modifiedTime') and entry.get('modifiedTime') != f.get('modifiedTime')
                and _drive_timestamp(f['modifiedTime']) > _drive_timestamp(entry.get('modifiedTime') or '1970-01-01T00:00:00')
            )
            plan.append((f, local, bool(needs)))
            continue

        stem = _safe_name(f['name'])
        plain = f"{stem}.xlsx"
        unique_title = len(by_title.get(stem.lower(), [])) == 1
        if unique_title and plain.lower() not in taken:
            local = excel_dir / plain
            # First run with a manifest: adopt the file already in the cache when it's current.
            needs = not local.exists() or (
                bool(f.get('modifiedTime')) and _drive_timestamp(f['modifiedTime']) > local.stat().st_mtime + 60
            )
        else:
            day = (f.get('createdTime') or '')[:10] or 'undated'
            name = f"{stem} [{day}].xlsx"
            if name.lower() in taken:
                name = f"{stem} [{day} {fid[:6]}].xlsx"
            local = excel_dir / name
            needs = not local.exists()
        taken[local.name.lower()] = fid
        plan.append((f, local, needs))

    mapped = {p[1].name.lower() for p in plan}
    orphans = [p for p in excel_dir.glob('*.xlsx') if p.name.lower() not in mapped]
    return plan, orphans


def list_drive_sheets(service, gsheet_directory: str) -> Optional[list]:
    """All Google Sheets in the Mobility Assessments folder (templates excluded), or None if not found."""
    folder_name = Path(gsheet_directory).name  # "Mobility Assessments"
    folder_id = _find_drive_folder_id(service, folder_name)
    if not folder_id:
        parent_name = Path(gsheet_directory).parent.name  # "Data"
        parent_id = _find_drive_folder_id(service, parent_name)
        if parent_id:
            folder_id = _find_drive_folder_id(service, folder_name, parent_id)
    if not folder_id:
        return None
    # Templates and test copies ("TEST UPDATED MOBILITY ASSESSMENT") aren't athlete data.
    return [f for f in _list_sheets_in_folder(service, folder_id)
            if 'template' not in f['name'].lower() and not f['name'].strip().lower().startswith('test')]


def download_missing_sheets(
    excel_directory: str,
    gsheet_directory: str,
    credentials_path: str,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    Download new / edited Google Sheets as Excel files into the cache and write a
    <file>.meta.json sidecar (Drive id, created and modified time) next to each.

    The sidecar is written for every sheet, including ones already cached, so the
    173 sheets bulk-downloaded on 2026-06-08 (before any sidecar existed) get their
    real Drive dates.
    """
    if not GOOGLE_API_AVAILABLE:
        return {'success': False, 'error': 'Google API libraries not available', 'downloaded': 0, 'failed': 0}

    print("Authenticating with Google...")
    creds = get_google_credentials(credentials_path)
    if not creds:
        return {'success': False, 'error': 'Failed to authenticate with Google', 'downloaded': 0, 'failed': 0}
    print("[OK] Authentication successful")

    service = build('drive', 'v3', credentials=creds)
    drive_files = list_drive_sheets(service, gsheet_directory)
    if drive_files is None:
        return {'success': False, 'error': f'Could not find Drive folder "{Path(gsheet_directory).name}" via API',
                'downloaded': 0, 'failed': 0}

    excel_dir = Path(excel_directory)
    excel_dir.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest(excel_dir)
    plan, orphans = plan_cache(drive_files, excel_dir, manifest)
    to_get = [p for p in plan if p[2]]
    print(f"\nFound {len(drive_files)} Google Sheets in Drive folder; {len(to_get)} new/updated; {len(orphans)} cached file(s) with no Drive sheet")

    downloaded = 0
    failed = 0
    errors = []
    for drive_file, local, needs in plan:
        if needs:
            print(f"\n{'Would download' if dry_run else 'Downloading'}: {drive_file['name']} -> {local.name}")
            if dry_run:
                continue
            if download_google_sheet_as_excel(creds, drive_file['id'], str(local)):
                downloaded += 1
            else:
                failed += 1
                errors.append(f"{drive_file['name']}: Download failed")
                continue
        if dry_run:
            continue
        write_meta_sidecar(local, drive_file)
        manifest[drive_file['id']] = {
            'file': local.name,
            'name': drive_file['name'],
            'createdTime': drive_file.get('createdTime'),
            'modifiedTime': drive_file.get('modifiedTime'),
        }
    if not dry_run:
        save_manifest(excel_dir, manifest)

    return {
        'success': True,
        'downloaded': downloaded,
        'failed': failed,
        'errors': errors,
        'plan': plan,
        'orphans': [str(p) for p in orphans],
    }
