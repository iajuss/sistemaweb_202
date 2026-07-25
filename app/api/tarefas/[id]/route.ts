import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { montarRespostaTarefa, type StatusTarefa } from "@/lib/tarefas";

const VENCIMENTO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_VALIDOS: StatusTarefa[] = ["Pendente", "Concluída"];

type TarefaPatchPayload = {
  status?: string;
  vencimento?: string;
};

// PATCH /api/tarefas/:id — usado para marcar uma tarefa como concluída ou
// reagendar manualmente (inclusive quando o vencimento coincide com um
// feriado: o sistema só alerta, quem decide mover a data é o usuário via
// este PATCH). `concluido_em` é setado quando `status` vira "Concluída" e
// limpo quando volta para "Pendente". RLS garante que só é possível
// atualizar tarefas do próprio escritório; id inexistente ou bloqueado por
// RLS responde 404 (não 403, mesmo padrão de `PATCH /api/empresas/:id`).
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

  if ("status" in payload) {
    const status = payload.status;
    if (!status || !STATUS_VALIDOS.includes(status as StatusTarefa)) {
      return applySetCookies(
        Response.json({ error: 'Status deve ser "Pendente" ou "Concluída" ("Atrasada" é sempre calculado).' }, { status: 400 }),
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
