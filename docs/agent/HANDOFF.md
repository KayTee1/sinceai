# Handoff

- **Now:** T3 documentation corrections on `feat/T3-pipeline-docs`, ready for
  independent review. No app code. T2 source intake is merged into master.
- **Design:** one app with normal-user dashboard and manager/analyst prompting
  workspaces; shared catalog, evidence, proposals and audit. Approval authority
  follows owner/steward roles, not prompting access (D7; Viet confirmation pending).
- **Lineage:** incorporates/refines unmerged `a09495b` D6. Imported assets expose
  catalog edges; only app-computed values expose actual query provenance. No
  internal BI chart queries or distinct users across assets/months are available.
- **Pipeline:** clarify → retrieve → check fit/governance → reuse/extend/new-build
  proposal → versioned approval → simulated local execution/audit. P0 new build
  creates a build request. Expiry/silence never auto-archives. No SQL formulas
  or live BI telemetry assumed; source and app-owned states/events stay separate.
- **Next:** Viet/other human reviews T3 with `prompts/review-task.md` before merge,
  confirms D6/D7 refinements, then both developers agree stack/contract and assign
  implementation tasks. T1 remains Viet's task; D2/D3/D5 still proposed.
- **Unknowns:** IP/redistribution/external processing terms, video limit, DSO fit.
