"""Ordered subprocess records and the sole Kinocut subprocess boundary."""
import hashlib
import os
from pathlib import Path
import subprocess
import re
from paths import TimelineError

# Named allow-list: executables and Python's operating-system runtime only.
CHILD_ALLOWLIST = ("PATH", "SYSTEMROOT")


def probe_env():
    """Read-only probes have no caller home, cache, configuration or credentials."""
    env = {name: os.environ[name] for name in CHILD_ALLOWLIST if name in os.environ}
    env.update(HOME=os.devnull, XDG_CACHE_HOME=os.devnull, TMPDIR=os.devnull,
               TMP=os.devnull, TEMP=os.devnull, LANG="C", LC_ALL="C",
               PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1")
    return env


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def child_env(work):
    env = {name: os.environ[name] for name in CHILD_ALLOWLIST if name in os.environ}
    env.update(HOME=str(work / "home"), XDG_CACHE_HOME=str(work / "cache"),
               TMPDIR=str(work / "tmp"), TMP=str(work / "tmp"), TEMP=str(work / "tmp"),
               MCP_VIDEO_HYPERFRAMES_COMMAND="", HYPERFRAMES_SKIP_SKILLS="1",
               LANG="C", LC_ALL="C", PYTHONDONTWRITEBYTECODE="1", PYTHONNOUSERSITE="1")
    return env


class Runner:
    def __init__(self):
        self.processes = []

    def run(self, args, cwd, reads=(), writes=(), env=None, check=True):
        if env is None:
            env = probe_env()
        args = [str(arg) for arg in args]
        entry = {"arguments": args, "cwd": str(cwd), "exit_status": None,
                 "read": [{"path": str(p), "sha256": digest(p)} for p in reads], "wrote": []}
        self.processes.append(entry)
        try:
            result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, stdin=subprocess.DEVNULL)
            entry["exit_status"] = result.returncode
            entry["wrote"] = [{"path": str(p), "sha256": digest(p)} for p in writes if Path(p).is_file()]
        except OSError:
            raise TimelineError("process could not start: " + Path(args[0]).name + "; check Dependencies and permissions") from None
        if check and result.returncode:
            raise TimelineError("process failed: " + Path(args[0]).name + " exit " + str(result.returncode) +
                                "; check inputs, disk space and Dependencies")
        return result

    def relative_records(self, work, output, tool):
        def relative(value):
            path = Path(value)
            if not path.is_absolute():
                return value
            if path == work / "deliverable" or work / "deliverable" in path.parents:
                return "output/" + str(path.relative_to(work / "deliverable"))
            if path == output or output in path.parents:
                return "output/" + str(path.relative_to(output))
            if path == work or work in path.parents:
                return str(path.relative_to(work))
            if path == tool or tool in path.parents:
                return "tool/" + str(path.relative_to(tool))
            return str(path)
        rows = []
        for entry in self.processes:
            rows.append({"arguments": [relative(a) for a in entry["arguments"]],
                         "cwd": relative(entry["cwd"]), "exit_status": entry["exit_status"],
                         "read": [{"path": relative(f["path"]), "sha256": f["sha256"]} for f in entry["read"]],
                         "wrote": [{"path": relative(f["path"]), "sha256": f["sha256"]} for f in entry["wrote"]]})
        return rows


def run_kinocut(arguments, work, runner, reads=(), writes=()):
    """Run a complete Kinocut argument list in an isolated work directory."""
    env = child_env(work)
    for name in ("home", "cache", "tmp"):
        (work / name).mkdir(exist_ok=True)
    result = runner.run(arguments, work, reads=reads, writes=writes, env=env, check=False)
    if result.returncode:
        # Accept only the bridge's bounded, path-free diagnostic, never a traceback.
        lines = result.stderr.decode("utf-8", errors="replace").splitlines()
        cause = next((line for line in lines if re.fullmatch(r"Kinocut [A-Za-z_][A-Za-z0-9_]* code=[A-Za-z0-9_.-]+", line)),
                     "Kinocut child exit " + str(result.returncode))
        raise TimelineError(cause + "; output withheld, check the cutfile, inputs and pinned environment")
    return result
