"""
Example usage of the AI Insights module.

This script demonstrates how to generate insights for athletes.
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from ai_insights import InsightGenerator


def example_single_athlete():
    """Example: Generate insights for a single athlete."""
    print("=" * 60)
    print("Example 1: Generate insights for a single athlete")
    print("=" * 60)
    
    # Initialize insight generator
    generator = InsightGenerator()
    
    # Replace with an actual athlete UUID from your database
    athlete_uuid = "your-athlete-uuid-here"
    
    # Generate insights
    insights = generator.generate_athlete_insights(
        athlete_uuid=athlete_uuid,
        include_trends=True,
        include_correlations=True,
        include_anomalies=True,
        include_peer_comparisons=True
    )
    
    # Format as text
    text_output = generator.format_insights_text(insights)
    print(text_output)
    
    # Save to file
    generator.save_insights(insights, "athlete_insights.txt", format='text')
    generator.save_insights(insights, "athlete_insights.json", format='json')
    
    print("\nInsights saved to athlete_insights.txt and athlete_insights.json")


def example_multiple_athletes():
    """Example: Generate insights for multiple athletes."""
    print("\n" + "=" * 60)
    print("Example 2: Generate insights for multiple athletes")
    print("=" * 60)
    
    from common.config import get_warehouse_engine
    from sqlalchemy import text
    import pandas as pd
    
    generator = InsightGenerator()
    engine = get_warehouse_engine()
    
    # Get list of athletes with data
    query = text("""
        SELECT DISTINCT athlete_uuid, name
        FROM analytics.d_athletes
        WHERE has_athletic_screen_data = true
        OR has_readiness_screen_data = true
        OR has_pro_sup_data = true
        LIMIT 5
    """)
    
    athletes_df = pd.read_sql(query, engine)
    
    print(f"Found {len(athletes_df)} athletes with data\n")
    
    for idx, row in athletes_df.iterrows():
        athlete_uuid = row['athlete_uuid']
        athlete_name = row['name']
        
        print(f"\nAnalyzing {athlete_name} ({athlete_uuid[:8]}...)")
        
        try:
            insights = generator.generate_athlete_insights(
                athlete_uuid=athlete_uuid,
                include_trends=True,
                include_correlations=False,  # Skip for speed
                include_anomalies=True,
                include_peer_comparisons=True
            )
            
            # Print summary
            if insights.get('trends'):
                print(f"  • Found {len(insights['trends'])} trend analyses")
            if insights.get('anomalies'):
                total_anomalies = sum(len(v) for v in insights['anomalies'].values())
                print(f"  • Detected {total_anomalies} anomalies")
            if insights.get('peer_comparisons'):
                print(f"  • Compared {len(insights['peer_comparisons'])} metrics to peers")
        except Exception as e:
            print(f"  • Error: {e}")


def example_specific_analysis():
    """Example: Perform specific types of analysis."""
    print("\n" + "=" * 60)
    print("Example 3: Specific analysis types")
    print("=" * 60)
    
    from ai_insights import DataAggregator, StatisticalAnalyzer
    
    aggregator = DataAggregator()
    analyzer = StatisticalAnalyzer()
    
    athlete_uuid = "your-athlete-uuid-here"
    
    # 1. Analyze CMJ trends
    print("\n1. CMJ Jump Height Trends:")
    cmj_df = aggregator.get_athletic_screen_trends(athlete_uuid, 'cmj', ['jh_in'])
    if not cmj_df.empty:
        trends = analyzer.detect_trends(cmj_df, metric_columns=['jh_in'])
        for metric, trend_data in trends.items():
            print(f"   {metric}: {trend_data.get('direction')} trend "
                  f"({trend_data.get('percent_change', 0):.1f}% change)")
    
    # 2. Cross-table correlations
    print("\n2. Cross-Table Correlations:")
    cross_df = aggregator.get_cross_table_metrics(athlete_uuid, date_range_days=180)
    if not cross_df.empty:
        relationships = analyzer.analyze_cross_table_relationships(cross_df)
        print(f"   Found {len(relationships.get('correlations', {}))} correlations")
        for pair, corr_data in list(relationships.get('correlations', {}).items())[:3]:
            if corr_data.get('is_significant'):
                print(f"   • {pair}: r={corr_data['correlation']:.2f}")
    
    # 3. Peer comparison
    print("\n3. Peer Group Comparison:")
    peer_stats = aggregator.get_peer_group_stats(
        'f_athletic_screen_cmj',
        'jh_in',
        age_group=None,  # Compare to all ages
        gender=None
    )
    if peer_stats:
        print(f"   Peer group stats for CMJ Jump Height:")
        print(f"   • Mean: {peer_stats['mean']:.2f}")
        print(f"   • Median: {peer_stats['median']:.2f}")
        print(f"   • 25th percentile: {peer_stats['percentile_25']:.2f}")
        print(f"   • 75th percentile: {peer_stats['percentile_75']:.2f}")


if __name__ == "__main__":
    print("AI Insights Module - Example Usage")
    print("=" * 60)
    print("\nNote: Replace 'your-athlete-uuid-here' with actual UUIDs from your database")
    print("You can find athlete UUIDs by querying: SELECT athlete_uuid, name FROM analytics.d_athletes LIMIT 10")
    print("\n")
    
    # Uncomment the examples you want to run:
    
    # example_single_athlete()
    # example_multiple_athletes()
    # example_specific_analysis()
    
    print("\n" + "=" * 60)
    print("To run examples, uncomment the function calls in the __main__ block")
    print("=" * 60)

