# MP3 fixture

`gapless.mp3` is the synthetic fixture supplied by wiser's Speech Preparation: a 0.25-second 440 Hz sine at 44,100 Hz, mono, encoded with FFmpeg 8.0 and libmp3lame 3.100. It contains no speech or vendor media. Its first packet reports 1105 Skip Samples; the first Xing/Info frame is 417 bytes. Tests create separate damaged/headerless copies; the committed fixture stays unchanged.

Tests decode this fixture to its real signed 16-bit WAV (11,025 samples), rather than manufacturing the former 4,410-sample stand-in. A separate refusal test proves that shortened WAV is outside the decoded source clock tolerance. FFmpeg and ffprobe are existing machine dependencies; the tests install nothing.
