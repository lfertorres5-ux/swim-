/**
 * Decorative pieces borrowed from real pools — the brand's visual language.
 *   LaneRope  the floating lane line between swim lanes (red at the walls, blue and white in the middle)
 *   TileBand  the waterline tile along the top of a pool
 *   WaveEdge  a soft water edge between sections
 * All are aria-hidden: purely visual.
 */

/** Floats along a lane rope. `count` floats; ends are red like a real lane line's last 5 m. */
export function LaneRope({ count = 28, className = "" }: { count?: number; className?: string }) {
  const color = (i: number) => (i < 3 || i >= count - 3 ? "var(--color-lane-red)" : i % 2 ? "#ffffff" : "var(--color-lane-blue)");
  return (
    <div aria-hidden className={`relative flex items-center ${className}`}>
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-stone-300" />
      <div className="relative flex w-full justify-between">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className="h-2.5 w-4 rounded-full shadow-[inset_0_-1px_0_rgba(0,0,0,0.15)] ring-1 ring-black/5" style={{ background: color(i) }} />
        ))}
      </div>
    </div>
  );
}

// Deterministic "random" so server and client render the same tiles.
const rand = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};
const TILE = ["var(--color-tile-1)", "var(--color-tile-2)", "var(--color-tile-3)", "var(--color-tile-4)"];

/** A strip of small mosaic tiles, two rows deep, at a fixed tile size so it reads as tile on any screen. */
export function TileBand({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`grid h-[22px] grid-flow-col grid-rows-2 gap-[2px] overflow-hidden ${className}`} style={{ gridAutoColumns: "10px" }}>
      {Array.from({ length: 2 * 220 }, (_, i) => {
        const r = rand(i + 1);
        return <span key={i} className="rounded-[2px]" style={{ background: TILE[r < 0.45 ? 0 : r < 0.75 ? 1 : r < 0.92 ? 2 : 3] }} />;
      })}
    </div>
  );
}

/** Soft wave separating two sections. `fill` is the color of the section below. */
export function WaveEdge({ fill = "#ffffff", flip = false, className = "" }: { fill?: string; flip?: boolean; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 1440 48" preserveAspectRatio="none" className={`block h-6 w-full sm:h-10 ${flip ? "rotate-180" : ""} ${className}`}>
      <path d="M0 30 C 180 6 360 6 540 26 S 900 48 1080 28 S 1320 4 1440 22 V48 H0Z" fill={fill} />
    </svg>
  );
}

/** Little SVG swimmer (front crawl), used on the booking progress lane. */
export function Swimmer({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 40 24" className={className}>
      <circle cx="31" cy="9" r="4.2" fill="var(--color-coral-500)" />
      <path d="M4 15 C 12 9 20 9 27 12" stroke="var(--color-brand-800)" strokeWidth="3.4" strokeLinecap="round" fill="none" />
      <path d="M22 11 C 24 4 30 2 36 3" stroke="var(--color-brand-800)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M0 20 C 6 17 10 23 16 20 S 26 17 32 20 S 38 22 40 20" stroke="var(--color-brand-400)" strokeWidth="1.6" fill="none" />
    </svg>
  );
}
