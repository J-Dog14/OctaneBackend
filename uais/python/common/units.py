"""
Height/weight unit conversion for UAIS warehouse.

All stored height/weight in d_athletes and fact tables are in inches and pounds.
Octane Pitching/Hitting session XML provides meters and kg; convert at ingestion.
"""
from typing import Optional

# Conversion constants (single place for all pipelines)
METERS_TO_INCHES = 39.3701
KG_TO_LBS = 2.2046226


def meters_to_inches(m: Optional[float]) -> Optional[float]:
    """Convert height from meters to inches. Returns None if m is None or <= 0."""
    if m is None or m <= 0:
        return None
    return m * METERS_TO_INCHES


def kg_to_lbs(kg: Optional[float]) -> Optional[float]:
    """Convert weight from kg to pounds. Returns None if kg is None or <= 0."""
    if kg is None or kg <= 0:
        return None
    return kg * KG_TO_LBS


def lbs_to_kg(lbs: Optional[float]) -> Optional[float]:
    """Convert weight from pounds to kg (e.g. for scoring formulas that expect kg)."""
    if lbs is None or lbs <= 0:
        return None
    return lbs / KG_TO_LBS
