"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import type { AnalysisView, KpiChecksView } from "@/mastra/tools/steward-views";
import type { BuildProposalView } from "@/mastra/tools/build-tools";
import type { ProposalListView } from "@/mastra/tools/inbox-tools";
import { useLifecycle } from "../lifecycle/lifecycle-context";
import { AnalysisCards, BuildProposalCards, KpiChecksCards, ProposalListCards } from "./chat-cards";

const SUGGESTIONS = [
  { title: "Run business request REQ-0001", prompt: "Handle business request REQ-0001." },
  { title: "Run team demo request TEAM-REQ-01", prompt: "Handle business request TEAM-REQ-01." },
  { title: "What's waiting for approval?", prompt: "What's waiting for approval?" },
  { title: "Check the Net Sales definition", prompt: "Which Net Sales KPI should we use, and are there conflicting definitions?" },
];

// Short, plain step names. Keys cover both tool ids and agent tool names.
const STEP: Record<string, string> = {
  "get-business-request": "Loaded the request",
  getBusinessRequest: "Loaded the request",
  "search-assets": "Searched assets",
  searchAssets: "Searched assets",
  "find-kpi-definitions": "Looked up KPI definitions",
  findKpiDefinitions: "Looked up KPI definitions",
  "analyze-request": "Checked the catalog",
  analyzeRequest: "Checked the catalog",
  "compute-kpi": "Computed the KPI",
  computeKpi: "Computed the KPI",
  "check-kpi-definitions": "Checked KPI definitions",
  checkKpiDefinitions: "Checked KPI definitions",
  "propose-build": "Submitted for approval",
  proposeBuild: "Submitted for approval",
  "list-pending-proposals": "Read the approval inbox",
  listPendingProposals: "Read the approval inbox",
  "get-build-status": "Checked build status",
  getBuildStatus: "Checked build status",
};

type ToolPart = { id: string; name: string; state: string; output?: unknown };

function toolPart(part: UIMessage["parts"][number], i: number): ToolPart | null {
  const p = part as { type: string; toolName?: string; toolCallId?: string; state?: string; output?: unknown };
  const name = p.type === "dynamic-tool" ? p.toolName : p.type.startsWith("tool-") ? p.type.slice(5) : undefined;
  if (!name) return null;
  return { id: p.toolCallId ?? String(i), name, state: p.state ?? "", output: p.output };
}

function toolParts(m: UIMessage): ToolPart[] {
  return m.parts.flatMap((part, i) => {
    const t = toolPart(part, i);
    return t ? [t] : [];
  });
}

const viewOf = (t: ToolPart) => (t.state === "output-available" ? (t.output as { view?: string } | undefined)?.view : undefined);

/** Proposals stored in this chat (tool call IDs), so the side inbox can re-read once per new one. */
function storedProposalCalls(messages: UIMessage[]): string[] {
  return messages.flatMap((m) =>
    toolParts(m)
      .filter((t) => viewOf(t) === "build-proposal/v1" && (t.output as { status?: string }).status === "proposed")
      .map((t) => t.id),
  );
}

/** Follow-up chips for the latest answer, from what its tools returned. */
function followUps(m: UIMessage): string[] {
  const chips: string[] = [];
  for (const t of toolParts(m)) {
    const view = viewOf(t);
    if (view === "steward-analysis/v1") {
      const a = t.output as AnalysisView;
      if (a.kpiChecks.some((k) => k.conflict)) chips.push(`Why are the KPI definitions for ${a.request.id} in conflict?`);
      if (a.recommendation.kind === "reuse_candidates") chips.push(`What is unknown about the top candidate for ${a.request.id}?`);
    }
    if (view === "build-proposal/v1" && ["proposed", "already_proposed"].includes((t.output as { status: string }).status)) {
      chips.push("What else is waiting for approval?");
    }
  }
  if (!chips.some((c) => c.includes("waiting"))) chips.push("What's waiting for approval?");
  chips.push("Any escalated reviews?");
  return [...new Set(chips)].slice(0, 3);
}

export function ChatView() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const busy = status === "submitted" || status === "streaming";
  const endRef = useRef<HTMLDivElement>(null);
  const { refresh } = useLifecycle();
  const seenProposals = useRef(new Set<string>());

  // A proposal submitted from chat lands in the approval inbox: re-read it once per new proposal.
  useEffect(() => {
    const fresh = storedProposalCalls(messages).filter((id) => !seenProposals.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => seenProposals.current.add(id));
    refresh();
  }, [messages, refresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    sendMessage({ text: t });
    setInput("");
  }

  const last = messages.at(-1);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-6 py-8">
          {messages.length === 0 ? (
            <Empty onPick={send} />
          ) : (
            <div className="space-y-6">
              {messages.map((m) => (
                <Message key={m.id} message={m} send={send} busy={busy} />
              ))}
              {status === "submitted" && <Thinking />}
              {!busy && last?.role === "assistant" && <Chips items={followUps(last)} onPick={send} />}
            </div>
          )}
          {error && (
            <div className="mt-6 rounded-sm border border-danger/30 bg-[#fdeeee] px-4 py-3 text-sm text-danger">
              {readError(error)}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-surface">
        <form
          className="mx-auto flex max-w-[760px] items-end gap-2 px-6 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask about a request (e.g. REQ-0001), a KPI, or what's waiting for approval"
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-sm border border-line-strong px-3 py-2.5 text-sm placeholder:text-ink-3 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => stop()}
              className="h-[44px] rounded-sm border border-line-strong px-4 text-sm font-medium text-ink-2 hover:bg-canvas"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="h-[44px] rounded-sm bg-blue px-5 text-sm font-semibold text-white hover:bg-[#007fc4] disabled:bg-line-strong"
            >
              Send
            </button>
          )}
        </form>
        <p className="mx-auto max-w-[760px] px-6 pb-3 text-[11px] text-ink-3">
          I only propose; a person approves. Answers use synthetic challenge data.
        </p>
      </div>
    </div>
  );
}

