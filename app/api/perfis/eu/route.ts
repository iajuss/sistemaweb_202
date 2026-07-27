import { createSupabaseRouteHandlerClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { LIMITES, validarCampos } from "@/lib/validacao";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { data: perfil } = await supabase.from("perfis").select("papel, nome").eq("id", user.id).single();

  return Response.json({ papel: perfil?.papel ?? "responsavel", nome: perfil?.nome ?? user.user_metadata?.nome ?? "Usuário" });
}

export async function PATCH(request: Request) {
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));

  let payload: { nome?: string };
  try {
    payload = (await request.json()) as { nome?: string };
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  const nome = payload.nome?.trim() ?? "";
  if (!nome) return applySetCookies(Response.json({ error: "Informe o seu nome." }, { status: 400 }));
  const erro = validarCampos([["Nome", nome, LIMITES.nome]]);
  if (erro) return applySetCookies(Response.json({ error: erro }, { status: 400 }));

  const { error } = await supabase.from("perfis").update({ nome }).eq("id", user.id);
  if (error) return applySetCookies(Response.json({ error: "Não foi possível atualizar o seu nome." }, { status: 500 }));

  await supabase.auth.updateUser({ data: { nome } });
  return applySetCookies(Response.json({ nome }));
}
