"""
Data Aggregator Module
Handles SQL queries to fetch and aggregate athlete data from PostgreSQL warehouse.
"""

import pandas as pd
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
from sqlalchemy import create_engine, text
import sys
from pathlib import Path

# Add parent directory to path to import common modules
sys.path.insert(0, str(Path(__file__).parent.parent))
from common.config import get_warehouse_engine


class DataAggregator:
    """
    Aggregates athlete data from warehouse database for analysis.
    """
    
    def __init__(self, engine=None):
        """
        Initialize data aggregator.
        
        Args:
            engine: SQLAlchemy engine (optional, will create if not provided)
        """
        self.engine = engine or get_warehouse_engine()
    
    def get_athlete_demographics(self, athlete_uuid: str) -> Optional[Dict[str, Any]]:
        """
        Get athlete demographic information.
        
        Args:
            athlete_uuid: UUID of the athlete
            
        Returns:
            Dict with athlete demographics or None if not found
        """
        query = text("""
            SELECT 
                athlete_uuid,
                name,
                date_of_birth,
                age,
                gender,
                height,
                weight,
                age_group
            FROM analytics.d_athletes
            WHERE athlete_uuid = :athlete_uuid
        """)
        
        df = pd.read_sql(query, self.engine, params={'athlete_uuid': athlete_uuid})
        
        if df.empty:
            return None
        
        return df.iloc[0].to_dict()
    
    def get_athletic_screen_trends(
        self, 
        athlete_uuid: str, 
        movement_type: str = 'cmj',
        metrics: Optional[List[str]] = None
    ) -> pd.DataFrame:
        """
        Get time-series data for athletic screen movements.
        
        Args:
            athlete_uuid: UUID of the athlete
            movement_type: One of 'cmj', 'dj', 'slv', 'nmt', 'ppu'
            metrics: List of metric names to retrieve (None = all)
            
        Returns:
            DataFrame with session_date and metric columns
        """
        table_map = {
            'cmj': 'f_athletic_screen_cmj',
            'dj': 'f_athletic_screen_dj',
            'slv': 'f_athletic_screen_slv',
            'nmt': 'f_athletic_screen_nmt',
            'ppu': 'f_athletic_screen_ppu'
        }
        
        if movement_type not in table_map:
            raise ValueError(f"Invalid movement_type: {movement_type}. Must be one of {list(table_map.keys())}")
        
        table = table_map[movement_type]
        
        # Default metrics for each movement type
        default_metrics = {
            'cmj': ['jh_in', 'peak_power', 'pp_w_per_kg', 'peak_power_w', 'time_to_peak_s'],
            'dj': ['jh_in', 'peak_power', 'pp_w_per_kg', 'rsi', 'ct'],
            'slv': ['jh_in', 'peak_power', 'pp_w_per_kg'],
            'nmt': ['num_taps_10s', 'num_taps_20s', 'num_taps_30s'],
            'ppu': ['jh_in', 'peak_power', 'pp_w_per_kg']
        }
        
        selected_metrics = metrics or default_metrics.get(movement_type, [])
        
        # Build query with selected metrics
        metric_cols = ', '.join(selected_metrics)
        
        query = text(f"""
            SELECT 
                session_date,
                age_at_collection,
                {metric_cols}
            FROM public.{table}
            WHERE athlete_uuid = :athlete_uuid
            AND session_date IS NOT NULL
            ORDER BY session_date ASC
        """)
        
        df = pd.read_sql(query, self.engine, params={'athlete_uuid': athlete_uuid})
        
        if not df.empty:
            df['session_date'] = pd.to_datetime(df['session_date'])
            # Convert numeric columns
            for col in selected_metrics:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
        
        return df
    
    def get_readiness_screen_trends(
        self,
        athlete_uuid: str,
        test_type: str = 'i',
        metrics: Optional[List[str]] = None
    ) -> pd.DataFrame:
        """
        Get time-series data for readiness screen tests.
        
        Args:
            athlete_uuid: UUID of the athlete
            test_type: One of 'i', 'y', 't', 'ir90', 'cmj', 'ppu'
            metrics: List of metric names to retrieve (None = all)
            
        Returns:
            DataFrame with session_date and metric columns
        """
        table_map = {
            'i': 'f_readiness_screen_i',
            'y': 'f_readiness_screen_y',
            't': 'f_readiness_screen_t',
            'ir90': 'f_readiness_screen_ir90',
            'cmj': 'f_readiness_screen_cmj',
            'ppu': 'f_readiness_screen_ppu'
        }
        
        if test_type not in table_map:
            raise ValueError(f"Invalid test_type: {test_type}. Must be one of {list(table_map.keys())}")
        
        table = table_map[test_type]
        
        default_metrics = {
            'i': ['avg_force', 'avg_force_norm', 'max_force', 'max_force_norm', 'time_to_max'],
            'y': ['avg_force', 'avg_force_norm', 'max_force', 'max_force_norm', 'time_to_max'],
            't': ['avg_force', 'avg_force_norm', 'max_force', 'max_force_norm', 'time_to_max'],
            'ir90': ['avg_force', 'avg_force_norm', 'max_force', 'max_force_norm', 'time_to_max'],
            'cmj': ['jump_height', 'peak_power', 'peak_force', 'pp_w_per_kg'],
            'ppu': ['jump_height', 'peak_power', 'peak_force', 'pp_w_per_kg']
        }
        
        selected_metrics = metrics or default_metrics.get(test_type, [])
        metric_cols = ', '.join(selected_metrics)
        
        query = text(f"""
            SELECT 
                session_date,
                age_at_collection,
                {metric_cols}
            FROM public.{table}
            WHERE athlete_uuid = :athlete_uuid
            AND session_date IS NOT NULL
            ORDER BY session_date ASC
        """)
        
        df = pd.read_sql(query, self.engine, params={'athlete_uuid': athlete_uuid})
        
        if not df.empty:
            df['session_date'] = pd.to_datetime(df['session_date'])
            for col in selected_metrics:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
        
        return df
    
    def get_pro_sup_trends(
        self,
        athlete_uuid: str,
        metrics: Optional[List[str]] = None
    ) -> pd.DataFrame:
        """
        Get time-series data for Pro-Sup test.
        
        Args:
            athlete_uuid: UUID of the athlete
            metrics: List of metric names to retrieve (None = all)
            
        Returns:
            DataFrame with session_date and metric columns
        """
        default_metrics = [
            'tot_rom_0to10', 'tot_rom_10to20', 'tot_rom_20to30', 'tot_rom',
            'forearm_rom_0to10', 'forearm_rom_10to20', 'forearm_rom_20to30',
            'fatigue_index_10', 'fatigue_index_20', 'fatigue_index_30',
            'total_score', 'total_fatigue_score'
        ]
        
        selected_metrics = metrics or default_metrics
        metric_cols = ', '.join(selected_metrics)
        
        query = text(f"""
            SELECT 
                session_date,
                age_at_collection,
                {metric_cols}
            FROM public.f_pro_sup
            WHERE athlete_uuid = :athlete_uuid
            AND session_date IS NOT NULL
            ORDER BY session_date ASC
        """)
        
        df = pd.read_sql(query, self.engine, params={'athlete_uuid': athlete_uuid})
        
        if not df.empty:
            df['session_date'] = pd.to_datetime(df['session_date'])
            for col in selected_metrics:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
        
        return df
    
    def get_cross_table_metrics(
        self,
        athlete_uuid: str,
        date_range_days: int = 90
    ) -> pd.DataFrame:
        """
        Get metrics from multiple tables for correlation analysis.
        
        Args:
            athlete_uuid: UUID of the athlete
            date_range_days: Number of days to look back for matching sessions
            
        Returns:
            DataFrame with metrics from different test types
        """
        cutoff_date = datetime.now() - timedelta(days=date_range_days)
        
        query = text("""
            WITH cmj_data AS (
                SELECT 
                    session_date,
                    'cmj' as test_type,
                    jh_in as metric_value,
                    'cmj_jump_height' as metric_name
                FROM public.f_athletic_screen_cmj
                WHERE athlete_uuid = :athlete_uuid
                AND session_date >= :cutoff_date
                AND jh_in IS NOT NULL
            ),
            readiness_i AS (
                SELECT 
                    session_date,
                    'readiness_i' as test_type,
                    max_force_norm as metric_value,
                    'readiness_i_max_force' as metric_name
                FROM public.f_readiness_screen_i
                WHERE athlete_uuid = :athlete_uuid
                AND session_date >= :cutoff_date
                AND max_force_norm IS NOT NULL
            ),
            pro_sup_data AS (
                SELECT 
                    session_date,
                    'pro_sup' as test_type,
                    tot_rom as metric_value,
                    'pro_sup_tot_rom' as metric_name
                FROM public.f_pro_sup
                WHERE athlete_uuid = :athlete_uuid
                AND session_date >= :cutoff_date
                AND tot_rom IS NOT NULL
            )
            SELECT * FROM cmj_data
            UNION ALL
            SELECT * FROM readiness_i
            UNION ALL
            SELECT * FROM pro_sup_data
            ORDER BY session_date, test_type
        """)
        
        df = pd.read_sql(
            query, 
            self.engine, 
            params={'athlete_uuid': athlete_uuid, 'cutoff_date': cutoff_date}
        )
        
        if not df.empty:
            df['session_date'] = pd.to_datetime(df['session_date'])
            df['metric_value'] = pd.to_numeric(df['metric_value'], errors='coerce')
        
        return df
    
    def get_peer_group_stats(
        self,
        metric_table: str,
        metric_column: str,
        age_group: Optional[str] = None,
        gender: Optional[str] = None,
        min_sessions: int = 1
    ) -> Dict[str, float]:
        """
        Get peer group statistics for a metric.
        
        Args:
            metric_table: Table name (e.g., 'f_athletic_screen_cmj')
            metric_column: Column name (e.g., 'jh_in')
            age_group: Filter by age group (optional)
            gender: Filter by gender (optional)
            min_sessions: Minimum number of sessions required
            
        Returns:
            Dict with mean, median, std, min, max, percentile_25, percentile_75
        """
        # Build WHERE clause
        conditions = [f"{metric_column} IS NOT NULL"]
        
        if age_group:
            conditions.append("a.age_group = :age_group")
        if gender:
            conditions.append("a.gender = :gender")
        
        where_clause = " AND " + " AND ".join(conditions)
        
        query = text(f"""
            WITH athlete_sessions AS (
                SELECT 
                    t.athlete_uuid,
                    COUNT(*) as session_count,
                    AVG(t.{metric_column}) as avg_metric
                FROM public.{metric_table} t
                JOIN analytics.d_athletes a ON t.athlete_uuid = a.athlete_uuid
                WHERE {where_clause}
                GROUP BY t.athlete_uuid
                HAVING COUNT(*) >= :min_sessions
            )
            SELECT 
                AVG(avg_metric) as mean,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_metric) as median,
                STDDEV(avg_metric) as std,
                MIN(avg_metric) as min_val,
                MAX(avg_metric) as max_val,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY avg_metric) as percentile_25,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY avg_metric) as percentile_75
            FROM athlete_sessions
        """)
        
        params = {'min_sessions': min_sessions}
        if age_group:
            params['age_group'] = age_group
        if gender:
            params['gender'] = gender
        
        df = pd.read_sql(query, self.engine, params=params)
        
        if df.empty or df.iloc[0]['mean'] is None:
            return {}
        
        row = df.iloc[0]
        return {
            'mean': float(row['mean']),
            'median': float(row['median']),
            'std': float(row['std']) if row['std'] is not None else 0.0,
            'min': float(row['min_val']),
            'max': float(row['max_val']),
            'percentile_25': float(row['percentile_25']),
            'percentile_75': float(row['percentile_75'])
        }

