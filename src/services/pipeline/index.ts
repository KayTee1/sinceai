// Request pipeline runs (T23): the page-2 sequence of the Miro board as a run
// with step events (docs/ARCHITECTURE.md, contract 1). The analysis leg runs
// as a Mastra workflow (src/mastra/workflows/request-pipeline.ts). The run
// then waits for a person in our own tables, not a Mastra snapshot, so a
// paused run survives dev-server reloads: the requester's submit or "Use
// this", then the Lead's approval, continue it through the functions below,
// which the existing build, reuse and decision services call.
import type { Client } from "@libsql/client";
import type { Scope } from "../steward/types";

export type StepId =
  | "intent"
  | "clarify"
  | "discovery"
  | "conflict"
  | "duplicate"
  | "recommend"
  | "confirm_reuse"
  | "log_reuse"
  | "propose"
  | "approve"
  | "build"
  | "register"
  | "done";

export type Agent =
  | "Analyst"
  | "Orchestrator"
  | "Discovery agent"
  | "Conflict detector"
  | "Metadata catalog"
  | "Semantic layer"
  | "Lifecycle engine"
  | "Approver";

export type StepStatus = "running" | "done" | "waiting_input" | "waiting_approval" | "failed" | "skipped";
export type RunStatus = "running" | "waiting_input" | "waiting_approval" | "done" | "failed";
/** Which branch of the sequence the run took. */
export type RunPath = "reuse" | "build" | "clarify" | "restore" | "pending" | "insufficient" | null;

export type StepEvent = {
  id: number;
  runId: string;
  step: StepId;
  agent: Agent;
  status: StepStatus;
  summary: string;
  evidence: string[];
  ts: string;
};

export type Run = {
  runId: string;
  requestId: string;
  scope: Scope | null;
  path: RunPath;
  status: RunStatus;
  proposalId: string | null;
  assetId: string | null;
  createdOn: string;
  updatedAt: string;
};

export type RunWithEvents = Run & { events: StepEvent[] };

