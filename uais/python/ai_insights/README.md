# AI Insights Module

Free statistical analysis module for generating insights into athlete data trends and relationships.

## Overview

This module provides statistical analysis capabilities to:
- **Detect trends** in athlete performance over time
- **Find correlations** between different metrics
- **Identify anomalies** in test results
- **Compare athletes** to peer groups

All analysis is performed using free, open-source libraries (pandas, scipy, scikit-learn). No API costs!

## Architecture

The module is designed to be extensible - you can add an LLM interpretation layer later if desired.

```
ai_insights/
├── data_aggregator.py      # SQL queries to fetch data from PostgreSQL
├── statistical_analyzer.py  # Statistical analysis functions
├── insight_generator.py    # Main orchestration class
├── templates.py            # Formatting templates for insights
└── example_usage.py        # Usage examples
```

## Quick Start

### Basic Usage

```python
from ai_insights import InsightGenerator

# Initialize generator
generator = InsightGenerator()

# Generate insights for an athlete
insights = generator.generate_athlete_insights(
    athlete_uuid="your-athlete-uuid",
    include_trends=True,
    include_correlations=True,
    include_anomalies=True,
    include_peer_comparisons=True
)

# Format as readable text
text_output = generator.format_insights_text(insights)
print(text_output)

# Or save to file
generator.save_insights(insights, "insights.txt", format='text')
generator.save_insights(insights, "insights.json", format='json')
```

### Example Output

```
Insights for John Doe
==================================================

PERFORMANCE TRENDS:
  • Cmj Jump Height: Improving trend detected - +5.2% change over 120 days (8 data points, R²=0.65, p<0.05)
  • Cmj Peak Power: Stable trend detected over 120 days (8 data points, R²=0.12)

METRIC RELATIONSHIPS:
  • Cmj Jump Height vs Cmj Peak Power: Moderate positive correlation (r=0.58, p<0.05, n=8)

ANOMALIES DETECTED:
  • Cmj Jump Height: 1 anomaly detected - value 24.5 (2.3σ from mean)

PEER GROUP COMPARISONS:
  • Cmj Jump Height: 22.3 (+8.2% above peer mean of 20.6, 72nd percentile - Above average (75th-90th percentile))
```

## Features

### 1. Trend Detection

Analyzes performance trends over time using linear regression:

```python
from ai_insights import DataAggregator, StatisticalAnalyzer

aggregator = DataAggregator()
analyzer = StatisticalAnalyzer()

# Get CMJ data
df = aggregator.get_athletic_screen_trends(athlete_uuid, 'cmj', ['jh_in', 'peak_power'])

# Detect trends
trends = analyzer.detect_trends(df)

# Results include:
# - slope: Rate of change per day
# - direction: 'increasing', 'decreasing', or 'stable'
# - percent_change: Total % change over time period
# - r_squared: Goodness of fit
# - p_value: Statistical significance
```

### 2. Correlation Analysis

Finds relationships between metrics:

```python
# Within-table correlations
correlations = analyzer.calculate_correlations(df, method='pearson')

# Cross-table correlations (metrics from different test types)
cross_df = aggregator.get_cross_table_metrics(athlete_uuid, date_range_days=90)
relationships = analyzer.analyze_cross_table_relationships(cross_df)
```

### 3. Anomaly Detection

Identifies unusual test results:

```python
anomalies = analyzer.detect_anomalies(df, method='zscore', threshold=2.0)

# Methods:
# - 'zscore': Based on standard deviations from mean
# - 'isolation_forest': Machine learning-based detection
```

### 4. Peer Group Comparisons

Compares athlete metrics to peer groups:

```python
# Get peer statistics
peer_stats = aggregator.get_peer_group_stats(
    'f_athletic_screen_cmj',
    'jh_in',
    age_group='College',
    gender='Male'
)

# Compare athlete
comparison = analyzer.compare_to_peer_group(athlete_value, peer_stats)

# Results include:
# - percentile_rank: Where athlete ranks (0-100)
# - category: 'excellent', 'above_average', 'average', etc.
# - z_score: Standard deviations from mean
```

## Available Data Sources

The module can analyze data from:

- **Athletic Screen**: CMJ, DJ, SLV, NMT, PPU
- **Readiness Screen**: I, Y, T, IR90, CMJ, PPU
- **Pro-Sup Test**: ROM, fatigue, scores
- **Mobility**: Assessment metrics
- **Proteus**: Power, velocity, acceleration
- **Pitching/Hitting**: Kinematics data
- **Arm Action**: Biomechanical metrics

## Extending with LLM (Future)

The module is designed to be extended with LLM interpretation:

```python
# Future: Add LLM layer
from ai_insights.llm_client import LLMClient

llm = LLMClient()
statistical_results = generator.generate_athlete_insights(athlete_uuid)
llm_insights = llm.interpret_statistics(statistical_results)
```

## Requirements

All dependencies are already in `requirements.txt`:
- pandas
- numpy
- scipy
- scikit-learn
- SQLAlchemy
- psycopg2-binary

## Database Connection

The module uses your existing database configuration from `config/db_connections.yaml`. It connects to the warehouse database automatically.

## Examples

See `example_usage.py` for complete examples:
- Single athlete analysis
- Batch processing multiple athletes
- Specific analysis types

## Notes

- All analysis is performed locally (no API calls)
- Results are deterministic and reproducible
- Statistical methods are well-established and validated
- Module is extensible for future LLM integration

