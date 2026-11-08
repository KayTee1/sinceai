# Bonsai · 2-minute demo video (v2)

Status: **draft for review.** Picture first, then the ElevenLabs voiceover is
recorded against the final cut and these subtitles (`subtitles.srt`).

Rule for the visuals: **Pruna AI only for the story** (problem, metaphor,
close). **Everything that shows the product is a real screen recording** of the
app, so nothing in the video pretends to be a feature we don't have. Numbers in
the narration come from the rehearsed demo run (`docs/DEMO-RUNBOOK.md`).

## 1. ElevenLabs narration text

One take, paragraph breaks mark the longer pauses. 258 words: about 105 s of
speech and 15 s of pauses, cards and music. If the take runs long, cut the
lines marked (optional) in the shot list first.

Story: **the problem** (AI makes dashboards cheap, so they multiply, nobody can
govern them, and when the builder leaves nobody can fix them), then Bonsai in
three acts: **day one** (scan before you migrate), **every request** (rules 1 to
3) and **every day after** (rule 4 and governance that runs on its own).

```text
In the age of AI, a dashboard is just a few prompts away.
Anyone can vibe-code one in minutes.

So they multiply. Copies of copies,
each with its own version of the truth.
At Bayer's scale, that is almost impossible to govern.

Then the person who built a critical dashboard leaves.
One day it breaks,
and nobody knows where its data comes from, or how to fix it.

In Bayer's synthetic estate, eighty-six of three hundred and sixty dashboards
already have no active owner.

Bonsai keeps analytics small, healthy, and owned.

Day one, before any migration:
Bonsai scans the whole estate, finds duplicates through their KPIs,
checks who actually uses each dashboard,
and suggests what to merge or retire.
So you only move what earns its place.

Then every new request follows four rules.

One: find before you build.
Bonsai searches what already exists, flags conflicting KPI definitions,
and proposes to build only the real gap.

Two: nothing gets built without a human.
The AI can only propose. A regional Lead approves.

Three: every number shows where it came from.
Its definition, its semantic model, the exact SQL.
So when something breaks, anyone can fix it.

Four: every dashboard has an owner, and must earn its next ninety days.
When an owner leaves, a data steward takes over.

And governance runs on its own.
Scheduled jobs check every change for new duplicates,
and re-check every open finding,
so your team can focus on the questions that matter.

Bonsai. Find before you build. Govern what you keep.
```

## 2. Shot list

Times are on the final 2:00 timeline. **Source:** P = Pruna AI clip,
C = our own card (HTML, rendered by us, exact text), A = app screen recording
(1920×1080), F = brand card from the v1 film.

| # | Time | Source | On screen | Narration |
| --- | --- | --- | --- | --- |
| **Problem** | | | | |
| S1 | 0:00–0:09 | P1 | Laptop at night; a prompt is typed and dashboards bloom above it, one after another | In the age of AI… in minutes. |
| S2 | 0:09–0:19 | P2 | Screens multiply into an overgrown jungle; near-identical charts in amber and red | So they multiply… almost impossible to govern. |
| S3 | 0:19–0:29 | P3 | Empty office chair, farewell box; behind it a critical screen glitches and goes dark | Then the person who built a critical dashboard leaves… how to fix it. |
| S4 | 0:29–0:35 | C stat | **86 of 360** dashboards have no active owner (65 inactive, 21 with none) | In Bayer's synthetic estate… no active owner. |
| S5 | 0:35–0:39 | P4 → logo | Hands prune a bonsai; cut to the Bonsai logo | Bonsai keeps analytics small, healthy, and owned. |
| **Day one** | | | | |
| S6 | 0:39–0:52 | C day1 → A | Card "Day one · Scan before you migrate", then **Estate overview**: assets, low usage, duplicated scopes, KPI variants; then a chat merge suggestion card | Day one… only move what earns its place. |
| **Every request** | | | | |
| S7 | 0:52–1:05 | C 1 → A | Card "Rule 1", then **Agentic**: TEAM-REQ-01 in the live chat; Pipeline › Steps fills in (related dashboards, KPI conflicts, gap) | Then every new request… only the real gap. |
| S8 | 1:05–1:12 | C 2 → A | Card "Rule 2", then **Submit build proposal** → Inbox → **Approve** as the North America Lead | Two: nothing gets built without a human… |
| S9 | 1:12–1:24 | C 3 → A | Card "Rule 3", then the built insight → click a value → definition, formula, SQL; a catalog dashboard's **Semantic model** card | Three: every number… anyone can fix it. |
| **Every day after** | | | | |
| S10 | 1:24–1:33 | C 4 → A | Card "Rule 4", then clock **Next event**: AST-0201's owner is inactive, its review goes straight to the data steward | Four: every dashboard has an owner… a data steward takes over. |
| S11 | 1:33–1:51 | C auto → A | Card "Governance runs on its own", then **+30d** (56 under review, 43 escalated), the **Scheduler** tab (jobs, Run now succeeded) and the Estate overview change strip (52 renewed · 43 escalated · 1 expired · 1 built) | And governance runs on its own… questions that matter. |
| S12 | 1:51–2:00 | P5 → F | Pruned bonsai in morning light; dissolve to the brand card | Bonsai. Find before you build. Govern what you keep. |

