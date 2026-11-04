# Claude Code entry point

Read and follow [AGENTS.md](AGENTS.md) for all shared rules.
Before task work, read [the plan](docs/PLAN.md) and
[the current handoff](docs/agent/HANDOFF.md), then the relevant requirements.

Use the matching file in `prompts/` for challenge bootstrap, implementation,
review, review fixes, or preparing the next task. Keep shared instructions in
`AGENTS.md`; do not maintain a separate Claude-specific workflow.

Claude's usual responsibilities are challenge decomposition, requirement analysis,
architecture proposals, assigned implementation, tests, and handoff maintenance.
Either human may use either agent; these are defaults, not exclusive roles.
Codex normally provides independent review of Claude's work; reverse roles when
Codex implements. Address verified findings or explicitly resolve disagreements
with the reviewer/human. Never silently ignore findings.

Do not invent requirements, build a speculative solution before approval, perform
destructive Git operations, or make major architecture changes without authorization.
