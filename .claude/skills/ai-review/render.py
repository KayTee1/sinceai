#!/usr/bin/env python3
"""Render an ai-review JSON file into the standard HTML report.

Usage: python3 .claude/skills/ai-review/render.py <review.json> [--out-root ai-reviews]

Validates the JSON, writes ai-reviews/<slug>/<YYYY-MM-DD-HHMM>-review.{html,json},
and regenerates ai-reviews/index.html. Standard library only.
"""

import argparse
import html
import json
import re
import sys
from datetime import datetime
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent / "template.html"

TYPES = {"feature", "fix", "refactor", "chore", "docs", "other"}
SEVERITIES = ["high", "medium", "low"]

# Plain-language labels and colours shown in the report.
VERDICTS = {
    "approve": ("green", "Ready to merge"),
    "changes_needed": ("red", "Fix before merging"),
    "unable_to_verify": ("grey", "Could not verify"),
}
SEVERITY_TAG = {
    "high": ("red", "High"),
    "medium": ("orange", "Medium"),
    "low": ("blue", "Low"),
}
CHECK_TAG = {
    "pass": ("green", "Passed"),
    "fail": ("red", "Failed"),
    "not_run": ("grey", "Not run"),
}

REQUIRED = {
    "title": str, "slug": str, "type": str, "task": str, "branch": str,
    "reviewer": str, "self_review": bool, "date": str, "verdict": str,
    "summary": str, "findings": list, "checks": list, "next_steps": list,
}
FINDING_KEYS = ("id", "severity", "file", "title", "problem", "impact", "fix")


def fail(msg):
    sys.exit(f"Invalid review JSON: {msg}")


def validate(r):
    for key, typ in REQUIRED.items():
        if key not in r:
            fail(f"missing key '{key}'")
        if not isinstance(r[key], typ):
            fail(f"'{key}' must be {typ.__name__}")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", r["slug"]):
        fail("slug may only contain letters, digits, '.', '_' and '-'")
    if r["type"] not in TYPES:
        fail(f"type must be one of {sorted(TYPES)}")
    if r["verdict"] not in VERDICTS:
        fail(f"verdict must be one of {sorted(VERDICTS)}")
    try:
        datetime.fromisoformat(r["date"])
    except ValueError:
        fail("date must be ISO 8601, e.g. 2026-11-07T14:30:00+02:00")

    ids = set()
    for i, f in enumerate(r["findings"]):
        for key in FINDING_KEYS:
            if not isinstance(f.get(key), str) or not f[key].strip():
                fail(f"findings[{i}].{key} is required")
        if f["severity"] not in SEVERITIES:
            fail(f"findings[{i}].severity must be one of {SEVERITIES}")
        if f.get("line") is not None and not isinstance(f["line"], int):
            fail(f"findings[{i}].line must be an integer or null")
        if f["id"] in ids:
            fail(f"duplicate finding id {f['id']}")
        ids.add(f["id"])

    for i, c in enumerate(r["checks"]):
        if not isinstance(c.get("command"), str) or c.get("result") not in CHECK_TAG:
            fail(f"checks[{i}] needs 'command' and 'result' in {sorted(CHECK_TAG)}")

    if not all(isinstance(x, str) for x in r["next_steps"]):
        fail("'next_steps' must be a list of strings")

    if r["verdict"] == "approve" and any(f["severity"] != "low" for f in r["findings"]):
        fail("verdict 'approve' is not allowed with high or medium findings")


def e(value):
    return html.escape(str(value), quote=True)


def tag(colour, text):
    return f'<span class="tag {colour}">{e(text)}</span>'


def render_findings(findings):
    if not findings:
        return '<p class="empty">Nothing to fix.</p>'
    order = {s: i for i, s in enumerate(SEVERITIES)}
    out = []
    for f in sorted(findings, key=lambda f: (order[f["severity"]], f["id"])):
        where = f"{f['file']}:{f['line']}" if f.get("line") else f["file"]
        out.append(
            '<div class="issue">'
            f'{tag(*SEVERITY_TAG[f["severity"]])} <code>{e(where)}</code>'
            f'<h3>{e(f["id"])}. {e(f["title"])}</h3>'
            f'<p><b>What\'s wrong</b>{e(f["problem"])}</p>'
            f'<p><b>What happens</b>{e(f["impact"])}</p>'
            f'<p><b>How to fix</b>{e(f["fix"])}</p>'
            '</div>'
        )
    return "".join(out)


