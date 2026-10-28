import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, safeNextPath } from "@/lib/auth";
import { brand } from "@/config/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(typeof rawNext === "string" ? rawNext : null);
  if (await getCurrentUser()) redirect(next);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-8 text-sm font-semibold text-brand-700">
        ← {brand.name}
      </Link>
      <h1 className="h-section">Sign in</h1>
      <p className="mt-4 mb-8 text-stone-600">New here? Signing in creates your family account. No password needed.</p>
      <LoginForm next={next} />
      <p className="mt-8 text-xs text-stone-500">
        By continuing, you agree to our{" "}
        <Link href="/terms" className="underline">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
        .
      </p>
    </main>
  );
}
