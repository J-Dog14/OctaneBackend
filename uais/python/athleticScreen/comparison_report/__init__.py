"""
Athletic Screen comparison report package.

Generates a multi-session PDF that compares 2-4 athletic screen sessions
for a single athlete (e.g. pre/post test) side-by-side. Mirrors the
visual style of the single-session report produced by ``pdf_report.py``
without touching that file.

Public entry point: ``create_comparison_pdf`` from
``comparison_report.comparison_pdf``.
"""

from .comparison_pdf import create_comparison_pdf  # noqa: F401
