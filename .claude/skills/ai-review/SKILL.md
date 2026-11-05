---
name: ai-review
description: Use when a developer has finished a feature, fix or task and asks for a code review ("review my branch", "review T3", "review this fix"). Reviews the diff against master, runs available checks, and saves a standard HTML report to ai-reviews/<branch>/ using a fixed template so every review looks the same. Read-only on the code under review.
---

# AI review

Review a finished piece of work and save the result as a standard HTML report.
The layout never changes: you write the review as JSON, and `render.py` turns
it into HTML with [template.html](template.html).

**Never modify the code under review.** Only write files inside `ai-reviews/`
(and `docs/agent/REVIEW.md` if it exists, see step 7).

## 1. Find the scope

Work out what to review, in this order:

1. The user named a branch, task ID (T3) or PR number. Use it.
   For a PR: `gh pr view <n> --json headRefName,baseRefName`.
2. Otherwise use the current branch compared with `master`.
3. If the current branch is `master` and there are uncommitted changes,
   review those (`git diff HEAD`).
4. Still unclear: ask the user (one `AskUserQuestion` round).

Collect:

```sh
git fetch -q origin
BASE=$(git merge-base origin/master <branch>)
git diff --stat $BASE <branch>
git diff $BASE <branch>
git log --oneline $BASE..<branch>
```

Slug for the folder = branch name with `/` replaced by `-`
(`feat/T3-upload` becomes `feat-T3-upload`). For uncommitted work, use
`uncommitted-<short description>`.

Type comes from the branch prefix: `feat` = feature, `fix` = fix,
`refactor`, `chore`, `docs`; anything else = other.

## 2. Read the context

- The task in `docs/PLAN.md` (its "done when" and "how to check")
- `docs/REQUIREMENTS.md` (demo script, must-haves)
- `docs/ARCHITECTURE.md` (interface contract, run commands)
- Previous reviews in `ai-reviews/<slug>/`, to check whether old findings
  were fixed

Skip any that don't exist yet.

## 3. Review the code

Read the full diff and the surrounding code it touches, not just the
changed lines. Check, in this order:

1. **Correctness**: does it do what the task says? Edge cases, empty or
   bad input, error handling, broken flows.
2. **Contract**: does it match the agreed interface (shapes, field names,
   status codes)? Would it break the other developer's lane?
3. **Security and data**: secrets in code or Git, `.env` committed,
   confidential/NDA data committed, injection, unsafe file or shell use.
4. **AI-specific**: prompt injection from user input, no timeout/retry on
   model calls, unhandled model errors or empty output, parsing model output
   without validation, cost/rate-limit traps, hard-coded keys or model names
   that should be config.
5. **Demo readiness**: will it work in the demo video? Slow paths,
   flaky external calls without a fallback, debug output left in.
6. **Simplicity**: needless complexity, dead code, duplicated logic.
   Only flag it if it costs time or causes bugs.
7. **Tests**: are risky parts tested? Are the tests meaningful?

**Verify every finding.** Point to the exact file and line, and describe
what actually goes wrong (input, then wrong result). Drop anything you
can't back up. No style nitpicks; hackathon time is short.

Severity:
- **high**: breaks the demo, a must-have, or leaks secrets or data
- **medium**: real bug or security risk; fix before merge
- **low**: worth fixing if there's time

Write findings so a tired developer at 3am understands them: short
sentences, no jargon, and say what the user or demo would see.

## 4. Run checks

Run the commands from `docs/ARCHITECTURE.md` (tests, lint, build, typecheck)
plus anything obvious in the repo (`package.json` scripts, `pytest`).
Record each with its result: `pass`, `fail` or `not_run` (with the reason).
Never record a check as passed if you didn't run it. Don't install new
dependencies or start long-running servers without asking.

## 5. Decide the verdict

- `approve`: no high or medium findings
- `changes_needed`: at least one high or medium finding
- `unable_to_verify`: couldn't build or run enough to judge

If you (this session) wrote the code, set `"self_review": true`. The report
will say so, and the verdict can't count as independent review.

## 6. Write the JSON and render

Write the review to a temporary JSON file following
[example-review.json](example-review.json) exactly (same keys, same
allowed values). Each finding has `problem` (what's wrong), `impact` (what
happens because of it) and `fix` (how to fix it). Then render it:

```sh
python3 .claude/skills/ai-review/render.py <path-to-review.json>
```

The script validates the JSON, then writes:

```text
ai-reviews/
  index.html                         <- list of all reviews (regenerated)
  <slug>/
    <YYYY-MM-DD-HHMM>-review.html    <- the report
    <YYYY-MM-DD-HHMM>-review.json    <- the source data
```

If validation fails, fix the JSON and re-run. Don't edit the HTML by hand.

## 7. Report back

- In the terminal: verdict, counts per severity, the top findings (one line
  each), and the report path. Offer to open it (`open <path>` on macOS).
- If `docs/agent/REVIEW.md` exists, add any high and medium findings
  to its table (ID, task, severity, where, problem, fix, state `open`).
- Don't commit unless the user asks. When they do, commit only the
  `ai-reviews/` files (and REVIEW.md).

## Re-reviews

When `ai-reviews/<slug>/` already has reports, read the latest JSON and
check whether each old finding is fixed. Say which ones were fixed in the
`summary`, keep unfixed ones as findings with their old ID, and number new
findings after the highest old ID.
