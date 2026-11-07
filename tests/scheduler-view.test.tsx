// T25 (Codex P2): the Scheduler tab must never show findings for a status
// filter other than the selected one. Renders the real SchedulerPanel (the
// Scheduler tab body, without the lifecycle provider) with React DOM in a
// happy-dom window and a fake fetch whose responses the test releases in a
// chosen order, so the action/filter interleaving Codex reproduced runs
// through the component's own state, callbacks and effects.
//
// Limitations: happy-dom, not a browser; no Next.js runtime; the lifecycle
// clock key is a fixed prop. Server behaviour is a tiny in-memory fake.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

type Pending = { url: string; method: string; body: unknown; release: () => Promise<void> };

const win = new Window({ url: "http://localhost/" });
const g = globalThis as Record<string, unknown>;
const restore: [string, unknown][] = [];
function setGlobal(key: string, value: unknown) {
  restore.push([key, g[key]]);
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

let React: typeof import("react");
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let SchedulerPanel: typeof import("../src/components/agentic/scheduler-view").SchedulerPanel;

before(async () => {
  for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "Node", "Event", "MouseEvent"]) {
    setGlobal(k, k === "window" ? win : (win as unknown as Record<string, unknown>)[k]);
  }
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ SchedulerPanel } = await import("../src/components/agentic/scheduler-view"));
});

after(async () => {
  for (const [k, v] of restore.reverse()) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  await win.happyDOM.close();
});

// ---- Fake server: findings in memory; every response is held until released ----

function finding(id: string, status: "open" | "dismissed") {
  return {
    findingId: id,
    dedupKey: id,
    ruleId: "active_overlap",
    ruleVersion: "1",
    assetIds: [`${id}-A`, `${id}-B`],
    status,
    evidence: null,
    fingerprint: "fp",
    firstSeen: { at: "2026-01-01T00:00:00Z", simDate: "2026-01-01", runId: "R-1" },
    lastSeen: { at: "2026-01-01T00:00:00Z", simDate: "2026-01-01", runId: "R-1" },
    observations: 1,
    dismissal: null,
    resolution: null,
    proposal: null,
  };
}

function fakeServer() {
  const store = [finding("F-OPEN", "open"), finding("F-OLD", "dismissed")];
  const pending: Pending[] = [];
  const counts = () => {
    const c: Record<string, number> = { open: 0, dismissed: 0 };
    for (const f of store) c[f.status] += 1;
    return c;
  };
  const job = {
    job: {
      jobId: "incremental_overlap",
      mode: "incremental",
      title: "Overlap",
      description: "",
      triggers: ["manual"],
      rules: [],
      watchedActions: [],
      limitations: [],
    },
    checkpoint: null,
    pendingAuditRows: 1,
    runs: {},
    latestRun: null,
    running: null,
  };
  // The body is computed when the response is released, as a server would answer then.
  const respond = (url: string, method: string): { status: number; body: unknown } => {
    const u = new URL(url, "http://localhost");
    if (method === "POST" && u.pathname.endsWith("/dismiss")) {
      const id = decodeURIComponent(u.pathname.split("/")[4]);
      const f = store.find((x) => x.findingId === id)!;
      f.status = "dismissed";
      return { status: 200, body: { finding: f } };
    }
    if (method === "POST" && u.pathname === "/api/scheduler/runs") {
      const run = { runId: "R-2", jobId: "incremental_overlap", status: "completed", summary: {}, error: null };
      return { status: 200, body: { run } };
    }
    if (u.pathname === "/api/scheduler") return { status: 200, body: { jobs: [job], findings: counts() } };
    if (u.pathname === "/api/scheduler/runs") return { status: 200, body: { runs: [], counts: {} } };
    if (u.pathname === "/api/scheduler/findings") {
      const s = u.searchParams.get("status")!;
      const list = store.filter((f) => s === "any" || f.status === s);
      return { status: 200, body: { total: list.length, counts: counts(), findings: list } };
    }
    return { status: 404, body: { error: "unknown" } };
  };
  const fetch = (url: string, init?: RequestInit) =>
    new Promise<Response>((resolve) => {
      const method = init?.method ?? "GET";
      const entry: Pending = {
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        release: async () => {
          pending.splice(pending.indexOf(entry), 1);
          await act(async () => {
            const r = respond(url, method);
            resolve({ status: r.status, json: async () => r.body } as Response);
          });
        },
      };
      pending.push(entry);
    });
  const take = (pred: (p: Pending) => boolean, what: string) => {
    const p = pending.find(pred);
    assert.ok(p, `expected a pending request: ${what}; pending: ${pending.map((x) => `${x.method} ${x.url}`).join(", ")}`);
    return p;
  };
  const findingsReq = (status: string) => take((p) => p.url.startsWith(`/api/scheduler/findings?status=${status}&`), `findings ${status}`);
  const releaseAll = async () => {
    while (pending.length) await pending[0].release();
  };
  const releaseWhere = async (pred: (p: Pending) => boolean) => {
    for (let p = pending.find(pred); p; p = pending.find(pred)) await p.release();
  };
  return { pending, fetch, take, findingsReq, releaseAll, releaseWhere };
}

// ---- DOM helpers ----

