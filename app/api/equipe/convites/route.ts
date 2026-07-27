import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validarEmailConvite } from "@/lib/equipe";

export async function POST(request: Request) {
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  let payload: { email?: string };
  try {
    payload = (await request.json()) as { email?: string };
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  const erroEmail = validarEmailConvite(payload.email);
  if (erroEmail) {
    return applySetCookies(Response.json({ error: erroEmail }, { status: 400 }));
  }
  const email = (payload.email as string).trim();

  const { data: perfil } = await supabase
    .from("perfis")
    .select("escritorio_id, papel")
    .eq("id", user.id)
    .single();

  if (!perfil || perfil.papel !== "responsavel") {
    return applySetCookies(Response.json({ error: "Só o responsável pelo escritório pode convidar." }, { status: 403 }));
  }

  const { data: jaMembro } = await supabase
    .from("perfis")
    .select("id")
    .eq("escritorio_id", perfil.escritorio_id)
    .eq("email", email)
    .maybeSingle();

  if (jaMembro) {
    return applySetCookies(Response.json({ error: "Este e-mail já faz parte da equipe." }, { status: 409 }));
  }

  const { data: escritorio } = await supabase
    .from("escritorios")
    .select("nome")
    .eq("id", perfil.escritorio_id)
    .single();

  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { escritorio_id: perfil.escritorio_id, escritorio_nome: escritorio?.nome ?? "" },
  });

  if (error) {
    const jaExisteEmOutroEscritorio = error.message.toLowerCase().includes("already");
    return applySetCookies(
      Response.json(
        { error: jaExisteEmOutroEscritorio ? "Este e-mail já está cadastrado no sistema." : "Não foi possível enviar o convite." },
        { status: 400 },
      ),
    );
  }

  return applySetCookies(Response.json({ ok: true }, { status: 201 }));
}
