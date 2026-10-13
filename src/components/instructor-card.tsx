import Image from "next/image";
import type { InstructorCardData } from "@/lib/instructor-cards";

const CERT_LABELS: Record<string, string> = {
  cpr: "CPR",
  first_aid: "First Aid",
  lifeguard: "Lifeguard",
  water_safety_instructor: "Water Safety Instructor",
  swim_instructor: "Certified Swim Instructor",
  background_check: "Background checked",
  other: "Certified",
};

const SPECIALTY_LABELS: Record<string, string> = {
  toddlers: "Toddlers",
  fearful_swimmers: "Fearful swimmers",
  stroke_technique: "Stroke technique",
  swim_team_prep: "Swim team prep",
  water_safety: "Water safety",
  infant_survival: "Infant self-rescue",
  special_needs: "Adaptive / special needs",
  older_beginners: "Older beginners",
};

export function InstructorCard({
  instructor,
  favorite,
  selected,
  compact,
}: {
  instructor: InstructorCardData;
  favorite?: boolean;
  selected?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`card flex h-full flex-col gap-3 border-2 transition ${selected ? "border-brand-500" : "border-transparent"}`}>
      <div className="flex items-center gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-stone-100 ring-1 ring-stone-200">
          {instructor.photoUrl && <Image src={instructor.photoUrl} alt={`Photo of ${instructor.firstName}`} fill sizes="64px" className="object-cover" unoptimized />}
        </div>
        <div>
          <p className="font-display text-lg font-semibold text-stone-900">
            {instructor.firstName}
            {favorite && <span className="badge ml-2 bg-coral-50 text-coral-700">Your favorite</span>}
          </p>
          <p className="text-xs text-stone-500">
            {[instructor.yearsExperience ? `${instructor.yearsExperience} yrs teaching` : null, instructor.languages.join(" · ")].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      {!compact && <p className="line-clamp-4 text-sm text-stone-700">{instructor.bio}</p>}
      <div className="flex flex-wrap gap-1.5">
        {instructor.certifications.map((c, i) => (
          <span key={i} className="badge bg-brand-50 text-brand-800" title={c.issuer ?? undefined}>
            {CERT_LABELS[c.kind] ?? c.kind}
          </span>
        ))}
        {instructor.specialties.map((s) => (
          <span key={s} className="badge bg-sand text-stone-700">
            {SPECIALTY_LABELS[s] ?? s}
          </span>
        ))}
      </div>
    </div>
  );
}
