import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import {
  buscarModeloRecorrenciaCompletoPorId,
  paraShapeFrontend,
  faixaDiaReferencia,
  substituirResponsaveisModelo,
  validarDiasSemana,
  validarMesReferencia,
  validarPeriodoRepeticao,
  type Periodicidade,
} from "@/lib/modelos-recorrencia";

const PERIODICIDADES_VALIDAS: Periodicidade[] = ["diario", "semanal", "mensal", "anual"];

type ModeloRecorrenciaPatchPayload = {
  titulo?: string;
  tipo?: string;
  periodicidade?: string;
  diaReferencia?: number;
  diasSemana?: number[];
  mesReferencia?: number;
  empresaId?: string | null;
  responsavelIds?: string[];
  repeteInicio?: string | null;
  repeteFim?: string | null;
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
  { chave: "diasSemana", coluna: "dias_semana" },
  { chave: "mesReferencia", coluna: "mes_referencia" },
  { chave: "empresaId", coluna: "empresa_id" },
  { chave: "repeteInicio", coluna: "repete_inicio" },
  { chave: "repeteFim", coluna: "repete_fim" },
  { chave: "ativo", coluna: "ativo" },
];

// Campos cuja combinação afeta a geração de tarefas (calcularVencimentosDoModelo)
// — quando qualquer um deles é alterado, a combinação *efetiva* (valor novo,
// quando enviado; valor atual do banco, caso contrário) precisa ser
// revalidada como um todo, não campo a campo isoladamente.
const CAMPOS_QUE_AFETAM_GERACAO = [
  "periodicidade", "diaReferencia", "diasSemana", "mesReferencia",
] as const;

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

  if ("diaReferencia" in payload) {
    const diaReferencia = payload.diaReferencia;
    if (typeof diaReferencia !== "number" || !Number.isInteger(diaReferencia)) {
      return applySetCookies(Response.json({ error: "Dia de referência inválido." }, { status: 400 }));
    }
  }

  if (CAMPOS_QUE_AFETAM_GERACAO.some((campo) => campo in payload)) {
    const { data: modeloAtual, error: buscarError } = await supabase
      .from("modelos_recorrencia")
      .select("periodicidade, dia_referencia, dias_semana, mes_referencia")
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

    const atual = modeloAtual as {
      periodicidade: string; dia_referencia: number; dias_semana: number[] | null; mes_referencia: number | null;
    };

    const periodicidadeEfetiva = (payload.periodicidade ?? atual.periodicidade) as Periodicidade;
    if (!PERIODICIDADES_VALIDAS.includes(periodicidadeEfetiva)) {
      return applySetCookies(
        Response.json({ error: 'Periodicidade deve ser "diario", "semanal", "mensal" ou "anual".' }, { status: 400 }),
      );
    }

    const diaEfetivo = payload.diaReferencia ?? atual.dia_referencia;
    const maxDia = faixaDiaReferencia(periodicidadeEfetiva);
    if (diaEfetivo < 1 || diaEfetivo > maxDia) {
      return applySetCookies(
        Response.json({ error: `Dia de referência deve estar entre 1 e ${maxDia}.` }, { status: 400 }),
      );
    }

    if (periodicidadeEfetiva === "semanal") {
      const diasSemanaEfetivo = "diasSemana" in payload ? payload.diasSemana : atual.dias_semana;
      const erroDias = validarDiasSemana(diasSemanaEfetivo);
      if (erroDias) {
        return applySetCookies(Response.json({ error: erroDias }, { status: 400 }));
      }
    } else if (periodicidadeEfetiva === "anual") {
      const mesEfetivo = "mesReferencia" in payload ? payload.mesReferencia : atual.mes_referencia;
      const erroMes = validarMesReferencia(mesEfetivo);
      if (erroMes) {
        return applySetCookies(Response.json({ error: erroMes }, { status: 400 }));
      }
    }
  }

  if ("repeteInicio" in payload || "repeteFim" in payload) {
    let repeteInicioEfetivo = payload.repeteInicio ?? null;
    let repeteFimEfetivo = payload.repeteFim ?? null;

    if (!("repeteInicio" in payload) || !("repeteFim" in payload)) {
      const { data: modeloAtual, error: buscarError } = await supabase
        .from("modelos_recorrencia")
        .select("repete_inicio, repete_fim")
        .eq("id", id)
        .maybeSingle();

      if (buscarError || !modeloAtual) {
        return applySetCookies(Response.json({ error: "Modelo de recorrência não encontrado." }, { status: 404 }));
      }

      const atualPeriodo = modeloAtual as { repete_inicio: string | null; repete_fim: string | null };
      if (!("repeteInicio" in payload)) repeteInicioEfetivo = atualPeriodo.repete_inicio;
      if (!("repeteFim" in payload)) repeteFimEfetivo = atualPeriodo.repete_fim;
    }

    const erroPeriodo = validarPeriodoRepeticao(repeteInicioEfetivo, repeteFimEfetivo);
    if (erroPeriodo) {
      return applySetCookies(Response.json({ error: erroPeriodo }, { status: 400 }));
    }
  }

  const updates: Record<string, unknown> = {};
  for (const { chave, coluna } of CAMPOS_EDITAVEIS) {
    if (chave in payload) {
      updates[coluna] = payload[chave];
    }
  }

  const responsavelIdsPatch: string[] | null = "responsavelIds" in payload
    ? (Array.isArray(payload.responsavelIds) ? payload.responsavelIds : [])
    : null;

  if (Object.keys(updates).length === 0 && responsavelIdsPatch === null) {
    return applySetCookies(Response.json({ error: "Nenhum campo para atualizar." }, { status: 400 }));
  }

  if (Object.keys(updates).length > 0) {
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
  }

  if (responsavelIdsPatch !== null) {
    const erroResponsaveis = await substituirResponsaveisModelo(supabase, id, responsavelIdsPatch);
    if (erroResponsaveis) {
      return applySetCookies(
        Response.json({ error: "Não foi possível atualizar os responsáveis do modelo." }, { status: 500 }),
      );
    }
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
