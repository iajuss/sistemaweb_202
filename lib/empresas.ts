import { LIMITES, validarCampos, validarListaTexto } from "@/lib/validacao";
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
  tags: string[];
  observacoes: string;
  criado_em: string;
  atualizado_em: string;
  empresas_socios: { nome: string; papel: string }[] | null;
  responsaveis: { perfil: { id: string; nome: string } }[];
};

export const EMPRESA_SELECT = "*, empresas_socios(nome, papel), responsaveis:empresas_responsaveis(perfil:perfis(id,nome))";

function formatarSocio(socio: { nome: string; papel: string }): string {
  return socio.papel && socio.papel.trim() !== "" ? `${socio.nome} (${socio.papel})` : socio.nome;
}

export function paraShapeFrontend(row: EmpresaRow) {
  const responsaveis = row.responsaveis.map((r) => r.perfil);
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
    responsavelIds: responsaveis.map((p) => p.id),
    responsaveis: responsaveis.map((p) => p.nome),
    socios: (row.empresas_socios ?? []).map(formatarSocio),
    tags: row.tags,
    observacoes: row.observacoes,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

/**
 * Substitui a lista inteira de responsáveis internos de uma empresa: apaga
 * todas as ligações existentes e insere as novas. Mesmo racional de
 * `substituirResponsaveisTarefa` em `lib/tarefas.ts`.
 */
export async function substituirResponsaveisEmpresa(
  supabase: SupabaseClient,
  empresaId: string,
  perfilIds: string[],
) {
  const { error: erroDelete } = await supabase.from("empresas_responsaveis").delete().eq("empresa_id", empresaId);
  if (erroDelete) return erroDelete;
  if (perfilIds.length === 0) return null;
  const { error: erroInsert } = await supabase
    .from("empresas_responsaveis")
    .insert(perfilIds.map((perfilId) => ({ empresa_id: empresaId, perfil_id: perfilId })));
  return erroInsert;
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

/**
 * Campos de texto que as rotas de empresa aceitam. Frouxo de propósito: só
 * descreve o que precisa ser medido, tanto no POST quanto no PATCH.
 */
export type EmpresaComTextos = {
  cnpj?: string;
  razaoSocial?: string;
  fantasia?: string;
  cidade?: string;
  estado?: string;
  endereco?: string;
  cnaeCodigo?: string;
  cnaeDescricao?: string;
  porte?: string;
  situacaoCadastral?: string;
  observacoes?: string;
  tags?: unknown;
  socios?: { nome: string; papel: string }[];
};

// Nenhuma coluna de texto do schema tem limite de tamanho, e o corte de 512 KB
// no worker não impede gravar centenas de KB por registro. Exportado porque o
// PATCH de /api/empresas/:id valida exatamente os mesmos campos.
export function validarCamposDaEmpresa(
  payload: EmpresaComTextos,
  cnpj?: string,
  razaoSocial?: string,
): string | null {
  return (
    validarCampos([
      ["CNPJ", cnpj ?? payload.cnpj, LIMITES.cnpj],
      ["Razão social", razaoSocial ?? payload.razaoSocial, LIMITES.razaoSocial],
      ["Nome fantasia", payload.fantasia, LIMITES.razaoSocial],
      ["Cidade", payload.cidade, LIMITES.cidade],
      ["Estado", payload.estado, LIMITES.estado],
      ["Endereço", payload.endereco, LIMITES.endereco],
      ["Código CNAE", payload.cnaeCodigo, LIMITES.classificacao],
      ["Descrição do CNAE", payload.cnaeDescricao, LIMITES.cnae],
      ["Porte", payload.porte, LIMITES.classificacao],
      ["Situação cadastral", payload.situacaoCadastral, LIMITES.classificacao],
      ["Observações", payload.observacoes, LIMITES.observacoes],
    ]) ??
    validarListaTexto("Tags", payload.tags, LIMITES.tags, LIMITES.tag) ??
    validarSocios(payload.socios)
  );
}

function validarSocios(socios: EmpresaComTextos["socios"]): string | null {
  if (socios === undefined || socios === null) return null;
  if (!Array.isArray(socios)) return "Sócios deve ser uma lista.";
  if (socios.length > LIMITES.socios) return `Sócios aceita no máximo ${LIMITES.socios} itens.`;

  for (const socio of socios) {
    const erro = validarCampos([
      ["Nome do sócio", socio?.nome, LIMITES.razaoSocial],
      ["Papel do sócio", socio?.papel, LIMITES.classificacao],
    ]);
    if (erro) return erro;
  }

  return null;
}
