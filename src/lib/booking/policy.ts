/** Cancellation / reschedule policy (window and late refund % are admin settings). */
export type CancellationPolicy = { cancellationWindowHours: number; lateCancelRefundPct: number };

export type CancellationOutcome = {
  /** Cancelled at least `cancellationWindowHours` before the lesson. */
  onTime: boolean;
  refundCents: number;
  /** For package lessons: whether the credit goes back on the package. */
  restoreCredit: boolean;
};

export function hoursUntil(startsAt: number, now: number): number {
  return (startsAt - now) / 3_600_000;
}

export function cancellationOutcome(
  lesson: { startsAt: number; paidCents: number; paidWithCredit: boolean },
  policy: CancellationPolicy,
  now: number,
): CancellationOutcome {
  const onTime = hoursUntil(lesson.startsAt, now) >= policy.cancellationWindowHours;
  if (lesson.paidWithCredit) return { onTime, refundCents: 0, restoreCredit: onTime };
  const refundCents = onTime ? lesson.paidCents : Math.round((lesson.paidCents * policy.lateCancelRefundPct) / 100);
  return { onTime, refundCents, restoreCredit: false };
}

/** Parents can reschedule themselves only outside the cancellation window. */
export function canReschedule(startsAt: number, policy: CancellationPolicy, now: number): boolean {
  return hoursUntil(startsAt, now) >= policy.cancellationWindowHours;
}
