"use client";

import { useState } from "react";
import type { DashboardData, Role } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { DashboardView } from "./dashboard/dashboard-view";
import { ChatView } from "./agentic/chat-view";
import { LifecycleProvider, useLifecycle } from "./lifecycle/lifecycle-context";
import { ClockBar } from "./lifecycle/clock-bar";
import { Inbox } from "./lifecycle/inbox";
import { PipelineView } from "./agentic/pipeline-view";

type Tab = "agentic" | "dashboard";

export function StewardApp({ data }: { data: DashboardData }) {
  const [role, setRole] = useState<Role>("employee");
  const [tab, setTab] = useState<Tab>("dashboard");

  // Employees only browse dashboards (D8); the Agentic tab is shown but locked.
  const activeTab: Tab = role === "employee" ? "dashboard" : tab;

  return (
    <LifecycleProvider>
      <div className="flex h-dvh flex-col">
        <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center bg-navy px-5 text-white">
          <Brand />
          <TabSwitch value={activeTab} onChange={setTab} agenticLocked={role === "employee"} />
          <div className="flex items-center justify-end gap-4">
            {role === "employee" ? <ViewerPicker /> : <SimDate fallback={data.clockDate} />}
            <RoleSwitch value={role} onChange={setRole} />
          </div>
        </header>

        {role === "manager" && <ClockBar />}

        <main className="min-h-0 flex-1">
          {activeTab === "dashboard" ? (
            <DashboardView data={data} role={role} />
          ) : (
            <AgenticLayout />
          )}
        </main>
      </div>
    </LifecycleProvider>
  );
}

type Side = "pipeline" | "inbox";

// T23: the chat with the live Pipeline view beside it (default) or the approval inbox.
function AgenticLayout() {
  const [side, setSide] = useState<Side>("pipeline");
  const { data } = useLifecycle();
  const waiting = data?.pending.length ?? 0;
  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1">
        <ChatView />
      </div>
      <aside
        className={`flex shrink-0 flex-col border-l border-line bg-surface ${side === "pipeline" ? "w-[46%] min-w-[420px]" : "w-[380px]"}`}
      >
        <div className="flex shrink-0 gap-1 border-b border-line px-3 py-2">
          {(["pipeline", "inbox"] as Side[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`rounded-sm px-2.5 py-1 text-xs font-medium ${side === s ? "bg-navy text-white" : "text-ink-2 hover:bg-canvas"}`}
            >
              {s === "pipeline" ? "Pipeline" : `Inbox${waiting ? ` (${waiting})` : ""}`}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">{side === "pipeline" ? <PipelineView /> : <Inbox />}</div>
      </aside>
    </div>
  );
}

function SimDate({ fallback }: { fallback: string }) {
  const { data } = useLifecycle();
  return (
    <span className="hidden text-xs text-white/60 md:inline">
      Simulated date <span className="tabular text-white/90">{formatDate(data?.clock.date ?? fallback)}</span>
    </span>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <circle cx="11" cy="11" r="9.5" fill="none" stroke="var(--green)" strokeWidth="2" />
        <circle cx="11" cy="11" r="4" fill="var(--sky)" />
      </svg>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">Analytics Steward</div>
        <div className="text-[11px] text-white/60">Bayer Pharmaceuticals · Since AI 2026 prototype</div>
      </div>
    </div>
  );
}

function TabSwitch({
  value,
  onChange,
  agenticLocked,
}: {
  value: Tab;
  onChange: (t: Tab) => void;
  agenticLocked: boolean;
}) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "agentic", label: "Agentic" },
    { id: "dashboard", label: "Dashboard" },
  ];
  return (
    <nav className="flex h-full items-stretch" aria-label="Main">
      {tabs.map((t) => {
        const locked = t.id === "agentic" && agenticLocked;
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            disabled={locked}
            onClick={() => onChange(t.id)}
            title={locked ? "Manager only: switch role to Manager" : undefined}
            className={`relative flex items-center gap-1.5 px-5 text-sm font-medium transition-colors ${
              active ? "text-white" : "text-white/65 hover:text-white"
            } disabled:cursor-not-allowed disabled:text-white/35 disabled:hover:text-white/35`}
          >
            {locked && <LockIcon />}
            {t.label}
            {active && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t bg-green" />}
          </button>
        );
      })}
    </nav>
  );
}

function RoleSwitch({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  const roles: { id: Role; label: string }[] = [
    { id: "employee", label: "Employee" },
    { id: "manager", label: "Manager" },
  ];
  return (
    <div className="flex rounded-full bg-white/10 p-0.5 text-xs font-medium" role="radiogroup" aria-label="Role">
      {roles.map((r) => (
        <button
          key={r.id}
          type="button"
          role="radio"
          aria-checked={value === r.id}
          onClick={() => onChange(r.id)}
          className={`rounded-full px-3 py-1.5 transition-colors ${
            value === r.id ? "bg-white text-navy" : "text-white/75 hover:text-white"
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <rect x="2" y="5.5" width="8" height="5.5" rx="1" fill="currentColor" />
      <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

// Employee identity for usage logging (D13). Opens count for this person.
function ViewerPicker() {
  const { data, viewer, setViewer } = useLifecycle();
  if (!data) return null;
  const people = Object.entries(data.people)
    .filter(([, p]) => p.active)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));
  return (
    <label className="flex items-center gap-2 text-xs text-white/60">
      Viewing as
      <select
        value={viewer}
        onChange={(e) => setViewer(e.target.value)}
        className="max-w-[180px] rounded-sm border border-white/20 bg-white/10 px-2 py-1 text-xs text-white focus:outline-none"
      >
        {people.map(([id, p]) => (
          <option key={id} value={id} className="text-ink">
            {p.name} · {p.region}
          </option>
        ))}
      </select>
    </label>
  );
}