async function ensureTables(db: Client) {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS runs (
         run_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, scope TEXT, path TEXT, status TEXT NOT NULL,
         proposal_id TEXT, asset_id TEXT, created_on TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS run_events (
         id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, step TEXT NOT NULL, agent TEXT NOT NULL,
         status TEXT NOT NULL, summary TEXT NOT NULL, evidence TEXT NOT NULL, ts TEXT NOT NULL)`,
    ],
    "write",
  );
}

const now = () => new Date().toISOString();

function toRun(r: Record<string, unknown>): Run {
  return {
    runId: r.run_id as string,
    requestId: r.request_id as string,
    scope: r.scope ? (JSON.parse(r.scope as string) as Scope) : null,
    path: (r.path as RunPath) ?? null,
    status: r.status as RunStatus,
    proposalId: (r.proposal_id as string | null) ?? null,
    assetId: (r.asset_id as string | null) ?? null,
    createdOn: r.created_on as string,
    updatedAt: r.updated_at as string,
  };
}

export async function startRun(db: Client, input: { requestId: string; date: string }): Promise<Run> {
  await ensureTables(db);
  const n = Number((await db.execute(`SELECT COUNT(*) AS n FROM runs`)).rows[0]?.n ?? 0);
  const runId = `RUN-${String(n + 1).padStart(3, "0")}`;
  const ts = now();
  await db.execute({
    sql: `INSERT INTO runs (run_id, request_id, status, created_on, updated_at) VALUES (?, ?, 'running', ?, ?)`,
    args: [runId, input.requestId.toUpperCase(), input.date, ts],
  });
  return (await getRun(db, runId))!;
}

export async function updateRun(
  db: Client,
  runId: string,
  patch: Partial<Pick<Run, "scope" | "path" | "status" | "proposalId" | "assetId">>,
): Promise<void> {
  const fields: [string, string | null][] = [];
  if (patch.scope !== undefined) fields.push(["scope", patch.scope ? JSON.stringify(patch.scope) : null]);
  if (patch.path !== undefined) fields.push(["path", patch.path]);
  if (patch.status !== undefined) fields.push(["status", patch.status]);
  if (patch.proposalId !== undefined) fields.push(["proposal_id", patch.proposalId]);
  if (patch.assetId !== undefined) fields.push(["asset_id", patch.assetId]);
  fields.push(["updated_at", now()]);
  const sets = fields.map(([f]) => `${f} = ?`);
  const args = fields.map(([, v]) => v);
  await db.execute({ sql: `UPDATE runs SET ${sets.join(", ")} WHERE run_id = ?`, args: [...args, runId] });
}

/** Appends one step event (contract: runId, step, agent, status, summary, evidence, ts). */
export async function emit(
  db: Client,
  runId: string,
  e: { step: StepId; agent: Agent; status: StepStatus; summary: string; evidence?: string[] },
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO run_events (run_id, step, agent, status, summary, evidence, ts) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [runId, e.step, e.agent, e.status, e.summary, JSON.stringify(e.evidence ?? []), now()],
  });
  await db.execute({ sql: `UPDATE runs SET updated_at = ? WHERE run_id = ?`, args: [now(), runId] });
}

export async function getRun(db: Client, runId: string): Promise<RunWithEvents | null> {
  await ensureTables(db);
  const r = await db.execute({ sql: `SELECT * FROM runs WHERE run_id = ?`, args: [runId] });
  if (!r.rows[0]) return null;
  const ev = await db.execute({ sql: `SELECT * FROM run_events WHERE run_id = ? ORDER BY id`, args: [runId] });
  return {
    ...toRun(r.rows[0] as Record<string, unknown>),
    events: ev.rows.map((x) => ({
      id: Number(x.id),
      runId: x.run_id as string,
      step: x.step as StepId,
      agent: x.agent as Agent,
      status: x.status as StepStatus,
      summary: x.summary as string,
      evidence: JSON.parse(x.evidence as string) as string[],
      ts: x.ts as string,
    })),
  };
}

export async function latestRun(db: Client): Promise<RunWithEvents | null> {
  await ensureTables(db);
  const r = await db.execute(`SELECT run_id FROM runs ORDER BY rowid DESC LIMIT 1`);
  return r.rows[0] ? getRun(db, r.rows[0].run_id as string) : null;
}

/** The newest run for a request that is waiting at the given step (or any waiting run). */
async function waitingRunFor(db: Client, requestId: string, path: RunPath): Promise<Run | null> {
  await ensureTables(db);
  const r = await db.execute({
    sql: `SELECT * FROM runs WHERE request_id = ? AND status = 'waiting_input' AND path = ? ORDER BY rowid DESC LIMIT 1`,
    args: [requestId.toUpperCase(), path],
  });
  return r.rows[0] ? toRun(r.rows[0] as Record<string, unknown>) : null;
}

async function runForProposal(db: Client, proposalId: string): Promise<Run | null> {
  await ensureTables(db);
  const r = await db.execute({ sql: `SELECT * FROM runs WHERE proposal_id = ? ORDER BY rowid DESC LIMIT 1`, args: [proposalId] });
  return r.rows[0] ? toRun(r.rows[0] as Record<string, unknown>) : null;
}

// ---------- continuations (called by the existing services) ----------

/** The requester submitted the build: the run asks the Approver and waits. */
export async function onBuildProposed(
  db: Client,
  input: { requestId: string; proposalId: string; approvers: string[] },
): Promise<void> {
  const run = await waitingRunFor(db, input.requestId, "build");
  if (!run) return;
  await emit(db, run.runId, {
    step: "propose",
    agent: "Orchestrator",
    status: "done",
    summary: `Request approval to build (${input.proposalId})`,
    evidence: [input.proposalId],
  });
  await emit(db, run.runId, {
    step: "approve",
    agent: "Approver",
    status: "waiting_approval",
    summary: `Waiting for ${input.approvers.join(" or ") || "an approver"}`,
    evidence: input.approvers,
  });
  await updateRun(db, run.runId, { status: "waiting_approval", proposalId: input.proposalId });
}

/** The Lead decided: approved runs build, register and hand back the insight; rejected runs end. */
export async function onBuildDecided(
  db: Client,
  input: {
    proposalId: string;
    actor: string;
    action: "approve" | "reject";
    reason?: string;
    insight?: { id: string; kpiIds: string[]; ttlEnd: string | null } | null;
  },
): Promise<void> {
  const run = await runForProposal(db, input.proposalId);
  if (!run || run.status !== "waiting_approval") return;
  if (input.action === "reject") {
    await emit(db, run.runId, {
      step: "approve",
      agent: "Approver",
      status: "failed",
      summary: `Rejected by ${input.actor}: ${input.reason ?? ""}`.trim(),
      evidence: [input.proposalId],
    });
    await emit(db, run.runId, { step: "done", agent: "Orchestrator", status: "failed", summary: "Nothing was built" });
    await updateRun(db, run.runId, { status: "failed" });
    return;
  }
  const ins = input.insight;
  await emit(db, run.runId, { step: "approve", agent: "Approver", status: "done", summary: `Approved by ${input.actor}`, evidence: [input.proposalId] });
  await emit(db, run.runId, {
    step: "build",
    agent: "Semantic layer",
    status: "done",
    summary: `Queried certified metrics only: ${ins?.kpiIds.join(", ") ?? "–"}`,
    evidence: ins?.kpiIds ?? [],
  });
  await emit(db, run.runId, {
    step: "register",
    agent: "Lifecycle engine",
    status: "done",
    summary: `Registered ${ins?.id ?? "insight"} as TEMPORARY, TTL 30 days`,
    evidence: ins ? [ins.id] : [],
  });
  await emit(db, run.runId, {
    step: "done",
    agent: "Lifecycle engine",
    status: "done",
    summary: `Insight ${ins?.id ?? ""} ready${ins?.ttlEnd ? `, expires ${ins.ttlEnd}` : ""}`,
    evidence: ins ? [ins.id, ...(ins.ttlEnd ? [`#expires=${ins.ttlEnd}`] : [])] : [],
  });
  await updateRun(db, run.runId, { status: "done", assetId: ins?.id ?? null });
}

/** The requester picked a reuse candidate: log the reuse (usage +1) and finish. */
export async function onReuseConfirmed(
  db: Client,
  input: { requestId: string; assetId: string; requesterId: string },
): Promise<void> {
  const run = await waitingRunFor(db, input.requestId, "reuse");
  if (!run) return;
  await emit(db, run.runId, { step: "confirm_reuse", agent: "Analyst", status: "done", summary: `Use ${input.assetId}`, evidence: [input.assetId] });
  await emit(db, run.runId, {
    step: "log_reuse",
    agent: "Lifecycle engine",
    status: "done",
    summary: `Logged reuse (usage +1 for ${input.requesterId})`,
    evidence: [input.assetId, input.requesterId],
  });
  await emit(db, run.runId, { step: "done", agent: "Orchestrator", status: "done", summary: `Answered by existing ${input.assetId}` });
  await updateRun(db, run.runId, { status: "done", assetId: input.assetId });
}
