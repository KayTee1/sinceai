// T24 (B4): pure logic behind the Scheduler tab (src/lib/scheduler-client.ts).
// The React tab itself is rendered in scheduler-view.test.tsx (happy-dom); this
// covers response/error mapping, validation, generic status/job/summary
// rendering and the fetch helpers' requests (with an injected fetch stub).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SchedulerRun } from "../src/services/scheduler/types";
import {
  AGENTIC_SIDE_TABS,
  DEMO_ACTOR,
  GATE_MESSAGE,
  NOT_READY_MESSAGE,
  canStartRun,
  countsText,
  findingStatusOptions,
  mapResponse,
  runOutcome,
  schedulerApi,
  statusLabel,
  statusTone,
  summaryLines,
  validateReason,
  windowText,
  type Fetcher,
  type JobOverview,
} from "../src/lib/scheduler-client";

const GATE_ERROR =
  "Scheduler actions over HTTP are disabled: the prototype has no authentication, so a manager identity cannot be verified. Set SCHEDULER_DEMO_ACTIONS=1 on the server to accept the demo's client-asserted manager, or use the scheduler CLI.";

function run(over: Partial<SchedulerRun> = {}): SchedulerRun {
  return {
    runId: "SCH-1",
    jobId: "incremental_overlap",
    mode: "incremental",
    trigger: "manual",
    actor: "manager",
    simDate: "2026-11-07",
    status: "succeeded",
    startedAt: "2026-11-07T10:00:00.000Z",
    completedAt: "2026-11-07T10:00:01.000Z",
    window: { fromAuditId: 0, toAuditId: 5 },
    rules: [],
    policyVersion: "1",
    summary: null,
    error: null,
    ...over,
  };
}

function job(over: Partial<JobOverview> = {}): JobOverview {
  return {
    job: {
      jobId: "incremental_overlap",
      mode: "incremental",
      title: "Incremental overlap",
      description: "d",
      triggers: ["manual"],
      rules: [],
      watchedActions: [],
      limitations: [],
    },
    checkpoint: null,
    pendingAuditRows: 0,
    runs: { running: 0, succeeded: 0, failed: 0, total: 0 },
    latestRun: null,
    running: null,
    ...over,
  };
}

describe("side tabs", () => {
  it("are exactly Pipeline | Scheduler | Inbox", () => {
    assert.deepEqual([...AGENTIC_SIDE_TABS], ["pipeline", "scheduler", "inbox"]);
  });
});

describe("mapResponse", () => {
  it("passes 2xx data through", () => {
    assert.deepEqual(mapResponse({ status: 200, body: { a: 1 } }), { ok: true, data: { a: 1 } });
  });

  it("maps the demo gate 403 to the gate message", () => {
    const r = mapResponse({ status: 403, body: { error: GATE_ERROR } }, "run");
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.kind === "gate" && r.message === GATE_MESSAGE);
  });

  it("maps a non-manager 403 to a gate refusal that keeps the server text and never claims real auth", () => {
    const r = mapResponse({ status: 403, body: { error: "Only the manager may run scheduler actions" } }, "dismiss");
    assert.ok(!r.ok && r.kind === "gate");
    assert.ok(!r.ok && r.message.includes("Only the manager") && r.message.includes("no authentication"));
  });

  it("maps 409 'not initialised' to a readable not-ready state", () => {
    const r = mapResponse({ status: 409, body: { error: "Lifecycle is not initialised yet; open the app once first" } });
    assert.ok(!r.ok && r.kind === "not_ready" && r.message === NOT_READY_MESSAGE);
  });

  it("maps a run 409 to 'another run is in progress'", () => {
    const r = mapResponse({ status: 409, body: { error: "Run SCH-9 is still running", runningRunId: "SCH-9" } }, "run");
    assert.ok(!r.ok && r.kind === "conflict" && /another run is in progress/i.test(r.message));
  });

  it("keeps other 409s as a conflict with the server text", () => {
    const r = mapResponse({ status: 409, body: { error: "Finding F-1 is already dismissed" } }, "dismiss");
    assert.ok(!r.ok && r.kind === "conflict" && r.message.includes("already dismissed"));
    assert.ok(!r.ok && !/another run/i.test(r.message));
  });

  it("maps 400, 404 and 500 with the server message", () => {
    const bad = mapResponse({ status: 400, body: { error: "reason is required" } });
    assert.ok(!bad.ok && bad.kind === "invalid" && bad.message.includes("reason is required"));
    const nf = mapResponse({ status: 404, body: { error: "Unknown run X" } });
    assert.ok(!nf.ok && nf.kind === "not_found" && nf.message.includes("Unknown run X"));
    const err = mapResponse({ status: 500, body: { error: "Scheduler request failed" } });
    assert.ok(!err.ok && err.kind === "server" && err.message.includes("500"));
  });

  it("handles a non-JSON error body", () => {
    const r = mapResponse({ status: 502, body: null });
    assert.ok(!r.ok && r.kind === "server" && r.message.includes("502"));
  });

  it("maps a network failure", () => {
    const r = mapResponse({ status: null, error: "fetch failed" });
    assert.ok(!r.ok && r.kind === "network" && r.status === null && r.message.includes("fetch failed"));
  });
});

