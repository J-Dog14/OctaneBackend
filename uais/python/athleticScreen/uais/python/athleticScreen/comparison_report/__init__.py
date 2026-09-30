"""
Athletic Screen comparison report package.

Generates a multi-session PDF that compares 2-4 athletic screen sessions
for a single athlete (e.g. pre/post test) side-by-side. Mirrors the
visual style of the single-session report produced by ``pdf_report.py``
without touching that file.

Page 1 is a summary that answers "what changed, and where does that sit in
our data" in one view; the movement pages behind it carry the detail.

Public entry point: ``create_comparison_pdf`` from
``comparison_report.comparison_pdf``.
"""

from .comparison_pdf import create_comparison_pdf  # noqa: F401
from .summary_page import summary_page  # noqa: F401
