import { Canvas } from "@react-three/fiber";
import { useEffect, useState, type CSSProperties } from "react";
import { clock, useClock } from "./clock";
import { Overlay } from "./Overlay";
import { Scene } from "./scene/Scene";
import { CHAPTERS, chapterAt, DURATION } from "./story";

// URL options (all optional):
//   ?t=12.5        start at a time (seconds)
//   ?autoplay=1    start playing immediately
//   ?record=1      hide controls and cursor (clean 16:9 frame for capture)
//   ?size=1920x1080  fixed stage size in CSS pixels instead of fit-to-window
//   ?fixed=60      advance exactly 1/60 s per rendered frame (frame-exact capture)
const params = new URLSearchParams(window.location.search);
const startAt = Number(params.get("t") ?? 0);
const recordMode = params.get("record") === "1";
const fixed = Number(params.get("fixed") ?? 0);
const sizeMatch = /^(\d+)x(\d+)$/.exec(params.get("size") ?? "");
if (fixed > 0) clock.fixedStep = 1 / fixed;
clock.seek(Number.isFinite(startAt) ? startAt : 0);
if (params.get("autoplay") === "1") clock.play();

const FRAME = 1 / 30;

function jumpChapter(dir: 1 | -1) {
  const i = chapterAt(clock.time);
  const sinceStart = clock.time - CHAPTERS[i].start;
  const target = dir > 0 ? i + 1 : sinceStart > 0.6 ? i : i - 1;
  if (target >= CHAPTERS.length) clock.seek(DURATION);
  else clock.seek(CHAPTERS[Math.max(0, target)].start);
}

export function App() {
  const [uiHidden, setUiHidden] = useState(recordMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const step = e.shiftKey ? 5 : 1;
      switch (e.key) {
        case " ":
        case "k":
        case "K":
          clock.toggle();
          break;
        case "r":
        case "R":
        case "Home":
          clock.restart(e.key !== "Home");
          break;
        case "End":
          clock.pause();
          clock.seek(DURATION);
          break;
        case "ArrowLeft":
          clock.seek(clock.time - step);
          break;
        case "ArrowRight":
          clock.seek(clock.time + step);
          break;
        case ",":
          clock.pause();
          clock.seek(clock.time - FRAME);
          break;
        case ".":
          clock.pause();
          clock.seek(clock.time + FRAME);
          break;
        case "ArrowUp":
        case "PageUp":
          jumpChapter(-1);
          break;
        case "ArrowDown":
        case "PageDown":
          jumpChapter(1);
          break;
        case "h":
        case "H":
          setUiHidden((v) => !v);
          break;
        case "f":
        case "F":
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen();
          break;
        default:
          if (/^[1-5]$/.test(e.key)) clock.seek(CHAPTERS[Number(e.key) - 1].start);
          else return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stageStyle: CSSProperties | undefined = sizeMatch
    ? { width: `${sizeMatch[1]}px`, height: `${sizeMatch[2]}px` }
    : undefined;

  return (
    <div className={`app ${uiHidden ? "app--clean" : ""} ${sizeMatch ? "app--fixed" : ""}`}>
      <div className="stage" style={stageStyle}>
        <Canvas
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          camera={{ fov: 32, near: 0.1, far: 200, position: [0, 3.2, 33] }}
        >
          <Scene />
        </Canvas>
        <Overlay />
      </div>
      {!uiHidden && <Controls onHide={() => setUiHidden(true)} />}
    </div>
  );
}

function Controls({ onHide }: { onHide: () => void }) {
  const { time, playing } = useClock();
  const current = chapterAt(time);
  return (
    <div className="controls" role="toolbar" aria-label="Playback">
      <button onClick={() => clock.restart()} title="Restart (R)" aria-label="Restart">
        ⟲
      </button>
      <button
        className="controls__play"
        onClick={() => clock.toggle()}
        title="Play / pause (Space)"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="controls__track">
        <input
          type="range"
          min={0}
          max={DURATION}
          step={0.01}
          value={time}
          aria-label="Seek"
          onChange={(e) => clock.seek(Number(e.target.value))}
        />
        <div className="controls__ticks" aria-hidden>
          {CHAPTERS.slice(1).map((c) => (
            <span key={c.id} style={{ left: `${(c.start / DURATION) * 100}%` }} />
          ))}
        </div>
      </div>
      <span className="controls__time">
        {time.toFixed(2).padStart(5, "0")} / {DURATION.toFixed(2)}
      </span>
      <div className="controls__chapters">
        {CHAPTERS.map((c, i) => (
          <button
            key={c.id}
            className={i === current ? "is-current" : ""}
            onClick={() => clock.seek(c.start)}
            title={`${c.title} (${i + 1})`}
          >
            {c.index}
          </button>
        ))}
      </div>
      <button onClick={onHide} title="Hide controls (H)">
        Hide
      </button>
    </div>
  );
}
