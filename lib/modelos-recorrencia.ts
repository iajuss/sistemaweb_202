/**
 * Shape compartilhado entre GET/POST/PATCH de /api/modelos-recorrencia: linha
 * bruta retornada pelo PostgREST (com os embeds de responsável e empresa) e a
 * função que a traduz para o formato consumido pelo frontend. Mesma
 * convenção usada em `lib/empresas.ts` e `lib/divergencias.ts`.
 */
import type { createServerClient } from "@supabase/ssr";

type SupabaseClient = ReturnType<typeof createServerClient>;

export type Periodicidade = "diario" | "semanal" | "mensal" | "anual";

export type ModeloRecorrenciaRow = {
  id: string;
  escritorio_id: string;
  empresa_id: string | null;
  titulo: string;
  tipo: string;
  periodicidade: string;
  dia_referencia: number;
  dias_semana: number[] | null;
  mes_referencia: number | null;
  ativo: boolean;
  repete_inicio: string | null;
  repete_fim: string | null;
  criado_em: string;
  empresa: { fantasia: string } | null;
  responsaveis: { perfil: { id: string; nome: string } }[];
};

export const MODELO_RECORRENCIA_SELECT = "*, empresa:empresas(fantasia), responsaveis:modelos_recorrencia_responsaveis(perfil:perfis(id,nome))";

/**
 * Faixa válida de `diaReferencia` conforme a periodicidade: mensal/anual
 * usam dia do mês (1-31). "diario" e "semanal" não usam `diaReferencia`
 * (dias da semana ficam em `diasSemana`), mas a coluna é NOT NULL — o
 * frontend sempre envia um valor dummy dentro dessa faixa.
 */
export function faixaDiaReferencia(_periodicidade: string): number {
  return 31;
}

/** Um ou mais dias da semana (1=segunda...7=domingo), obrigatório para periodicidade "semanal". */
export function validarDiasSemana(dias: unknown): string | null {
  if (!Array.isArray(dias) || dias.length === 0) {
    return "Selecione pelo menos um dia da semana.";
  }
  if (!dias.every((d) => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 7)) {
    return "Dias da semana inválidos.";
  }
  return null;
}

/** Mês do vencimento (1-12), obrigatório para periodicidade "anual". */
export function validarMesReferencia(mes: unknown): string | null {
  if (typeof mes !== "number" || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return "Selecione o mês da recorrência anual.";
  }
  return null;
}

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida a combinação de `repeteInicio`/`repeteFim`: os dois precisam vir
 * juntos (ambos `null` = repete sem fim) e, quando presentes, ambos devem
 * ser datas `"YYYY-MM-DD"` válidas com `fim >= inicio`. Retorna a mensagem
 * de erro, ou `null` se a combinação for válida.
 */
export function validarPeriodoRepeticao(inicio: unknown, fim: unknown): string | null {
  const i = inicio ?? null;
  const f = fim ?? null;

  if ((i === null) !== (f === null)) {
    return "Informe início e fim do período juntos, ou deixe os dois em branco para repetir sem data final.";
  }
  if (i === null) {
    return null;
  }
  if (typeof i !== "string" || !DATA_REGEX.test(i) || typeof f !== "string" || !DATA_REGEX.test(f)) {
    return 'Datas do período devem estar no formato "YYYY-MM-DD".';
  }
  if (f < i) {
    return "A data de fim deve ser igual ou posterior à data de início.";
  }
  return null;
}

export function paraShapeFrontend(row: ModeloRecorrenciaRow) {
  const responsaveis = row.responsaveis.map((r) => r.perfil);
  return {
    id: row.id,
    empresaId: row.empresa_id,
    empresa: row.empresa?.fantasia ?? "",
    titulo: row.titulo,
    tipo: row.tipo,
    periodicidade: row.periodicidade,
    diaReferencia: row.dia_referencia,
    diasSemana: row.dias_semana,
    mesReferencia: row.mes_referencia,
    responsavelIds: responsaveis.map((p) => p.id),
    responsaveis: responsaveis.map((p) => p.nome),
    ativo: row.ativo,
    repeteInicio: row.repete_inicio,
    repeteFim: row.repete_fim,
    criadoEm: row.criado_em,
  };
}

/**
 * Substitui a lista inteira de responsáveis de um modelo de recorrência:
 * apaga todas as ligações existentes e insere as novas. Mesmo racional de
 * `substituirResponsaveisTarefa` em `lib/tarefas.ts`.
 */
export async function substituirResponsaveisModelo(
  supabase: SupabaseClient,
  modeloId: string,
  perfilIds: string[],
) {
  const { error: erroDelete } = await supabase.from("modelos_recorrencia_responsaveis").delete().eq("modelo_id", modeloId);
  if (erroDelete) return erroDelete;
  if (perfilIds.length === 0) return null;
  const { error: erroInsert } = await supabase
    .from("modelos_recorrencia_responsaveis")
    .insert(perfilIds.map((perfilId) => ({ modelo_id: modeloId, perfil_id: perfilId })));
  return erroInsert;
}

/**
 * Rebusca um modelo de recorrência pelo id no shape completo (com embeds),
 * usado por POST/PATCH após a escrita para devolver a resposta no mesmo
 * formato do GET. Retorna `null` se a linha não for encontrada (RLS ou id
 * inexistente).
 */
export async function buscarModeloRecorrenciaCompletoPorId(
  supabase: SupabaseClient,
  id: string,
): Promise<ModeloRecorrenciaRow | null> {
  const { data, error } = await supabase
    .from("modelos_recorrencia")
    .select(MODELO_RECORRENCIA_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as unknown as ModeloRecorrenciaRow;
}
