"""
DEPRECATED - dead code, no longer imported anywhere in this package.

main.py runs entirely through database.py + reports.py, both of which read
and write the warehouse database. This file was the pre-warehouse version
(ingest into a local actionPlus.sqlite file, plus its own copy of PDF
generation with a slightly different compute_score() formula than the one
in utils.py). Nothing in this codebase calls it anymore.

The original content is preserved at:
    armAction/_archive/actionPlus.py

This stub is here because the tool that made this change could only write
files on this machine, not delete them, so it left this note instead of
silently leaving the old code in place. Safe to delete this file and the
_archive copy once you've confirmed you don't need either.
"""
