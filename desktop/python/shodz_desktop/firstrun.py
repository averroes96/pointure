"""
Desktop configuration manager & first-run generator.
"""
import json
import os
import secrets
from .paths import get_config_path, get_data_dir


def ensure_config():
    """Ensure config.json exists in the data directory and load into os.environ."""
    config_file = get_config_path()
    data = {}

    if config_file.exists():
        try:
            data = json.loads(config_file.read_text(encoding="utf-8"))
        except Exception:
            data = {}

    changed = False

    if "SECRET_KEY" not in data or not data["SECRET_KEY"]:
        data["SECRET_KEY"] = secrets.token_hex(50)
        changed = True

    if "SHUTDOWN_TOKEN" not in data or not data["SHUTDOWN_TOKEN"]:
        data["SHUTDOWN_TOKEN"] = secrets.token_hex(32)
        changed = True

    if changed:
        config_file.write_text(json.dumps(data, indent=2), encoding="utf-8")

    # Propagate to os.environ for Django decouple / settings
    for key, val in data.items():
        if key not in os.environ:
            os.environ[key] = str(val)

    if "SHODZ_DATA_DIR" not in os.environ:
        os.environ["SHODZ_DATA_DIR"] = str(get_data_dir())

    return data