describe("runOutcome", () => {
  it("reports a 200 carrying a failed run as failed, not success", () => {
    const o = runOutcome(
      run({ status: "failed", error: { code: "evaluation_failed", stage: "evaluate", message: "boom", at: "x" } }),
    );
    assert.equal(o.tone, "bad");
    assert.match(o.text, /failed/);
    assert.match(o.text, /boom/);
    assert.doesNotMatch(o.text, /succeeded/);
  });

  it("reports success with finding counts", () => {
    const o = runOutcome(
      run({
        summary: {
          window: { fromAuditId: 0, toAuditId: 5 },
          eventsRead: 5,
          relevantEvents: 1,
          ignoredSchedulerEvents: 0,
          assessments: [],
          findings: { created: 2, updated: 0, unchanged: 1, reopened: 0, suppressed: 0 },
          limitations: [],
        },
      }),
    );
    assert.equal(o.tone, "ok");
    assert.match(o.text, /succeeded: 2 created, 1 unchanged/);
  });

  it("does not report success without a run", () => {
    assert.equal(runOutcome(null).tone, "bad");
  });
});

describe("validateReason", () => {
  it("requires a non-blank reason", () => {
    assert.ok(validateReason(""));
    assert.ok(validateReason("   "));
    assert.equal(validateReason("duplicate of AST-1 by design"), null);
  });
});

describe("generic status and job rendering", () => {
  it("renders unknown statuses as-is with neutral tone", () => {
    assert.equal(statusTone("open"), "attention");
    assert.equal(statusTone("failed"), "bad");
    assert.equal(statusTone("resolved"), "ok");
    assert.equal(statusTone("superseded"), "muted");
    assert.equal(statusTone("something_new"), "neutral");
    assert.equal(statusLabel("something_new"), "something new");
  });

  it("builds the finding filter from server counts, open first, including later statuses", () => {
    assert.deepEqual(findingStatusOptions({ open: 1, dismissed: 2 }), ["any", "open", "dismissed"]);
    assert.deepEqual(findingStatusOptions({ superseded: 0, dismissed: 2, open: 1, resolved: 3 }), [
      "any",
      "open",
      "dismissed",
      "resolved",
      "superseded",
    ]);
    assert.deepEqual(findingStatusOptions(null), ["any", "open"]);
  });

  it("disables a run while one is in flight or the server reports one running", () => {
    assert.equal(canStartRun(job(), false), true);
    assert.equal(canStartRun(job(), true), false);
    assert.equal(canStartRun(job({ running: run({ status: "running", completedAt: null }) }), false), false);
  });

  it("treats a periodic job like any other job (present or absent)", () => {
    const periodic = job({
      job: { ...job().job, jobId: "periodic_reassessment" as never, mode: "reassessment" as never, title: "Periodic" },
      checkpoint: null,
      pendingAuditRows: 0,
    });
    const jobs = [job(), periodic];
    assert.deepEqual(jobs.map((j) => j.job.jobId), ["incremental_overlap", "periodic_reassessment"]);
    assert.ok(jobs.every((j) => canStartRun(j, false)));
  });
});

