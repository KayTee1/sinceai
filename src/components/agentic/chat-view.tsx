"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";

const SUGGESTIONS = [
  { title: "Run business request REQ-0001", prompt: "Handle business request REQ-0001." },
  { title: "Find existing Nubeqa sales dashboards", prompt: "Is there already a dashboard for Nubeqa net sales vs forecast in Germany?" },
  { title: "Check the Net Sales definition", prompt: "Which Net Sales KPI should we use, and are there conflicting definitions?" },
];

// Tool calls are shown as pipeline steps. Keys cover both tool ids and agent tool names.
const STEP_LABEL: Record<string, { agent: string; action: string }> = {
  "get-business-request": { agent: "Orchestrator", action: "Loaded business request" },
  getBusinessRequest: { agent: "Orchestrator", action: "Loaded business request" },
  "search-assets": { agent: "Discovery", action: "Searched existing assets" },
  searchAssets: { agent: "Discovery", action: "Searched existing assets" },
  "find-kpi-definitions": { agent: "Conflict detector", action: "Compared KPI definitions" },
  findKpiDefinitions: { agent: "Conflict detector", action: "Compared KPI definitions" },
};

export function ChatView() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const busy = status === "submitted" || status === "streaming";
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    sendMessage({ text: t });
    setInput("");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-6 py-8">
          {messages.length === 0 ? (
            <Empty onPick={send} />
          ) : (
            <div className="space-y-6">
              {messages.map((m) => (
                <Message key={m.id} message={m} />
              ))}
              {status === "submitted" && <Thinking />}
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
            placeholder="Describe what you need, or give a request ID (e.g. REQ-0001)"
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
          Agents only propose; a human decides. Answers use synthetic challenge data.
        </p>
      </div>
    </div>
  );
}

function Empty({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="pt-10">
      <div className="label">Agentic</div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Ask before you build.</h1>
      <p className="mt-2 max-w-[560px] text-sm text-ink-2">
        The steward searches what already exists, checks KPI definitions for conflicts, and recommends reuse
        before anything new gets built.
      </p>
      <div className="mt-6 grid gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onPick(s.prompt)}
            className="group flex items-center justify-between rounded-sm border border-line bg-surface px-4 py-3 text-left text-sm hover:border-blue"
          >
            <span>
              <span className="font-medium">{s.title}</span>
              <span className="mt-0.5 block text-xs text-ink-3">{s.prompt}</span>
            </span>
            <span className="text-ink-3 group-hover:text-blue" aria-hidden>
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Message({ message }: { message: UIMessage }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-sm bg-navy px-4 py-2.5 text-sm text-white">{text}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="label">Analytics Steward</div>
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return part.text ? (
            <div key={i} className="prose-steward text-sm leading-relaxed text-ink">
              <ReactMarkdown>{part.text}</ReactMarkdown>
            </div>
          ) : null;
        }
        if (part.type === "dynamic-tool") {
          return <Step key={i} name={part.toolName} state={part.state} output={part.output} />;
        }
        if (part.type.startsWith("tool-")) {
          const p = part as { type: string; state: string; output?: unknown };
          return <Step key={i} name={p.type.slice(5)} state={p.state} output={p.output} />;
        }
        return null;
      })}
    </div>
  );
}

function Step({ name, state, output }: { name: string; state: string; output?: unknown }) {
  const label = STEP_LABEL[name] ?? { agent: "Agent", action: name };
  const done = state === "output-available";
  const failed = state === "output-error";
  return (
    <div className="flex items-center gap-3 rounded-sm border border-line bg-surface px-3 py-2 text-xs">
      <StatusDot done={done} failed={failed} />
      <span className="w-[120px] shrink-0 font-semibold text-ink">{label.agent}</span>
      <span className="flex-1 text-ink-2">{label.action}</span>
      <span className="tabular text-ink-3">{failed ? "failed" : done ? summarize(output) : "running…"}</span>
    </div>
  );
}

function StatusDot({ done, failed }: { done: boolean; failed: boolean }) {
  if (failed) return <span className="h-2 w-2 rounded-full bg-danger" aria-label="failed" />;
  if (done) return <span className="h-2 w-2 rounded-full bg-green" aria-label="done" />;
  return <span className="h-2 w-2 animate-pulse rounded-full bg-sky" aria-label="running" />;
}

function summarize(output: unknown): string {
  if (!output || typeof output !== "object") return "done";
  const o = output as Record<string, unknown>;
  if (Array.isArray(o.assets)) return `${o.assets.length} candidates`;
  if (Array.isArray(o.kpis)) return `${o.kpis.length} definitions${o.conflict ? " · conflict" : ""}`;
  if ("found" in o) return o.found ? "found" : "not found";
  return "done";
}

function Thinking() {
  return (
    <div className="flex items-center gap-2 text-xs text-ink-3">
      <span className="h-2 w-2 animate-pulse rounded-full bg-sky" />
      Orchestrator is planning…
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