function Empty({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="pt-10">
      <div className="label">Analytics Steward</div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Ask before you build.</h1>
      <p className="mt-2 max-w-[560px] text-sm text-ink-2">
        Give me a request and I&apos;ll tell you whether something already answers it, which KPI definition to trust, and
        what&apos;s waiting for your decision.
      </p>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onPick(s.prompt)}
            className="group flex items-center justify-between rounded-sm border border-line bg-surface px-4 py-3 text-left text-sm hover:border-blue"
          >
            <span className="font-medium">{s.title}</span>
            <span className="text-ink-3 group-hover:text-blue" aria-hidden>
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Message({ message, send, busy }: { message: UIMessage; send: (t: string) => void; busy: boolean }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-sm bg-navy px-4 py-2.5 text-sm text-white">{text}</div>
      </div>
    );
  }

  const tools = toolParts(message);
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n\n").trim();
  return (
    <div className="space-y-3">
      {tools.length > 0 && <Steps tools={tools} />}
      {text && (
        <div className="prose-steward text-sm leading-relaxed text-ink">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      )}
      {tools.map((t) => (
        <ToolCards key={t.id} t={t} send={send} busy={busy} />
      ))}
    </div>
  );
}

function ToolCards({ t, send, busy }: { t: ToolPart; send: (t: string) => void; busy: boolean }) {
  switch (viewOf(t)) {
    case "steward-analysis/v1":
      return <AnalysisCards v={t.output as AnalysisView} send={send} busy={busy} />;
    case "kpi-checks/v1":
      return <KpiChecksCards v={t.output as KpiChecksView} />;
    case "build-proposal/v1":
      return <BuildProposalCards v={t.output as BuildProposalView} />;
    case "proposal-list/v1":
      return <ProposalListCards v={t.output as ProposalListView} />;
    default:
      return null;
  }
}

/** One quiet line for all tool steps; expands to the list. */
function Steps({ tools }: { tools: ToolPart[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.some((t) => t.state !== "output-available" && t.state !== "output-error");
  const failed = tools.filter((t) => t.state === "output-error").length;
  const names = [...new Set(tools.map((t) => STEP[t.name] ?? t.name))];
  return (
    <div className="text-xs text-ink-3">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2 hover:text-ink-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${running ? "animate-pulse bg-sky" : failed ? "bg-danger" : "bg-green"}`}
          aria-hidden
        />
        <span>
          {running ? `${names.at(-1)}…` : names.join(" · ")}
          {failed ? ` · ${failed} failed` : ""}
        </span>
        <span aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <ul className="mt-1.5 space-y-0.5 border-l border-line pl-3">
          {tools.map((t) => (
            <li key={t.id} className="flex gap-2">
              <span className="text-ink-2">{STEP[t.name] ?? t.name}</span>
              <span className="tabular">
                {t.state === "output-error" ? "failed" : t.state === "output-available" ? summarize(t.output) : "running…"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chips({ items, onPick }: { items: string[]; onPick: (t: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          className="rounded-full border border-line-strong bg-surface px-3 py-1 text-xs text-ink-2 hover:border-blue hover:text-blue"
        >
          {c}
        </button>
      ))}
    </div>
  );
}

function summarize(output: unknown): string {
  if (!output || typeof output !== "object") return "done";
  const o = output as Record<string, unknown>;
  if (o.error === true) return "invalid input";
  if (o.view === "steward-analysis/v1") {
    const a = o as unknown as AnalysisView;
    return `${a.request.id} · ${a.candidates.total} assets · ${a.kpiChecks.length} KPIs · ${a.recommendation.kind.replace(/_/g, " ")}`;
  }
  if (o.view === "build-proposal/v1") {
    if (o.status === "proposed" || o.status === "already_proposed") return `${(o.proposal as { id?: string }).id} · awaiting approval`;
    return String(o.status).replace(/_/g, " ");
  }
  if (o.view === "kpi-checks/v1" && Array.isArray(o.checks)) {
    const conflicts = o.checks.filter((c) => (c as { conflict?: boolean }).conflict).length;
    return `${o.checks.length} metrics${conflicts ? ` · ${conflicts} conflict` : ""}`;
  }
  if (o.view === "proposal-list/v1") return `${o.total} waiting`;
  if (o.view === "kpi-result/v1" && typeof o.status === "string") return o.status.replace(/_/g, " ");
  if (o.view === "kpi-by-market/v1") return "by market";
  if (Array.isArray(o.assets)) return `${o.assets.length} candidates`;
  if ("found" in o) return o.found ? "found" : "not found";
  return "done";
}

function Thinking() {
  return (
    <div className="flex items-center gap-2 text-xs text-ink-3">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky" />
      Looking into it…
    </div>
  );
}

function readError(error: Error): string {
  try {
    const parsed = JSON.parse(error.message);
    if (parsed?.error) return parsed.error;
  } catch {
    // not JSON
  }
  return error.message || "Something went wrong.";
}
