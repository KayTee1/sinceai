// Small shared building blocks for the dashboard views.

export function Card({
  title,
  subtitle,
  children,
  pad = true,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  pad?: boolean;
}) {
  return (
    <div className="rounded-sm border border-line bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <span className="text-right text-xs text-ink-3">{subtitle}</span>}
      </div>
      <div className={pad ? "px-3 pb-3 pt-4" : ""}>{children}</div>
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="label">{label}</div>
      <div className="tabular mt-1 text-[26px] font-semibold leading-tight tracking-tight">{value}</div>
      {note && <div className="mt-0.5 text-xs text-ink-3">{note}</div>}
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line bg-line lg:grid-cols-4">
      {children}
    </div>
  );
}

export function Meta({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-ink-3">{label}</dt>
      <dd className={`font-medium ${warn ? "text-warn" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

const TONE: Record<string, string> = {
  good: "border-green-deep/30 bg-[#eef7e4] text-green-deep",
  warn: "border-warn/30 bg-[#fdf3e6] text-warn",
  bad: "border-danger/30 bg-[#fdeeee] text-danger",
  neutral: "border-line-strong bg-canvas text-ink-2",
};

/** Status label with a text value, never colour alone. */
export function Pill({ text, tone = "neutral" }: { text: string; tone?: keyof typeof TONE }) {
  return (
    <span className={`inline-block rounded-sm border px-1.5 py-px text-[11px] font-semibold ${TONE[tone]}`}>
      {text.replaceAll("_", " ")}
    </span>
  );
}

export function toneFor(value: string): keyof typeof TONE {
  const v = value.toLowerCase();
  if (
    ["healthy", "good", "green", "completed", "listed", "canonical", "approved", "certified", "improving"].includes(v)
  )
    return "good";
  if (
    ["failed", "poor", "red", "high", "not_launched", "unapproved", "definition_conflict", "missing_owner"].includes(v)
  )
    return "bad";
  if (["warning", "partial", "amber", "medium", "review", "in_progress", "local", "duplicate_candidate"].includes(v))
    return "warn";
  return "neutral";
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-sm border border-line bg-surface px-3 py-2 text-xs text-ink-2">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky" aria-hidden />
      {children}
    </p>
  );
}
