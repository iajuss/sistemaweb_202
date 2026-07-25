import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function POST() {
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  await supabase.auth.signOut();
  return applySetCookies(Response.json({ ok: true }));
}
