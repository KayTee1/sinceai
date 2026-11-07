import { memo } from "react";
import { useClock } from "./clock";
import { labelElements } from "./labels";
import { smoothstep, win } from "./math";
import { Inbox, PipelineHeader, StepTracker } from "./Panels";
import { brandOpacity, CAPTIONS, CHAPTERS, chapterAt, LABELS, T } from "./story";

// HTML layer over the canvas: chapter tag, captions, 3D-anchored labels,
// the illustration notice and the closing brand card. Sized in container
// units (cqw) so it scales exactly with the 16:9 stage.

export function Overlay() {
  const { time: t } = useClock();
  const chapter = CHAPTERS[chapterAt(t)];
  const brandOn = smoothstep(T.veil[0], T.veil[0] + 0.6, t);
  const chapterOpacity = win(t, chapter.start + 0.15, chapter.end + 0.05, 0.5) * (1 - brandOn);
  const caption = CAPTIONS.find((c) => t >= c.start && t <= c.end);
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

      {caption && (
        <div
          key={caption.start}
          className="caption"
          style={{ opacity: win(t, caption.start, caption.end, 0.45) }}
        >
          <div className="caption__text">{caption.text}</div>
          {caption.sub && <div className="caption__sub">{caption.sub}</div>}
        </div>
      )}

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
