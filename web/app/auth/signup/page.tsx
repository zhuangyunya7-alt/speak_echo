import Link from "next/link";
import { signupAction } from "@/app/auth/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : "";
  const code = typeof sp.code === "string" ? sp.code : "";
  const next = typeof sp.next === "string" ? sp.next : "/";

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">注册账号</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        第 2 步：创建账户。
      </p>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <form
        action={signupAction}
        className="mt-6 space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <input type="hidden" name="activationCode" value={code} />
        <input type="hidden" name="next" value={next} />
        <Input name="activationCodeDisplay" label="激活码" value={code || "（请先验证激活码）"} disabled />
        <Input name="phone" type="tel" label="手机号" placeholder="例如：13800000000" required disabled={!code} />
        <Input
          name="password"
          type="password"
          label="密码"
          placeholder="至少 8 位字符"
          required
          minLength={8}
          disabled={!code}
        />
        <Input
          name="passwordConfirm"
          type="password"
          label="确认密码"
          placeholder="请再次输入密码"
          required
          minLength={8}
          disabled={!code}
        />
        <Button type="submit" className="w-full">
          创建
        </Button>
      </form>

      <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
        已有账号？{" "}
        <Link className="font-medium text-zinc-900 hover:underline dark:text-zinc-100" href="/auth/login">
          去登录
        </Link>
      </div>

      {!code ? (
        <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          还没验证激活码？{" "}
          <Link className="font-medium text-[#602D89] hover:underline" href={`/auth/activate?next=${encodeURIComponent(next)}`}>
            去验证
          </Link>
        </div>
      ) : null}
    </div>
  );
}

