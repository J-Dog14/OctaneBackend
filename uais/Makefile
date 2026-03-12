# ============================================================================
# Makefile for Athlete Sync ETL
# ============================================================================
# Provides convenient targets for installing dependencies and running the sync.
# ============================================================================

.PHONY: help install sync format clean

# Default target
help:
	@echo "Available targets:"
	@echo "  make install  - Install Python dependencies"
	@echo "  make sync     - Run the athlete sync ETL script"
	@echo "  make format   - Format Python code with black (if available)"
	@echo "  make clean    - Remove Python cache files"

# Install dependencies
install:
	@echo "Installing Python dependencies..."
	pip install -r python/requirements.txt

# Run the sync script
sync:
	@echo "Running athlete sync ETL..."
	python python/scripts/sync_athletes_from_app.py

# Format code (optional, requires black)
format:
	@if command -v black >/dev/null 2>&1; then \
		echo "Formatting Python code..."; \
		black python/scripts/sync_athletes_from_app.py; \
	else \
		echo "black not found. Install with: pip install black"; \
	fi

# Clean Python cache files
clean:
	@echo "Cleaning Python cache files..."
	find python -type d -name __pycache__ -exec rm -r {} + 2>/dev/null || true
	find python -type f -name "*.pyc" -delete 2>/dev/null || true

