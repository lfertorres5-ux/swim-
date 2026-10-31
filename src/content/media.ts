/**
 * Optional hero background video (e.g. slow footage of California coastal
 * bluffs). Put a short, muted MP4 in /public/video (10–20 s, ~1920×1080,
 * under ~6 MB) and a still frame as the poster, then set `src` and `poster`.
 * With `src` null the hero has no video.
 */
export const HERO_VIDEO: { src: string | null; poster: string | null; credit: string | null } = {
  src: null,
  poster: null,
  credit: null,
};
