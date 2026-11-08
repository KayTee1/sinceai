# Analytics Steward · voiceover script (v1 film)

Status: **recorded.** The owner generated section 1 as one ElevenLabs take.
`public/audio/voiceover.mp3` is that take, cut only inside its own pauses and
placed per cue by `narration/place.py`; the final voiced times are in
`cues.json`. Written against the committed v1 film (`ad4d1a8`): `src/story.ts`
timings (`T`, `CHAPTERS`, `CAPTIONS`, labels), `Panels.tsx`, `Overlay.tsx` and
the camera keys.

The machine-readable version of everything below is
[`src/narration/cues.json`](../src/narration/cues.json). The app reads it, and
so does `narration/assemble.mjs`.

## 1. ElevenLabs narration text

Plain text, no timestamps. Paste it as one take. Paragraph breaks mark the
longer pauses.

```text
Analytics keeps multiplying.
Duplicate dashboards. Conflicting KPI definitions.

Then a business question arrives.
Net sales and forecast variance. Xarelto, North America.

Analytics Steward maps the request to its KPIs.
A Mastra workflow searches the catalog for candidates,
checks for conflicting KPI definitions,
and for existing copies and pending builds.
Net sales has reuse candidates. Forecast variance is a gap.

The gap becomes a proposal. Nothing is built yet.
A regional Lead must approve it.
Only then is the approved insight created, temporary, with provenance.

Over time, approved decisions keep the estate lean.

Analytics Steward. Find before you build. Govern what you keep.
```

The same text with pause tags, for models that support `<break>` (check the
current ElevenLabs model notes; some newer models ignore SSML breaks). The
pause before the first line is left out on purpose. Set `audio.offset` in
`cues.json` instead (see section 6).

```text
Analytics keeps multiplying. <break time="0.5s" /> Duplicate dashboards. Conflicting KPI definitions. <break time="0.9s" /> Then a business question arrives. <break time="0.3s" /> Net sales and forecast variance. Xarelto, North America. <break time="1.2s" /> Analytics Steward maps the request to its KPIs. <break time="0.8s" /> A Mastra workflow searches the catalog for candidates, <break time="0.8s" /> checks for conflicting KPI definitions, <break time="1.1s" /> and for existing copies and pending builds. <break time="0.7s" /> Net sales has reuse candidates. Forecast variance is a gap. <break time="0.5s" /> The gap becomes a proposal. Nothing is built yet. <break time="0.4s" /> A regional Lead must approve it. <break time="1.0s" /> Only then is the approved insight created, temporary, with provenance. <break time="0.7s" /> Over time, approved decisions keep the estate lean. <break time="0.4s" /> Analytics Steward. Find before you build. Govern what you keep.
```

102 words, about 44 s of speech and 11 s of pauses.

## 2. Timed cue sheet

Times are on the fixed film timeline (seconds). "On screen" lists what the
viewer sees while the line plays.

| Cue | Start → end | Line | On screen |
| --- | --- | --- | --- |
| **01 Analytics sprawl (0–8)** | | | |
| c01 | 0.7 → 3.3 | Analytics keeps multiplying. | 360 tiles fade in (0–2.6); links draw (1.2–3.5) |
| c02 | 3.8 → 7.4 | Duplicate dashboards. Conflicting KPI definitions. | "Duplicate dashboards" label (2.4–7.4), "Conflicting KPI definitions" label (3.4–7.6) |
| *pause* | 7.4 → 8.3 | | camera pulls toward the request side |
| **02 Business request (8–15)** | | | |
| c03 | 8.3 → 10.2 | Then a business question arrives. | TEAM-REQ-01 card flies in (8.0–11.6); caption from 8.6 |
| c04 | 10.5 → 14.3 | Net sales and forecast variance. Xarelto, North America. | request label (9.4–14.5); card lands 11.6 |
| *pause* | 14.3 → 15.5 | | card collapses into a token (14.3–15.0) |
| **03 Mastra investigation (15–35)** | | | |
| c05 | 15.5 → 18.8 | Analytics Steward maps the request to its KPIs. | Intent gate (15–19); "Mapped KPIs" label (16.0–18.9) |
| c06 | 19.6 → 22.9 | A Mastra workflow searches the catalog for candidates, | Discovery gate (19–23); scan (19.9–22.0); candidates label (21.1–23.05) |
| c07 | 23.7 → 26.6 | checks for conflicting KPI definitions, | Conflict gate (23–27); approved vs variant definition (23.9–26.95) |
| c08 | 27.7 → 30.6 | and for existing copies and pending builds. | Duplicate gate (27–31); label (28.2–30.9) |
| c09 | 31.3 → 34.9 | Net sales has reuse candidates. Forecast variance is a gap. | Recommend wide shot (31–35); reuse label (31.9); gap label (32.3) |
| **04 Human approval (35–47)** | | | |
| c10 | 35.4 → 38.4 | The gap becomes a proposal. Nothing is built yet. | proposal reaches the boundary (35.0–36.6); "nothing built yet" label (36.6–41.5) |
| c11 | 38.8 → 40.6 | A regional Lead must approve it. | Inbox card rises (38.4); hover on Approve (40.2) |
| *beat* | 40.6 → 41.6 | *(silence)* | **Approve pressed 40.9**; decision lands 41.4 |
| c12 | 41.6 → 44.3 | Only then is the approved insight created, | proposal crosses (41.9–43.1); insight forms (42.1–43.0) |
| c13 | 44.5 → 46.5 | temporary, with provenance. | 30-day TTL ring (43.2–45.0); insight label (43.3–46.9) |
| **05 Resolution and branding (47–55)** | | | |
| c14 | 47.2 → 50.3 | Over time, approved decisions keep the estate lean. | estate organizes (46.9–49.5); caption "illustrative outcome" (47.4–51.0); archive label (49.3–51.0) |
| c15 | 50.7 → 54.3 | Analytics Steward. Find before you build. Govern what you keep. | brand fades in (50.9), full (51.6–54.45), gone by 54.95 |

