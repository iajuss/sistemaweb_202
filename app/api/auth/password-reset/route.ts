import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let payload: { email?: string };

  try {
    payload = (await request.json()) as { email?: string };
  } catch {
    return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
  }

  const email = payload.email?.trim();
  if (!email) {
    return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
  }

  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL("/auth/callback?next=/redefinir-senha", request.url).toString(),
  });

  return applySetCookies(Response.json({ message: "Se este e-mail estiver cadastrado, você receberá um link para redefinir a senha." }));
}
