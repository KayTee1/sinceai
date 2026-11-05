# Question bank

Pick the relevant ones and pre-fill options from the challenge text.
Unanswerable ones go to "Questions for the company" in docs/CHALLENGE.md.

## Picking a challenge

- Which 2-4 challenges are you considering? Paste the summaries.
- What matters most: fit with our skills, biggest prize, a company we want
  to impress or work for, or the most interesting problem?
- Are we strongest at: LLM apps/agents, classic ML/data, computer vision,
  web product/UX, backend/integration?
- Any challenge with an NDA, special hardware or restricted data we want
  to avoid?

## Challenge

- Who at the company would use this daily? What's their job?
- What does "success" look like for the company in one sentence?
- What do they do today without our solution? What's painful about it?
- What data do we get? Format, size, quality, personal data?
- Any required tech, platform, model or cloud? Anything forbidden?
- What are the IP terms? Can we reuse our code after the event?
- Did the company hint at what they'd love to see (a specific feature,
  integration, metric)?
- How will this company judge: business value, technical depth, UX,
  feasibility of deploying it?

## Build

**Demo**
- What must the judge see working in the video to say "we'd use this"?
- What is the single "wow" moment?
- Live demo URL, or video only?

**AI core**
- Which capability is the core: extraction, classification, search/RAG,
  agent with tools, summarization, vision, speech, forecasting, anomaly
  detection, optimization, generation?
- Input and output of the core, concretely (an example of each)?
- Which model/provider: a hosted API we already have keys for, an open model,
  or a classic ML model? Cost and rate limits?
- How do we show it's accurate? (a small eval set, before/after comparison,
  confidence scores, citations to source)

**Data**
- Real, sample or synthetic? Do we need to generate a demo dataset?
- How do we load it: files, database, API?
- Personal or confidential data handling: anonymize? keep out of Git?

**Risk and scope**
- Riskiest technical piece? How do we prove it in 2-3 hours?
- What can we mock or hard-code honestly?
- What will we explicitly NOT build?
- Plan B if the AI core underperforms?

**Product**
- Shape: web app, chat assistant, dashboard, API + notebook, browser
  extension, Slack/Teams bot, integration into the company's tool?
- Stack: what both developers know best (fastest), or what the company uses?
- Deploy: localhost in the video only, or a public demo URL?

**Two developers**
- Who is stronger on AI/backend vs. UI/product?
- Who records the video and writes the submission text?
- Who owns integration into `master`?
- Sleep plan: who rests when, so one person is always fresh?
