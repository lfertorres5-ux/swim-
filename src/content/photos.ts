/**
 * Landing-page photography. Each slot shows the photo in /public/photos when
 * `src` is set, and a drawn water illustration until then.
 *
 * To add a photo: download it (Unsplash and Pexels photos are free for
 * commercial use — skip anything marked "Unsplash+"), save it as
 * public/photos/<name>.jpg (about 1600 px wide), then fill in `src` and
 * `credit` below. `want` describes what fits the slot.
 */
export type PhotoSlot = {
  src: string | null;
  alt: string;
  want: string;
  credit: { name: string; source: "Unsplash" | "Pexels"; url: string } | null;
};

export const PHOTOS = {
  hero: {
    src: null,
    alt: "An instructor in the water helping a young child float in a backyard pool",
    want: "Instructor in the water with one child, sunny backyard/residential pool, natural light, faces happy, portrait or 4:5 crop",
    credit: null,
  },
  splash: {
    src: null,
    alt: "A child in goggles smiling at the edge of a pool",
    want: "Close-up of a kid (5–9) in goggles at the pool edge or mid-kick, bright and candid",
    credit: null,
  },
  toddler: {
    src: null,
    alt: "A parent and toddler together in a warm pool",
    want: "Parent or instructor holding a toddler in a pool, gentle and calm",
    credit: null,
  },
  club: {
    src: null,
    alt: "A resort-style pool with lounge chairs and palm trees",
    want: "Country club / resort pool deck with loungers and palms, no identifiable people (Day Pass page)",
    credit: null,
  },
} satisfies Record<string, PhotoSlot>;

export const PHOTO_CREDITS = Object.values(PHOTOS as Record<string, PhotoSlot>)
  .map((p) => p.credit)
  .filter((c): c is NonNullable<PhotoSlot["credit"]> => Boolean(c));