Optional cuts if the voiceover runs long: "checks who actually uses each
dashboard" (S6) and "So when something breaks, anyone can fix it." (S9).

What the narration may and may not claim:
- **Migration:** Bonsai *assesses* the current estate (scan, duplicates by KPI,
  usage, merge and retire suggestions). It does not move content to a new BI
  platform; say "before any migration", never "migrates".
- **Scheduled jobs:** two deterministic, non-AI jobs (`incremental_overlap`,
  `periodic_reassessment`) plus the lifecycle clock (renewals, escalations,
  expiries). In the prototype they run on the simulated clock and "Run now",
  not a production cron. "Runs on its own / scheduled" is fine; "cron job in
  production" is not.
- **Merges:** only suggested and proposed; owners approve. Nothing is deleted.

Pruna clips: P1–P5. Prompts: [`prompts.json`](prompts.json).

## Decisions (8 Nov)

- Request scene: **live chat** (Anthropic credit topped up before recording; preflight must return 200).
- Pruna look: **cinematic photoreal**, navy and Bayer green light.
- Rule 4: **owner leaves → steward, then +30d**; no merge on screen.
- v1 3D film: **only its brand card** as the end frame.

## 3. Recording the app (S4–S9)

- Fresh database in an isolated worktree (runbook checklist step 1); never the
  shared `steward.db`. Production build, browser at 1920×1080.
- **AI path:** the Anthropic key had no credit at the last preflight (8 Nov).
  If it still fails, use the runbook's path D for S5–S6 and keep the narration
  as written: it describes the governed workflow, not the chat wording. Do not
  show a chat error on screen.
- Cut each segment to its slot. Trimming or speeding up waiting time is fine;
  never cut a click or change a result, so what is shown is what the app does.

## 4. Subtitles

[`subtitles.srt`](subtitles.srt), timed to the shot list. Re-time after the
voiceover is recorded (the v1 film's `narration/srt.mjs` approach).

## 5. How the v2 cut was made (and how to rebuild it)

Generated media is not in git (`.gitignore`); everything below recreates it.
Final picture: `build/bonsai-demo-v2.mp4`, 1:59.5, 1920×1080, 30 fps, soft
English subtitles; no audio until the ElevenLabs voiceover is added.

1. **Pruna stills and clips** (`tools/pruna.py`, key from `PRUNA_API_KEY` in
   `.env`, never printed). Stills: model `p-image`, 16:9, three seeds per shot
   from `prompts.json`. Picks: P1-2, P2-3, P3-2, P4-1, P5-3. Clips: model
   `p-video-2`, image-to-video from the pick, 1080p, 24 fps, no audio, the
   shot's `motion` prompt and `seconds`. Output is 1920×1088; the build crops it.
2. **Cards** (`cards/card.html?card=stat|day1|1|2|3|4|auto`, rendered with
   headless Chrome at 1920×1080). `cards/brand.png` is the v1 film's brand card
   (`demo/` at `?t=53&record=1&narration=0&subtitles=0`).
3. **App footage** (`tools/scenes.mjs`, Playwright driving installed Chrome;
   `tools/recorder.mjs` captures sharp CDP screencast frames and draws a
   cursor). Run against an isolated worktree with a fresh database, production
   build, live models (preflight 200), `SCHEDULER_DEMO_ACTIONS=1`,
   `SCHEDULER_SIM_TRIGGER=1`, on port 3100. `node scenes.mjs` resets the demo
   and records scenes A (day one), B (rules 1–2), C (rule 3), D (rule 4 and
   scheduler) in order; each folder gets JPEG frames, `list.ffconcat` and
   `marks.json` (step times). Encode each with
   `ffmpeg -f concat -safe 0 -i X/list.ffconcat -vf fps=30,format=yuv420p -c:v libx264 -crf 16 X.mp4`.
4. **Edit** (`build.py <folder with A.mp4..D.mp4>`): the edit decision list
   cuts each shot, speeds up waiting time only (model thinking, loading; never
   a click or a result), zooms 1.33× into the right-hand panel when the chat
   side is empty, joins at 1920×1080, and re-times `subtitles.srt` shot by shot
   into `subtitles-final.srt`.

Recorded run (8 Nov, fresh database): the Scheduler's overlap job ran but
found no new duplicate, so the video shows the job and its successful run, not
an invented finding.
