"""
Templates for formatting statistical insights into readable text.
These templates can later be enhanced with LLM interpretation.
"""

from typing import Dict, List, Any


class InsightTemplates:
    """
    Templates for formatting statistical insights.
    """
    
    @staticmethod
    def format_trend_insight(metric_name: str, trend_data: Dict[str, Any]) -> str:
        """
        Format trend analysis into readable text.
        
        Args:
            metric_name: Name of the metric
            trend_data: Trend analysis results from StatisticalAnalyzer
            
        Returns:
            Formatted insight text
        """
        direction = trend_data.get('direction', 'stable')
        pct_change = trend_data.get('percent_change', 0)
        is_significant = trend_data.get('is_significant', False)
        r_squared = trend_data.get('r_squared', 0)
        time_span = trend_data.get('time_span_days', 0)
        data_points = trend_data.get('data_points', 0)
        
        # Format metric name for readability
        metric_display = metric_name.replace('_', ' ').title()
        
        if not is_significant:
            return (
                f"{metric_display}: No significant trend detected over {time_span} days "
                f"({data_points} data points, R²={r_squared:.2f})"
            )
        
        direction_text = {
            'increasing': 'improving',
            'decreasing': 'declining',
            'stable': 'stable'
        }.get(direction, direction)
        
        pct_text = f"{abs(pct_change):.1f}%"
        if pct_change > 0:
            pct_text = f"+{pct_text}"
        
        return (
            f"{metric_display}: {direction_text.capitalize()} trend detected - "
            f"{pct_text} change over {time_span} days "
            f"({data_points} data points, R²={r_squared:.2f}, p<0.05)"
        )
    
    @staticmethod
    def format_correlation_insight(
        metric_pair: str,
        corr_data: Dict[str, Any]
    ) -> str:
        """
        Format correlation analysis into readable text.
        
        Args:
            metric_pair: Pair of metrics (e.g., "metric1 vs metric2")
            corr_data: Correlation analysis results
            
        Returns:
            Formatted insight text
        """
        correlation = corr_data.get('correlation', 0)
        p_value = corr_data.get('p_value', 1.0)
        is_significant = corr_data.get('is_significant', False)
        data_points = corr_data.get('data_points', 0)
        
        metric1, metric2 = metric_pair.split(' vs ')
        metric1_display = metric1.replace('_', ' ').title()
        metric2_display = metric2.replace('_', ' ').title()
        
        # Determine strength
        abs_corr = abs(correlation)
        if abs_corr >= 0.7:
            strength = 'strong'
        elif abs_corr >= 0.4:
            strength = 'moderate'
        elif abs_corr >= 0.2:
            strength = 'weak'
        else:
            strength = 'very weak'
        
        # Determine direction
        if correlation > 0:
            direction = 'positive'
        else:
            direction = 'negative'
        
        if not is_significant:
            return (
                f"{metric1_display} vs {metric2_display}: "
                f"No significant correlation (r={correlation:.2f}, p={p_value:.3f}, n={data_points})"
            )
        
        return (
            f"{metric1_display} vs {metric2_display}: "
            f"{strength.capitalize()} {direction} correlation "
            f"(r={correlation:.2f}, p<0.05, n={data_points})"
        )
    
    @staticmethod
    def format_anomaly_insight(
        metric_name: str,
        anomalies: List[Dict[str, Any]]
    ) -> str:
        """
        Format anomaly detection into readable text.
        
        Args:
            metric_name: Name of the metric
            anomalies: List of anomaly records
            
        Returns:
            Formatted insight text
        """
        if not anomalies:
            return f"{metric_name.replace('_', ' ').title()}: No anomalies detected"
        
        metric_display = metric_name.replace('_', ' ').title()
        count = len(anomalies)
        
        if count == 1:
            anomaly = anomalies[0]
            value = anomaly.get('value', 0)
            z_score = anomaly.get('z_score', 0)
            return (
                f"{metric_display}: 1 anomaly detected - "
                f"value {value:.2f} ({z_score:.1f}σ from mean)"
            )
        else:
            return (
                f"{metric_display}: {count} anomalies detected "
                f"(values {min(a.get('value', 0) for a in anomalies):.2f} to "
                f"{max(a.get('value', 0) for a in anomalies):.2f})"
            )
    
    @staticmethod
    def format_peer_comparison_insight(
        metric_name: str,
        comparison: Dict[str, Any]
    ) -> str:
        """
        Format peer group comparison into readable text.
        
        Args:
            metric_name: Name of the metric
            comparison: Comparison results from compare_to_peer_group
            
        Returns:
            Formatted insight text
        """
        athlete_value = comparison.get('athlete_value', 0)
        peer_mean = comparison.get('peer_mean', 0)
        percentile = comparison.get('percentile_rank', 50)
        category = comparison.get('category', 'average')
        percent_diff = comparison.get('percent_difference', 0)
        
        metric_display = metric_name.replace('_', ' ').title()
        
        category_text = {
            'excellent': 'Excellent (top 10%)',
            'above_average': 'Above average (75th-90th percentile)',
            'average': 'Average (50th-75th percentile)',
            'below_average': 'Below average (25th-50th percentile)',
            'poor': 'Below average (bottom 25%)'
        }.get(category, category)
        
        diff_text = f"{abs(percent_diff):.1f}%"
        if percent_diff > 0:
            diff_text = f"+{diff_text} above"
        else:
            diff_text = f"{diff_text} below"
        
        return (
            f"{metric_display}: {athlete_value:.2f} "
            f"({diff_text} peer mean of {peer_mean:.2f}, "
            f"{percentile:.0f}th percentile - {category_text})"
        )
    
    @staticmethod
    def format_summary_insights(
        athlete_name: str,
        insights: Dict[str, Any]
    ) -> str:
        """
        Format a summary of all insights for an athlete.
        
        Args:
            athlete_name: Name of the athlete
            insights: Complete insights dictionary
            
        Returns:
            Formatted summary text
        """
        lines = [f"Insights for {athlete_name}", "=" * 50, ""]
        
        # Trends section
        if 'trends' in insights and insights['trends']:
            lines.append("PERFORMANCE TRENDS:")
            for metric, trend_data in insights['trends'].items():
                lines.append(f"  • {InsightTemplates.format_trend_insight(metric, trend_data)}")
            lines.append("")
        
        # Correlations section
        if 'correlations' in insights and insights['correlations']:
            lines.append("METRIC RELATIONSHIPS:")
            for pair, corr_data in list(insights['correlations'].items())[:5]:  # Top 5
                if corr_data.get('is_significant', False):
                    lines.append(f"  • {InsightTemplates.format_correlation_insight(pair, corr_data)}")
            lines.append("")
        
        # Anomalies section
        if 'anomalies' in insights and insights['anomalies']:
            lines.append("ANOMALIES DETECTED:")
            for metric, anomaly_list in insights['anomalies'].items():
                if anomaly_list:
                    lines.append(f"  • {InsightTemplates.format_anomaly_insight(metric, anomaly_list)}")
            lines.append("")
        
        # Peer comparisons section
        if 'peer_comparisons' in insights and insights['peer_comparisons']:
            lines.append("PEER GROUP COMPARISONS:")
            for metric, comparison in insights['peer_comparisons'].items():
                lines.append(f"  • {InsightTemplates.format_peer_comparison_insight(metric, comparison)}")
            lines.append("")
        
        return "\n".join(lines)
    
    @staticmethod
    def format_json_insights(insights: Dict[str, Any]) -> Dict[str, Any]:
        """
        Format insights as structured JSON (for API consumption).
        
        Args:
            insights: Complete insights dictionary
            
        Returns:
            Formatted JSON structure
        """
        return {
            'summary': {
                'has_trends': bool(insights.get('trends')),
                'has_correlations': bool(insights.get('correlations')),
                'has_anomalies': bool(insights.get('anomalies')),
                'has_peer_comparisons': bool(insights.get('peer_comparisons'))
            },
            'trends': insights.get('trends', {}),
            'correlations': insights.get('correlations', {}),
            'anomalies': insights.get('anomalies', {}),
            'peer_comparisons': insights.get('peer_comparisons', {}),
            'metadata': insights.get('metadata', {})
        }

