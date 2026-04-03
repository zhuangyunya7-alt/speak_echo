import Link from "next/link";
import { verifyActivationCodeAction } from "@/app/auth/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : "";
  const next = typeof sp.next === "string" ? sp.next : "/";

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-3xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#602D89] text-white">
          <div className="text-lg font-semibold">SE</div>
        </div>

        <h1 className="mt-4 text-center text-2xl font-semibold tracking-tight">账号激活</h1>
        <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
          专为油管英语口语设计的学习网站
        </p>

        <div className="mt-6 flex items-center justify-center gap-4 text-sm">
          <div className="flex items-center gap-2 text-[#602D89]">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#602D89]">
              1
            </span>
            <span className="font-medium">验证激活码</span>
          </div>
          <div className="h-px w-12 bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-zinc-300 dark:border-zinc-700">
              2
            </span>
            <span className="font-medium">创建账户</span>
          </div>
        </div>

        {error ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <form action={verifyActivationCodeAction} className="mt-6 space-y-4">
          <input type="hidden" name="next" value={next} />
          <Input name="activationCode" label="" placeholder="请输入激活码" required />
          <Button type="submit" className="w-full">
            验证激活码
          </Button>
        </form>

        <div className="mt-6 border-t border-zinc-200 pt-4 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          已有账户？{" "}
          <Link className="font-medium text-[#602D89] hover:underline" href="/auth/login">
            立即登录
          </Link>
          <div className="mt-3 text-xs">
            没有激活码，请联系微信号：<span className="font-medium text-[#602D89]">speakecho</span>
          </div>
        </div>
      </div>
    </div>
  );
}

