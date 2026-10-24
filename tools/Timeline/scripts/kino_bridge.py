"""Internal pinned cutfile adapter. Kinocut owns trimming, merging and receipts.

Kinocut 1.16.1 exposes no trim quality parameter. Its FFmpeg builder imports
_quality_args at call time. Replace only that quality seam in this child so
trims use Timeline's shared lossless profile, without altering the package.
"""
import sys
import re
from encoding import ENCODE_ARGS


def main():
    import kinocut.engine_runtime_utils as runtime
    from kinocut.errors import MCPVideoError
    from kinocut.te.cutfile_render import render_cutfile
    runtime._quality_args = lambda **kwargs: ENCODE_ARGS[2:]
    try:
        render_cutfile(sys.argv[1], output_path=sys.argv[2], save_receipt=sys.argv[3], keep_intermediates=True)
    except MCPVideoError as error:
        # Class and structured code name the cause without echoing input paths.
        code = str(error.code)
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", code):
            code = "unknown"
        print("Kinocut " + type(error).__name__ + " code=" + code, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
