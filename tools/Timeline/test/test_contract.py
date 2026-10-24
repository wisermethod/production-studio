import ast
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from unittest.mock import patch
from support import TOOL, call, plan, save, temporary
import install
import paths
import timeline
import plan as plans
from paths import TimelineError
from processes import child_env, Runner


class ContractTests(unittest.TestCase):
    def test_help(self):
        for args in (["help"], ["--help"]):
            result = call(args)
            self.assertEqual((result.returncode, result.stderr), (0, ""))
            self.assertIn("--plan", result.stdout)
            self.assertIn("--install", result.stdout)

    def test_python39_help(self):
        for path in (TOOL / "scripts").glob("*.py"):
            ast.parse(path.read_text(), feature_version=(3, 9))
        candidates = [shutil.which("python3.9"), sys.executable, shutil.which("python3"), "/usr/bin/python3"]
        interpreter = None
        for candidate in candidates:
            if candidate and Path(candidate).is_file():
                try:
                    version = subprocess.run([candidate, "-B", "-c", "import sys; print(\"%d.%d\" % sys.version_info[:2])"], capture_output=True, text=True)
                except OSError:
                    continue
                if version.returncode == 0 and version.stdout.strip() == "3.9":
                    interpreter = candidate
                    break
        if interpreter is None:
            self.skipTest("no interpreter reporting Python 3.9 is available; help compatibility cannot be executed")
        result = call(["help"], python=interpreter)
        self.assertEqual(result.returncode, 0)
        self.assertIn("Timeline 0.1.0", result.stdout)

    def test_import_has_no_side_effect(self):
        result = subprocess.run([sys.executable, "-B", "-c", "import sys; sys.path.insert(0,sys.argv[1]); import timeline", str(TOOL / "scripts")], capture_output=True)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b"", b""))

    def test_check_readonly(self):
        with temporary() as d:
            root = Path(d)
            tool = root / "tools/Timeline"
            shutil.copytree(TOOL / "scripts", tool / "scripts")
            shutil.copyfile(TOOL / "requirements.txt", tool / "requirements.txt")
            (root / "tools/AGENTS.md").write_text("# Synthetic plugin\n")
            before = sorted(str(p.relative_to(root)) for p in root.rglob("*"))
            with patch.dict(os.environ, {"WISER_ALLOW_INSTALL": "1"}):
                result = call(["check"], tool=tool)
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["state"], "absent")
            self.assertEqual(len(data["packages"]), 35)
            self.assertFalse(data["ok"])
            self.assertEqual(before, sorted(str(p.relative_to(root)) for p in root.rglob("*")))

    def test_unknown_commands_and_flags(self):
        for args, name in [(["speed"], "speed"), (["--bad"], "--bad"), (["check", "--install"], "--install"),
                           (["help", "--bad"], "--bad"), (["render", "--help"], "--help"),
                           (["render", "--plan", "x", "--output", "y", "--bad"], "--bad"),
                           (["render", "--plan", "x", "--plan", "y"], "--plan"),
                           (["render", "--install", "--install"], "--install"),
                           (["render", "extra"], "extra"), (["render", "--output"], "--output")]:
            with self.subTest(args=args):
                result = call(args)
                self.assertEqual((result.returncode, result.stdout), (1, ""))
                self.assertIn(name, result.stderr)
                self.assertIn("help", result.stderr)

    def test_missing_command_and_flags(self):
        for args in ([], ["render"], ["render", "--plan", "x"]):
            with self.assertRaisesRegex(TimelineError, "missing"):
                timeline.parse(args)

    def test_old_python_render(self):
        out, err = io.StringIO(), io.StringIO()
        with patch.object(sys, "version_info", (3, 9)), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            status = timeline.main(["render", "--plan", "/missing.json", "--output", "/missing"])
        self.assertEqual((status, out.getvalue()), (1, ""))
        self.assertIn(timeline.PYTHON_CHECK, err.getvalue())

    @unittest.skipIf(not (3, 11) <= sys.version_info[:2] <= (3, 13), "render requires Python 3.11 to 3.13 only")
    def test_missing_system_dependency(self):
        for absent in ("ffmpeg", "ffprobe", "libx264"):
            with self.subTest(absent=absent), temporary() as d:
                root = Path(d)
                (root / "a.mp4").touch()
                p = save(root, plan())
                deps = {"ffmpeg": "ffmpeg", "ffprobe": "ffprobe", "ffmpeg_libx264": True}
                deps["ffmpeg_libx264" if absent == "libx264" else absent] = False
                out, err = io.StringIO(), io.StringIO()
                with patch.object(timeline, "programs", return_value=deps), patch.object(install, "ensure") as ensure, contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    status = timeline.main(["render", "--plan", str(p), "--output", str(root / "out"), "--install"])
                self.assertEqual((status, out.getvalue()), (1, ""))
                self.assertIn(absent, err.getvalue())
                ensure.assert_not_called()

    def test_environment_allowlist(self):
        with temporary() as d, patch.dict(os.environ, {"KINOCUT_VISION_MODEL": "planted", "ANTHROPIC_API_KEY": "synthetic", "UNLISTED": "no", "MCP_VIDEO_HYPERFRAMES_COMMAND": "planted", "KINOCUT_FFMPEG_EXECUTABLE": "planted"}):
            root = Path(d)
            env = child_env(root)
            for name in ("KINOCUT_VISION_MODEL", "ANTHROPIC_API_KEY", "UNLISTED", "KINOCUT_FFMPEG_EXECUTABLE"):
                self.assertNotIn(name, env)
            self.assertEqual(env["MCP_VIDEO_HYPERFRAMES_COMMAND"], "")
            self.assertEqual(env["HYPERFRAMES_SKIP_SKILLS"], "1")
            for name in ("HOME", "XDG_CACHE_HOME", "TMPDIR", "TEMP", "TMP"):
                self.assertTrue(Path(env[name]).is_relative_to(root))

    def test_path_canonical_and_links(self):
        with temporary() as d:
            root = Path(d).resolve()
            tool = root / "tool"
            tool.mkdir()
            alias = root / "alias"
            alias.symlink_to(tool, target_is_directory=True)
            with self.assertRaisesRegex(TimelineError, "inside the tool"):
                paths.screen(str(alias / "new"), "--output", tool, True)
            loop = root / "loop"
            loop.symlink_to(loop)
            with self.assertRaisesRegex(TimelineError, "cannot be resolved"):
                paths.screen(str(loop / "missing"), "--output", tool, True)
            f = root / "input.json"
            f.write_text("{}")
            link = root / "link"
            link.symlink_to(f)
            self.assertEqual(paths.screen(str(link), "--plan", tool), f)

    def test_path_credentials_by_identity(self):
        with temporary() as d:
            root = Path(d).resolve()
            reserved = root / "credentials"
            reserved.mkdir()
            # Empty stand-ins only, never opening any actual environment file.
            key = reserved / "auth-provider.env"
            key.touch()
            other = reserved / "other.json"
            other.touch()
            hard_key, hard_other = root / "key.json", root / "other.json"
            os.link(key, hard_key)
            os.link(other, hard_other)
            with patch.object(paths, "config_dir", return_value=reserved):
                for path, message in [(hard_key, "connector key"), (hard_other, "identifies a file"), (reserved / "new", "credential directory")]:
                    with self.assertRaisesRegex(TimelineError, message):
                        paths.screen(str(path), "--output", TOOL, True)

    def test_path_private_and_relative(self):
        with temporary() as d:
            root = Path(d)
            for path in ("relative", str(root / ".env"), str(root / "memory/file"), "\x00bad"):
                with self.assertRaises(TimelineError):
                    paths.screen(path, "--output", TOOL, True)

    def test_output_exists(self):
        with temporary() as d:
            with self.assertRaisesRegex(TimelineError, "already exists"):
                paths.screen(d, "--output", TOOL, True)

    def test_output_parent_absent(self):
        with temporary() as d:
            with self.assertRaisesRegex(TimelineError, "parent is absent"):
                paths.screen(str(Path(d) / "absent/out"), "--output", TOOL, True)

    def test_output_inside_tool(self):
        with self.assertRaisesRegex(TimelineError, "inside the tool"):
            paths.screen(str(TOOL / "new-output"), "--output", TOOL, True)

    def test_pin_manifest_and_states(self):
        self.assertEqual(len(install.required_pins(TOOL)), 35)
        with temporary() as d:
            tool = Path(d)
            (tool / "requirements.txt").write_text("kinocut==1.16.1\n")
            self.assertEqual(install.state(tool)["state"], "absent")
            cache = install.cache_for(tool)
            site = install.site_for(cache)
            site.mkdir(parents=True)
            self.assertEqual(install.state(tool)["state"], "incomplete")
            dist = site / "kinocut-1.16.1.dist-info"
            dist.mkdir()
            (dist / "METADATA").write_text("Name: kinocut\nVersion: 1.16.1\n")
            (cache / "bin").mkdir()
            (cache / "bin/python3").touch()
            self.assertEqual(install.state(tool)["state"], "complete")
            (dist / "METADATA").write_text("Name: kinocut\nVersion: 1.16.0\n")
            self.assertEqual(install.state(tool)["state"], "incomplete")

    def test_pin_parser_refuses_unpinned(self):
        with temporary() as d:
            root = Path(d)
            for value in ("kinocut>=1", "kinocut==1.16.1\nkinocut==1.16.1", 'kinocut==1.16.1; python_version > "3.9"'):
                (root / "requirements.txt").write_text(value + "\n")
                with self.assertRaises(TimelineError):
                    install.required_pins(root)

    def consent_fixture(self, arm):
        with temporary() as d:
            root = Path(d).resolve()
            tool = root / "tools/Timeline"
            tool.mkdir(parents=True)
            (root / "tools/AGENTS.md").write_text("# Synthetic root\n")
            (tool / "requirements.txt").write_text((TOOL / "requirements.txt").read_text())
            cache = install.cache_for(tool)
            marker = root / ".wiser-consent"
            if arm in ("matching", "mismatch", "malformed"):
                marker.write_text("bad JSON" if arm == "malformed" else json.dumps({"realpath": str(root if arm == "matching" else root / "other")}))
            initial = marker.read_bytes() if marker.exists() else None
            authorised = arm in ("explicit", "environment", "matching", "failure")
            states = [{"state": "absent"}, {"state": "complete"}]
            called = []
            def fake_run(args, **kwargs):
                called.append(args)
                if arm == "failure":
                    return subprocess.CompletedProcess(args, 1, b"", b"")
                if "venv" in args:
                    (cache / "bin").mkdir(parents=True)
                    (cache / "bin/python3").touch()
                return subprocess.CompletedProcess(args, 0, b"", b"")
            with patch.dict(os.environ, {"WISER_ALLOW_INSTALL": "1" if arm == "environment" else "0"}), patch.object(install, "state", side_effect=states), patch.object(subprocess, "run", side_effect=fake_run):
                if authorised and arm != "failure":
                    install.ensure(tool, arm == "explicit")
                    self.assertEqual(json.loads(marker.read_text())["realpath"], str(root))
                    self.assertEqual(json.loads(marker.read_text())["tool"], "Timeline")
                    self.assertIn("--only-binary", called[-1])
                    self.assertIn("--no-cache-dir", called[-1])
                else:
                    with self.assertRaisesRegex(TimelineError, "wheel install failed" if arm == "failure" else "packages missing"):
                        install.ensure(tool, arm == "failure")
                    if not authorised:
                        self.assertEqual(called, [])
                        self.assertEqual(marker.read_bytes() if marker.exists() else None, initial)

    def test_install_cache_environment(self):
        with patch.dict(os.environ, {"PIP_INDEX_URL": "synthetic", "PIP_NO_CACHE_DIR": "0", "HTTPS_PROXY": "synthetic"}):
            env = install.install_env(TOOL / ".venv")
            self.assertEqual(env["PIP_NO_CACHE_DIR"], "1")
            self.assertEqual(env["PIP_DISABLE_PIP_VERSION_CHECK"], "1")
            self.assertEqual(env["PIP_CONFIG_FILE"], os.devnull)
            self.assertNotIn("PIP_INDEX_URL", env)
            self.assertNotIn("HTTPS_PROXY", env)
            self.assertTrue(env["PIP_CACHE_DIR"].startswith(str(TOOL)))

    def test_process_failure_and_hashes(self):
        with temporary() as d:
            root = Path(d)
            f = root / "input"
            f.write_text("synthetic")
            r = Runner()
            with self.assertRaisesRegex(TimelineError, "exit 7"):
                r.run([sys.executable, "-c", "raise SystemExit(7)"], root, reads=[f])
            self.assertEqual(r.processes[0]["exit_status"], 7)
            self.assertEqual(len(r.processes[0]["read"][0]["sha256"]), 64)


