export const SWIM_LEVELS = [
  "water_acclimation",
  "beginner",
  "advanced_beginner",
  "intermediate",
  "advanced",
  "stroke_technique",
] as const;
export type SwimLevel = (typeof SWIM_LEVELS)[number];

export type InstructorCapability = {
  id: string;
  firstName: string;
  photoPath: string | null;
  specialties: string[];
  levelsTaught: SwimLevel[];
  minChildAgeMonths: number;
  maxChildrenPerLesson: number;
  isAcceptingNewClients: boolean;
  sortOrder: number;
  zoneIds: string[];
};

/** Local (America/Los_Angeles) wall-clock availability. Times are "HH:MM". */
export type AvailabilityRule = {
  instructorId: string;
  weekday: number; // 0 = Sunday
  startTime: string;
  endTime: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveUntil: string | null;
};

export type AvailabilityOverride = {
  instructorId: string;
  date: string;
  kind: "available" | "blackout";
  startTime: string | null; // null + blackout = whole day
  endTime: string | null;
};

/** Time an instructor is already committed. zoneId is null for external busy blocks (calendar sync). */
export type OccupiedBlock = {
  id?: string;
  instructorId: string;
  zoneId: string | null;
  start: number; // epoch ms
  end: number;
};

export type Zone = { id: string; code: string; name: string; minBookingMinutes: number; isBookable: boolean };

export type SchedulingSettings = {
  slotStepMinutes: number;
  minNoticeHours: number;
  maxHorizonDays: number;
  defaultBufferMinutes: number;
  neighborhoodWindowMinutes: number;
  bookingRequestWindowHours: number;
  offerMinLeadMinutes: number;
  paymentHoldMinutes: number;
  maxChildrenPerLesson: number;
  /** Shortest bookable lesson; used to detect unusable leftover gaps. */
  minLessonMinutes: number;
};

export type SchedulingData = {
  settings: SchedulingSettings;
  zones: Zone[];
  buffers: { from: string; to: string; minutes: number }[];
  instructors: InstructorCapability[];
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  occupied: OccupiedBlock[];
};

export type Swimmer = { ageMonths: number | null; level: SwimLevel };

export type SchedulingPreferences = {
  weekdays?: number[];
  windows?: { start: string; end: string }[]; // local "HH:MM"
};

export type SlotRequest = {
  zoneId: string;
  durationMinutes: number;
  swimmers: Swimmer[];
  fromDate: string; // local YYYY-MM-DD, inclusive
  toDate: string; //   local YYYY-MM-DD, inclusive
  /** A specific instructor chosen by the parent; null/undefined = first available. */
  instructorId?: string | null;
  favoriteInstructorId?: string | null;
  preferences?: SchedulingPreferences;
  /** Only return slots matching preferences (otherwise they're just flagged). */
  onlyPreferred?: boolean;
  excludeInstructorIds?: string[];
  /** Skip the minimum-notice rule (admin manual booking, re-offers). */
  ignoreNotice?: boolean;
};

export type Candidate = {
  instructorId: string;
  score: number;
  isNeighborhoodSlot: boolean;
  reasons: string[];
};

export type Slot = {
  start: number;
  end: number;
  date: string;
  startMinutes: number;
  /** Ranked best-first; this is also the order booking requests are offered in. */
  candidates: Candidate[];
  /** True when the top-ranked instructor already teaches in this zone within the window. */
  isNeighborhoodSlot: boolean;
  matchesPreferences: boolean;
  score: number;
};

export type SlotResult = {
  slots: Slot[];
  suggested: Slot[];
  eligibleInstructorIds: string[];
};

export type SchedulingErrorCode =
  | "zone_not_found"
  | "zone_not_bookable"
  | "below_zone_minimum"
  | "no_swimmers"
  | "too_many_swimmers"
  | "invalid_duration"
  | "invalid_range";

export class SchedulingError extends Error {
  constructor(
    readonly code: SchedulingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SchedulingError";
  }
}
