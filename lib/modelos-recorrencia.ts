/**
 * Shape compartilhado entre GET/POST/PATCH de /api/modelos-recorrencia: linha
 * bruta retornada pelo PostgREST (com os embeds de responsável e empresa) e a
 * função que a traduz para o formato consumido pelo frontend. Mesma
 * convenção usada em `lib/empresas.ts` e `lib/divergencias.ts`.
 */
import type { createServerClient } from "@supabase/ssr";

type SupabaseClient = ReturnType<typeof createServerClient>;

export type Periodicidade = "diario" | "semanal" | "mensal" | "anual";
export type UnidadeRepeticao = "dias" | "meses" | "anos";

export const UNIDADES_REPETICAO_VALIDAS: UnidadeRepeticao[] = ["dias", "meses", "anos"];

// Ordem de grandeza das periodicidades e das unidades, menor pra maior —
// usada para restringir as unidades de "repetir por" às de valor igual ou
// maior que a própria periodicidade (não faz sentido um modelo "anual"
// repetir só "por 3 dias"). Não existe unidade "semanas": para "semanal" a
// menor unidade cabível é "meses" (dias é menor que uma semana).
const ORDEM_UNIDADE: Record<UnidadeRepeticao, number> = { dias: 1, meses: 2, anos: 3 };
const UNIDADE_MINIMA_POR_PERIODICIDADE: Record<Periodicidade, UnidadeRepeticao> = {
  diario: "dias",
  semanal: "meses",
  mensal: "meses",
  anual: "anos",
};

/** Unidades de "repetir por" válidas para a periodicidade, em ordem crescente (a menor primeiro). */
export function unidadesValidasParaPeriodicidade(periodicidade: Periodicidade): UnidadeRepeticao[] {
  const minimo = ORDEM_UNIDADE[UNIDADE_MINIMA_POR_PERIODICIDADE[periodicidade]];
  return UNIDADES_REPETICAO_VALIDAS.filter((u) => ORDEM_UNIDADE[u] >= minimo);
}

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
  responsavel_id: string | null;
  ativo: boolean;
  repeticoes_quantidade: number | null;
  repeticoes_unidade: string | null;
  criado_em: string;
  empresa: { fantasia: string } | null;
  responsavel: { nome: string } | null;
};

export const MODELO_RECORRENCIA_SELECT = "*, responsavel:perfis(nome), empresa:empresas(fantasia)";

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

/**
 * Valida a combinação de `repeticoesQuantidade`/`repeticoesUnidade`: os dois
 * precisam vir juntos (ambos `null` = repete sem fim) e, quando presentes,
 * `quantidade` deve ser um inteiro positivo e `unidade` uma das válidas
 * para a `periodicidade` do modelo (ver `unidadesValidasParaPeriodicidade`).
 * Retorna a mensagem de erro, ou `null` se a combinação for válida.
 */
export function validarRepeticoes(
  periodicidade: Periodicidade,
  quantidade: number | null | undefined,
  unidade: string | null | undefined,
): string | null {
  const q = quantidade ?? null;
  const u = unidade ?? null;

  if ((q === null) !== (u === null)) {
    return "Informe quantidade e unidade da repetição juntas, ou deixe as duas em branco para repetir sem data final.";
  }
  if (q === null) {
    return null;
  }
  if (typeof q !== "number" || !Number.isInteger(q) || q < 1) {
    return "A quantidade de repetição deve ser um número inteiro maior que zero.";
  }
  const validas = unidadesValidasParaPeriodicidade(periodicidade);
  if (!validas.includes(u as UnidadeRepeticao)) {
    return `Para periodicidade "${periodicidade}", a unidade de repetição deve ser ${validas.join(" ou ")}.`;
  }
  return null;
}

export function paraShapeFrontend(row: ModeloRecorrenciaRow) {
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
    responsavelId: row.responsavel_id,
    responsavel: row.responsavel?.nome ?? "",
    ativo: row.ativo,
    repeticoesQuantidade: row.repeticoes_quantidade,
    repeticoesUnidade: row.repeticoes_unidade,
    criadoEm: row.criado_em,
  };
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