for _arm in ("absent", "mismatch", "malformed", "explicit", "environment", "matching", "failure"):
    def _test(self, arm=_arm):
        self.consent_fixture(arm)
    setattr(ContractTests, "test_consent_" + _arm, _test)


class SchemaTests(unittest.TestCase):
    def bad(self, change, message):
        with temporary() as d:
            root = Path(d)
            (root / "a.mp4").touch()
            value = plan()
            change(value)
            p = save(root, value)
            with self.assertRaisesRegex(TimelineError, message):
                plans.load(p, TOOL)
            if not (3, 11) <= sys.version_info[:2] <= (3, 13):
                return
            before = sorted(root.iterdir())
            result = call(["render", "--plan", str(p), "--output", str(root / "out"), "--install"])
            self.assertEqual((result.returncode, result.stdout), (1, ""))
            self.assertIn(message.replace("\\", ""), result.stderr)
            self.assertEqual(before, sorted(root.iterdir()))

    def test_schema_valid_overlaps(self):
        with temporary() as d:
            root = Path(d)
            (root / "a.mp4").touch()
            value = plan()
            value["segments"].append({**value["segments"][0], "id": "two", "speed": 3})
            actual, sources = plans.load(save(root, value), TOOL)
            self.assertEqual(value, actual)
            self.assertEqual(sources["a"], (root / "a.mp4").resolve())

    def test_schema_duplicate_json_key(self):
        with temporary() as d:
            p = Path(d) / "plan.json"
            p.write_text('{"fps":30,"fps":60}')
            with self.assertRaisesRegex(TimelineError, "duplicate key fps"):
                plans.load(p, TOOL)

    def test_schema_invalid_json(self):
        with temporary() as d:
            p = Path(d) / "plan.json"
            p.write_text("{")
            with self.assertRaisesRegex(TimelineError, "not readable JSON"):
                plans.load(p, TOOL)