async function mount(server: ReturnType<typeof fakeServer>) {
  setGlobal("fetch", server.fetch);
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(React.createElement(SchedulerPanel, { clockKey: "2026-01-01" })));
  await act(async () => {}); // the mount effect schedules its load in a microtask
  return { host, root };
}

const buttons = (host: { querySelectorAll: (s: string) => ArrayLike<unknown> }) =>
  Array.from(host.querySelectorAll("button")) as unknown as HTMLButtonElement[];
function button(host: Parameters<typeof buttons>[0], text: RegExp) {
  const b = buttons(host).find((x) => text.test(x.textContent ?? ""));
  assert.ok(b, `no button ${text}; have: ${buttons(host).map((x) => x.textContent).join(" | ")}`);
  return b;
}
async function click(host: Parameters<typeof buttons>[0], text: RegExp) {
  const b = button(host, text);
  await act(async () => b.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event));
}
async function type(host: { querySelector: (s: string) => unknown }, value: string) {
  const ta = host.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(ta, value);
    ta.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
  });
}
const pressedFilter = (host: Parameters<typeof buttons>[0]) =>
  buttons(host)
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => (b.textContent ?? "").replace(/\s*\(\d+\)$/, ""));
/** Finding IDs rendered as cards in the panel (not the flash message above it). */
const shownFindings = (host: { querySelectorAll: (s: string) => ArrayLike<unknown> }) =>
  (Array.from(host.querySelectorAll("#scheduler-panel li")) as unknown as HTMLElement[]).map(
    (li) => (li.textContent ?? "").match(/F-(OPEN|OLD)(?!-)/)?.[0],
  );

// ---- Tests ----

const isRead = (p: Pending) => p.method === "GET";

describe("Scheduler tab: status filter vs. action completion (Codex P2)", () => {
  it("a dismissal started under Open and finishing after a switch to Dismissed refreshes Dismissed", async () => {
    const server = fakeServer();
    const { host, root } = await mount(server);
    await server.releaseAll();
    await click(host, /^Findings/);
    assert.deepEqual(pressedFilter(host), ["open"]);
    assert.deepEqual(shownFindings(host), ["F-OPEN"]);

    // 1. Start dismissing F-OPEN while viewing Open; the POST is held.
    await click(host, /^Dismiss…$/);
    await type(host, "Known duplicate, owners agreed");
    await click(host, /^Dismiss finding$/);
    const dismissReq = server.take((p) => p.method === "POST" && p.url.endsWith("/dismiss"), "dismiss POST");
    assert.deepEqual(dismissReq.body, { actor: "manager", reason: "Known duplicate, owners agreed" });

    // 2-3. Switch to Dismissed; its load lands (only F-OLD: the dismissal has not happened yet).
    await click(host, /^dismissed/);
    await act(async () => {});
    await server.releaseWhere(isRead);
    assert.deepEqual(pressedFilter(host), ["dismissed"]);
    assert.deepEqual(shownFindings(host), ["F-OLD"]);

    // 4. The dismissal finishes; its refresh must ask for the CURRENT filter.
    await dismissReq.release();
    await act(async () => {});
    assert.equal(server.pending.filter((p) => p.url.includes("status=open")).length, 0, "no refresh of the old Open filter");
    server.findingsReq("dismissed");
    await server.releaseWhere(isRead);

    // 5-6. Dismissed stays selected and shows dismissed findings, now including F-OPEN.
    assert.deepEqual(pressedFilter(host), ["dismissed"]);
    assert.deepEqual(shownFindings(host).sort(), ["F-OLD", "F-OPEN"]);
    assert.match(host.textContent ?? "", /Finding F-OPEN is now dismissed\./i);
    assert.doesNotMatch(host.textContent ?? "", /No open findings/);
    await act(async () => root.unmount());
  });

  it("an older filter's response landing after a newer one is dropped", async () => {
    const server = fakeServer();
    const { host, root } = await mount(server);
    await server.releaseAll();
    await click(host, /^Findings/);

    await click(host, /^dismissed/);
    await act(async () => {});
    const stale = server.findingsReq("dismissed");
    await click(host, /^open/);
    await act(async () => {});
    // Newer (Open) load lands first, then the stale Dismissed one.
    await server.releaseWhere((p) => isRead(p) && p !== stale && !p.url.includes("status=dismissed"));
    await stale.release();
    await server.releaseWhere(isRead);
    assert.deepEqual(pressedFilter(host), ["open"]);
    assert.deepEqual(shownFindings(host), ["F-OPEN"]);
    await act(async () => root.unmount());
  });

  it("a manual run finishing after a filter switch refreshes the current filter", async () => {
    const server = fakeServer();
    const { host, root } = await mount(server);
    await server.releaseAll();

    await click(host, /^Run now$/);
    const runReq = server.take((p) => p.method === "POST" && p.url === "/api/scheduler/runs", "run POST");
    await click(host, /^Findings/);
    await click(host, /^dismissed/);
    await act(async () => {});
    await server.releaseWhere(isRead);

    await runReq.release();
    await act(async () => {});
    assert.equal(server.pending.filter((p) => p.url.includes("status=open")).length, 0, "no refresh of the old Open filter");
    server.findingsReq("dismissed");
    await server.releaseWhere(isRead);
    assert.deepEqual(pressedFilter(host), ["dismissed"]);
    assert.deepEqual(shownFindings(host), ["F-OLD"]);
    await act(async () => root.unmount());
  });
});
