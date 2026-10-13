"use client";

import { useActionState } from "react";
import { sendMagicLink, signInWithGoogle, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-5 text-sky-900" role="status">
        <p className="font-medium">Check your inbox</p>
        <p className="mt-1 text-sm">
          We sent a sign-in link to <strong>{state.email}</strong>. It expires in one hour.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="btn-secondary w-full">
          <GoogleIcon /> Continue with Google
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
        <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email" className="text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          placeholder="you@example.com"
          className="input"
        />
        {state.status === "error" && (
          <p className="text-sm text-red-600" role="alert">
            {state.message}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.8 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}
