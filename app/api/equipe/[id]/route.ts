import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  let payload: { ativo?: unknown };
  try {
    payload = (await request.json()) as { ativo?: unknown };
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  if (typeof payload.ativo !== "boolean") {
    return applySetCookies(Response.json({ error: "Informe ativo como verdadeiro ou falso." }, { status: 400 }));
  }
  const ativo = payload.ativo;

  const { data: meuPerfil } = await supabase.from("perfis").select("escritorio_id, papel").eq("id", user.id).single();

  if (!meuPerfil || meuPerfil.papel !== "responsavel") {
    return applySetCookies(Response.json({ error: "Só o responsável pelo escritório pode gerenciar a equipe." }, { status: 403 }));
  }

  const { data: alvo } = await supabase
    .from("perfis")
    .select("escritorio_id, papel")
    .eq("id", id)
    .single();

  if (!alvo || alvo.escritorio_id !== meuPerfil.escritorio_id || alvo.papel !== "funcionario") {
    return applySetCookies(Response.json({ error: "Funcionário não encontrado." }, { status: 404 }));
  }

  const { error: erroUpdate } = await supabase.from("perfis").update({ ativo }).eq("id", id);

  if (erroUpdate) {
    return applySetCookies(Response.json({ error: "Não foi possível atualizar o funcionário." }, { status: 500 }));
  }

  const admin = createSupabaseAdminClient();
  const { error: erroBan } = await admin.auth.admin.updateUserById(id, {
    ban_duration: ativo ? "none" : "876000h",
  });

  if (erroBan) {
    // Reverte o ativo já gravado, pra não ficar num estado inconsistente
    // (perfil dizendo ativo mas login ainda banido, ou vice-versa).
    await supabase.from("perfis").update({ ativo: !ativo }).eq("id", id);
    return applySetCookies(Response.json({ error: "Não foi possível atualizar o acesso de login." }, { status: 500 }));
  }

  return applySetCookies(Response.json({ ok: true }));
}
