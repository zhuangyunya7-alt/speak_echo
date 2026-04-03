import { createSupabaseServerClient } from "@/lib/supabase/server";

function normalizePhone(input: string) {
  return input.replace(/\s+/g, "").replace(/[^\d+]/g, "");
}

export async function isAdminUser(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return false;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase.from("users").select("phone").eq("id", user.id).maybeSingle();
  const phone = normalizePhone(String(data?.phone ?? ""));
  if (!phone) return false;

  // Prefer Supabase-backed admin list (public.admins). Fallback to env if table not present.
  const adminsRes = await supabase.from("admins").select("phone").eq("phone", phone).maybeSingle();
  if (!adminsRes.error && adminsRes.data?.phone) return true;

  const envList = (process.env.SPEAKECHO_ADMIN_PHONES ?? "")
    .split(",")
    .map((s) => normalizePhone(s))
    .filter(Boolean);
  return envList.includes(phone);
}

