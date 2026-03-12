"""
AI Insights Module for UAIS
Provides statistical analysis and insights into athlete data trends and relationships.

This module is designed to be extensible - start with free statistical analysis,
then add LLM interpretation layer later if needed.
"""

from .data_aggregator import DataAggregator
from .statistical_analyzer import StatisticalAnalyzer
from .insight_generator import InsightGenerator

__all__ = [
    'DataAggregator',
    'StatisticalAnalyzer',
    'InsightGenerator',
]

