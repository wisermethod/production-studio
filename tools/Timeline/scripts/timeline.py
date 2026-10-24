#!/usr/bin/env python3
"""Timeline 0.1.0. Its help and survey paths require only Python 3.9 stdlib."""
import sys
sys.dont_write_bytecode = True
import json
from pathlib import Path
import platform
import shutil
from paths import TimelineError, screen
import install
from processes import Runner
import plan as plans

TOOL = Path(__file__).resolve().parents[1]
PYTHON_CHECK = "python3 -c 'import sys; print(sys.version.split()[0]); sys.exit(not (3, 11) <= sys.version_info[:2] <= (3, 13))'"
USAGE = """Timeline 0.1.0
Usage (from the tool directory):
  python3 scripts/timeline.py help
  python3 scripts/timeline.py --help
  python3 scripts/timeline.py check
  python3 scripts/timeline.py render --plan <path> --output <path> [--install]
Commands:
  help      Print usage before dependency checks (Python 3.9 or newer).
  check     Read-only survey; one JSON object, never installs.
  render    Cut a validated silent recording plan (Python 3.11 to 3.13 only).
            Kinocut needs 3.11+; OpenTimelineIO 0.18.1 has wheels through 3.13
            on Apple Silicon macOS, Linux x86_64/aarch64 and Windows,
            with none for Python 3.14 or Intel Macs; macOS needs an arm64 Python.
Flags:
  --help          Top-level alias for help; no other arguments.
  --plan <path>   Required for render; absolute JSON plan path.
  --output <path> Required for render; new absolute directory, parent exists.
  --install       Render only; authorize 35 pinned wheels (about 95 MB) into
                  this tool's .venv, then finish. Hosts: pypi.org and
                  files.pythonhosted.org. pip cache disabled.
No other commands or flags. Flags do not repeat. No account configuration.
WISER_ALLOW_INSTALL=1 or matching plugin-copy .wiser-consent also authorizes install.
"""


def platform_supported():
    # OpenTimelineIO 0.18.1 publishes macOS wheels for arm64 only; an Intel or Rosetta Python has none.
    return not (sys.platform == "darwin" and platform.machine() != "arm64")


def parse(argv):
    if not argv:
        raise TimelineError("missing command; run python3 scripts/timeline.py help")
    command = argv[0]
    if command not in ("help", "--help", "check", "render"):
        raise TimelineError("unknown command " + command + "; run python3 scripts/timeline.py help")
    options = {}
    at = 1
    while at < len(argv):
        flag = argv[at]
        if command != "render" or flag not in ("--plan", "--output", "--install"):
            raise TimelineError("unknown argument " + flag + "; run python3 scripts/timeline.py help")
        if flag in options:
            raise TimelineError("repeated flag " + flag + "; run python3 scripts/timeline.py help")
        if flag == "--install":
            options[flag] = True
        else:
            at += 1
            if at == len(argv) or argv[at].startswith("--"):
                raise TimelineError("missing value for " + flag + "; run python3 scripts/timeline.py help")
            options[flag] = argv[at]
        at += 1
    if command == "render":
        for flag in ("--plan", "--output"):
            if flag not in options:
                raise TimelineError("missing flag " + flag + "; run python3 scripts/timeline.py help")
    return command, options


def programs(runner, cwd):
    result = {}
    for name in ("ffmpeg", "ffprobe"):
        binary = shutil.which(name)
        result[name] = binary
        result[name + "_version"] = None
        if binary:
            try:
                p = runner.run([binary, "-version"], cwd)
                result[name + "_version"] = p.stdout.decode().splitlines()[0]
            except TimelineError:
                result[name] = None
    result["ffmpeg_libx264"] = False
    if result["ffmpeg"]:
        try:
            p = runner.run([result["ffmpeg"], "-hide_banner", "-encoders"], cwd)
            result["ffmpeg_libx264"] = any(len(line.split()) > 1 and line.split()[1] == "libx264" for line in p.stdout.decode().splitlines())
        except TimelineError:
            pass
    return result


def main(argv=None):
    try:
        command, options = parse(sys.argv[1:] if argv is None else argv)
        if command in ("help", "--help"):
            print(USAGE, end="")
            return 0
        runner = Runner()
        if command == "check":
            deps = programs(runner, Path.cwd())
            cache = install.state(TOOL)
            supported = (3, 11) <= sys.version_info[:2] <= (3, 13)
            machine = platform_supported()
            print(json.dumps({"python": {"version": sys.version.split()[0], "supported": supported},
                              "platform": {"system": sys.platform, "machine": platform.machine(), "supported": machine},
                              "programs": deps, **cache,
                              "ok": supported and machine and bool(deps["ffmpeg"] and deps["ffprobe"] and deps["ffmpeg_libx264"]) and cache["state"] == "complete"}))
            return 0
        if not (3, 11) <= sys.version_info[:2] <= (3, 13):
            raise TimelineError("render refuses Python " + sys.version.split()[0] + "; requires Python 3.11 to 3.13 only; check with " + PYTHON_CHECK)
        if not platform_supported():
            raise TimelineError("render refuses a " + platform.machine() + " Python on macOS; OpenTimelineIO 0.18.1 has wheels for "
                                "Apple Silicon (arm64) Macs only; run an arm64 Python 3.11 to 3.13")
        plan_path = screen(options["--plan"], "--plan", TOOL)
        output = screen(options["--output"], "--output", TOOL, destination=True)
        plan, sources = plans.load(plan_path, TOOL)
        deps = programs(runner, output.parent)
        for name in ("ffmpeg", "ffprobe"):
            if not deps[name]:
                raise TimelineError("missing " + name + "; check " + name + " -version per Dependencies")
        if not deps["ffmpeg_libx264"]:
            raise TimelineError("ffmpeg has no libx264 encoder; check ffmpeg -hide_banner -encoders per Dependencies")
        info = plans.validate_media(plan, sources, runner, output.parent, deps["ffprobe"])
        cache = install.ensure(TOOL, options.get("--install", False), runner)
        from engine import render
        result = render(TOOL, plan_path, plan, sources, info, output, cache, runner, deps)
        print(json.dumps(result))
        return 0
    except TimelineError as error:
        print(str(error), file=sys.stderr)
    except (Exception, KeyboardInterrupt):
        print("processing failed or was interrupted; check input, cache, permissions and disk space, then retry", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
