import { headers } from "next/headers";

import { signOut } from "@/app/actions";
import { Nav } from "@/components/nav";
import { isAdmin } from "@/lib/auth";
import { requireUser } from "@/lib/session";

/** Everything inside (app) needs a signed-in user; each role gets only its own links. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const user = await requireUser(h.get("x-pathname") ?? undefined);

  const links = isAdmin(user)
    ? [
        { href: "/", label: "Overview", icon: "📊" },
        { href: "/company", label: "Company detail", icon: "📈" },
        { href: "/requests", label: "Update requests", icon: "📨" },
        { href: "/submit", label: "Submit update", icon: "📝" },
        { href: "/people", label: "People", icon: "🔑" },
        { href: "/account", label: "Account", icon: "👤" },
      ]
    : [
        { href: "/submit", label: "Submit update", icon: "📝" },
        { href: `/company/${user.companyId}`, label: "My company", icon: "📈" },
        { href: "/account", label: "Account", icon: "👤" },
      ];

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col md:flex-row">
      <aside className="border-b border-line bg-plane p-4 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <p className="mb-4 hidden px-3 text-sm font-semibold md:block">Portfolio KPIs</p>
        <Nav links={links} />
        <div className="mt-6 hidden border-t border-line px-3 pt-4 md:block">
          <p className="caption">
            Signed in as <strong className="text-ink-2">{user.name}</strong>
            {isAdmin(user) ? "" : " · founder"}
          </p>
          <form action={signOut} className="mt-3">
            <button className="btn">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 md:py-10">{children}</main>
    </div>
  );
}
