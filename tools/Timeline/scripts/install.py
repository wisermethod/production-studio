"""Exact wheel pins and plugin-copy consent. Standard library only."""
import importlib.metadata
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import date
from paths import TimelineError


def cache_for(tool):
    return tool / ".venv" / ("python%d.%d" % sys.version_info[:2])


def site_for(cache):
    return cache / ("lib/python%d.%d/site-packages" % sys.version_info[:2])


def required_pins(tool):
    pins = {}
    for line in (tool / "requirements.txt").read_text().splitlines():
        match = re.fullmatch(r"([A-Za-z0-9_.-]+)==([0-9]+(?:\.[0-9]+)*)", line)
        if not match:
            raise TimelineError("requirements must be exact pins; restore requirements.txt")
        name = re.sub(r"[-_.]+", "-", match[1]).lower()
        if name in pins:
            raise TimelineError("requirements contain a duplicate pin; restore requirements.txt")
        pins[name] = match[2]
    return pins


def state(tool):
    cache = cache_for(tool)
    found = {}
    for dist in importlib.metadata.distributions(path=[str(site_for(cache))]):
        name = re.sub(r"[-_.]+", "-", dist.metadata.get("Name", "")).lower()
        found.setdefault(name, set()).add(dist.version)
    packages = [{"name": n, "pin": v, "installed": found.get(n) == {v}}
                for n, v in required_pins(tool).items()]
    complete = bool(packages) and all(p["installed"] for p in packages) and (cache / "bin/python3").is_file()
    return {"state": "complete" if complete else "incomplete" if cache.exists() else "absent",
            "directory": str(cache), "packages": packages}


def plugin_root(tool):
    for parent in (tool,) + tuple(tool.parents):
        if (parent / "tools/AGENTS.md").is_file():
            return parent.resolve()
    raise TimelineError("plugin root missing tools/AGENTS.md; restore the family index")


def consented(root):
    try:
        marker = json.loads((root / ".wiser-consent").read_text())
        return isinstance(marker, dict) and marker.get("realpath") == str(root.resolve())
    except (ValueError, OSError):
        return False


def install_env(cache):
    # Ignore caller pip configuration, index overrides, user sites and proxies.
    env = {key: os.environ[key] for key in ("PATH", "SYSTEMROOT") if key in os.environ}
    env.update(HOME=str(cache), TMPDIR=str(cache), LC_ALL="C", LANG="C",
               PIP_CONFIG_FILE=os.devnull, PIP_NO_CACHE_DIR="1", PIP_DISABLE_PIP_VERSION_CHECK="1",
               PIP_CACHE_DIR=str(cache / "pip-cache"), XDG_CACHE_HOME=str(cache / "cache"),
               PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1", PIP_NO_INPUT="1")
    return env


def ensure(tool, authorised, runner=None):
    cache = cache_for(tool)
    if state(tool)["state"] != "complete":
        root = plugin_root(tool)
        explicit = authorised or os.environ.get("WISER_ALLOW_INSTALL") == "1"
        if not explicit and not consented(root):
            pins = ", ".join(n + "==" + v for n, v in required_pins(tool).items())
            raise TimelineError("packages missing: " + pins + ". Install fetches about 95 MB from pypi.org and "
                                "files.pythonhosted.org into " + str(cache) + "; pip cache is off. "
                                "Retry render with --install or WISER_ALLOW_INSTALL=1")
        cache.mkdir(parents=True, exist_ok=True)
        marker = root / ".wiser-consent"
        marker.write_text(json.dumps({"realpath": str(root), "date": date.today().isoformat(), "tool": "Timeline"}) + "\n")
        marker.chmod(0o600)
        env = install_env(cache)
        failure = "wheel install failed at " + str(cache) + "; check python3 -m venv --help, wheel support and permissions, then remove the incomplete cache and retry with --install"
        def run(args, reads=()):
            if runner:
                result = runner.run(args, tool, reads=reads, env=env, check=False)
            else:
                result = subprocess.run(args, env=env, capture_output=True, stdin=subprocess.DEVNULL)
            if result.returncode:
                missing = re.search(rb"No matching distribution found for ([A-Za-z0-9_.-]+==[0-9.]+)", result.stderr or b"")
                detail = "; no compatible binary wheel for " + missing[1].decode("ascii") if missing else ""
                raise TimelineError(failure + detail)
            return result
        try:
            if not (cache / "bin/python3").is_file():
                run([sys.executable, "-m", "venv", str(cache)])
            sys.stderr.write("First run: installing dependencies into " + str(cache) + "\n")
            run([str(cache / "bin/python3"), "-m", "pip", "install", "--only-binary", ":all:",
                 "--no-cache-dir", "--disable-pip-version-check", "--index-url", "https://pypi.org/simple",
                 "-r", str(tool / "requirements.txt")], reads=[tool / "requirements.txt"])
            if state(tool)["state"] != "complete":
                raise TimelineError(failure)
        except TimelineError as error:
            if str(error).startswith(failure):
                raise
            raise TimelineError(failure) from None
        except (OSError, subprocess.SubprocessError):
            raise TimelineError(failure) from None
    sys.path.insert(0, str(site_for(cache)))
    return cache
