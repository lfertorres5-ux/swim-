import { HERO_VIDEO } from "@/content/media";

/**
 * Muted, looping background video behind the hero. Softened and faded toward
 * the headline so text stays readable; visitors who prefer reduced motion
 * see the still poster instead.
 */
export function HeroVideo() {
  if (!HERO_VIDEO.src) return null;
  return (
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
      <video
        className="h-full w-full object-cover saturate-[0.85] motion-reduce:hidden"
        src={HERO_VIDEO.src}
        poster={HERO_VIDEO.poster ?? undefined}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      />
      {HERO_VIDEO.poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={HERO_VIDEO.poster} alt="" className="hidden h-full w-full object-cover motion-reduce:block" />
      )}
      {/* Sand wash: strong behind the headline, clear over the water. */}
      <div className="absolute inset-0 bg-gradient-to-b from-sand/90 via-sand/70 to-sand lg:bg-gradient-to-r lg:from-sand lg:via-sand/80 lg:to-sand/10" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-sand" />
    </div>
  );
}
