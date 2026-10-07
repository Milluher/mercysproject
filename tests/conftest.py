import os
import tempfile
from pathlib import Path

# The app reads PORTFOLIO_DB when portfolio.db is first imported, so point it at a throwaway
# database before any test module imports the app. Tests that pass db_path explicitly are unaffected.
os.environ["PORTFOLIO_DB"] = str(Path(tempfile.mkdtemp(prefix="portfolio-tests-")) / "app.db")
