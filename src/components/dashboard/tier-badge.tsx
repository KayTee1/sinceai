import type { Tier } from "@/lib/types";

const STYLE: Record<Tier, { label: string; cls: string; icon: React.ReactNode }> = {
  certified: {
    label: "Certified",
    cls: "border-green-deep/30 bg-[#eef7e4] text-green-deep",
    icon: (
      <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    ),
  },
  team: {
    label: "Team",
    cls: "border-blue/30 bg-[#e6f4fc] text-[#00609a]",
    icon: (
      <>
        <circle cx="4" cy="4.5" r="1.7" fill="currentColor" />
        <circle cx="8.3" cy="4.5" r="1.7" fill="currentColor" />
        <path d="M1 10c.4-2 1.6-3 3-3s2.6 1 3 3M5.5 10c.4-2 1.5-3 2.8-3S10.7 8 11 10" fill="currentColor" />
      </>
    ),
  },
  personal: {
    label: "Personal",
    cls: "border-line-strong bg-canvas text-ink-2",
    icon: (
      <>
        <circle cx="6" cy="4" r="2" fill="currentColor" />
        <path d="M2 10.5c.5-2.3 2-3.5 4-3.5s3.5 1.2 4 3.5" fill="currentColor" />
      </>
    ),
  },
  temporary: {
    label: "Temporary",
    cls: "border-warn/40 bg-[#fdf3e6] text-warn",
    icon: (
      <>
        <circle cx="6" cy="6" r="4.3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 3.6V6l1.6 1.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
};

export function TierBadge({ tier }: { tier: Tier }) {
  const s = STYLE[tier];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-[11px] font-semibold ${s.cls}`}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
        {s.icon}
      </svg>
      {s.label}
    </span>
  );
}
