import Link from "next/link";

export default async function AuthErrorPage({ searchParams }: PageProps<"/auth/error">) {
  const { reason } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900">That sign-in link didn&apos;t work</h1>
      <p className="text-slate-600">
        {reason === "link"
          ? "Magic links expire after an hour and can only be used once."
          : "We couldn't complete sign-in."}{" "}
        Please request a new link.
      </p>
      <Link href="/login" className="btn-primary w-fit">
        Back to sign in
      </Link>
    </main>
  );
}
