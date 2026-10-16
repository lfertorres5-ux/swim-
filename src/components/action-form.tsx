"use client";

import { useActionState, type ReactNode } from "react";

export type FormState = { ok?: boolean; message?: string; error?: string };
type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * A form bound to a server action that returns { ok, message } or { error }.
 * Shows the result inline next to the submit button.
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  pendingLabel = "Saving…",
  variant = "primary",
  confirm,
  className = "space-y-3",
  inline = false,
}: {
  action: Action;
  children?: ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "link";
  confirm?: string;
  className?: string;
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const button =
    variant === "primary"
      ? "btn-primary"
      : variant === "secondary"
        ? "btn-secondary"
        : variant === "danger"
          ? "btn-secondary border-red-200 text-red-700 hover:border-red-300"
          : "text-sm font-medium text-brand-700 hover:underline disabled:opacity-50";
  return (
    <form
      action={formAction}
      className={inline ? "inline-flex flex-wrap items-center gap-2" : className}
      onSubmit={confirm ? (e) => !window.confirm(confirm) && e.preventDefault() : undefined}
    >
      {children}
      <div className={inline ? "contents" : "flex flex-wrap items-center gap-3"}>
        <button type="submit" className={button} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {state.error && (
          <p className="text-sm text-red-700" role="alert">
            {state.error}
          </p>
        )}
        {state.ok && state.message && (
          <p className="text-sm text-brand-700" role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

/** Labeled field wrapper. */
export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}