SCHEMA_CASES = {
    "unknown_top": (lambda p: p.update(extra=True), "unknown key plan.extra"),
    "unknown_source": (lambda p: p["sources"][0].update(extra=True), "unknown key source.extra"),
    "unknown_segment": (lambda p: p["segments"][0].update(extra=True), "unknown key segment.extra"),
    "fps_boolean": (lambda p: p.update(fps=True), "fps must"),
    "fps_zero": (lambda p: p.update(fps=0), "fps must"),
    "fps_fraction": (lambda p: p.update(fps=29.97), "fps must"),
    "sources_empty": (lambda p: p.update(sources=[]), "sources must"),
    "segments_wrong_type": (lambda p: p.update(segments={}), "segments must"),
    "source_wrong_type": (lambda p: p.update(sources=[3]), "source must"),
    "path_wrong_type": (lambda p: p["sources"][0].update(path=7), "source.path must"),
    "id_bad": (lambda p: p["segments"][0].update(id="UPPER"), "segment.id must"),
    "id_duplicate": (lambda p: p["segments"].append(dict(p["segments"][0])), "duplicate id"),
    "source_duplicate": (lambda p: p["sources"].append(dict(p["sources"][0])), "duplicate id"),
    "cross_id_duplicate": (lambda p: p["segments"][0].update(id="a"), "duplicate id"),
    "source_unknown": (lambda p: p["segments"][0].update(source="missing"), "segment.source is unknown"),
    "start_negative": (lambda p: p["segments"][0].update(start=-1), "segment.start must"),
    "start_boolean": (lambda p: p["segments"][0].update(start=False), "segment.start must"),
    "end_string": (lambda p: p["segments"][0].update(end="37"), "segment.end must"),
    "empty": (lambda p: p["segments"][0].update(end=7), "empty or reversed"),
    "reversed": (lambda p: p["segments"][0].update(end=6), "empty or reversed"),
    "speed_zero": (lambda p: p["segments"][0].update(speed=0), "segment.speed must"),
    "speed_fraction": (lambda p: p["segments"][0].update(speed=1.5), "segment.speed must"),
    "speed_boolean": (lambda p: p["segments"][0].update(speed=True), "segment.speed must"),
    "not_divisible": (lambda p: p["segments"][0].update(speed=4), "not divisible"),
}
for _level, _keys in (("plan", ("fps", "sources", "segments")), ("source", ("id", "path")), ("segment", ("id", "source", "start", "end", "speed"))):
    for _key in _keys:
        def remove(p, level=_level, key=_key):
            (p if level == "plan" else p["sources" if level == "source" else "segments"][0]).pop(key)
        SCHEMA_CASES["missing_" + _level + "_" + _key] = (remove, "missing field " + _level + "." + _key)
for _name, (_change, _message) in SCHEMA_CASES.items():
    def _test(self, change=_change, message=_message):
        self.bad(change, message)
    setattr(SchemaTests, "test_schema_" + _name, _test)
