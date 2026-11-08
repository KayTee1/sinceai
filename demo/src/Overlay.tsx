import { memo } from "react";
import { useClock } from "./clock";
import { labelElements } from "./labels";
import { smoothstep, win } from "./math";
import { Inbox, PipelineHeader, StepTracker } from "./Panels";
import { brandOpacity, CHAPTERS, chapterAt, LABELS, NOTES, T } from "./story";
import { subtitleAt, subtitleOpacity } from "./subtitles";

// ?subtitles=0 hides the spoken subtitles (e.g. to add the .srt in an editor).
const showSubtitles = new URLSearchParams(window.location.search).get("subtitles") !== "0";

// HTML layer over the canvas: chapter tag, spoken subtitles and notes, 3D-anchored labels,
// the illustration notice and the closing brand card. Sized in container
// units (cqw) so it scales exactly with the 16:9 stage.

export function Overlay() {
  const { time: t } = useClock();
  const chapter = CHAPTERS[chapterAt(t)];
  const brandOn = smoothstep(T.veil[0], T.veil[0] + 0.6, t);
  const chapterOpacity = win(t, chapter.start + 0.15, chapter.end + 0.05, 0.5) * (1 - brandOn);
  const subtitle = showSubtitles ? subtitleAt(t) : null;
  const note = NOTES.find((n) => t >= n.start && t <= n.end);
  const brand = brandOpacity(t);
  // veil: soften the estate behind the brand, then a clean frame to cut to the app
  const veil = 0.64 * smoothstep(T.veil[0], T.veil[1], t) + 0.36 * smoothstep(T.veil[2], T.veil[3], t);
  const notice = 1 - brandOn;

  return (
    <div className="overlay">
      <div className="veil" style={{ opacity: veil }} />

      <Labels />

      <PipelineHeader t={t} />
      <StepTracker t={t} />
      <Inbox t={t} />

      <div className="chapter" style={{ opacity: chapterOpacity }}>
        <span className="chapter__index">{chapter.index}</span>
        <span className="chapter__rule" />
        <span className="chapter__title">{chapter.title}</span>
      </div>

      <div className="notice" style={{ opacity: notice }}>
        Illustrative sequence · synthetic data
      </div>

      <div className="caption">
        <div className="caption__text" aria-live="off">
          {subtitle && (
            <span key={subtitle.id} style={{ opacity: subtitleOpacity(subtitle, t) }}>
              {subtitle.text}
            </span>
          )}
        </div>
        {note && (
          <div className="caption__sub" style={{ opacity: win(t, note.start, note.end, 0.45) }}>
            {note.text}
          </div>
        )}
      </div>

      <div className="brand" style={{ opacity: brand }}>
        <svg className="brand__logo" viewBox="0 0 64 64" aria-hidden>
          <g fill="none" stroke="var(--ink)" strokeLinecap="round" strokeLinejoin="round">
            <path d="M31 49 C29 42 37 40 35 34 C33 28 26 29 25 23" strokeWidth="4.5" />
            <path d="M35 35 C39 34 42 33 44 31" strokeWidth="3" />
            <path d="M29 27 C33 24 37 20 40 16" strokeWidth="3" />
          </g>
          <ellipse cx="22" cy="21" rx="12.5" ry="6.5" fill="#66b512" />
          <ellipse cx="41" cy="14.5" rx="12" ry="6.5" fill="#4e8a12" />
          <ellipse cx="45" cy="30.5" rx="10" ry="5.5" fill="#66b512" />
          <rect x="13" y="48" width="38" height="4.5" rx="1.5" fill="var(--accent)" />
          <path d="M17 52.5 H47 L43.5 59 H20.5 Z" fill="var(--accent)" />
        </svg>
        <div className="brand__mark">Bonsai</div>
        <div className="brand__product">Orchestrated with Mastra</div>
        <div className="brand__rule" />
        <div className="brand__line">Find before you build. Govern what you keep.</div>
        <div className="brand__credit">Built for the Since AI Hackathon</div>
      </div>
    </div>
  );
}

/** Static label elements; positioned imperatively by LabelProjector. */
const Labels = memo(function Labels() {
  return (
    <div className="labels">
      {LABELS.map((l) => (
        <div
          key={l.id}
          ref={(el) => {
            if (el) labelElements.set(l.id, el);
            else labelElements.delete(l.id);
          }}
          className={`label label--${l.variant} tone--${l.tone ?? "neutral"}`}
          style={{ visibility: "hidden" }}
        >
          <div className="label__title">{l.title}</div>
          {l.body && <div className="label__body">{l.body}</div>}
        </div>
      ))}
    </div>
  );
});
