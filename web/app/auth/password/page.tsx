"use client";

import { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function PasswordPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [current, setCurrent] = useState("");
  const [next1, setNext1] = useState("");
  const [next2, setNext2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setMsg(null);
    if (!supabase) {
      setMsg("未配置 Supabase。");
      return;
    }
    if (!next1 || next1.length < 8) {
      setMsg("新密码至少 8 位。");
      return;
    }
    if (next1 !== next2) {
      setMsg("两次输入的新密码不一致。");
      return;
    }

    setLoading(true);
    try {
      let email = "";
      try {
        const { data: sess, error: sessErr } = await supabase.auth.getSession();
        if (sessErr) {
          setMsg("网络异常，暂时无法获取登录状态。请稍后重试。");
          return;
        }
        email = sess.session?.user?.email ?? "";
      } catch {
        setMsg("网络异常，暂时无法获取登录状态。请稍后重试。");
        return;
      }
      if (!email) {
        setMsg("请先登录。");
        return;
      }

      // Re-authenticate with current password (best-effort).
      let re;
      try {
        re = await supabase.auth.signInWithPassword({ email, password: current });
      } catch {
        setMsg("网络异常，当前无法校验密码。");
        return;
      }
      if (re.error) {
        setMsg("当前密码不正确。");
        return;
      }

      let up;
      try {
        up = await supabase.auth.updateUser({ password: next1 });
      } catch {
        setMsg("网络异常，暂时无法更新密码。");
        return;
      }
      if (up.error) {
        setMsg(up.error.message);
        return;
      }
      setMsg("密码已更新。");
      setCurrent("");
      setNext1("");
      setNext2("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">更改密码</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">修改成功后，下次登录请使用新密码。</p>
      </div>

      {msg ? (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
          {msg}
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 dark:border-zinc-800 dark:bg-zinc-950">
        <Input label="当前密码" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Input label="新密码" type="password" value={next1} onChange={(e) => setNext1(e.target.value)} />
        <Input label="确认新密码" type="password" value={next2} onChange={(e) => setNext2(e.target.value)} />
        <Button type="button" className="w-full" onClick={submit} disabled={loading}>
          {loading ? "提交中…" : "更新密码"}
        </Button>
      </div>
    </div>
  );
}

