#!/usr/bin/env python3
"""
Analyze which files in the project are actually used.

This script checks:
1. Python imports
2. R source() calls
3. SQL file references
4. Configuration file references
5. Script entry points
6. Database file references
"""

import os
import re
from pathlib import Path
from collections import defaultdict
from typing import Set, Dict, List

project_root = Path(__file__).parent.parent.parent


def find_all_files() -> Dict[str, List[Path]]:
    """Find all files in the project."""
    files = defaultdict(list)
    
    for root, dirs, filenames in os.walk(project_root):
        # Skip common ignored directories
        dirs[:] = [d for d in dirs if d not in [
            '__pycache__', 'node_modules', 'venv', '.git', 
            'prisma/generated', 'renv', '.venv'
        ]]
        
        for filename in filenames:
            filepath = Path(root) / filename
            ext = filepath.suffix.lower()
            
            if ext in ['.py', '.r', '.sql', '.md', '.json', '.yaml', '.yml', 
                      '.db', '.xlsx', '.ipynb', '.png', '.txt', '.bat', '.ps1', 
                      '.sh', '.toml', '.lock']:
                files[ext].append(filepath)
    
    return files


def find_python_imports(filepath: Path) -> Set[str]:
    """Extract all imports from a Python file."""
    imports = set()
    
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            
            # Find import statements
            import_patterns = [
                r'^import\s+([^\s\.]+)',
                r'^from\s+([^\s\.]+)',
                r'import\s+([^\s\.]+)',
                r'from\s+([^\s\.]+)',
            ]
            
            for pattern in import_patterns:
                matches = re.findall(pattern, content, re.MULTILINE)
                for match in matches:
                    # Clean up the import
                    module = match.split('.')[0].split(' as ')[0].strip()
                    if module and not module.startswith('#'):
                        imports.add(module)
            
            # Also check for file references
            file_refs = re.findall(r'["\']([^"\']+\.(?:py|sql|yaml|yml|json|db|xlsx|R|r))["\']', content)
            for ref in file_refs:
                imports.add(ref)
                
    except Exception as e:
        pass
    
    return imports


def find_r_sources(filepath: Path) -> Set[str]:
    """Extract all source() calls from an R file."""
    sources = set()
    
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            
            # Find source() calls
            source_pattern = r'source\(["\']([^"\']+)["\']'
            matches = re.findall(source_pattern, content)
            for match in matches:
                sources.add(match)
            
            # Find library() calls
            library_pattern = r'library\(["\']?([^"\']+)["\']?\)'
            matches = re.findall(library_pattern, content)
            for match in matches:
                sources.add(match)
                
    except Exception as e:
        pass
    
    return sources


def find_file_references(filepath: Path) -> Set[str]:
    """Find all file references in any file."""
    refs = set()
    
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            
            # Find file paths
            patterns = [
                r'["\']([^"\']+\.(?:py|sql|yaml|yml|json|db|xlsx|R|r|md|png|txt|bat|ps1|sh))["\']',
                r'([a-zA-Z0-9_/\\]+\.(?:py|sql|yaml|yml|json|db|xlsx|R|r|md|png|txt|bat|ps1|sh))',
            ]
            
            for pattern in patterns:
                matches = re.findall(pattern, content)
                for match in matches:
                    # Normalize path
                    ref = match.replace('\\', '/')
                    if not ref.startswith('http'):
                        refs.add(ref)
                        
    except Exception:
        pass
    
    return refs


def get_relative_path(filepath: Path) -> str:
    """Get relative path from project root."""
    try:
        return str(filepath.relative_to(project_root))
    except:
        return str(filepath)


