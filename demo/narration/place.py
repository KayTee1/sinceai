#!/usr/bin/env python3
"""Place the owner's single ElevenLabs take on the fixed 55 s film timeline.

    python3 narration/place.py narration/source/<take>.mp3 public/audio/voiceover.mp3

The raw take (kept out of Git in narration/source/) is cut only inside its own
pauses, one segment per cue (c15 at its two internal pauses), at original speed.
Each segment is placed at its timeline start; the rest is silence. Raw times
were measured with ffmpeg silencedetect and word timestamps. Needs ffmpeg with
libmp3lame. Re-measure SEG if the take is regenerated.
"""
import subprocess, sys, json
# id, raw speech start, raw speech end, timeline start (all seconds)
SEG = [
 ("c01", 0.000, 1.971, 0.70), ("c02", 2.349, 5.932, 3.80), ("c03", 6.447, 8.396, 8.20),
 ("c04", 8.818, 12.982, 10.40), ("c05", 13.606, 16.696, 15.50), ("c06", 17.126, 19.998, 19.60),
 ("c07", 20.266, 22.650, 23.70), ("c08", 22.729, 25.259, 27.70), ("c09", 25.682, 29.717, 31.10),
 ("c10", 30.158, 33.280, 35.45), ("c11", 33.620, 35.306, 38.85), ("c12", 35.709, 38.193, 41.60),
 ("c13", 38.534, 40.228, 44.50), ("c14", 40.629, 43.821, 46.65),
 ("c15a", 44.374, 45.360, 50.20), ("c15b", 45.729, 47.226, 51.48), ("c15c", 47.608, 48.760, 53.25),
]
PRE, POST, F = 0.03, 0.04, 0.012
src, out = sys.argv[1], sys.argv[2]
parts = []
for i, (_, a, b, t) in enumerate(SEG):
    s, e = max(0, a - PRE), b + POST
    d = e - s
    parts.append(f"[0:a]atrim={s:.3f}:{e:.3f},asetpts=PTS-STARTPTS,afade=t=in:d={F},afade=t=out:st={d-F:.3f}:d={F},adelay={round((t-(a-s))*1000)}:all=1[a{i}]")
mix = "".join(f"[a{i}]" for i in range(len(SEG))) + f"amix=inputs={len(SEG)}:normalize=0,apad=whole_dur=55[out]"
subprocess.run(["ffmpeg","-v","error","-y","-i",src,"-filter_complex",";".join(parts+[mix]),"-map","[out]","-t","55","-ar","44100","-ac","1","-c:a","libmp3lame","-b:a","128k",out], check=True)
print(json.dumps([{"id":k,"start":t,"end":round(t+b-a,2)} for k,a,b,t in SEG]))
