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
        <div className="brand__mark">Analytics Steward</div>
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
