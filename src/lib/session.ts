/**
 * The signed-in user for the current request, and the guards every page and server action uses.
 *
 * The session cookie holds a random token (httpOnly, so page scripts can't read it); the database
 * holds only its hash. The account is re-checked on every request, so deactivation is immediate.
 */
import "server-only";

import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { createSession, endSession, isAdmin, sessionUser, type User } from "./auth";

const COOKIE = "session";

export async function currentUser(): Promise<User | null> {
  return sessionUser((await cookies()).get(COOKIE)?.value);
}

/** The signed-in user, or a redirect to sign in (coming back to `next` afterwards). */
export async function requireUser(next?: string): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}

/**
 * The signed-in admin. Founders get a 404 rather than a hint that the page exists. Every
 * admin-only page and server action calls this itself: hiding links is not access control.
 */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!isAdmin(user)) notFound();
  return user;
}

export async function startSession(userId: number): Promise<void> {
  const { token, expires } = await createSession(userId);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function finishSession(): Promise<void> {
  const store = await cookies();
  await endSession(store.get(COOKIE)?.value);
  store.delete(COOKIE);
}

/** Only allow redirects to paths on this site (not "//evil.example" or "https://..."). */
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

/** Absolute URL on this deployment, for links people send to others (invites, requests). */
export async function appUrl(path: string): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "") + path;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${path}`;
}
