"""Synthetic fixtures only; all media and run artifacts live in OS scratch."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

TOOL = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(TOOL / "scripts"))
import install
from encoding import ENCODE_ARGS

READY = (3, 11) <= sys.version_info[:2] <= (3, 13) and install.state(TOOL)["state"] == "complete"
REASON = "this interpreter's tool-local .venv lacks all pinned packages; run an authorized render --install"


def temporary():
    return tempfile.TemporaryDirectory(prefix="timeline-test-", dir=os.environ.get("WISER_TEST_SCRATCH"))


def call(args, tool=TOOL, python=sys.executable):
    return subprocess.run([python, "-B", str(tool / "scripts/timeline.py"), *args], capture_output=True, text=True)


def ffmpeg(args):
    return subprocess.run(["ffmpeg", "-v", "error", "-nostdin", *args], capture_output=True, check=True)


def recording(path, size="96x64", fps=30, frames=180, offset=0):
    # The upper 16 rows encode the frame index in eight-pixel binary blocks.
    # The rest changes on every frame, including a source-specific offset.
    expression = "nullsrc=s=%s:r=%d,geq=lum='if(lt(Y,16),16+219*mod(floor((N+%d)/pow(2,floor(X/8))),2),16+mod(N*31+X*13+Y*7+%d,220))':cb=128:cr=128" % (size, fps, offset, offset)
    ffmpeg(["-f", "lavfi", "-i", expression, "-frames:v", str(frames), "-an", *ENCODE_ARGS, str(path)])


def plan(source="a.mp4"):
    return {"fps": 30, "sources": [{"id": "a", "path": source}],
            "segments": [{"id": "one", "source": "a", "start": 7, "end": 37, "speed": 1}]}


def save(root, value):
    path = root / "plan.json"
    path.write_text(json.dumps(value))
    return path


def frames(path, size=(96, 64)):
    raw = ffmpeg(["-i", str(path), "-map", "0:v:0", "-fps_mode", "passthrough", "-pix_fmt", "yuv420p", "-f", "rawvideo", "-"]).stdout
    length = size[0] * size[1] * 3 // 2
    assert len(raw) % length == 0
    return [raw[i:i+length] for i in range(0, len(raw), length)]
