/**
 * Instructor platform terms, keyed by version. The active version is
 * platform_settings.instructor_terms_version. To publish new terms: add a new
 * entry here, deploy, then bump the setting in Admin. Every instructor loses
 * access to client data until they accept the new version (enforced by RLS).
 *
 * NOTE: Have counsel review this language before launch.
 */
export const INSTRUCTOR_TERMS: Record<string, { title: string; effective: string; sections: { heading: string; body: string }[] }> = {
  "2026-10-01": {
    title: "Instructor Platform Agreement",
    effective: "October 1, 2026",
    sections: [
      {
        heading: "1. Client confidentiality",
        body:
          "All client information you see through the platform — including children's names, ages, swim levels, notes, neighborhoods and lesson addresses — is confidential and is provided solely to deliver scheduled lessons. You will not copy, photograph, export, store outside the platform, or share it with anyone.",
      },
      {
        heading: "2. All payments on-platform",
        body:
          "Every lesson, package, rebooking and tip for a client you meet through the platform must be booked and paid through the platform. You will not accept cash, Venmo, Zelle, Cash App, PayPal or any other off-platform payment from a platform client.",
      },
      {
        heading: "3. No solicitation",
        body:
          "You will not share your personal phone number, email, social media handles or website with platform clients, and will not ask for theirs. Use the in-app chat and masked phone numbers only. Messages are automatically screened, and attempts to exchange contact or payment details are flagged for review.",
      },
      {
        heading: "4. Non-circumvention",
        body:
          "During your engagement and for 12 months after it ends, you will not provide swim instruction to any client you were introduced to through the platform except through the platform.",
      },
      {
        heading: "5. Monitoring",
        body:
          "You acknowledge that every view of client information is logged, that in-app messages and lesson notes are screened, and that the platform may review these records.",
      },
      {
        heading: "6. Safety and certifications",
        body:
          "You will keep your CPR and lifeguard/water-safety certifications current, upload renewals before they expire, and follow the platform's safety guidelines at every lesson.",
      },
      {
        heading: "7. Consequences",
        body:
          "Breach of these terms may result in immediate deactivation, forfeiture of unpaid earnings where permitted by law, and other remedies available to the platform.",
      },
    ],
  },
};
