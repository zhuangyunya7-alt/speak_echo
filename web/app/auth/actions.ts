"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function asString(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v : "";
}

function normalizePhone(input: string) {
  return input.replace(/\s+/g, "").replace(/[^\d+]/g, "");
}

function phoneToAuthEmail(phone: string) {
  // Use Email/Password auth internally; treat phone as username.
  // This avoids SMS/OTP while keeping a stable unique identifier.
  return `${phone}@speakecho.local`;
}

export async function loginAction(formData: FormData) {
  const phone = normalizePhone(asString(formData.get("phone")).trim());
  const password = asString(formData.get("password"));
  const next = asString(formData.get("next")) || "/";

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect(`/auth/login?error=${encodeURIComponent("未配置 Supabase 环境变量")}&next=${encodeURIComponent(next)}`);

  if (!phone) redirect(`/auth/login?error=${encodeURIComponent("请输入手机号")}&next=${encodeURIComponent(next)}`);

  const email = phoneToAuthEmail(phone);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/auth/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`);
  }

  redirect(next);
}

export async function verifyActivationCodeAction(formData: FormData) {
  const activationCode = asString(formData.get("activationCode")).trim();
  const next = asString(formData.get("next")) || "/";

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect(`/auth/activate?error=${encodeURIComponent("未配置 Supabase 环境变量")}&next=${encodeURIComponent(next)}`);
  }

  if (!activationCode) {
    redirect(`/auth/activate?error=${encodeURIComponent("请输入激活码")}&next=${encodeURIComponent(next)}`);
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    redirect(
      `/auth/activate?error=${encodeURIComponent("服务端未配置：缺少 SUPABASE_SERVICE_ROLE_KEY")}&next=${encodeURIComponent(next)}`,
    );
  }

  const { data: codeRow, error: codeErr } = await admin
    .from("activation_codes")
    .select("code,is_used,expire_days")
    .eq("code", activationCode)
    .eq("is_used", false)
    .maybeSingle();

  if (codeErr || !codeRow) {
    redirect(`/auth/activate?error=${encodeURIComponent("激活码无效或已被使用")}&next=${encodeURIComponent(next)}`);
  }

  redirect(`/auth/signup?code=${encodeURIComponent(activationCode)}&next=${encodeURIComponent(next)}`);
}

export async function signupAction(formData: FormData) {
  const phone = normalizePhone(asString(formData.get("phone")).trim());
  const password = asString(formData.get("password"));
  const passwordConfirm = asString(formData.get("passwordConfirm"));
  const activationCode = asString(formData.get("activationCode")).trim();
  const next = asString(formData.get("next")) || "/";

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect(`/auth/signup?error=${encodeURIComponent("未配置 Supabase 环境变量")}&code=${encodeURIComponent(activationCode)}&next=${encodeURIComponent(next)}`);

  const admin = createSupabaseAdminClient();
  if (!admin)
    redirect(
      `/auth/signup?error=${encodeURIComponent("服务端未配置：缺少 SUPABASE_SERVICE_ROLE_KEY")}&code=${encodeURIComponent(activationCode)}&next=${encodeURIComponent(next)}`,
    );

  if (!activationCode) {
    redirect(`/auth/activate?error=${encodeURIComponent("请先验证激活码")}&next=${encodeURIComponent(next)}`);
  }
  if (!phone) {
    redirect(`/auth/signup?error=${encodeURIComponent("请输入手机号")}&code=${encodeURIComponent(activationCode)}&next=${encodeURIComponent(next)}`);
  }
  if (!password || password.length < 8) {
    redirect(`/auth/signup?error=${encodeURIComponent("密码至少 8 位")}&code=${encodeURIComponent(activationCode)}&next=${encodeURIComponent(next)}`);
  }
  if (password !== passwordConfirm) {
    redirect(`/auth/signup?error=${encodeURIComponent("两次输入的密码不一致")}&code=${encodeURIComponent(activationCode)}&next=${encodeURIComponent(next)}`);
  }

  const { data: codeRow, error: codeErr } = await admin
    .from("activation_codes")
    .select("code,is_used,expire_days")
    .eq("code", activationCode)
    .eq("is_used", false)
    .maybeSingle();

  if (codeErr || !codeRow) {
    redirect(`/auth/activate?error=${encodeURIComponent("激活码无效或已被使用")}&next=${encodeURIComponent(next)}`);
  }

  // Ensure phone not already registered in our profile table.
  const existing = await admin.from("users").select("id").eq("phone", phone).maybeSingle();
  if (existing.data?.id) {
    redirect(`/auth/signup?error=${encodeURIComponent("该手机号已注册")}&code=${encodeURIComponent(activationCode)}&next=${encodeURIComponent(next)}`);
  }

  const email = phoneToAuthEmail(phone);
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) {
    redirect(
      `/auth/signup?error=${encodeURIComponent(error?.message ?? "注册失败")}&code=${encodeURIComponent(activationCode)}&next=${encodeURIComponent(next)}`,
    );
  }

  const days = typeof codeRow.expire_days === "number" && codeRow.expire_days > 0 ? codeRow.expire_days : 365;
  const activeUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { error: useErr } = await admin
    .from("activation_codes")
    .update({ is_used: true, used_by: data.user.id, used_at: new Date().toISOString() })
    .eq("code", activationCode)
    .eq("is_used", false);

  const { error: userErr } = await admin
    .from("users")
    .upsert({ id: data.user.id, email: data.user.email ?? null, phone, active_until: activeUntil }, { onConflict: "id" });

  if (useErr) {
    // Don't block signup; user can still log in. Keep error visible.
    redirect(`/auth/login?error=${encodeURIComponent("账号已创建，但激活码状态更新失败，请联系管理员。")}`);
  }
  if (userErr) {
    redirect(`/auth/login?error=${encodeURIComponent("账号已创建，但激活状态更新失败，请联系管理员。")}`);
  }

  redirect(next);
}

export async function redeemActivationCodeAction(formData: FormData) {
  const activationCode = asString(formData.get("activationCode")).trim();
  const next = asString(formData.get("next")) || "/";

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect(`/auth/activate?error=${encodeURIComponent("未配置 Supabase 环境变量")}&next=${encodeURIComponent(next)}`);

  const admin = createSupabaseAdminClient();
  if (!admin) redirect(`/auth/activate?error=${encodeURIComponent("服务端未配置：缺少 SUPABASE_SERVICE_ROLE_KEY")}`);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/auth/login?next=${encodeURIComponent("/auth/activate")}`);

  const { data: codeRow, error: codeErr } = await admin
    .from("activation_codes")
    .select("code,is_used,expire_days")
    .eq("code", activationCode)
    .eq("is_used", false)
    .maybeSingle();

  if (codeErr || !codeRow) {
    redirect(`/auth/activate?error=${encodeURIComponent("激活码无效或已被使用")}`);
  }

  const days = typeof codeRow.expire_days === "number" && codeRow.expire_days > 0 ? codeRow.expire_days : 365;
  const activeUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { error: useErr } = await admin
    .from("activation_codes")
    .update({ is_used: true, used_by: user.id, used_at: new Date().toISOString() })
    .eq("code", activationCode)
    .eq("is_used", false);

  const { error: userErr } = await admin
    .from("users")
    .upsert({ id: user.id, email: user.email ?? null, active_until: activeUntil }, { onConflict: "id" });

  if (useErr || userErr) {
    redirect(`/auth/activate?error=${encodeURIComponent("激活失败，请稍后重试")}`);
  }

  redirect(next);
}

export async function logoutAction() {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/");
}

