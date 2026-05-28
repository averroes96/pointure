"""
Persistent machine UUID.

The UUID is generated once and stored on disk.  We use a well-known path
(/var/lib/shodz/machine_id) so the same ID survives container restarts as
long as the Docker volume is preserved.  A fallback path inside the project
directory is used when that path is not writable (development).
"""
import uuid
from pathlib import Path


_PRIMARY_PATH = Path("/var/lib/shodz/machine_id")
_FALLBACK_PATH = Path(__file__).resolve().parent.parent.parent.parent / ".machine_id"


def _get_or_create(path: Path) -> str:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            value = path.read_text().strip()
            if value:
                return value
        # Generate and persist
        value = str(uuid.uuid4())
        path.write_text(value)
        return value
    except OSError:
        return None


def get_machine_id() -> str:
    """Return the persistent machine UUID, creating it if necessary."""
    value = _get_or_create(_PRIMARY_PATH)
    if value:
        return value
    value = _get_or_create(_FALLBACK_PATH)
    if value:
        return value
    # Last resort — in-memory (won't persist across restarts, but won't crash)
    return str(uuid.uuid4())
