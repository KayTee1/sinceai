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
| M | Mute / unmute narration (when a narration file is present) |
| F | Fullscreen |

The bottom bar has the same controls plus a scrubber with chapter ticks.

URL options: `?t=12.5` start time, `?autoplay=1`, `?record=1` (no controls,
hidden cursor), `?size=1920x1080` (fixed stage in CSS pixels), `?fixed=60`
(advance exactly 1/60 s per rendered frame for frame-exact capture; always
silent), `?narration=0` (ignore the narration file), `?cues=1` (show the
intended narration cue in the control bar), `?subtitles=0` (hide the spoken
subtitles, e.g. to add the `.srt` in an editor instead).

## Recording at 1920×1080

Use a 1920×1080 browser viewport (fullscreen on a 1080p display, or DevTools
device mode) with `?record=1&autoplay=1`. The stage is always 16:9; overlay text
scales with it. Every frame is a pure function of timeline time plus a fixed
seed, so seeking to the same time always renders the same frame.

## Narration (optional)

The film plays with `public/audio/voiceover.mp3` (55.00 s, committed): the
owner's single ElevenLabs take, cut only inside its own pauses and placed per
cue at original speed by [`narration/place.py`](narration/place.py). The raw
take stays out of Git (`narration/source/` is ignored). Without the file the
film plays silently. The script, cue sheet and pronunciation notes are in
[`narration/SCRIPT.md`](narration/SCRIPT.md), and the cue manifest is in
[`src/narration/cues.json`](src/narration/cues.json).

How it behaves (`src/narration.ts`, hooks in `src/clock.ts`):

- **No file:** a HEAD check finds nothing and the film plays silently, exactly
  as before. The control bar shows "No narration".
- **File present:** during real-time playback the audio is the master clock.
  The timeline is steered onto `audio.currentTime + offset` every frame, with
  small errors eased out and large ones snapped, so picture and voice cannot
  drift. Play, pause, restart, seek (keys, scrubber, `?t=`) and chapter jumps
  move the audio with the film. If the audio is shorter than 55 s, the film
  carries on silently after it ends. The film is never stretched to fit the
  audio.
- **Autoplay blocked:** if the browser refuses to start audio without a user
  gesture (e.g. `?autoplay=1`), the film holds where it was and shows "▶ Play
  with narration". Clicking it, or pressing Space, starts both together.
- **Fixed-step capture (`?fixed=60`) and `?narration=0`:** audio is never
  loaded, so frame-exact silent recording is unchanged.
