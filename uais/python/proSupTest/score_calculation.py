"""
Score calculation utilities for Pro-Sup Test.
Handles fatigue index calculation, consistency penalties, and total score computation.
"""
import pandas as pd
from typing import Tuple


# ROM columns for calculations
ROM_COLUMNS = ['tot_rom_0to10', 'tot_rom_10to20', 'tot_rom_20to30']

# Scoring weights (ROM, fatigue, consistency)
SCORING_WEIGHTS = {
    'rom': 70,
    'fatigue': 15,
    'consistency': 15
}


def calculate_fatigue_indices(df: pd.DataFrame) -> pd.DataFrame:
    """
    Calculate fatigue indices for each interval.
    
    Args:
        df: DataFrame with ROM columns.
    
    Returns:
        DataFrame with fatigue index columns added.
    """
    df = df.copy()
    
    # Convert ROM columns to numeric
    df[ROM_COLUMNS] = df[ROM_COLUMNS].apply(pd.to_numeric, errors='coerce')
    
    # Calculate fatigue indices
    df['fatigue_index_10'] = 0  # First interval has no prior data to compare
    df['fatigue_index_20'] = ((df['tot_rom_10to20'] - df['tot_rom_0to10']) / df['tot_rom_0to10']) * 100
    df['fatigue_index_30'] = ((df['tot_rom_20to30'] - df['tot_rom_10to20']) / df['tot_rom_10to20']) * 100
    
    return df


def calculate_total_fatigue_score(df: pd.DataFrame) -> pd.DataFrame:
    """
    Calculate total fatigue score (sum of absolute fatigue indices).
    
    Args:
        df: DataFrame with fatigue index columns.
    
    Returns:
        DataFrame with total_fatigue_score column added.
    """
    df = df.copy()
    df['total_fatigue_score'] = df[['fatigue_index_10', 'fatigue_index_20', 'fatigue_index_30']].abs().sum(axis=1)
    return df


def calculate_consistency_penalty(df: pd.DataFrame) -> pd.DataFrame:
    """
    Calculate consistency penalty (standard deviation of ROM across intervals).
    
    Args:
        df: DataFrame with ROM columns.
    
    Returns:
        DataFrame with consistency_penalty column added.
    """
    df = df.copy()
    df['consistency_penalty'] = df[ROM_COLUMNS].std(axis=1)
    return df


def calculate_total_score(df: pd.DataFrame, 
                         weights: Tuple[int, int, int] = None) -> pd.DataFrame:
    """
    Calculate total score based on ROM, fatigue, and consistency.
    
    Args:
        df: DataFrame with ROM, fatigue, and consistency columns.
        weights: Tuple of (ROM_weight, fatigue_weight, consistency_weight).
                 Defaults to (70, 15, 15).
    
    Returns:
        DataFrame with total_score column added.
    """
    if weights is None:
        w1, w2, w3 = SCORING_WEIGHTS['rom'], SCORING_WEIGHTS['fatigue'], SCORING_WEIGHTS['consistency']
    else:
        w1, w2, w3 = weights
    
    df = df.copy()
    
    # Ensure numeric types
    df[ROM_COLUMNS] = df[ROM_COLUMNS].apply(pd.to_numeric, errors='coerce')
    
    # Calculate max values for scaling (matching notebook exactly)
    max_rom = df[ROM_COLUMNS].max().sum()  # Sum of max values from each column
    max_fatigue_score = df['total_fatigue_score'].max()
    max_consistency_penalty = df['consistency_penalty'].max()
    
    # Calculate total score
    df['total_score'] = (
        (df[ROM_COLUMNS].sum(axis=1) / max_rom) * w1 - 
        (df['total_fatigue_score'] / max_fatigue_score) * w2 - 
        (df['consistency_penalty'] / max_consistency_penalty) * w3
    )
    
    return df


def calculate_all_scores(df: pd.DataFrame, 
                        weights: Tuple[int, int, int] = None) -> pd.DataFrame:
    """
    Calculate all scores: fatigue indices, total fatigue, consistency, and total score.
    
    Args:
        df: DataFrame with ROM columns.
        weights: Tuple of scoring weights (default: 70, 15, 15).
    
    Returns:
        DataFrame with all score columns added.
    """
    df = calculate_fatigue_indices(df)
    df = calculate_total_fatigue_score(df)
    df = calculate_consistency_penalty(df)
    df = calculate_total_score(df, weights=weights)
    
    return df


def add_percentile_columns(df: pd.DataFrame, 
                          metric_cols: list = None) -> pd.DataFrame:
    """
    Add percentile columns for specified metrics.
    
    Args:
        df: DataFrame with metric columns.
        metric_cols: List of column names to calculate percentiles for.
                    Defaults to ['tot_rom_0to10', 'tot_rom_10to20', 'tot_rom_20to30', 'total_score'].
    
    Returns:
        DataFrame with percentile columns added (suffix '_pct').
    """
    if metric_cols is None:
        metric_cols = ['tot_rom_0to10', 'tot_rom_10to20', 'tot_rom_20to30', 'total_score']
    
    df = df.copy()
    
    for col in metric_cols:
        if col in df.columns:
            df[f"{col}_pct"] = df[col].rank(pct=True) * 100
    
    return df

