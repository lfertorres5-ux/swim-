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
    src: "/photos/lesson-jump.jpg",
    alt: "A toddler leaping from the pool edge toward our instructor's outstretched arms in a backyard pool",
    want: "Instructor and child mid-lesson, joyful, backyard pool (1:1)",
    credit: null,
  },
  splash: {
    src: null,
    alt: "A child in goggles swimming underwater",
    want: "Spare slot (unused)",
    credit: null,
  },
  toddler: {
    src: "/photos/lesson-toddler-smile.jpg",
    alt: "Our instructor holding a smiling toddler in the water during a lesson",
    want: "Inset photo beside the main photo (1:1)",
    credit: null,
  },
  stroke: {
    src: "/photos/lesson-coaching.jpg",
    alt: "Our instructor coaching an older swimmer at the side of a backyard pool",
    want: "One-on-one coaching with an established swimmer (16:9)",
    credit: null,
  },
  freestyle: {
    src: "/photos/freestyle-wide.jpg",
    alt: "A young swimmer swimming freestyle between lane lines",
    want: "Established swimmer mid-stroke, wide banner under the home hero (16:9 on phones, 21:9 on desktop)",
    credit: null,
  },
  instructor: {
    src: "/photos/instructor-shoulders.jpg",
    alt: "Our instructor smiling in the pool with a young swimmer on his shoulders",
    want: "The instructor, friendly and clearly visible (1:1, Meet the instructors)",
    credit: null,
  },
  club: {
    src: "/photos/club-freestyle.jpg",
    alt: "A swimmer swimming freestyle between lane lines in a sunny outdoor pool",
    want: "Club pool scene for the Day Pass page banner (16:9)",
    credit: null,
  },
} satisfies Record<string, PhotoSlot>;

export const PHOTO_CREDITS = Object.values(PHOTOS as Record<string, PhotoSlot>)
  .map((p) => p.credit)
  .filter((c): c is NonNullable<PhotoSlot["credit"]> => Boolean(c))
  .filter((c, i, all) => all.findIndex((x) => x.url === c.url) === i);
