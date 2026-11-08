// Bonsai mark: a pot, a curved trunk and three foliage pads. "light" is for
// white or canvas backgrounds; "dark" (white trunk, sky pot) for the navy header.
// Same drawing as src/app/icon.svg, the summary page and the demo brand card.
const TONES = {
  light: { trunk: "#6b4a2b", pot: "var(--navy)" },
  dark: { trunk: "#ffffff", pot: "var(--sky)" },
} as const;

export function BonsaiLogo({ size = 28, tone = "light" }: { size?: number; tone?: keyof typeof TONES }) {
  const c = TONES[tone];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <g fill="none" stroke={c.trunk} strokeLinecap="round" strokeLinejoin="round">
        <path d="M31 49 C29 42 37 40 35 34 C33 28 26 29 25 23" strokeWidth="4.5" />
        <path d="M35 35 C39 34 42 33 44 31" strokeWidth="3" />
        <path d="M29 27 C33 24 37 20 40 16" strokeWidth="3" />
      </g>
      <ellipse cx="22" cy="21" rx="12.5" ry="6.5" fill="var(--green)" />
      <ellipse cx="41" cy="14.5" rx="12" ry="6.5" fill="var(--green-deep)" />
      <ellipse cx="45" cy="30.5" rx="10" ry="5.5" fill="var(--green)" />
      <rect x="13" y="48" width="38" height="4.5" rx="1.5" fill={c.pot} />
      <path d="M17 52.5 H47 L43.5 59 H20.5 Z" fill={c.pot} />
    </svg>
  );
}
