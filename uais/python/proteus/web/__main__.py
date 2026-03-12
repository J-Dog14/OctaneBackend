"""
Entry point for proteus_web module.
Run with: python -m proteus.web
"""
from .runner import run_daily_proteus_job
import logging

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    run_daily_proteus_job()
