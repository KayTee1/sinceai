"""Builds the 2-minute Bonsai video from the Pruna clips, our cards and the app
screen recordings. Usage: python3 build.py <recordings-dir>
Writes build/bonsai-demo-v2.mp4 (picture + soft subtitles) and subtitles-final.srt."""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REC = sys.argv[1]  # folder with A.mp4 .. D.mp4 (app scenes)
OUT = os.path.join(HERE, "build")
os.makedirs(OUT, exist_ok=True)
P = lambda *a: os.path.join(HERE, *a)
R = lambda n: os.path.join(REC, n)
ZOOM = "crop=1440:810:480:0"  # right-hand panels (inbox, scheduler) when the chat side is empty

# (shot, source, in, out, speed, extra filter) ; stills: (shot, png, None, seconds, 1, None)
EDL = [
    ("S1", P("pruna/clips/P1.mp4"), 0.0, 8.5, 1, None),
    ("S2", P("pruna/clips/P2.mp4"), 0.0, 9.5, 1, None),
    ("S3", P("pruna/clips/P3.mp4"), 0.0, 10.0, 1, None),
    ("S4", P("cards/stat.png"), None, 6.0, 1, None),
    ("S5", P("pruna/clips/P4.mp4"), 0.0, 4.0, 1, "logo"),
    ("S6", P("cards/day1.png"), None, 1.8, 1, None),
    ("S6", R("A.mp4"), 1.0, 6.5, 1, None),
    ("S6", R("A.mp4"), 11.5, 20.5, 2.5, None),
    ("S6", R("A.mp4"), 21.0, 23.8, 1, None),
    ("S7", P("cards/1.png"), None, 1.8, 1, None),
    ("S7", R("B.mp4"), 0.2, 1.9, 1, None),
    ("S7", R("B.mp4"), 1.9, 9.7, 3, None),
    ("S7", R("B.mp4"), 9.7, 16.2, 1, None),
    ("S8", P("cards/2.png"), None, 1.5, 1, None),
    ("S8", R("B.mp4"), 16.2, 20.4, 3, None),
    ("S8", R("B.mp4"), 23.0, 27.4, 1, None),
    ("S9", P("cards/3.png"), None, 1.5, 1, None),
    ("S9", R("B.mp4"), 28.6, 30.6, 1, None),
    ("S9", R("C.mp4"), 2.5, 9.5, 1, None),
    ("S9", R("C.mp4"), 14.5, 17.3, 1, None),
    ("S10", P("cards/4.png"), None, 1.5, 1, None),
    ("S10", R("C.mp4"), 19.1, 21.4, 1, None),
    ("S10", R("D.mp4"), 1.0, 9.6, 1.5, ZOOM),
    ("S11", P("cards/auto.png"), None, 1.8, 1, None),
    ("S11", R("D.mp4"), 9.6, 17.0, 1.6, ZOOM),
    ("S11", R("D.mp4"), 19.5, 24.5, 1, ZOOM),
    ("S11", R("D.mp4"), 33.0, 36.6, 1, None),
    ("S12", P("pruna/clips/P5.mp4"), 0.0, 6.0, 1, None),
    ("S12", P("cards/brand.png"), None, 4.0, 1, None),
]
# Original shot windows in subtitles.srt (seconds), from SCRIPT.md section 2.
SHOTS = {"S1": (0, 9), "S2": (9, 19), "S3": (19, 29), "S4": (29, 35), "S5": (35, 39), "S6": (39, 52),
         "S7": (52, 65), "S8": (65, 72), "S9": (72, 84), "S10": (84, 93), "S11": (93, 111), "S12": (111, 120)}

BASE = "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p,setsar=1"
def run(args): subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)

segs, new_start, t = [], {}, 0.0
for i, (shot, src, a, b, speed, extra) in enumerate(EDL):
    out = os.path.join(OUT, f"seg{i:02d}.mp4")
    if a is None:  # still image
        dur = b
        vf = BASE
        run(["-loop", "1", "-t", f"{dur}", "-i", src, "-vf", vf, "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-an", out])
    else:
        dur = (b - a) / speed
        vf = (extra + "," if extra and extra != "logo" else "") + f"setpts=(PTS-STARTPTS)/{speed}," + BASE
        if extra == "logo":
            fc = (f"[0:v]setpts=PTS-STARTPTS,{BASE}[v];[1:v]format=rgba,fade=t=in:st={dur-1.6}:d=0.8:alpha=1[l];"
                  f"[v][l]overlay=0:0:shortest=1,format=yuv420p[o]")
            run(["-ss", f"{a}", "-t", f"{b-a}", "-i", src, "-loop", "1", "-t", f"{dur}", "-i", P("cards/logo-overlay.png"),
                 "-filter_complex", fc, "-map", "[o]", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-an", out])
        else:
            run(["-ss", f"{a}", "-t", f"{b-a}", "-i", src, "-vf", vf, "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-an", out])
    new_start.setdefault(shot, t)
    t += dur
    segs.append(out)
new_end, keys = {}, list(SHOTS)
for k, nxt in zip(keys, keys[1:] + [None]):
    new_end[k] = new_start[nxt] if nxt else t

with open(os.path.join(OUT, "list.txt"), "w") as f:
    f.writelines(f"file '{s}'\n" for s in segs)
picture = os.path.join(OUT, "picture.mp4")
run(["-f", "concat", "-safe", "0", "-i", os.path.join(OUT, "list.txt"),
     "-vf", f"fade=t=in:st=0:d=0.6,fade=t=out:st={t-0.9:.2f}:d=0.9", "-c:v", "libx264", "-crf", "17", "-preset", "medium", picture])

# Re-time subtitles: map each cue's shot window linearly onto the new window.
def ts(s): h, m, rest = s.split(":"); sec, ms = rest.split(","); return int(h)*3600+int(m)*60+int(sec)+int(ms)/1000
def fmt(x): ms = int(round(x*1000)); return f"{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}"
cues = re.split(r"\n\s*\n", open(P("subtitles.srt")).read().strip())
lines = []
for i, c in enumerate(cues, 1):
    parts = c.split("\n"); a, b = [ts(x.strip()) for x in parts[1].split("-->")]
    shot = next(k for k, (s, e) in SHOTS.items() if s <= (a + b) / 2 < e)
    (s0, e0), s1, e1 = SHOTS[shot], new_start[shot], new_end[shot]
    m = lambda x: s1 + (x - s0) * (e1 - s1) / (e0 - s0)
    lines.append(f"{i}\n{fmt(m(a))} --> {fmt(m(b))}\n" + "\n".join(parts[2:]))
srt = P("subtitles-final.srt")
open(srt, "w").write("\n\n".join(lines) + "\n")
final = os.path.join(OUT, "bonsai-demo-v2.mp4")
run(["-i", picture, "-i", srt, "-c:v", "copy", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", final])
json.dump({k: [round(new_start[k], 2), round(new_end[k], 2)] for k in SHOTS}, open(os.path.join(OUT, "shots.json"), "w"), indent=1)
print(f"total {t:.1f}s ->", final)
print(json.dumps({k: [round(new_start[k], 1), round(new_end[k], 1)] for k in SHOTS}))
