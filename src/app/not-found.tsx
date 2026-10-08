import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card max-w-md space-y-3 text-center">
        <h1 className="h2">Page not found</h1>
        <p className="text-sm text-ink-2">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <Link className="btn" href="/">
          Go to the dashboard
        </Link>
      </div>
    </main>
  );
}
