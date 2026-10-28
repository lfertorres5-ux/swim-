import Image from "next/image";
import type { PhotoSlot } from "@/content/photos";

/**
 * A photo slot. With no photo yet, draws sunlit pool water so the layout
 * looks intentional instead of empty (decorative, so screen readers skip it).
 */
export function Photo({ photo, className = "", sizes = "(min-width: 1024px) 40vw, 90vw", priority = false, tone = "day" }: { photo: PhotoSlot; className?: string; sizes?: string; priority?: boolean; tone?: "day" | "dusk" }) {
  if (photo.src) {
    return (
      <div className={`relative overflow-hidden bg-brand-100 ${className}`}>
        <Image src={photo.src} alt={photo.alt} fill sizes={sizes} priority={priority} className="object-cover" />
      </div>
    );
  }
  const [a, b, c] = tone === "day" ? ["#9fdbe0", "#3fa7b4", "#17707f"] : ["#ffd6c2", "#5fb4bd", "#1d5f6b"];
  return (
    // Decorative stand-in: hidden from screen readers so it isn't described as a real photo.
    <div className={`relative overflow-hidden ${className}`} aria-hidden>
      <svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id={`w-${tone}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset=".55" stopColor={b} />
            <stop offset="1" stopColor={c} />
          </linearGradient>
        </defs>
        <rect width="400" height="500" fill={`url(#w-${tone})`} />
        {/* Caustic light ripples on the pool floor */}
        {[60, 130, 210, 290, 370, 450].map((y, i) => (
          <path key={y} d={`M-20 ${y} C 60 ${y - 18} 120 ${y + 22} 200 ${y} S 340 ${y - 20} 420 ${y + 4}`} stroke="#ffffff" strokeOpacity={0.28 - i * 0.03} strokeWidth={6 - i * 0.6} fill="none" />
        ))}
        {[
          [90, 110, 26],
          [280, 190, 18],
          [170, 330, 22],
          [320, 400, 14],
        ].map(([x, y, r]) => (
          <ellipse key={`${x}${y}`} cx={x} cy={y} rx={r * 1.6} ry={r} fill="#ffffff" fillOpacity={0.1} />
        ))}
      </svg>
    </div>
  );
}
