import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { montarRespostaTarefa, type StatusTarefa } from "@/lib/tarefas";

const VENCIMENTO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_VALIDOS: StatusTarefa[] = ["Pendente", "Concluída", "Cancelada"];

type TarefaPatchPayload = {
  titulo?: string;
  tipo?: string;
  empresaId?: string | null;
  responsavelId?: string | null;
  status?: string;
  vencimento?: string;
};

// PATCH /api/tarefas/:id — usado para marcar uma tarefa como concluída,
// reagendar (inclusive quando o vencimento coincide com um feriado: o sistema
// só alerta, quem decide mover a data é o usuário) ou editar os dados da
// tarefa (título, natureza Interna/Externa, empresa e responsável).
// `concluido_em` é setado quando `status` vira "Concluída" e limpo quando
// volta para "Pendente". Uma tarefa "Interna" (reunião da própria equipe) não
// tem empresa: `empresaId: null` grava `empresa_id = NULL`. RLS garante que só
// é possível atualizar tarefas do próprio escritório; id inexistente ou
// bloqueado por RLS responde 404 (mesmo padrão de `PATCH /api/empresas/:id`).
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  let payload: TarefaPatchPayload;
  try {
    payload = (await request.json()) as TarefaPatchPayload;
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  const updates: Record<string, unknown> = {};

  if ("titulo" in payload) {
    const titulo = payload.titulo?.trim() ?? "";
    if (!titulo) {
      return applySetCookies(Response.json({ error: "O título é obrigatório." }, { status: 400 }));
    }
    updates.titulo = titulo;
  }

  if ("tipo" in payload) {
    const tipo = payload.tipo?.trim() ?? "";
    if (!tipo) {
      return applySetCookies(Response.json({ error: "O tipo é obrigatório." }, { status: 400 }));
    }
    updates.tipo = tipo;
  }

  if ("empresaId" in payload) {
    const empresaId = payload.empresaId?.trim?.() ?? payload.empresaId;
    // "" ou null → tarefa interna (sem empresa).
    updates.empresa_id = empresaId ? empresaId : null;
  }

  if ("responsavelId" in payload) {
    const responsavelId = payload.responsavelId?.trim?.() ?? payload.responsavelId;
    updates.responsavel_id = responsavelId ? responsavelId : null;
  }

  if ("status" in payload) {
    const status = payload.status;
    if (!status || !STATUS_VALIDOS.includes(status as StatusTarefa)) {
      return applySetCookies(
        Response.json({ error: 'Status deve ser "Pendente", "Concluída" ou "Cancelada" ("Atrasada" é sempre calculado).' }, { status: 400 }),
      );
    }
    updates.status = status;
    updates.concluido_em = status === "Concluída" ? new Date().toISOString() : null;
  }

  if ("vencimento" in payload) {
    const vencimento = payload.vencimento;
    if (!vencimento || !VENCIMENTO_REGEX.test(vencimento)) {
      return applySetCookies(Response.json({ error: 'Vencimento deve estar no formato "YYYY-MM-DD".' }, { status: 400 }));
    }
    updates.vencimento = vencimento;
  }

  if (Object.keys(updates).length === 0) {
    return applySetCookies(Response.json({ error: "Nenhum campo para atualizar." }, { status: 400 }));
  }

  const { data: tarefaAtualizada, error: updateError } = await supabase
    .from("tarefas")
    .update(updates)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return applySetCookies(Response.json({ error: "Não foi possível atualizar a tarefa." }, { status: 500 }));
  }

  if (!tarefaAtualizada) {
    return applySetCookies(Response.json({ error: "Tarefa não encontrada." }, { status: 404 }));
  }

  const resposta = await montarRespostaTarefa(supabase, id);

  if (!resposta) {
    return applySetCookies(Response.json({ error: "Tarefa não encontrada." }, { status: 404 }));
  }

  return applySetCookies(Response.json(resposta));
}

// DELETE /api/tarefas/:id — exclui uma tarefa avulsa ou gerada por modelo.
// RLS garante que só é possível excluir tarefas do próprio escritório; id
// inexistente ou bloqueado por RLS responde 404 (mesmo padrão do PATCH).
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  const { data: tarefaExcluida, error: deleteError } = await supabase
    .from("tarefas")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    return applySetCookies(Response.json({ error: "Não foi possível excluir a tarefa." }, { status: 500 }));
  }

  if (!tarefaExcluida) {
    return applySetCookies(Response.json({ error: "Tarefa não encontrada." }, { status: 404 }));
  }

  return applySetCookies(Response.json({ ok: true }));
}
