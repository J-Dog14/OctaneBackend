"""
Shared utility functions for athlete processing across all modules.

This module provides common functions for extracting source_athlete_id
and handling athlete name processing consistently.
"""

import re
from typing import Optional


def extract_source_athlete_id(name: str) -> str:
    """
    Extract source_athlete_id from name.
    
    If name has trailing initials (2-3 uppercase letters), extract those.
    Otherwise, use the cleaned name.
    
    Examples:
        "Cody Yarborough CY" -> "CY"
        "John Smith" -> "John Smith"
        "Bob Jones BJ" -> "BJ"
        "Ryan Weiss 11-25" -> "Ryan Weiss" (dates removed, no initials)
    
    Args:
        name: Original name from file
        
    Returns:
        source_athlete_id (initials if found, otherwise cleaned name)
    """
    if not name or not name.strip():
        return name
    
    # Try to extract trailing initials (2-3 uppercase letters at the end)
    # Pattern: space followed by 2-3 uppercase letters at the end of string
    initials_match = re.search(r'\s+([A-Z]{2,3})\s*$', name)
    if initials_match:
        return initials_match.group(1)
    
    # No initials found, return the name as-is
    # (will be cleaned by get_or_create_athlete)
    return name

