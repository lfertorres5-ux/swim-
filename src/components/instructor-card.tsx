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
    <div className={`card flex h-full flex-col gap-3 transition ${selected ? "ring-2 ring-sky-500" : ""}`}>
      <div className="flex items-center gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
          {instructor.photoUrl && <Image src={instructor.photoUrl} alt={`Photo of ${instructor.firstName}`} fill sizes="64px" className="object-cover" unoptimized />}
        </div>
        <div>
          <p className="text-lg font-semibold text-slate-900">
            {instructor.firstName}
            {favorite && <span className="badge ml-2 bg-rose-50 text-rose-700">♥ Your favorite</span>}
          </p>
          <p className="text-xs text-slate-500">
            {[instructor.yearsExperience ? `${instructor.yearsExperience} yrs teaching` : null, instructor.languages.join(" · ")].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      {!compact && <p className="line-clamp-4 text-sm text-slate-700">{instructor.bio}</p>}
      <div className="flex flex-wrap gap-1.5">
        {instructor.certifications.map((c, i) => (
          <span key={i} className="badge bg-emerald-50 text-emerald-800" title={c.issuer ?? undefined}>
            ✓ {CERT_LABELS[c.kind] ?? c.kind}
          </span>
        ))}
        {instructor.specialties.map((s) => (
          <span key={s} className="badge bg-sky-50 text-sky-800">
            {SPECIALTY_LABELS[s] ?? s}
          </span>
        ))}
      </div>
    </div>
  );
}
