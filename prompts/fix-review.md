# Fix review findings

Input: task ID and finding IDs in docs/agent/REVIEW.md.

Read AGENTS.md, inspect Git state, and read the reviewed scope, requirements,
plan, and handoff. Confirm the findings apply to the current version and coordinate
file ownership before editing.

Address blocking and important findings first with the smallest focused changes. If a finding
is disputed or needs a product decision, document evidence and ask the reviewer
or human; do not silently dismiss it. Keep unrelated improvements separate.

Re-run affected checks and acceptance steps. Record the fix and exact validation
evidence against each finding as awaiting recheck, not independently approved.
Update PLAN and HANDOFF, identify the new review scope, and request independent
recheck of material fixes. Report remaining findings and limitations. Do not
commit or push unless authorized.
When explicitly authorized to commit, stage only the fix paths, inspect the staged
diff, and make a scoped commit without including unrelated work.
