import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let payload: { email?: string; senha?: string };

  try {
    payload = (await request.json()) as { email?: string; senha?: string };
  } catch {
    return Response.json({ error: "Informe e-mail e senha." }, { status: 400 });
  }

  const email = payload.email?.trim() ?? "";
  const senha = payload.senha ?? "";

  if (!email || !senha) {
    return Response.json({ error: "Informe e-mail e senha." }, { status: 400 });
  }

  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

  if (error) {
    return applySetCookies(Response.json({ error: "E-mail ou senha inválidos." }, { status: 401 }));
  }

  return applySetCookies(Response.json({ ok: true }));
}
