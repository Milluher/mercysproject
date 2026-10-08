import { NextResponse, type NextRequest } from "next/server";

/**
 * Pass the requested path and query to the pages, so the sign-in screen can send people back
 * to the link they opened (e.g. a request form) after signing in. Access control itself lives
 * in the pages and server actions, not here.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  const response = NextResponse.next({ request: { headers } });
  // Basic hardening: no framing (clickjacking), no MIME sniffing, no referrer leaking invite tokens.
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
