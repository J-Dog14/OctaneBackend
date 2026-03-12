"""
Insight Generator Module
Orchestrates data aggregation, statistical analysis, and insight formatting.
"""

from typing import Dict, List, Optional, Any
from datetime import datetime
import json

from .data_aggregator import DataAggregator
from .statistical_analyzer import StatisticalAnalyzer
from .templates import InsightTemplates


class InsightGenerator:
    """
    Main class for generating insights from athlete data.
    """
    
    def __init__(self, engine=None):
        """
        Initialize insight generator.
        
        Args:
            engine: SQLAlchemy engine (optional)
        """
        self.aggregator = DataAggregator(engine)
        self.analyzer = StatisticalAnalyzer()
        self.templates = InsightTemplates()
    
    def generate_athlete_insights(
        self,
        athlete_uuid: str,
        include_trends: bool = True,
        include_correlations: bool = True,
        include_anomalies: bool = True,
        include_peer_comparisons: bool = True
    ) -> Dict[str, Any]:
        """
        Generate comprehensive insights for an athlete.
        
        Args:
            athlete_uuid: UUID of the athlete
            include_trends: Whether to analyze trends
            include_correlations: Whether to analyze correlations
            include_anomalies: Whether to detect anomalies
            include_peer_comparisons: Whether to compare to peer groups
            
        Returns:
            Dict with all insights
        """
        insights = {
            'athlete_uuid': athlete_uuid,
            'generated_at': datetime.now().isoformat(),
            'trends': {},
            'correlations': {},
            'anomalies': {},
            'peer_comparisons': {},
            'metadata': {}
        }
        
        # Get athlete demographics
        demographics = self.aggregator.get_athlete_demographics(athlete_uuid)
        if not demographics:
            insights['error'] = f"Athlete {athlete_uuid} not found"
            return insights
        
        insights['metadata']['athlete_name'] = demographics.get('name', 'Unknown')
        insights['metadata']['age'] = demographics.get('age')
        insights['metadata']['gender'] = demographics.get('gender')
        insights['metadata']['age_group'] = demographics.get('age_group')
        
        # Analyze trends
        if include_trends:
            insights['trends'] = self._analyze_trends(athlete_uuid)
        
        # Analyze correlations
        if include_correlations:
            insights['correlations'] = self._analyze_correlations(athlete_uuid)
        
        # Detect anomalies
        if include_anomalies:
            insights['anomalies'] = self._detect_anomalies(athlete_uuid)
        
        # Peer comparisons
        if include_peer_comparisons:
            insights['peer_comparisons'] = self._compare_to_peers(athlete_uuid, demographics)
        
        return insights
    
    def _analyze_trends(self, athlete_uuid: str) -> Dict[str, Dict[str, Any]]:
        """Analyze trends across all available test types."""
        all_trends = {}
        
        # Athletic Screen trends
        for movement in ['cmj', 'dj', 'slv', 'ppu']:
            try:
                df = self.aggregator.get_athletic_screen_trends(athlete_uuid, movement)
                if not df.empty:
                    trends = self.analyzer.detect_trends(df)
                    # Prefix with movement type
                    for metric, trend_data in trends.items():
                        all_trends[f"{movement}_{metric}"] = trend_data
            except Exception:
                continue
        
        # Readiness Screen trends
        for test_type in ['i', 'y', 't', 'ir90', 'cmj', 'ppu']:
            try:
                df = self.aggregator.get_readiness_screen_trends(athlete_uuid, test_type)
                if not df.empty:
                    trends = self.analyzer.detect_trends(df)
                    for metric, trend_data in trends.items():
                        all_trends[f"readiness_{test_type}_{metric}"] = trend_data
            except Exception:
                continue
        
        # Pro-Sup trends
        try:
            df = self.aggregator.get_pro_sup_trends(athlete_uuid)
            if not df.empty:
                trends = self.analyzer.detect_trends(df)
                for metric, trend_data in trends.items():
                    all_trends[f"pro_sup_{metric}"] = trend_data
        except Exception:
            pass
        
        return all_trends
    
    def _analyze_correlations(self, athlete_uuid: str) -> Dict[str, Dict[str, Any]]:
        """Analyze correlations within and across test types."""
        all_correlations = {}
        
        # Within-table correlations (Athletic Screen CMJ as example)
        try:
            df = self.aggregator.get_athletic_screen_trends(athlete_uuid, 'cmj')
            if not df.empty and len(df) >= 3:
                corrs = self.analyzer.calculate_correlations(df)
                all_correlations.update(corrs)
        except Exception:
            pass
        
        # Cross-table correlations
        try:
            df = self.aggregator.get_cross_table_metrics(athlete_uuid, date_range_days=90)
            if not df.empty:
                cross_corrs = self.analyzer.analyze_cross_table_relationships(df)
                all_correlations.update(cross_corrs.get('correlations', {}))
        except Exception:
            pass
        
        return all_correlations
    
    def _detect_anomalies(self, athlete_uuid: str) -> Dict[str, List[Dict[str, Any]]]:
        """Detect anomalies across all test types."""
        all_anomalies = {}
        
        # Athletic Screen anomalies
        for movement in ['cmj', 'dj']:
            try:
                df = self.aggregator.get_athletic_screen_trends(athlete_uuid, movement)
                if not df.empty:
                    anomalies = self.analyzer.detect_anomalies(df)
                    for metric, anomaly_list in anomalies.items():
                        all_anomalies[f"{movement}_{metric}"] = anomaly_list
            except Exception:
                continue
        
        # Pro-Sup anomalies
        try:
            df = self.aggregator.get_pro_sup_trends(athlete_uuid)
            if not df.empty:
                anomalies = self.analyzer.detect_anomalies(df)
                for metric, anomaly_list in anomalies.items():
                    all_anomalies[f"pro_sup_{metric}"] = anomaly_list
        except Exception:
            pass
        
        return all_anomalies
    
    def _compare_to_peers(
        self,
        athlete_uuid: str,
        demographics: Dict[str, Any]
    ) -> Dict[str, Dict[str, Any]]:
        """Compare athlete metrics to peer groups."""
        comparisons = {}
        
        age_group = demographics.get('age_group')
        gender = demographics.get('gender')
        
        # Compare key metrics
        metrics_to_compare = [
            ('f_athletic_screen_cmj', 'jh_in', 'cmj_jump_height'),
            ('f_athletic_screen_cmj', 'pp_w_per_kg', 'cmj_power_per_kg'),
            ('f_readiness_screen_i', 'max_force_norm', 'readiness_i_max_force'),
            ('f_pro_sup', 'tot_rom', 'pro_sup_total_rom')
        ]
        
        for table, column, metric_name in metrics_to_compare:
            try:
                # Get athlete's latest value
                if 'cmj' in table:
                    df = self.aggregator.get_athletic_screen_trends(athlete_uuid, 'cmj')
                    if df.empty or column not in df.columns:
                        continue
                    athlete_value = df[column].dropna().iloc[-1] if len(df[column].dropna()) > 0 else None
                elif 'readiness' in table:
                    df = self.aggregator.get_readiness_screen_trends(athlete_uuid, 'i')
                    if df.empty or column not in df.columns:
                        continue
                    athlete_value = df[column].dropna().iloc[-1] if len(df[column].dropna()) > 0 else None
                elif 'pro_sup' in table:
                    df = self.aggregator.get_pro_sup_trends(athlete_uuid)
                    if df.empty or column not in df.columns:
                        continue
                    athlete_value = df[column].dropna().iloc[-1] if len(df[column].dropna()) > 0 else None
                else:
                    continue
                
                if athlete_value is None:
                    continue
                
                # Get peer stats
                peer_stats = self.aggregator.get_peer_group_stats(
                    table, column, age_group=age_group, gender=gender
                )
                
                if peer_stats:
                    comparison = self.analyzer.compare_to_peer_group(athlete_value, peer_stats)
                    if comparison:
                        comparisons[metric_name] = comparison
            except Exception:
                continue
        
        return comparisons
    
    def format_insights_text(self, insights: Dict[str, Any]) -> str:
        """
        Format insights as readable text.
        
        Args:
            insights: Insights dictionary from generate_athlete_insights
            
        Returns:
            Formatted text string
        """
        athlete_name = insights.get('metadata', {}).get('athlete_name', 'Unknown')
        return self.templates.format_summary_insights(athlete_name, insights)
    
    def format_insights_json(self, insights: Dict[str, Any]) -> Dict[str, Any]:
        """
        Format insights as structured JSON.
        
        Args:
            insights: Insights dictionary from generate_athlete_insights
            
        Returns:
            Formatted JSON structure
        """
        return self.templates.format_json_insights(insights)
    
    def save_insights(
        self,
        insights: Dict[str, Any],
        output_path: str,
        format: str = 'json'
    ):
        """
        Save insights to file.
        
        Args:
            insights: Insights dictionary
            output_path: Path to output file
            format: 'json' or 'text'
        """
        if format == 'json':
            formatted = self.format_insights_json(insights)
            with open(output_path, 'w') as f:
                json.dump(formatted, f, indent=2)
        else:  # text
            formatted = self.format_insights_text(insights)
            with open(output_path, 'w') as f:
                f.write(formatted)