- **Server without byte-range support:** the audio cannot be seeked, so
  narration detaches and the film stays silent ("Narration needs a
  range-capable server"). `npm run dev` and `npm run preview` support ranges.
- No audio service, API key or library is involved; it is one static file and
  an `HTMLAudioElement`.

### Inserting the ElevenLabs MP3

1. Generate the audio from `narration/SCRIPT.md` (one take, or one clip per cue
   assembled with `node narration/assemble.mjs <clips-dir>`). Keep ElevenLabs
   credentials out of this repository.
2. Save it as `demo/public/audio/voiceover.mp3`.
3. Measure it with `ffprobe -v error -show_entries format=duration -of csv=p=0
   public/audio/voiceover.mp3` and record the value in `audio.measuredDuration`
   in `cues.json`. If the first word should land at 0.7 s but the file starts
   speaking immediately, set `audio.offset` to `0.7`.
4. `npm run dev`, open `http://localhost:5180/?cues=1` and check:
   - each line starts on its cue (the control bar shows the intended cue);
   - c11 ends before the Approve press (40.9 s) and c12 starts after 41.4 s;
   - narration ends before the brand card fades (54.45 s);
   - seek, chapter keys 1–5, ↑/↓, pause/resume and R keep voice and picture
     together.
5. Run `npm run build` and `npm run preview` and check once more from `dist/`.
   The file is copied into `dist/audio/`.

### Subtitles

The on-screen subtitles are the spoken words, nothing else. Text and timing come
only from `src/narration/cues.json` (`src/subtitles.ts`): each cue shows from
its measured voiced start to just after its end, never touching the next cue,
so the screen is clear in every pause, including the Approve click (40.9 s). One
line at the bottom centre (max two), anchored above the brand credit and below
the 3D-label safe area. Small notes ("No automatic approvals…", "Illustrative
outcome…", `NOTES` in `story.ts`) hang under the line and are not spoken.

`narration/voiceover.srt` is the matching subtitle file for the final video,
generated with `node narration/srt.mjs` from the same manifest and rules.
Re-run it after changing cues.

### Recording with sound

Silent frame-exact capture is unchanged (`?record=1&fixed=60`). To capture with
narration, record the screen and system audio in real time with
`?record=1&size=1920x1080`, click once to start (or press Space), and keep the
tab in the foreground. Alternatively, capture silently with `?fixed=60` and
mux the MP3 afterwards at the same offset. Because the film's timeline is
fixed, both give the same timing.

## Sequence

All timings live in `T` and `CHAPTERS` in `src/story.ts`. Each beat has an
approach, an action and a readable hold; the camera settles during holds.

| Time | Chapter | What is shown |
| --- | --- | --- |
| 0–8 s | 01 Analytics sprawl | 360 tiles fade into a drifting cloud; duplicate copies and conflicting KPI links are labelled |
| 8–15 s | 02 A business request | TEAM-REQ-01 card flies in (8–11.6), then holds with its label until 14.3 |
| 15–35 s | 03 Mastra investigation | Five gates, 4 s each (0.9 s approach, action, hold): Intent (mapped KPIs, product, market), Discovery (scan, catalog candidates), Conflict (approved vs variant definition), Duplicate (copies and pending builds checked), Recommend (reuse candidates for Net Sales, gap for Forecast Variance) |
| 35–47 s | 04 Human governance and approval | Proposal reaches the boundary (35–36.6) and waits; an illustrative Inbox card appears (38.4), the Lead presses Approve (40.9), only then the proposal crosses (41.4–43.1) and becomes an approved Temporary insight with a 30-tick TTL ring |
| 47–55 s | 05 Resolution | Estate settles (47–49.5) and holds with the illustrative-outcome note; Analytics Steward brand card (with "Orchestrated with Mastra" and the Since AI Hackathon credit) fades in at 50.9, is fully visible 51.6–54.45, then a clean dark end frame |

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
  organized estate is noted as an illustrative outcome over time, not the
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
  story.ts      film script: chapters, notes, camera keys, labels, request path
  estate.ts     seeded 360-node estate, relationships and governed layout
  clock.ts      single timeline clock (play, pause, seek, fixed-step, audio follow)
  subtitles.ts  spoken subtitles from the cue manifest
  narration.ts  optional voiceover: file check, audio-as-master sync, autoplay handling
  narration/cues.json  machine-readable narration cue manifest
  math.ts       seeded PRNG, easing, windows, eased camera keys
  palette.ts    shared colours
  App.tsx       16:9 stage, controls, keyboard, URL options
  Overlay.tsx   chapter tag, subtitles + notes, notice, brand card, label elements
  Panels.tsx    pipeline header and step tracker, approval tracker, Inbox card
  scene/        Estate (instanced tiles + links), Pipeline, Governance,
                Protagonist (request/proposal/insight), Scene (camera, labels)
demo/narration/
  SCRIPT.md     ElevenLabs script, cue sheet, pronunciation, delivery, pauses
  assemble.mjs  prints an ffmpeg command placing per-cue clips at cue starts
  srt.mjs       writes voiceover.srt from the cue manifest
  voiceover.srt subtitles for the final video
  place.py      places the single raw take on the timeline (how voiceover.mp3 was made)
  source/       raw ElevenLabs take (git-ignored)
demo/public/audio/
  voiceover.mp3 final synchronized narration, 55.00 s
```
