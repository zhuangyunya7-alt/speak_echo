import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/env";

/** Exact paths that require login + activation (do not use "/" in prefix lists — would match everything). */
const PROTECTED_EXACT = ["/"];
const PROTECTED_PREFIXES = ["/v/", "/flashcards", "/record"];
/** Logged-in users skip these (go home); exclude `/auth/activate` so inactive users can submit a code. */
const AUTH_SKIP_WHEN_LOGGED_IN = ["/auth/login", "/auth/signup"];
const ADMIN_PREFIXES = ["/admin"];

function needsAppGate(pathname: string) {
  if (PROTECTED_EXACT.includes(pathname)) return true;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function isAdminPath(pathname: string) {
  return ADMIN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const env = getPublicEnv();
  if (!env.configured || !env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next();
  }

  const response = NextResponse.next({ request });

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  let user: { id: string } | null = null;
  try {
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();
    user = currentUser ? { id: currentUser.id } : null;
  } catch {
    // If auth endpoint is temporarily unreachable, treat as anonymous request.
    user = null;
  }

  const pathname = request.nextUrl.pathname;

  if (user && AUTH_SKIP_WHEN_LOGGED_IN.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  if (!user && needsAppGate(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isAdminPath(pathname)) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    // Do NOT hard-redirect non-admin users.
    // The admin pages and APIs will enforce authorization and can show "无权限访问".
  }

  // Activation wall: logged-in but inactive users cannot access core pages.
  if (user && needsAppGate(pathname)) {
    try {
      const { data, error } = await supabase.from("users").select("active_until").eq("id", user.id).maybeSingle();
      const until = data?.active_until ? new Date(data.active_until).getTime() : 0;
      const active = !error && until > Date.now();
      if (!active) {
        const url = request.nextUrl.clone();
        url.pathname = "/auth/activate";
        url.searchParams.set("next", pathname);
        return NextResponse.redirect(url);
      }
    } catch {
      // Skip activation wall when backend is unreachable to avoid hard-failing requests.
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};

