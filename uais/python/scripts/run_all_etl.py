"""
Run all ETL pipelines sequentially.
Logs results and handles exceptions gracefully.
"""
import logging
import sys
from datetime import datetime

# Import all ETL modules
try:
    from athleticScreen.etl_athletic_screen import etl_athletic_screen
except ImportError as e:
    print(f"Warning: Could not import athletic_screen ETL: {e}")
    etl_athletic_screen = None

try:
    from mobility.etl_mobility import etl_mobility
except ImportError as e:
    print(f"Warning: Could not import mobility ETL: {e}")
    etl_mobility = None

try:
    from proSupTest.etl_pro_sup import etl_pro_sup
except ImportError as e:
    print(f"Warning: Could not import pro_sup ETL: {e}")
    etl_pro_sup = None

try:
    from proteus.etl_proteus import etl_proteus
except ImportError as e:
    print(f"Warning: Could not import proteus ETL: {e}")
    etl_proteus = None

try:
    from readinessScreen.etl_readiness import etl_readiness
except ImportError as e:
    print(f"Warning: Could not import readiness ETL: {e}")
    etl_readiness = None


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(f'etl_run_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)


def run_all_etl():
    """
    Execute all ETL pipelines in sequence.
    Continues even if individual pipelines fail.
    """
    pipelines = [
        ('Athletic Screen', etl_athletic_screen),
        ('Mobility', etl_mobility),
        ('Pro-Sup Test', etl_pro_sup),
        ('Proteus', etl_proteus),
        ('Readiness Screen', etl_readiness),
    ]
    
    results = {}
    start_time = datetime.now()
    
    logger.info("=" * 60)
    logger.info("Starting UAIS ETL Pipeline Run")
    logger.info(f"Start time: {start_time}")
    logger.info("=" * 60)
    
    for name, etl_func in pipelines:
        if etl_func is None:
            logger.warning(f"Skipping {name} - module not available")
            results[name] = {'status': 'skipped', 'error': 'Module not imported'}
            continue
        
        logger.info(f"\n{'=' * 60}")
        logger.info(f"Running {name} ETL...")
        logger.info(f"{'=' * 60}")
        
        try:
            etl_func()
            results[name] = {'status': 'success'}
            logger.info(f"{name} ETL completed successfully")
        except Exception as e:
            results[name] = {'status': 'failed', 'error': str(e)}
            logger.error(f"{name} ETL failed: {e}", exc_info=True)
    
    end_time = datetime.now()
    duration = end_time - start_time
    
    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("ETL Pipeline Run Summary")
    logger.info("=" * 60)
    
    for name, result in results.items():
        status = result['status']
        if status == 'success':
            logger.info(f"{name}: {status}")
        elif status == 'skipped':
            logger.warning(f"{name}: {status} - {result.get('error', '')}")
        else:
            logger.error(f"{name}: {status} - {result.get('error', '')}")
    
    logger.info(f"\nTotal duration: {duration}")
    logger.info(f"End time: {end_time}")
    
    # Return success if at least one pipeline succeeded
    success_count = sum(1 for r in results.values() if r['status'] == 'success')
    return success_count > 0


if __name__ == "__main__":
    success = run_all_etl()
    sys.exit(0 if success else 1)

