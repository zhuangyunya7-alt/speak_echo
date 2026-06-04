import Link from "next/link";
import { loginAction } from "@/app/auth/actions";
import { IcpBeianLink } from "@/components/IcpBeianLink";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : "";
  const next = typeof sp.next === "string" ? sp.next : "/";

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">登录</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">登录后可使用交互播放器、点词查词与闪卡功能。</p>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <form action={loginAction} className="mt-6 space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <input type="hidden" name="next" value={next} />
        <Input name="phone" type="tel" label="手机号" placeholder="例如：13800000000" required />
        <Input name="password" type="password" label="密码" placeholder="••••••••" required />
        <Button type="submit" className="w-full">
          继续
        </Button>
      </form>

      <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
        还没有账户？{" "}
        <Link className="font-medium text-[#602D89] hover:underline" href="/auth/activate">
          立即注册
        </Link>
      </div>

      <IcpBeianLink className="mt-16 pb-2" />
    </div>
  );
}

