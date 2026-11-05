# Ideas toolkit

Use these to generate options quickly. Adapt each to the company's real user.

## Common AI solution patterns

| Pattern | Good when the challenge mentions | Demo "wow" |
| --- | --- | --- |
| Ask-your-documents (RAG) | manuals, regulations, reports, knowledge bases | Answer with cited source passages |
| Extraction to structured data | PDFs, forms, emails, invoices, logs | Messy document becomes a clean table/JSON |
| Agent with tools | workflows, multi-step tasks, internal systems | Agent completes a task and shows its steps |
| Classification and routing | tickets, feedback, cases, reports | Incoming items auto-sorted with reasons |
| Anomaly detection and alerts | sensors, transactions, process data | Chart highlights the problem + plain-language explanation |
| Forecasting and optimization | demand, maintenance, energy, scheduling | "What-if" slider changes the plan live |
| Vision | images, inspection, quality control, safety | Upload a photo, defects are marked |
| Copilot for an expert | engineers, analysts, officials, field workers | Expert's 30-minute task done in 1 minute |
| Summarize and report | meetings, long data, regulatory text | One-click briefing a manager would send |
| Conversational interface | citizens, customers, non-technical users | Natural question in, correct action out |

## Ways to stand out

- **Show it on their data**, or realistic synthetic data in their format.
- **Measure it**: a small eval set with an accuracy number beats "it works".
- **Explain it**: citations, confidence, reasons. Companies trust what they
  can check.
- **Human in the loop**: let the expert approve or correct. Shows you
  understand real deployment.
- **Fits their workflow**: plugs into tools they already use.
- **Cost and privacy awareness**: a line on running it on-prem or cheaply
  often matters to industrial and public-sector judges.
- **A crisp story**: user, pain, before/after, in the first 15 seconds of
  the video.

## Approach card (fill one per option)

```text
Name:
Pitch (one sentence):
Wow moment:
AI core and model options:
Architecture (3-5 boxes):
Lane A builds:            Lane B builds:
Effort (S/M/L):     Main risk:     Plan B:
Fit to company goal:
Stretch feature:
```

## Default safe architecture (if the team has no preference)

Simple web UI -> one backend service -> model API + small data store
(files or SQLite). One repo, one command to run. Add complexity only if the
demo script needs it.
