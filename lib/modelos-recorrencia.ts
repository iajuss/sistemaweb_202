/**
 * Shape compartilhado entre GET/POST/PATCH de /api/modelos-recorrencia: linha
 * bruta retornada pelo PostgREST (com os embeds de responsável e empresa) e a
 * função que a traduz para o formato consumido pelo frontend. Mesma
 * convenção usada em `lib/empresas.ts` e `lib/divergencias.ts`.
 */
import type { createServerClient } from "@supabase/ssr";

type SupabaseClient = ReturnType<typeof createServerClient>;

export type Periodicidade = "mensal" | "semanal" | "anual";

export type ModeloRecorrenciaRow = {
  id: string;
  escritorio_id: string;
  empresa_id: string | null;
  titulo: string;
  tipo: string;
  periodicidade: string;
  dia_referencia: number;
  responsavel_id: string | null;
  ativo: boolean;
  criado_em: string;
  empresa: { fantasia: string } | null;
  responsavel: { nome: string } | null;
};

export const MODELO_RECORRENCIA_SELECT = "*, responsavel:perfis(nome), empresa:empresas(fantasia)";

/**
 * Faixa válida de `diaReferencia` conforme a periodicidade: semanal usa dia
 * da semana (1-7), mensal/anual usam dia do mês (1-31).
 */
export function faixaDiaReferencia(periodicidade: string): number {
  return periodicidade === "semanal" ? 7 : 31;
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
    responsavelId: row.responsavel_id,
    responsavel: row.responsavel?.nome ?? "",
    ativo: row.ativo,
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
