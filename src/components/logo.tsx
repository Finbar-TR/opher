// "The Ring" — Opher's wordmark. A segmented ring (2 of 5 arcs filled, echoing the
// fill meter) stands in for the letter O, followed by lowercase "pher". The ring
// recolours for the inverted (dark) operator/roast chrome.

export function RingMark({
  size = 21,
  dark = false,
}: {
  size?: number;
  dark?: boolean;
}) {
  const claimed = dark ? "#f0844c" : "#d6432c";
  const open = dark ? "#5c4432" : "#dcc3ab";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden
      style={{ transform: "translateY(0.06em)" }}
    >
      <g transform="rotate(-90 50 50)" fill="none" strokeWidth="14">
        {/* five segments, all open */}
        <circle cx="50" cy="50" r="36" stroke={open} strokeDasharray="36 9.24" strokeDashoffset="4.62" />
        {/* two segments filled */}
        <circle cx="50" cy="50" r="36" stroke={claimed} strokeDasharray="36 216.19" strokeDashoffset="4.62" />
        <circle cx="50" cy="50" r="36" stroke={claimed} strokeDasharray="36 216.19" strokeDashoffset="-40.62" />
      </g>
    </svg>
  );
}

export function Logo({
  ring = 21,
  dark = false,
  textClass = "text-[26px]",
}: {
  ring?: number;
  dark?: boolean;
  textClass?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-[2px] font-display leading-none">
      <RingMark size={ring} dark={dark} />
      <span className={`${textClass} ${dark ? "text-[#fffaf3]" : "text-ink"}`}>
        pher
      </span>
    </span>
  );
}
