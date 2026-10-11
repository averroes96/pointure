"""
Desktop path resolution.

Determines the shared application data directory across all Windows user accounts.
Standard location: %ProgramData%\\ShoeDZ
Fallback (dev/testing): %APPDATA%\\ShoeDZ or ./data
"""
import os
from pathlib import Path


def get_data_dir() -> Path:
    """Return the base application data directory."""
    custom = os.environ.get("SHODZ_DATA_DIR", "")
    if custom:
        p = Path(custom)
    elif os.environ.get("PROGRAMDATA"):
        p = Path(os.environ["PROGRAMDATA"]) / "ShoeDZ"
    elif os.environ.get("APPDATA"):
        p = Path(os.environ["APPDATA"]) / "ShoeDZ"
    else:
        # Dev fallback inside repo
        p = Path(__file__).resolve().parent.parent.parent.parent / "backend" / "data"

    p.mkdir(parents=True, exist_ok=True)
    return p


def get_config_path() -> Path:
    return get_data_dir() / "config.json"


def get_db_path() -> Path:
    return get_data_dir() / "db.sqlite3"


def get_logs_dir() -> Path:
    p = get_data_dir() / "logs"
    p.mkdir(parents=True, exist_ok=True)
    return p
