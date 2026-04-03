import { createBrowserClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

let browserClient: ReturnType<typeof createBrowserClient> | null | undefined;

export function createSupabaseBrowserClient() {
  if (browserClient !== undefined) return browserClient;
  const env = getPublicEnv();
  if (!env.configured || !env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    browserClient = null;
    return null;
  }

  browserClient = createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return browserClient;
}

/**
 * Best-effort current user on the client.
 * Prefer getSession() so we read cookie/storage without hitting /auth/v1/user.
 * That avoids `Failed to fetch` + auth-js `console.error` (and Next dev overlay noise)
 * when the network cannot reach Supabase but a valid local session still exists.
 * Server routes should still use getUser() for verified identity.
 */
export async function safeGetBrowserUser(): Promise<User | null> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.user ?? null;
  } catch {
    return null;
  }
}

