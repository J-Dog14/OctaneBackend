"""
Statistical Analyzer Module
Performs statistical analysis on athlete data: trends, correlations, anomalies.
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple, Any
from scipy import stats
from scipy.stats import linregress, pearsonr, spearmanr
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import IsolationForest
import warnings
warnings.filterwarnings('ignore')


class StatisticalAnalyzer:
    """
    Performs statistical analysis on athlete data.
    """
    
    def __init__(self):
        """Initialize statistical analyzer."""
        pass
    
    def detect_trends(
        self,
        df: pd.DataFrame,
        date_column: str = 'session_date',
        metric_columns: Optional[List[str]] = None
    ) -> Dict[str, Dict[str, Any]]:
        """
        Detect trends in time-series data using linear regression.
        
        Args:
            df: DataFrame with time-series data
            date_column: Name of date column
            metric_columns: List of metric columns to analyze (None = all numeric)
            
        Returns:
            Dict mapping metric names to trend analysis results
        """
        if df.empty or len(df) < 2:
            return {}
        
        # Convert date to numeric (days since first date)
        df = df.copy()
        df[date_column] = pd.to_datetime(df[date_column])
        first_date = df[date_column].min()
        df['days_since_first'] = (df[date_column] - first_date).dt.days
        
        # Identify metric columns
        if metric_columns is None:
            numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
            metric_columns = [col for col in numeric_cols if col not in ['days_since_first', 'age_at_collection']]
        
        trends = {}
        
        for metric in metric_columns:
            if metric not in df.columns:
                continue
            
            # Get valid data points
            valid_data = df[['days_since_first', metric]].dropna()
            
            if len(valid_data) < 2:
                continue
            
            x = valid_data['days_since_first'].values
            y = valid_data[metric].values
            
            # Linear regression
            try:
                slope, intercept, r_value, p_value, std_err = linregress(x, y)
                
                # Calculate percentage change over time period
                if len(x) > 0:
                    time_span_days = x.max() - x.min()
                    total_change = slope * time_span_days
                    first_value = y[0] if len(y) > 0 else 0
                    pct_change = (total_change / first_value * 100) if first_value != 0 else 0
                else:
                    pct_change = 0
                
                # Determine trend direction
                if p_value < 0.05:  # Statistically significant
                    if slope > 0:
                        direction = 'increasing'
                    else:
                        direction = 'decreasing'
                else:
                    direction = 'stable'
                
                trends[metric] = {
                    'slope': float(slope),
                    'intercept': float(intercept),
                    'r_squared': float(r_value ** 2),
                    'p_value': float(p_value),
                    'std_err': float(std_err),
                    'direction': direction,
                    'percent_change': float(pct_change),
                    'is_significant': p_value < 0.05,
                    'data_points': len(valid_data),
                    'time_span_days': int(time_span_days) if len(x) > 0 else 0
                }
            except Exception as e:
                # Skip metrics that can't be analyzed
                continue
        
        return trends
    
    def calculate_correlations(
        self,
        df: pd.DataFrame,
        metric_columns: Optional[List[str]] = None,
        method: str = 'pearson'
    ) -> Dict[str, Dict[str, float]]:
        """
        Calculate correlations between metrics.
        
        Args:
            df: DataFrame with metric columns
            metric_columns: List of metric columns to correlate (None = all numeric)
            method: 'pearson' or 'spearman'
            
        Returns:
            Dict mapping metric pairs to correlation coefficients and p-values
        """
        if df.empty:
            return {}
        
        # Identify metric columns
        if metric_columns is None:
            numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
            metric_columns = [col for col in numeric_cols if col not in ['age_at_collection']]
        
        # Filter to valid columns
        metric_columns = [col for col in metric_columns if col in df.columns]
        
        if len(metric_columns) < 2:
            return {}
        
        correlations = {}
        
        for i, metric1 in enumerate(metric_columns):
            for metric2 in metric_columns[i+1:]:
                # Get valid pairs
                valid_data = df[[metric1, metric2]].dropna()
                
                if len(valid_data) < 3:
                    continue
                
                x = valid_data[metric1].values
                y = valid_data[metric2].values
                
                try:
                    if method == 'pearson':
                        corr, p_value = pearsonr(x, y)
                    else:  # spearman
                        corr, p_value = spearmanr(x, y)
                    
                    key = f"{metric1} vs {metric2}"
                    correlations[key] = {
                        'correlation': float(corr),
                        'p_value': float(p_value),
                        'is_significant': p_value < 0.05,
                        'method': method,
                        'data_points': len(valid_data)
                    }
                except Exception:
                    continue
        
        return correlations
    
    def detect_anomalies(
        self,
        df: pd.DataFrame,
        metric_columns: Optional[List[str]] = None,
        method: str = 'zscore',
        threshold: float = 2.0
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        Detect anomalies in metric values.
        
        Args:
            df: DataFrame with metric columns
            metric_columns: List of metric columns to analyze (None = all numeric)
            method: 'zscore' or 'isolation_forest'
            threshold: Z-score threshold (for zscore method)
            
        Returns:
            Dict mapping metric names to lists of anomaly records
        """
        if df.empty:
            return {}
        
        # Identify metric columns
        if metric_columns is None:
            numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
            metric_columns = [col for col in numeric_cols if col not in ['age_at_collection']]
        
        anomalies = {}
        
        for metric in metric_columns:
            if metric not in df.columns:
                continue
            
            valid_data = df[[metric]].dropna()
            
            if len(valid_data) < 3:
                continue
            
            values = valid_data[metric].values
            
            if method == 'zscore':
                # Z-score method
                mean = np.mean(values)
                std = np.std(values)
                
                if std == 0:
                    continue
                
                z_scores = np.abs((values - mean) / std)
                outlier_indices = np.where(z_scores > threshold)[0]
                
                metric_anomalies = []
                for idx in outlier_indices:
                    original_idx = valid_data.index[idx]
                    metric_anomalies.append({
                        'index': int(original_idx),
                        'value': float(values[idx]),
                        'z_score': float(z_scores[idx]),
                        'mean': float(mean),
                        'std': float(std),
                        'deviation_sigma': float(z_scores[idx])
                    })
            
            elif method == 'isolation_forest':
                # Isolation Forest method
                try:
                    iso_forest = IsolationForest(contamination=0.1, random_state=42)
                    values_2d = values.reshape(-1, 1)
                    predictions = iso_forest.fit_predict(values_2d)
                    
                    outlier_indices = np.where(predictions == -1)[0]
                    
                    metric_anomalies = []
                    for idx in outlier_indices:
                        original_idx = valid_data.index[idx]
                        metric_anomalies.append({
                            'index': int(original_idx),
                            'value': float(values[idx]),
                            'method': 'isolation_forest'
                        })
                except Exception:
                    continue
            else:
                continue
            
            if metric_anomalies:
                anomalies[metric] = metric_anomalies
        
        return anomalies
    
    def compare_to_peer_group(
        self,
        athlete_value: float,
        peer_stats: Dict[str, float]
    ) -> Dict[str, Any]:
        """
        Compare athlete's metric value to peer group statistics.
        
        Args:
            athlete_value: Athlete's metric value
            peer_stats: Dict with mean, median, std, min, max, percentile_25, percentile_75
            
        Returns:
            Dict with comparison results including percentile rank
        """
        if not peer_stats or 'mean' not in peer_stats:
            return {}
        
        mean = peer_stats['mean']
        std = peer_stats.get('std', 0)
        median = peer_stats['median']
        min_val = peer_stats.get('min', mean)
        max_val = peer_stats.get('max', mean)
        p25 = peer_stats.get('percentile_25', mean)
        p75 = peer_stats.get('percentile_75', mean)
        
        # Calculate z-score
        if std > 0:
            z_score = (athlete_value - mean) / std
        else:
            z_score = 0
        
        # Estimate percentile (rough approximation)
        if athlete_value <= min_val:
            percentile = 0
        elif athlete_value >= max_val:
            percentile = 100
        elif std > 0:
            # Use normal distribution approximation
            percentile = stats.norm.cdf(z_score) * 100
        else:
            # Fallback: linear interpolation between quartiles
            if athlete_value <= p25:
                percentile = 12.5  # Below 25th percentile
            elif athlete_value <= median:
                percentile = 37.5  # Between 25th and 50th
            elif athlete_value <= p75:
                percentile = 62.5  # Between 50th and 75th
            else:
                percentile = 87.5  # Above 75th percentile
        
        # Determine category
        if percentile >= 90:
            category = 'excellent'
        elif percentile >= 75:
            category = 'above_average'
        elif percentile >= 50:
            category = 'average'
        elif percentile >= 25:
            category = 'below_average'
        else:
            category = 'poor'
        
        return {
            'athlete_value': float(athlete_value),
            'peer_mean': float(mean),
            'peer_median': float(median),
            'peer_std': float(std),
            'z_score': float(z_score),
            'percentile_rank': float(percentile),
            'category': category,
            'difference_from_mean': float(athlete_value - mean),
            'percent_difference': float((athlete_value - mean) / mean * 100) if mean != 0 else 0
        }
    
    def analyze_cross_table_relationships(
        self,
        df: pd.DataFrame,
        date_tolerance_days: int = 7
    ) -> Dict[str, Dict[str, Any]]:
        """
        Analyze relationships between metrics from different test types.
        
        Args:
            df: DataFrame with columns: session_date, test_type, metric_name, metric_value
            date_tolerance_days: Days within which to consider sessions as "matched"
            
        Returns:
            Dict with correlation analysis between different test types
        """
        if df.empty:
            return {}
        
        df = df.copy()
        df['session_date'] = pd.to_datetime(df['session_date'])
        
        # Pivot to get metrics as columns, aligned by date
        # Group by date windows
        df['date_window'] = df['session_date'].dt.floor(f'{date_tolerance_days}D')
        
        # Create pivot table
        pivot = df.pivot_table(
            index='date_window',
            columns='metric_name',
            values='metric_value',
            aggfunc='mean'
        )
        
        # Calculate correlations
        correlations = self.calculate_correlations(pivot, method='pearson')
        
        return {
            'correlations': correlations,
            'matched_sessions': len(pivot),
            'metrics_compared': list(pivot.columns)
        }
    
    def calculate_performance_velocity(
        self,
        df: pd.DataFrame,
        metric_column: str,
        date_column: str = 'session_date'
    ) -> Dict[str, Any]:
        """
        Calculate rate of change (velocity) in performance metrics.
        
        Args:
            df: DataFrame with time-series data
            metric_column: Name of metric column
            date_column: Name of date column
            
        Returns:
            Dict with velocity metrics
        """
        if df.empty or len(df) < 2:
            return {}
        
        df = df.copy()
        df[date_column] = pd.to_datetime(df[date_column])
        df = df.sort_values(date_column)
        
        if metric_column not in df.columns:
            return {}
        
        valid_data = df[[date_column, metric_column]].dropna()
        
        if len(valid_data) < 2:
            return {}
        
        # Calculate daily change rate
        valid_data = valid_data.copy()
        valid_data['days_diff'] = (valid_data[date_column] - valid_data[date_column].shift(1)).dt.days
        valid_data['value_diff'] = valid_data[metric_column] - valid_data[metric_column].shift(1)
        valid_data['daily_rate'] = valid_data['value_diff'] / valid_data['days_diff']
        
        # Remove first row (NaN)
        valid_data = valid_data.iloc[1:]
        
        if len(valid_data) == 0:
            return {}
        
        return {
            'average_daily_change': float(valid_data['daily_rate'].mean()),
            'median_daily_change': float(valid_data['daily_rate'].median()),
            'std_daily_change': float(valid_data['daily_rate'].std()),
            'total_change': float(valid_data['value_diff'].sum()),
            'sessions_analyzed': len(valid_data)
        }

