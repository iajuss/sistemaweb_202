import { createSupabaseRouteHandlerClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { LIMITES, validarCampos } from "@/lib/validacao";

// GET /api/escritorio — nome do escritório da sessão (qualquer perfil do
// escritório pode ler, mesmo padrão de RLS de escritorios_select_own).
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { data: perfil } = await supabase.from("perfis").select("escritorio_id").eq("id", user.id).single();

  if (!perfil) {
    return Response.json({ error: "Perfil não encontrado." }, { status: 404 });
  }

  const { data: escritorio, error } = await supabase
    .from("escritorios")
    .select("nome")
    .eq("id", perfil.escritorio_id)
    .single();

  if (error || !escritorio) {
    return Response.json({ error: "Não foi possível carregar o escritório." }, { status: 500 });
  }

  return Response.json({ nome: escritorio.nome });
}

// PATCH /api/escritorio — renomeia o escritório. Só o responsável pode
// (checado aqui na aplicação; a policy de RLS escritorios_update_own em si
// permite qualquer perfil do escritório, mesmo padrão de completar-cadastro,
// mas essa rota é usada fora do onboarding, então restringe por papel).
export async function PATCH(request: Request) {
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  let payload: { nome?: string };
  try {
    payload = (await request.json()) as { nome?: string };
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  const nome = payload.nome?.trim() ?? "";
  if (!nome) {
    return applySetCookies(Response.json({ error: "Informe o nome do escritório." }, { status: 400 }));
  }

  const erroTamanho = validarCampos([["Nome do escritório", nome, LIMITES.nome]]);
  if (erroTamanho) {
    return applySetCookies(Response.json({ error: erroTamanho }, { status: 400 }));
  }

  const { data: perfil } = await supabase.from("perfis").select("escritorio_id, papel").eq("id", user.id).single();

  if (!perfil || perfil.papel !== "responsavel") {
    return applySetCookies(Response.json({ error: "Só o responsável pelo escritório pode renomeá-lo." }, { status: 403 }));
  }

  const { data: escritorioAtualizado, error } = await supabase
    .from("escritorios")
    .update({ nome })
    .eq("id", perfil.escritorio_id)
    .select("nome")
    .single();

  if (error || !escritorioAtualizado) {
    return applySetCookies(Response.json({ error: "Não foi possível atualizar o escritório." }, { status: 500 }));
  }

  return applySetCookies(Response.json({ nome: escritorioAtualizado.nome }));
}
