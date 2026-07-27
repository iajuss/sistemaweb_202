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

  let { data: escritorio, error } = await supabase
    .from("escritorios")
    .select("nome, logo_path, exibir_nome_na_lateral, exibir_nome_no_header")
    .eq("id", perfil.escritorio_id)
    .single();

  // Mantém o restante da aplicação disponível até a migração 0024 ser
  // aplicada em instalações já existentes.
  if (error?.code === "42703") {
    const fallback = await supabase.from("escritorios").select("nome, logo_path").eq("id", perfil.escritorio_id).single();
    escritorio = fallback.data as typeof escritorio;
    error = fallback.error;
  }

  if (error || !escritorio) {
    return Response.json({ error: "Não foi possível carregar o escritório." }, { status: 500 });
  }

  const logoUrl = escritorio.logo_path
    ? supabase.storage.from("logos-clientes").getPublicUrl(escritorio.logo_path).data.publicUrl
    : null;
  const exibicao = escritorio as typeof escritorio & { exibir_nome_na_lateral?: boolean; exibir_nome_no_header?: boolean };
  const preferenciasDisponiveis = "exibir_nome_na_lateral" in exibicao && "exibir_nome_no_header" in exibicao;
  return Response.json({ nome: escritorio.nome, logoUrl, exibirNomeNaLateral: exibicao.exibir_nome_na_lateral ?? true, exibirNomeNoHeader: exibicao.exibir_nome_no_header ?? false, preferenciasDisponiveis });
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

  let payload: { nome?: string; exibirNomeNaLateral?: boolean; exibirNomeNoHeader?: boolean };
  try {
    payload = (await request.json()) as { nome?: string; exibirNomeNaLateral?: boolean; exibirNomeNoHeader?: boolean };
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  const nome = payload.nome?.trim() ?? "";
  if (!nome) {
    return applySetCookies(Response.json({ error: "Informe o nome do escritório." }, { status: 400 }));
  }

  const preferenciasForamEnviadas = "exibirNomeNaLateral" in payload || "exibirNomeNoHeader" in payload;
  if (preferenciasForamEnviadas && (typeof payload.exibirNomeNaLateral !== "boolean" || typeof payload.exibirNomeNoHeader !== "boolean")) {
    return applySetCookies(Response.json({ error: "As opções de exibição são inválidas." }, { status: 400 }));
  }

  const erroTamanho = validarCampos([["Nome do escritório", nome, LIMITES.nome]]);
  if (erroTamanho) {
    return applySetCookies(Response.json({ error: erroTamanho }, { status: 400 }));
  }

  const { data: perfil } = await supabase.from("perfis").select("escritorio_id, papel").eq("id", user.id).single();

  if (!perfil || perfil.papel !== "responsavel") {
    return applySetCookies(Response.json({ error: "Só o responsável pelo escritório pode renomeá-lo." }, { status: 403 }));
  }

  const updates: Record<string, unknown> = { nome };
  if (preferenciasForamEnviadas) {
    updates.exibir_nome_na_lateral = payload.exibirNomeNaLateral;
    updates.exibir_nome_no_header = payload.exibirNomeNoHeader;
  }

  const baseUpdate = supabase.from("escritorios").update(updates).eq("id", perfil.escritorio_id);
  const { data: escritorioAtualizado, error } = preferenciasForamEnviadas
    ? await baseUpdate.select("nome, exibir_nome_na_lateral, exibir_nome_no_header").single()
    : await baseUpdate.select("nome").single<{ nome: string; exibir_nome_na_lateral?: boolean; exibir_nome_no_header?: boolean }>();

  if (error || !escritorioAtualizado) {
    if (error?.code === "42501") {
      return applySetCookies(Response.json({ error: "O banco ainda não liberou a alteração do escritório. Execute a migração 0023 no Supabase." }, { status: 503 }));
    }
    if (error?.code === "42703") {
      return applySetCookies(Response.json({ error: "A personalização da exibição precisa da migração 0024 no Supabase." }, { status: 503 }));
    }
    return applySetCookies(Response.json({ error: "Não foi possível atualizar o escritório." }, { status: 500 }));
  }

  return applySetCookies(Response.json({ nome: escritorioAtualizado.nome, exibirNomeNaLateral: preferenciasForamEnviadas ? escritorioAtualizado.exibir_nome_na_lateral : undefined, exibirNomeNoHeader: preferenciasForamEnviadas ? escritorioAtualizado.exibir_nome_no_header : undefined }));
}
