import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import {
  buscarModeloRecorrenciaCompletoPorId,
  paraShapeFrontend,
  faixaDiaReferencia,
  type Periodicidade,
} from "@/lib/modelos-recorrencia";

const PERIODICIDADES_VALIDAS: Periodicidade[] = ["mensal", "semanal", "anual"];

type ModeloRecorrenciaPatchPayload = {
  titulo?: string;
  tipo?: string;
  periodicidade?: string;
  diaReferencia?: number;
  empresaId?: string | null;
  responsavelId?: string | null;
  ativo?: boolean;
};

// Nota: `escritorioId` deliberadamente NÃO está na lista de campos
// editáveis — reatribuir o modelo a outro escritório (tenant) nunca é uma
// operação válida via PATCH, mesmo padrão de `app/api/empresas/[id]/route.ts`.
const CAMPOS_EDITAVEIS: { chave: keyof ModeloRecorrenciaPatchPayload; coluna: string }[] = [
  { chave: "titulo", coluna: "titulo" },
  { chave: "tipo", coluna: "tipo" },
  { chave: "periodicidade", coluna: "periodicidade" },
  { chave: "diaReferencia", coluna: "dia_referencia" },
  { chave: "empresaId", coluna: "empresa_id" },
  { chave: "responsavelId", coluna: "responsavel_id" },
  { chave: "ativo", coluna: "ativo" },
];

// PATCH /api/modelos-recorrencia/:id — atualização parcial, usada
// principalmente para `{ ativo: false }` (desativar um modelo sem excluir:
// tarefas já geradas continuam existindo, ver `tarefas.modelo_id` com
// `onDelete: "set null"`). RLS garante que só é possível atualizar modelos
// do próprio escritório; id inexistente ou bloqueado por RLS responde 404
// (não 403, mesmo padrão de `PATCH /api/empresas/:id`).
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  let payload: ModeloRecorrenciaPatchPayload;
  try {
    payload = (await request.json()) as ModeloRecorrenciaPatchPayload;
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  if ("periodicidade" in payload) {
    const periodicidade = payload.periodicidade;
    if (!periodicidade || !PERIODICIDADES_VALIDAS.includes(periodicidade as Periodicidade)) {
      return applySetCookies(
        Response.json({ error: 'Periodicidade deve ser "mensal", "semanal" ou "anual".' }, { status: 400 }),
      );
    }
  }

  if ("diaReferencia" in payload) {
    const diaReferencia = payload.diaReferencia;
    if (typeof diaReferencia !== "number" || !Number.isInteger(diaReferencia)) {
      return applySetCookies(Response.json({ error: "Dia de referência inválido." }, { status: 400 }));
    }
  }

  // Se periodicidade e/ou diaReferencia estão sendo alterados, valida a
  // combinação efetiva (o valor novo, quando enviado; o valor atual do
  // banco, caso contrário) contra a faixa plausível — evita, por exemplo,
  // que só a periodicidade mude para "semanal" enquanto o diaReferencia
  // salvo continua em 31.
  if ("periodicidade" in payload || "diaReferencia" in payload) {
    const { data: modeloAtual, error: buscarError } = await supabase
      .from("modelos_recorrencia")
      .select("periodicidade, dia_referencia")
      .eq("id", id)
      .maybeSingle();

    if (buscarError) {
      return applySetCookies(
        Response.json({ error: "Não foi possível carregar o modelo de recorrência." }, { status: 500 }),
      );
    }

    if (!modeloAtual) {
      return applySetCookies(Response.json({ error: "Modelo de recorrência não encontrado." }, { status: 404 }));
    }

    const atual = modeloAtual as { periodicidade: string; dia_referencia: number };
    const periodicidadeEfetiva = payload.periodicidade ?? atual.periodicidade;
    const diaEfetivo = payload.diaReferencia ?? atual.dia_referencia;
    const maxDia = faixaDiaReferencia(periodicidadeEfetiva);

    if (diaEfetivo < 1 || diaEfetivo > maxDia) {
      return applySetCookies(
        Response.json(
          {
            error: `Dia de referência deve estar entre 1 e ${maxDia} para periodicidade "${periodicidadeEfetiva}".`,
          },
          { status: 400 },
        ),
      );
    }
  }

  const updates: Record<string, unknown> = {};
  for (const { chave, coluna } of CAMPOS_EDITAVEIS) {
    if (chave in payload) {
      updates[coluna] = payload[chave];
    }
  }

  const { data: modeloAtualizado, error: updateError } = await supabase
    .from("modelos_recorrencia")
    .update(updates)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return applySetCookies(
      Response.json({ error: "Não foi possível atualizar o modelo de recorrência." }, { status: 500 }),
    );
  }

  if (!modeloAtualizado) {
    return applySetCookies(Response.json({ error: "Modelo de recorrência não encontrado." }, { status: 404 }));
  }

  const modeloCompleto = await buscarModeloRecorrenciaCompletoPorId(supabase, id);

  if (!modeloCompleto) {
    return applySetCookies(Response.json({ error: "Modelo de recorrência não encontrado." }, { status: 404 }));
  }

  return applySetCookies(Response.json(paraShapeFrontend(modeloCompleto)));
}

// DELETE /api/modelos-recorrencia/:id — exclui um modelo de recorrência.
// Antes de excluir, marca como "Cancelada" (ver `StatusTarefa` em
// lib/tarefas.ts) todas as tarefas geradas por este modelo — sem isso,
// `tarefas.modelo_id` (FK com `on delete set null`) só desvincularia essas
// tarefas do modelo excluído, e elas continuariam aparecendo no calendário
// como se fossem avulsas. RLS garante que só é possível excluir modelos do
// próprio escritório; id inexistente ou bloqueado por RLS responde 404
// (mesmo padrão do PATCH acima).
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  const { error: cancelarTarefasError } = await supabase
    .from("tarefas")
    .update({ status: "Cancelada", concluido_em: null })
    .eq("modelo_id", id);

  if (cancelarTarefasError) {
    return applySetCookies(
      Response.json({ error: "Não foi possível cancelar as tarefas geradas por este modelo." }, { status: 500 }),
    );
  }

  const { data: modeloExcluido, error: deleteError } = await supabase
    .from("modelos_recorrencia")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    return applySetCookies(
      Response.json({ error: "Não foi possível excluir o modelo de recorrência." }, { status: 500 }),
    );
  }

  if (!modeloExcluido) {
    return applySetCookies(Response.json({ error: "Modelo de recorrência não encontrado." }, { status: 404 }));
  }

  return applySetCookies(Response.json({ ok: true }));
}
