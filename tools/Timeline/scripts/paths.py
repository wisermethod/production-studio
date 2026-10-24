"""Screen caller paths by resolved spelling and filesystem identity, without opening secrets."""
import os
import sys
from pathlib import Path


class TimelineError(Exception):
    pass


def canonical(value):
    try:
        path = Path(value).resolve()
        ancestor = path
        while not ancestor.exists():
            # stat detects loops even on Python versions where resolve leaves them.
            try:
                ancestor.stat()
            except FileNotFoundError:
                pass
            if ancestor == ancestor.parent:
                break
            ancestor = ancestor.parent
        return path
    except (OSError, RuntimeError, ValueError):
        raise TimelineError("path cannot be resolved; repair permissions or symbolic link loops") from None


def identity(path):
    try:
        stat = path.stat()
        return stat.st_dev, stat.st_ino
    except FileNotFoundError:
        return None
    except OSError:
        raise TimelineError("path cannot be screened; check folder permissions") from None


def inside(path, directory):
    key = identity(directory)
    return path == directory or directory in path.parents or (key is not None and any(
        identity(p) == key for p in (path,) + tuple(path.parents)))


def config_dir():
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/wiser"
    if os.name == "nt":
        return Path(os.environ.get("APPDATA", str(Path.home() / "AppData/Roaming"))) / "wiser"
    return Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "wiser"


def screen(value, label, tool, destination=False):
    if not isinstance(value, str) or not value or any(ord(c) < 32 for c in value):
        raise TimelineError(label + " must be a nonempty path without control characters; choose a work path")
    if not Path(value).is_absolute():
        raise TimelineError(label + " must be absolute; pass a full path")
    path = canonical(value)
    reserved = canonical(config_dir())
    key = reserved / "auth-provider.env"
    candidate = identity(path)
    if path == key or (candidate is not None and candidate == identity(key)):
        raise TimelineError(label + " names the connector key; choose a work path")
    if inside(path, reserved):
        raise TimelineError(label + " is in the credential directory; choose a work path")
    try:
        if candidate is not None and reserved.is_dir():
            for entry in reserved.iterdir():
                if entry.is_file() and identity(entry) == candidate:
                    raise TimelineError(label + " identifies a file in the credential directory; choose a work path")
    except OSError:
        raise TimelineError(label + " cannot screen the credential directory; repair its permissions") from None
    # Never open environment files or private stores, including through aliases.
    if path.name == ".env" or path.name.endswith(".env") or "memory" in path.parts:
        raise TimelineError(label + " names private configuration or memory; choose a work path")
    if destination:
        if inside(path, canonical(tool)):
            raise TimelineError(label + " resolves inside the tool; choose a work directory")
        if path.exists() or path.is_symlink():
            raise TimelineError(label + " already exists; choose a new directory")
        if not path.parent.is_dir():
            raise TimelineError(label + " parent is absent; create the work parent first")
    elif not path.is_file():
        raise TimelineError(label + " is not a readable file; check its path")
    return path
