"""Deterministic encoding arguments shared with the pinned Kinocut bridge."""
ENCODE_ARGS = ["-c:v", "libx264", "-crf", "0", "-preset", "medium", "-threads", "1",
               "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709",
               "-colorspace", "bt709", "-color_range", "tv",
               "-bsf:v", "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0"]