def render_checks(checks):
    if not checks:
        return '<p class="empty">No checks were run.</p>'
    return "".join(
        '<div class="check">'
        f'{tag(*CHECK_TAG[c["result"]])} <code>{e(c["command"])}</code>'
        + (f' <small>{e(c["notes"])}</small>' if c.get("notes") else "")
        + "</div>"
        for c in checks
    )


def render(r):
    colour, label = VERDICTS[r["verdict"]]
    values = {
        "TITLE": e(r["title"]),
        "TYPE": e(r["type"].capitalize()),
        "TASK": e(r["task"] or "No task"),
        "BRANCH": e(r["branch"]),
        "DATE": e(datetime.fromisoformat(r["date"]).strftime("%a %d %b %Y, %H:%M")),
        "VERDICT": f'<div class="verdict {colour}">{e(label)}<p>{e(r["summary"])}</p></div>',
        "SELF_REVIEW_WARNING": (
            '<div class="warn orange">This session wrote the code, so this is not '
            "an independent review.</div>" if r["self_review"] else ""
        ),
        "FINDINGS": render_findings(r["findings"]),
        "CHECKS": render_checks(r["checks"]),
        "NEXT_STEPS": (
            "<ul>" + "".join(f"<li>{e(s)}</li>" for s in r["next_steps"]) + "</ul>"
            if r["next_steps"] else '<p class="empty">None.</p>'
        ),
        "REVIEWER": e(r["reviewer"]),
    }
    out = TEMPLATE.read_text(encoding="utf-8")
    for key, value in values.items():
        out = out.replace("{{" + key + "}}", value)
    leftover = re.findall(r"\{\{[A-Z_]+\}\}", out)
    if leftover:
        sys.exit(f"Template placeholders not filled: {leftover}")
    return out


def write_index(root):
    reviews = []
    for path in root.glob("*/*-review*.json"):
        try:
            r = json.loads(path.read_text(encoding="utf-8"))
            datetime.fromisoformat(r["date"])
        except (OSError, json.JSONDecodeError, KeyError, ValueError):
            continue
        reviews.append((r, path.with_suffix(".html").relative_to(root).as_posix()))
    reviews.sort(key=lambda x: x[0]["date"], reverse=True)

    rows = "".join(
        '<div class="issue">'
        f'{tag(*VERDICTS.get(r.get("verdict"), ("grey", "Unknown")))} '
        f'<code>{e(r.get("branch", ""))}</code>'
        f'<h3><a href="{e(link)}">{e(r.get("title", link))}</a></h3>'
        f'<p class="meta">{e(datetime.fromisoformat(r["date"]).strftime("%a %d %b, %H:%M"))}'
        f' &middot; {sum(1 for f in r.get("findings", []) if f.get("severity") != "low")} high/medium</p>'
        "</div>"
        for r, link in reviews
    ) or '<p class="empty">No reviews yet.</p>'

    # Reuse the report's <head> so the index looks the same.
    head = TEMPLATE.read_text(encoding="utf-8").split("</head>")[0]
    head = head.replace("Review: {{TITLE}}", "AI reviews")
    (root / "index.html").write_text(
        f"{head}</head>\n<body>\n<main>\n"
        f'<div class="card"><h1>AI reviews</h1>{rows}</div>\n'
        "</main>\n</body>\n</html>\n",
        encoding="utf-8",
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("review_json")
    parser.add_argument("--out-root", default="ai-reviews")
    args = parser.parse_args()

    try:
        review = json.loads(Path(args.review_json).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        sys.exit(f"Could not read {args.review_json}: {err}")
    validate(review)
    page = render(review)

    root = Path(args.out_root)
    folder = root / review["slug"]
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.fromisoformat(review["date"]).strftime("%Y-%m-%d-%H%M")
    name, n = f"{stamp}-review", 2
    while (folder / f"{name}.html").exists():
        name, n = f"{stamp}-review-{n}", n + 1

    (folder / f"{name}.html").write_text(page, encoding="utf-8")
    (folder / f"{name}.json").write_text(
        json.dumps(review, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_index(root)
    print(folder / f"{name}.html")
    print(root / "index.html")


if __name__ == "__main__":
    main()