def analyze_usage():
    """Main analysis function."""
    print("=" * 80)
    print("ANALYZING FILE USAGE")
    print("=" * 80)
    print()
    
    # Find all files
    print("Finding all files...")
    all_files = find_all_files()
    
    # Build file index
    file_index = {}
    for ext, files in all_files.items():
        for filepath in files:
            rel_path = get_relative_path(filepath)
            file_index[rel_path] = filepath
            # Also index by filename
            file_index[filepath.name] = filepath
    
    print(f"Found {sum(len(files) for files in all_files.values())} files")
    print()
    
    # Track usage
    used_files = set()
    entry_points = set()
    
    # Check Python files
    print("Analyzing Python files...")
    python_files = all_files.get('.py', [])
    for py_file in python_files:
        rel_path = get_relative_path(py_file)
        
        # Check if it's an entry point
        try:
            with open(py_file, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                if '__main__' in content or 'if __name__' in content:
                    entry_points.add(rel_path)
        except:
            pass
        
        # Find imports
        imports = find_python_imports(py_file)
        for imp in imports:
            # Try to resolve import to file
            if imp.endswith('.py'):
                used_files.add(imp)
            elif '/' in imp or '\\' in imp:
                used_files.add(imp)
            else:
                # Try to find module
                for other_file in python_files:
                    if other_file.stem == imp or other_file.name == f"{imp}.py":
                        used_files.add(get_relative_path(other_file))
        
        # Find file references
        refs = find_file_references(py_file)
        for ref in refs:
            used_files.add(ref)
            # Try to resolve relative paths
            if not ref.startswith('/'):
                parent_dir = py_file.parent
                potential = parent_dir / ref
                if potential.exists():
                    used_files.add(get_relative_path(potential))
    
    # Check R files
    print("Analyzing R files...")
    r_files = all_files.get('.r', [])
    for r_file in r_files:
        rel_path = get_relative_path(r_file)
        sources = find_r_sources(r_file)
        for src in sources:
            used_files.add(src)
        refs = find_file_references(r_file)
        for ref in refs:
            used_files.add(ref)
    
    # Check SQL files
    print("Analyzing SQL files...")
    sql_files = all_files.get('.sql', [])
    for sql_file in sql_files:
        rel_path = get_relative_path(sql_file)
        refs = find_file_references(sql_file)
        for ref in refs:
            used_files.add(ref)
    
    # Check configuration files
    print("Analyzing configuration files...")
    config_files = []
    for ext in ['.yaml', '.yml', '.json']:
        config_files.extend(all_files.get(ext, []))
    
    for config_file in config_files:
        refs = find_file_references(config_file)
        for ref in refs:
            used_files.add(ref)
    
    # Check package.json and Makefile
    print("Analyzing build files...")
    for build_file in [project_root / 'package.json', project_root / 'Makefile']:
        if build_file.exists():
            refs = find_file_references(build_file)
            for ref in refs:
                used_files.add(ref)
    
    # Find potentially unused files
    print()
    print("=" * 80)
    print("POTENTIALLY UNUSED FILES")
    print("=" * 80)
    print()
    
    # Files that are definitely used
    definitely_used = set()
    definitely_used.update(entry_points)
    definitely_used.update([f for f in used_files if f in file_index])
    
    # Files to check manually (might be used but not detected)
    manual_check = []
    
    # Categorize files
    unused_candidates = []
    
    for ext, files in all_files.items():
        for filepath in files:
            rel_path = get_relative_path(filepath)
            filename = filepath.name
            
            # Skip if definitely used
            if rel_path in definitely_used or filename in definitely_used:
                continue
            
            # Skip common files that are always needed
            if filename in ['README.md', 'requirements.txt', 'package.json', 
                          'package-lock.json', 'Makefile', '.gitignore',
                          'db_connections.yaml', 'db_connections.example.yaml']:
                continue
            
            # Skip schema files
            if 'schema.prisma' in filename or 'migration.sql' in filename:
                continue
            
            # Skip generated files
            if 'generated' in str(filepath) or '__pycache__' in str(filepath):
                continue
            
            # Check if it's a data file (might be used but not referenced in code)
            if ext in ['.db', '.xlsx', '.png', '.json']:
                # These might be data files - need manual check
                if 'structure.json' in filename or 'excel' in filename.lower():
                    manual_check.append(rel_path)
                else:
                    unused_candidates.append(rel_path)
            elif ext == '.md':
                # Documentation - usually not imported
                manual_check.append(rel_path)
            elif ext == '.sql':
                # SQL files might be run manually
                manual_check.append(rel_path)
            elif ext in ['.bat', '.ps1', '.sh']:
                # Scripts - might be run manually
                manual_check.append(rel_path)
            else:
                # Code files - should be imported
                unused_candidates.append(rel_path)
    
    print(f"Entry points (definitely used): {len(entry_points)}")
    for ep in sorted(entry_points):
        print(f"  - {ep}")
    
    print()
    print(f"Potentially unused files: {len(unused_candidates)}")
    for candidate in sorted(unused_candidates)[:50]:  # Show first 50
        print(f"  - {candidate}")
    if len(unused_candidates) > 50:
        print(f"  ... and {len(unused_candidates) - 50} more")
    
    print()
    print(f"Files needing manual check: {len(manual_check)}")
    for mc in sorted(manual_check)[:30]:  # Show first 30
        print(f"  - {mc}")
    if len(manual_check) > 30:
        print(f"  ... and {len(manual_check) - 30} more")
    
    return {
        'entry_points': entry_points,
        'unused_candidates': unused_candidates,
        'manual_check': manual_check
    }


if __name__ == '__main__':
    analyze_usage()

