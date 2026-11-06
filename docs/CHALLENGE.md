# Challenge

Status: **chosen: Bayer** (D1). Updated 2026-11-06 from the final brief and
builder pack supplied by KayTee. These supersede the earlier pasted summary.
Source identities, hashes and inspection details: [DATA_SOURCES](DATA_SOURCES.md).
Original files remain outside Git; the following is a summarized fact record.

## Confirmed brief

- **Title:** Build Less, Build Better: AI for Governed Analytics (B1 §01;
  B2 p1).
- **Problem:** self-service BI creates duplicate dashboards/logic, unclear
  ownership and technical debt. Bayer's Tableau-to-Power BI migration motivates
  the challenge (B1 §02; B2 p1).
- **Goal:** a working prototype that helps create, reuse, maintain or retire
  analytics intelligently, preserving governance and business value. Business
  questions should yield fewer, better analytics rather than inconsistent KPIs
  and more dashboards (B1 §02–03; B2 p1–2).
- **Suggested approaches, not mandated stack:** agents, metadata RAG, semantic/KPI
  mapping, duplicate detection, usage/lifecycle scoring, governance checks and
  human approval. Working end-to-end flow matters more than model complexity
  (B1 §04; B2 p2).
- **Data:** synthetic, anonymized or public data allowed; teams may generate
  synthetic data with documented assumptions. No proprietary Bayer data needed.
  Organizer-provided XLSX is a synthetic mock BI estate (B1 §05; B2 p2).
- **Contact:** Panu Aho, panu.aho@bayer.com, email / onsite Q&A (B1 §08; B2 p3).

## Dataset scope and constraints

W1 START_HERE explicitly limits this pack to **Pharmaceuticals / prescription
medicine analytics**, excluding Crop Science and Consumer Health. All owners,
reports, measures and governance values are synthetic/illustrative; public
product names are context only. No patient/HCP/personal data is represented.

Recommended workflow: parse intent → resolve governed KPIs → find existing
assets/models → inspect usage, ownership, lineage and governance → recommend
reuse, consolidation, repair, migration, retirement or justified new build with
cited evidence. Exclude clinical/treatment decisions, pharmacovigilance cases,
patient profiling, real internal systems and claims of actual Bayer performance.

The pack has 24 sheets, including 360 assets, 75 models, 56 KPIs, 3,600 usage
rows, 438 lineage edges, 980 product-market-month rows, 410 governance signals,
94 migration candidates and 150 business requests. It deliberately supplies no
evaluation answers. Candidate recommendations and conflict flags are inputs,
not authoritative lifecycle decisions (W1 Data_Dictionary, Package_Overview,
Change_Log). See DATA_SOURCES for schema and limitations.

## Judging (B1 §06; B2 p2–3)

| Criterion | Weight |
| --- | --- |
| Problem fit and business value | 30% |
| Governance and maintainability | 25% |
| Technical quality and meaningful AI use | 20% |
| Usability for business and IT | 15% |
| Scalability and demo quality | 10% |

Strong solutions reduce sprawl while preserving ownership, KPI consistency,
human oversight and lifecycle control.

## Required challenge outputs (B1 §07; B2 p3)

Working prototype with at least one end-to-end workflow; short pitch/demo;
source repository; brief README/architecture note covering data assumptions,
AI approach, governance controls and enterprise-BI integration. Slides alone
are insufficient. No specific stack, live integration or 90-day cycle is mandated.

## Event submission (previously recorded; not specified by this brief)

Submit by Sun 8 Nov 10:00 EET in sinceai.app: name, tagline, description,
technologies, repository, YouTube video, source ZIP and accepted IP terms.
Demo URL and pitch deck optional. Verify portal details separately; this intake
has not rechecked event rules. Disclose main AI tools and separate pre-event work.

## Remaining questions

| # | Question | Answer | Source / date |
| --- | --- | --- | --- |
| 1 | IP, workbook redistribution and external AI processing terms? | unknown; synthetic does not establish these permissions | B1/B2/W1 do not specify, 2026-11-06 |
| 2 | Demo video length limit and current submission portal requirements? | unknown / verify portal | Final brief says short pitch/demo only |
| 3 | Is 90-day DSO alignment useful to the judges? | unknown; not mentioned in final sources | B1/B2/W1 |
| 4 | How should conflicting request text/context be interpreted? | unknown; propose user clarification | W1 Business_Requests row 2 |