describe("summaryLines", () => {
  it("returns nothing for a missing summary", () => {
    assert.deepEqual(summaryLines(null), []);
    assert.deepEqual(summaryLines(undefined), []);
  });

  it("renders only the fields present and lists unknown fields generically", () => {
    const lines = summaryLines({ findings: { created: 1 }, reassessment: { assetsChecked: 4 } });
    assert.deepEqual(lines, [
      { label: "Findings", value: "1 created" },
      { label: "reassessment", value: '{"assetsChecked":4}' },
    ]);
  });

  it("renders a full incremental summary", () => {
    const lines = summaryLines({
      window: { fromAuditId: 3, toAuditId: 7 },
      eventsRead: 4,
      relevantEvents: 2,
      ignoredSchedulerEvents: 1,
      assessments: [{}, {}],
      findings: { created: 0, updated: 0 },
      limitations: ["x"],
    });
    assert.deepEqual(
      lines.map((l) => l.label),
      ["Window", "Audit rows read", "Relevant changes", "Scheduler rows ignored", "Assets assessed", "Findings"],
    );
    assert.equal(lines[0].value, "audit #4 to #7");
    assert.equal(lines[5].value, "no changes");
  });

  it("formats windows and counts defensively", () => {
    assert.equal(windowText(undefined), "unknown");
    assert.equal(windowText({ fromAuditId: 5, toAuditId: 5 }), "no new audit rows (at #5)");
    assert.equal(countsText({ a: 0, b: 2, c: "x" }), "2 b");
  });
});

describe("schedulerApi requests", () => {
  type Call = { url: string; init?: RequestInit };
  function stub(status: number, body: unknown) {
    const calls: Call[] = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    };
    return { calls, api: schedulerApi(fetcher) };
  }

  it("starts a run with POST, actor and jobId", async () => {
    const { calls, api } = stub(200, { run: run() });
    const r = await api.startRun("incremental_overlap");
    assert.equal(r.ok, true);
    assert.equal(calls[0].url, "/api/scheduler/runs");
    assert.equal(calls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { actor: DEMO_ACTOR, jobId: "incremental_overlap" });
  });

  it("returns a failed run from a 200 as data whose outcome is failed", async () => {
    const { api } = stub(200, { run: run({ status: "failed", error: { code: "commit_failed", stage: "commit", message: "m", at: "x" } }) });
    const r = await api.startRun("incremental_overlap");
    assert.ok(r.ok);
    assert.equal(r.ok && runOutcome(r.data.run).tone, "bad");
  });

  it("maps a gated run to the gate message", async () => {
    const { api } = stub(403, { error: GATE_ERROR });
    const r = await api.startRun("periodic_reassessment");
    assert.ok(!r.ok && r.message === GATE_MESSAGE);
  });

  it("dismisses with POST, actor and trimmed reason", async () => {
    const { calls, api } = stub(200, { finding: { findingId: "F/1", status: "dismissed" } });
    await api.dismiss("F/1", "  by design  ");
    assert.equal(calls[0].url, "/api/scheduler/findings/F%2F1/dismiss");
    assert.equal(calls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { actor: DEMO_ACTOR, reason: "by design" });
  });

  it("surfaces the server's 400 on dismiss", async () => {
    const { api } = stub(400, { error: "reason is required" });
    const r = await api.dismiss("F-1", "x");
    assert.ok(!r.ok && r.kind === "invalid" && r.message.includes("reason is required"));
  });

  it("abandons with POST, actor and reason", async () => {
    const { calls, api } = stub(200, { run: run({ status: "failed" }) });
    await api.abandon("SCH-1", "stuck after crash");
    assert.equal(calls[0].url, "/api/scheduler/runs/SCH-1/abandon");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { actor: DEMO_ACTOR, reason: "stuck after crash" });
  });

  it("reads overview, runs and findings with GET URLs", async () => {
    const { calls, api } = stub(200, {});
    await api.overview();
    await api.runs(20);
    await api.findings("open");
    assert.deepEqual(
      calls.map((c) => [c.url, c.init?.method ?? "GET"]),
      [
        ["/api/scheduler", "GET"],
        ["/api/scheduler/runs?limit=20", "GET"],
        ["/api/scheduler/findings?status=open&limit=50", "GET"],
      ],
    );
  });

  it("maps a thrown fetch to a network error", async () => {
    const api = schedulerApi(async () => {
      throw new Error("offline");
    });
    const r = await api.overview();
    assert.ok(!r.ok && r.kind === "network" && r.message.includes("offline"));
  });
});