Hard limits: c11 must end before the Approve press at 40.9, and c12 must not
start before the decision lands (41.4). Narration must stop by 54.45, when the
brand card starts to fade.

## 3. Pronunciation

| Term | Say | If the voice gets it wrong |
| --- | --- | --- |
| Xarelto | zuh-REL-toh | write `Zarelto` |
| KPI / KPIs | kay-pee-eye (letters) | write `K.P.I.` / `K.P.I.s` |
| Mastra | MASS-truh | confirm with the owner |
| Lead (the role) | leed | write `regional team lead` |
| provenance | PROV-uh-nunss | — |
| Analytics Steward | an-uh-LIT-iks STOO-erd | — |
| TEAM-REQ-01 | not spoken | — |

## 4. Delivery notes

- Calm, confident, unhurried. Think documentary narrator, not advert. Keep the
  pitch low and even, with no upward inflection at line ends.
- Target about 4 to 4.5 syllables per second. If a take runs long, slow lines
  are fine, but trim pauses before speeding up the speech.
- c02: two separate observations, with a short stop after "dashboards".
- c06 to c08 are one sentence across three gates. Keep the momentum. The
  commas are breaths, not full stops.
- c09: weight "candidates" and "gap". Don't make the gap sound alarming.
- c11 → c12: the silence at 40.6–41.6 is the click. "Only then" carries the
  point that the human decides.
- c15: say the product name plainly, pause, then the tagline in two even halves.
- Suggested starting point for ElevenLabs settings: stability around 0.5,
  similarity around 0.75, style low (0 to 0.2), speaker boost on. Adjust by
  ear.

## 5. Pauses

| After | Length | Why |
| --- | --- | --- |
| c02 | ~0.9 s | chapter change; camera move to the request |
| c04 | ~1.2 s | card collapses into a token; investigation starts |
| c05 | ~0.8 s | camera moves to Discovery |
| c06, c07 | ~0.8 s / ~1.1 s | camera moves to the next gate |
| c08 | ~0.7 s | wide shot opens for Recommend |
| c11 | ~1.0 s (keep) | the Approve press must land in silence |
| c13 | ~0.7 s | chapter change; estate starts to organize |
| c14 | ~0.4 s | brand card fades in |

## 6. Accuracy guardrails for any rewrite

- Only supported KPI values are computed, in code, by the deterministic
  services. Don't say the AI computes numbers, and don't say "every KPI".
- Catalog results are candidates, not answers. Don't say "found the answer".
- A human approval (a Lead in the requester's region) is required to create
  the approved insight. Computability may be probed before approval, so don't
  say "nothing is checked before approval". "Nothing is built yet" is
  accurate.
- The organized estate is an illustrative outcome over time. Don't promise
  automatic clean-up, bulk archiving or deletion.
- Product: Analytics Steward. Orchestration: Mastra. Since AI organizes the
  hackathon. It is not the product.

## 7. Producing the MP3

Two ways. Neither changes the film's timing.

**A. One take (simplest).** Generate section 1 as one file. Measure it with
`ffprobe -v error -show_entries format=duration -of csv=p=0 voiceover.mp3`.
If the first word starts late or early, set `audio.offset` in `cues.json` so
the first word lands near 0.7 s. Then step through the checks below. Lines
that drift can be fixed by editing pauses in the audio (in any editor), never
by changing the film.

**B. One clip per cue (most exact).** Generate each cue line separately as
`c01.mp3` … `c15.mp3` in one folder, then run:

```sh
cd demo
node narration/assemble.mjs /path/to/clips   # prints an ffmpeg command
```

If ffprobe is installed, it reports any clip that overruns the next cue. Run
the printed command (needs ffmpeg with libmp3lame) to write
`public/audio/voiceover.mp3` with every clip placed at its cue start.

Either way, record the measured length in `audio.measuredDuration`.
