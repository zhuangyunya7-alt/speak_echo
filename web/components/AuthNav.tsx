import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logoutAction } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";

export async function AuthNav() {
  const supabase = await createSupabaseServerClient();
  let user = null;
  if (supabase) {
    try {
      user = (await supabase.auth.getUser()).data.user;
    } catch {
      // Network/auth service hiccups should not break global layout rendering.
      user = null;
    }
  }

  if (!user) {
    return (
      <Link className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50" href="/auth/login">
        登录
      </Link>
    );
  }

  return (
    <form action={logoutAction} className="flex items-center gap-3">
      <span className="hidden max-w-[240px] truncate text-xs text-zinc-500 dark:text-zinc-400 md:inline">
        {user.email}
      </span>
      <Link className="text-xs font-medium text-[#602D89] hover:underline" href="/auth/password">
        更改密码
      </Link>
      <Button variant="ghost" size="sm" type="submit">
        退出
      </Button>
    </form>
  );
}

