/**
 * Shape compartilhado entre GET/PATCH de /api/auditoria/divergencias: linha
 * bruta retornada pelo PostgREST (com o embed de `empresas`) e a função que a
 * traduz para o formato consumido pelo frontend (ver `Divergencia` em
 * `src/services/portfolio.ts`). Mesma convenção usada em `lib/empresas.ts`.
 */
import type { createServerClient } from "@supabase/ssr";

type SupabaseClient = ReturnType<typeof createServerClient>;

export type DivergenciaRow = {
  id: string;
  empresa_id: string;
  tipo: string;
  atual: string;
  sugerido: string | null;
  status: string;
  detectado_em: string;
  resolvido_em: string | null;
  empresas: { razao_social: string } | null;
};

export const DIVERGENCIA_SELECT = "*, empresas(razao_social)";

export function paraShapeFrontend(row: DivergenciaRow) {
  return {
    id: row.id,
    empresaId: row.empresa_id,
    empresa: row.empresas?.razao_social ?? "",
    tipo: row.tipo,
    atual: row.atual,
    sugerido: row.sugerido,
    status: row.status,
  };
}

/**
 * Rebusca uma divergência pelo id no shape completo (com embed de
 * `empresas`), usado pelo PATCH após a escrita para devolver a resposta no
 * mesmo formato do GET. Retorna `null` se a linha não for encontrada (RLS ou
 * id inexistente) — mesmo padrão de `buscarEmpresaCompletaPorId`.
 */
export async function buscarDivergenciaCompletaPorId(
  supabase: SupabaseClient,
  id: string,
): Promise<DivergenciaRow | null> {
  const { data, error } = await supabase.from("divergencias").select(DIVERGENCIA_SELECT).eq("id", id).maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as unknown as DivergenciaRow;
}
