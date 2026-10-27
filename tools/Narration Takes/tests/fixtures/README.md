# MP3 fixture

`gapless.mp3` is the synthetic fixture supplied by wiser's Speech Preparation: a 0.25-second 440 Hz sine at 44,100 Hz, mono, encoded with FFmpeg 8.0 and libmp3lame 3.100. It contains no speech or vendor media. Its first packet reports 1105 Skip Samples; the first Xing/Info frame is 417 bytes. Tests create separate damaged/headerless copies; the committed fixture stays unchanged.
