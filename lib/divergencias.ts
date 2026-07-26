/**
 * Shape compartilhado entre GET/PATCH de /api/auditoria/divergencias: linha
 * bruta retornada pelo PostgREST (com o embed de `empresas`) e a função que a
 * traduz para o formato consumido pelo frontend (ver `Divergencia` em
 * `src/services/portfolio.ts`). Mesma convenção usada em `lib/empresas.ts`.
 */
import type { createServerClient } from "@supabase/ssr";

type SupabaseClient = ReturnType<typeof createServerClient>;

export type EmpresaRelacionadaRow = {
  id: string;
  razao_social: string;
  cnpj: string;
  cidade: string;
  estado: string;
  situacao_cadastral: string;
};

export type DivergenciaRow = {
  id: string;
  empresa_id: string;
  empresa_relacionada_id: string | null;
  tipo: string;
  atual: string;
  sugerido: string | null;
  status: string;
  detectado_em: string;
  resolvido_em: string | null;
  empresas: { razao_social: string } | null;
  empresa_relacionada: EmpresaRelacionadaRow | null;
};

// Duas FKs para `empresas` (empresa_id e empresa_relacionada_id) exigem
// desambiguar cada embed pelo nome da constraint — sem isso o PostgREST não
// sabe qual delas usar para cada alias.
export const DIVERGENCIA_SELECT =
  "*, empresas!divergencias_empresa_id_empresas_id_fk(razao_social), " +
  "empresa_relacionada:empresas!divergencias_empresa_relacionada_id_empresas_id_fk(id, razao_social, cnpj, cidade, estado, situacao_cadastral)";

export function paraShapeFrontend(row: DivergenciaRow) {
  return {
    id: row.id,
    empresaId: row.empresa_id,
    empresa: row.empresas?.razao_social ?? "",
    tipo: row.tipo,
    atual: row.atual,
    sugerido: row.sugerido,
    status: row.status,
    detectadoEm: row.detectado_em,
    resolvidoEm: row.resolvido_em,
    empresaRelacionada: row.empresa_relacionada
      ? {
          id: row.empresa_relacionada.id,
          razaoSocial: row.empresa_relacionada.razao_social,
          cnpj: row.empresa_relacionada.cnpj,
          cidade: row.empresa_relacionada.cidade,
          estado: row.empresa_relacionada.estado,
          status: row.empresa_relacionada.situacao_cadastral,
        }
      : null,
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
