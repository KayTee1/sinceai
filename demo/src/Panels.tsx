import { smoothstep, win } from "./math";
import { activeGate, GATES, pipelineVis, T } from "./story";

// Screen-space panels. Anything that must never be clipped by the camera
// (headings, the step tracker, the approval card) lives here instead of being
// anchored in 3D. All positions sit inside the 1920×1080 safe area.

/** Chapter 03: the orchestrator heading, step tracker and services rail. */
export function PipelineHeader({ t }: { t: number }) {
  const vis = pipelineVis(t);
  if (vis < 0.01) return null;
  const active = activeGate(t);
  return (
    <>
      <div className="panel-top" style={{ opacity: vis }}>
        <div className="panel-top__title">Mastra orchestrator · request-pipeline workflow</div>
        <ol className="steps">
          {GATES.map((g, i) => (
            <li
              key={g.name}
              className={i === active ? "is-active" : i < active || (active === -1 && t > T.pipelineVis[0] + 1) ? "is-done" : ""}
            >
              <span className="steps__n">{i + 1}</span>
              {g.name}
            </li>
          ))}
        </ol>
      </div>
      <div className="panel-rail" style={{ opacity: vis * smoothstep(T.pipelineVis[0] + 0.6, T.pipelineVis[0] + 1.4, t) }}>
        <span className="panel-rail__title">Deterministic Steward services</span>
        <span className="panel-rail__body">
          Supported KPI values are computed in code from source rows, not by the model
        </span>
      </div>
    </>
  );
}

/** Chapter 04: AI proposes → a Lead approves → an approved insight is created. */
export function StepTracker({ t }: { t: number }) {
  const vis = win(t, T.toBoundary[0] + 0.4, T.boundaryVis[1] - 0.6, 0.6);
  if (vis < 0.01) return null;
  const stages = [
    { label: "AI proposes", on: t >= T.toBoundary[1] - 0.3 },
    { label: "Lead approves", on: t >= T.approve },
    { label: "Approved insight created", on: t >= T.insightForm[1] },
  ];
  const current = stages.filter((s) => s.on).length - 1;
  return (
    <div className="panel-top" style={{ opacity: vis }}>
      <div className="panel-top__title">Human governance boundary</div>
      <ol className="steps steps--flow">
        {stages.map((s, i) => (
          <li key={s.label} className={i === current ? "is-active" : s.on ? "is-done" : ""}>
            <span className="steps__n">{i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * An illustration of the app's approval Inbox: the Lead presses Approve,
 * and only then does the proposal cross the boundary. Not a live approver.
 */
export function Inbox({ t }: { t: number }) {
  const vis = win(t, T.inbox[0], T.inbox[1], 0.5);
  if (vis < 0.01) return null;
  const rise = 1 - smoothstep(T.inbox[0], T.inbox[0] + 0.6, t);
  const hover = smoothstep(T.inboxHover, T.inboxHover + 0.4, t);
  const pressed = t >= T.inboxPress && t < T.inboxPress + 0.22;
  const approved = t >= T.inboxPress + 0.22;
  return (
    <div
      className={`inbox ${approved ? "is-approved" : ""}`}
      style={{ opacity: vis, transform: `translateY(${rise * 1.2}cqh)` }}
    >
      <div className="inbox__head">
        <span>Inbox · Lead review</span>
        <span className="inbox__tag">Illustration</span>
      </div>
      <div className="inbox__title">Build Temporary insight</div>
      <div className="inbox__meta">TEAM-REQ-01 · Forecast Variance gap</div>
      <dl className="inbox__rows">
        <dt>Approver</dt>
        <dd>Lead in the requester's region</dd>
        <dt>Requester</dt>
        <dd>Cannot approve their own build</dd>
      </dl>
      {approved ? (
        <div className="inbox__status">Approved by Lead · decision audited</div>
      ) : (
        <div className="inbox__actions">
          <span className="inbox__btn">Reject</span>
          <span
            className={`inbox__btn inbox__btn--primary ${pressed ? "is-pressed" : ""}`}
            style={{ ["--hover" as string]: hover }}
          >
            Approve
          </span>
        </div>
      )}
    </div>
  );
}
