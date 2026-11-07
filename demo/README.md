# Analytics Steward cinematic demo (standalone)

Status: **v1, owner-approved pacing and visual structure.**
Branch `demo/mvp`, based on `origin/master` `3cdfb60` (docs PR #39).

A 55-second, deterministic 3D film for the pitch video of **Analytics
Steward**: analytics sprawl, then one business request investigated by a
Mastra-orchestrated workflow (discovery, KPI-definition checks, reuse), an
explicit human approval, and an illustrative governed estate, ending on the
Analytics Steward brand card. It explains the product. It is not the product.

Naming: *Analytics Steward* is the product (working name). *Mastra* is the
orchestration framework. *Since AI* is the hackathon organizer, credited on the
end slate as "Built for the Since AI Hackathon"; it is not the product name.

## Run

Node 22.12+ and npm. Everything stays inside `demo/`.

```sh
cd demo
npm ci
npm run dev        # http://localhost:5180
npm run build      # typecheck + static bundle in demo/dist
npm run preview    # serve dist on http://localhost:5181
```

No backend, API, workbook, database or credentials are used.

## Controls

| Key | Action |
| --- | --- |
| Space / K | Play / pause |
| R | Restart and play (Home: restart paused) |
| ← / → | Seek 1 s (Shift: 5 s) |
| , / . | Step one frame (1/30 s) back / forward, pauses |
| ↑ / ↓ (PageUp / PageDown) | Previous / next chapter |
| 1–5 | Jump to chapter |
| End | Jump to the final frame |
| H | Hide / show controls |
| F | Fullscreen |

The bottom bar has the same controls plus a scrubber with chapter ticks.

URL options: `?t=12.5` start time, `?autoplay=1`, `?record=1` (no controls,
hidden cursor), `?size=1920x1080` (fixed stage in CSS pixels), `?fixed=60`
(advance exactly 1/60 s per rendered frame for frame-exact capture).

## Recording at 1920×1080

Use a 1920×1080 browser viewport (fullscreen on a 1080p display, or DevTools
device mode) with `?record=1&autoplay=1`. The stage is always 16:9; overlay text
scales with it. Every frame is a pure function of timeline time plus a fixed
seed, so seeking to the same time always renders the same frame.

## Sequence

All timings live in `T` and `CHAPTERS` in `src/story.ts`. Each beat has an
approach, an action and a readable hold; the camera settles during holds.

| Time | Chapter | What is shown |
| --- | --- | --- |
| 0–8 s | 01 Analytics sprawl | 360 tiles fade into a drifting cloud; duplicate copies and conflicting KPI links are labelled |
| 8–15 s | 02 A business request | TEAM-REQ-01 card flies in (8–11.6), then holds with its label until 14.3 |
| 15–35 s | 03 Mastra investigation | Five gates, 4 s each (0.9 s approach, action, hold): Intent (mapped KPIs, product, market), Discovery (scan, catalog candidates), Conflict (approved vs variant definition), Duplicate (copies and pending builds checked), Recommend (reuse candidates for Net Sales, gap for Forecast Variance) |
| 35–47 s | 04 Human governance and approval | Proposal reaches the boundary (35–36.6) and waits; an illustrative Inbox card appears (38.4), the Lead presses Approve (40.9), only then the proposal crosses (41.4–43.1) and becomes an approved Temporary insight with a 30-tick TTL ring |
| 47–55 s | 05 Resolution | Estate settles (47–49.5) and holds with the illustrative-outcome caption; Analytics Steward brand card (with "Orchestrated with Mastra" and the Since AI Hackathon credit) fades in at 50.9, is fully visible 51.6–54.45, then a clean dark end frame |

A screen-space header shows the orchestrator and active step in chapter 03,
and the "AI proposes → Lead approves → Approved insight created" tracker in
chapter 04. Labels anchored in 3D are clamped to a 1920×1080 safe area; gate
labels fade near the frame edge instead of being clipped.

## Accuracy rules applied

- Pipeline steps match the `request-pipeline` workflow (intent, discovery,
  conflict, duplicate, recommend) under the Mastra orchestrator. The rail
  states that only supported KPI values are computed in code by deterministic
  Steward services, not by the model.
- TEAM-REQ-01 outcome follows its fixture note: Net Sales covered by existing
  assets, Forecast Variance by none in North America.
- Catalog matches are shown as candidates, not guaranteed answers; reuse is
  confirmed by the requester.
- Computability may be probed before approval (the gap label says so); that
  probe is what lets a build be proposed.
- Nothing is built before approval, and a human approval is required to create
  an approved insight. The approver is a Lead in the requester's region;
  requesters cannot approve their own build. The approved insight stores its
  values with provenance.
- Temporary TTL is 30 days. Archive is shown as approved one owner decision at
  a time and restorable, never as deletion or automatic bulk archiving. The
  organized estate is captioned as an illustrative outcome over time, not the
  result of one request.
- The Inbox card is labelled "Illustration"; the film is not connected to a
  live approver.
- No automatic approval, no cron or background schedule, and no
  finding-to-proposal flow is shown.
- Every frame carries "Illustrative sequence · synthetic data". Counts and
  positions are narrative; nothing is read from the workbook.

## Isolation

- Own `package.json`, lockfile and `tsconfig.json`. No imports from `../src`.
- Root `tsconfig.json` excludes `demo` and root `eslint.config.mjs` ignores
  `demo/**`, so the app's `tsc`, `lint`, `test` and `next build` never see it.
- Dependencies: react, react-dom, three, @react-three/fiber; dev: vite,
  @vitejs/plugin-react, typescript and types. No drei, postprocessing or
  animation library.

## Layout

```text
demo/src/
  story.ts      film script: chapters, captions, camera keys, labels, request path
  estate.ts     seeded 360-node estate, relationships and governed layout
  clock.ts      single timeline clock (play, pause, seek, fixed-step)
  math.ts       seeded PRNG, easing, windows, eased camera keys
  palette.ts    shared colours
  App.tsx       16:9 stage, controls, keyboard, URL options
  Overlay.tsx   chapter tag, captions, notice, brand card, label elements
  Panels.tsx    pipeline header and step tracker, approval tracker, Inbox card
  scene/        Estate (instanced tiles + links), Pipeline, Governance,
                Protagonist (request/proposal/insight), Scene (camera, labels)
```
