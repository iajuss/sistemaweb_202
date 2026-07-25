/**
 * Shape compartilhado entre GET/POST/PATCH de /api/empresas: linha bruta
 * retornada pelo PostgREST (com os embeds de sócios e responsável) e a
 * função que a traduz para o formato consumido pelo frontend.
 */
import type { createServerClient } from "@supabase/ssr";

type SupabaseClient = ReturnType<typeof createServerClient>;

export type EmpresaRow = {
  id: string;
  cnpj: string;
  razao_social: string;
  fantasia: string;
  cidade: string;
  estado: string;
  endereco: string;
  cnae_codigo: string;
  cnae_descricao: string;
  porte: string;
  situacao_cadastral: string;
  abertura: string | null;
  responsavel_id: string | null;
  tags: string[];
  observacoes: string;
  criado_em: string;
  atualizado_em: string;
  empresas_socios: { nome: string; papel: string }[] | null;
  responsavel: { nome: string } | null;
};

export const EMPRESA_SELECT = "*, empresas_socios(nome, papel), responsavel:perfis(nome)";

function formatarSocio(socio: { nome: string; papel: string }): string {
  return socio.papel && socio.papel.trim() !== "" ? `${socio.nome} (${socio.papel})` : socio.nome;
}

export function paraShapeFrontend(row: EmpresaRow) {
  return {
    id: row.id,
    cnpj: row.cnpj,
    razaoSocial: row.razao_social,
    fantasia: row.fantasia,
    cidade: row.cidade,
    estado: row.estado,
    endereco: row.endereco,
    cnaeCodigo: row.cnae_codigo,
    cnae: row.cnae_descricao,
    porte: row.porte,
    status: row.situacao_cadastral,
    abertura: row.abertura,
    responsavelId: row.responsavel_id,
    responsavel: row.responsavel?.nome ?? "",
    socios: (row.empresas_socios ?? []).map(formatarSocio),
    tags: row.tags,
    observacoes: row.observacoes,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

/**
 * Rebusca uma empresa pelo id no shape completo (com embeds), usado por
 * POST/PATCH após a escrita para devolver a resposta no mesmo formato do
 * GET. Retorna `null` se a linha não for encontrada (RLS ou id inexistente).
 */
export async function buscarEmpresaCompletaPorId(
  supabase: SupabaseClient,
  id: string,
): Promise<EmpresaRow | null> {
  const { data, error } = await supabase.from("empresas").select(EMPRESA_SELECT).eq("id", id).maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as EmpresaRow;
}
