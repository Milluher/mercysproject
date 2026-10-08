/** Centred card for the screens shown before signing in. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="card w-full max-w-md space-y-5 p-8">
        <div>
          <p className="caption mb-1">Portfolio KPI dashboard</p>
          <h1 className="h1">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-ink-2">{subtitle}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}
