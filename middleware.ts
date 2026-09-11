import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "autom_session";

const PUBLIC_PATHS = ["/login", "/api/auth", "/api/health"];

// These check their own secret: the scheduled jobs require the CRON_SECRET
// bearer, the Mixmax webhook its signing secret. /api/cron/trigger is NOT here —
// it is the dashboard's manual button and relies on the session.
const SELF_AUTHENTICATED_PATHS = ["/api/cron", "/api/cron/digest"];
const SELF_AUTHENTICATED_PREFIXES = ["/api/webhooks/"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (SELF_AUTHENTICATED_PATHS.includes(pathname)) return true;
  return SELF_AUTHENTICATED_PREFIXES.some((p) => pathname.startsWith(p));
}

function hasSession(request: NextRequest): boolean {
  const session = request.cookies.get(SESSION_COOKIE);
  return !!process.env.DASHBOARD_PASSWORD && session?.value === process.env.DASHBOARD_PASSWORD;
}

// Lets server-side scripts on the droplet (backfills, ops checks) call the API
// with the same bearer the scheduled jobs use, without a browser session.
function hasCronBearer(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname) || hasSession(request)) {
    return NextResponse.next();
  }

  // The API holds lead data including agents' personal emails and phone
  // numbers, so it answers 401 rather than redirecting to the login page.
  if (pathname.startsWith("/api/")) {
    if (hasCronBearer(request)) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
