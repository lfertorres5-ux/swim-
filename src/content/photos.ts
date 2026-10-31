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
  credit: { name: string; source: "Unsplash" | "Pexels" | "Instagram"; url: string } | null;
};

export const PHOTOS = {
  hero: {
    src: "/photos/lesson-toddler-hero.jpg",
    alt: "Our instructor face to face with a toddler during a lesson in a backyard pool",
    want: "Instructor in the water with one child, sunny backyard/residential pool, natural light, faces happy, portrait or 4:5 crop",
    credit: { name: "@photosbyavalyn", source: "Instagram", url: "https://www.instagram.com/photosbyavalyn/" },
  },
  splash: {
    src: null,
    alt: "A child in goggles and arm floats swimming underwater",
    want: "Close-up of a kid (5–9) in goggles at the pool edge or mid-kick, bright and candid",
    credit: null,
  },
  toddler: {
    src: "/photos/instructor-coaching.jpg",
    alt: "Our instructor in the water coaching a young swimmer's kick in a backyard pool",
    want: "Parent or instructor holding a toddler in a pool, gentle and calm",
    credit: { name: "@photosbyavalyn", source: "Instagram", url: "https://www.instagram.com/photosbyavalyn/" },
  },
  stroke: {
    src: "/photos/stroke.jpg",
    alt: "A swimmer mid-stroke swimming freestyle between lane lines",
    want: "Established swimmer doing freestyle in a lane (stroke technique section)",
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
  .filter((c): c is NonNullable<PhotoSlot["credit"]> => Boolean(c))
  .filter((c, i, all) => all.findIndex((x) => x.url === c.url) === i);
