/**
 * Motor de regras de auditoria da carteira. Funções puras, sem I/O — sem
 * dependência de Next.js, Supabase ou rede — para serem testáveis via
 * `node --test` sem bootstrap de framework. A orquestração (busca de
 * empresas, chamada à BrasilAPI, RPC de duplicidade, persistência em
 * `divergencias`) vive em `app/api/auditoria/executar/route.ts`.
 */
import { validarCNPJ } from "./cnpj.ts";
import type { EmpresaBrasilAPI } from "./brasilapi.ts";

export type EmpresaParaAuditoria = {
  id: string;
  cnpj: string;
  razaoSocial: string;
  endereco: string;
  cnaeCodigo: string;
  porte: string;
  situacaoCadastral: string;
};

export type DivergenciaDetectada = {
  empresaId: string;
  tipo: "CNPJ inválido" | "Duplicidade" | "Razão social" | "Endereço" | "Situação irregular" | "Dados ausentes";
  atual: string;
  sugerido: string | null;
  // Só "Duplicidade" tem uma "outra empresa" do par — usado no frontend para
  // oferecer a ação de excluir uma das duas. As outras 5 regras (avaliadas
  // por empresa, nunca em par) nunca preenchem este campo.
  empresaRelacionadaId?: string;
};

/** `validarCNPJ` já remove máscara/valida dígitos verificadores. */
export function avaliarCNPJInvalido(empresa: EmpresaParaAuditoria): DivergenciaDetectada | null {
  if (validarCNPJ(empresa.cnpj)) {
    return null;
  }

  return {
    empresaId: empresa.id,
    tipo: "CNPJ inválido",
    atual: empresa.cnpj,
    sugerido: null,
  };
}

const SITUACAO_REGULAR = "ativa";

/**
 * Compara de forma tolerante a espaços/caixa para não sinalizar como
 * "irregular" uma empresa que está ativa mas com a situação salva em
 * capitalização diferente (ex.: "ATIVA", "ativa") — mesmo princípio de
 * normalização trivial usado em `avaliarRazaoSocialEEndereco`.
 */
export function avaliarSituacaoIrregular(empresa: EmpresaParaAuditoria): DivergenciaDetectada | null {
  const situacao = empresa.situacaoCadastral.trim();

  if (situacao.toLowerCase() === SITUACAO_REGULAR) {
    return null;
  }

  return {
    empresaId: empresa.id,
    tipo: "Situação irregular",
    atual: situacao,
    sugerido: null,
  };
}

const CAMPOS_OBRIGATORIOS: { chave: keyof EmpresaParaAuditoria; rotulo: string }[] = [
  { chave: "endereco", rotulo: "Endereço" },
  { chave: "cnaeCodigo", rotulo: "CNAE" },
  { chave: "porte", rotulo: "Porte" },
];

/** Valor do campo `chave` na resposta cacheada da API, pronto pra virar sugestão — string vazia quando o provedor também não tem esse dado. */
function valorSugeridoParaCampo(chave: keyof EmpresaParaAuditoria, dadosBrasilAPI: EmpresaBrasilAPI): string {
  if (chave === "endereco") return dadosBrasilAPI.endereco;
  if (chave === "cnaeCodigo") return [dadosBrasilAPI.cnaeCodigo, dadosBrasilAPI.cnaeDescricao].filter(Boolean).join(" · ");
  if (chave === "porte") return dadosBrasilAPI.porte;
  return "";
}

// `dadosBrasilAPI` só chega preenchido quando o chamador já reconsultou a API
// para esta empresa nesta execução (regras externas, ver `app/api/auditoria/
// executar/route.ts`) — nunca é buscado aqui, esta função continua pura/sem
// I/O. Sem `dadosBrasilAPI` (rodada interna, sempre executada após salvar/
// editar) a divergência é reportada sem sugestão; o usuário só ganha "Aplicar
// sugestão" depois de uma "Revalidar carteira" que tenha encontrado o dado
// que faltava no cache/provedor.
export function avaliarDadosAusentes(empresa: EmpresaParaAuditoria, dadosBrasilAPI?: EmpresaBrasilAPI | null): DivergenciaDetectada | null {
  const camposAusentes = CAMPOS_OBRIGATORIOS.filter(({ chave }) => empresa[chave].trim() === "");

  if (camposAusentes.length === 0) {
    return null;
  }

  const sufixo = camposAusentes.length === 1 ? "não informado" : "não informados";

  let sugerido: string | null = null;
  if (dadosBrasilAPI) {
    const partes = camposAusentes
      .map(({ chave, rotulo }) => ({ rotulo, valor: valorSugeridoParaCampo(chave, dadosBrasilAPI) }))
      .filter(({ valor }) => valor !== "")
      .map(({ rotulo, valor }) => `${rotulo}: ${valor}`);
    sugerido = partes.length > 0 ? partes.join("; ") : null;
  }

  return {
    empresaId: empresa.id,
    tipo: "Dados ausentes",
    atual: `${camposAusentes.map(({ rotulo }) => rotulo).join(", ")} ${sufixo}`,
    sugerido,
  };
}

/** Roda as 2 regras internas de campo único (sem I/O) para uma empresa — "Dados ausentes" corre à parte (ver `avaliarDadosAusentes`), porque pode ou não ter `dadosBrasilAPI` disponível dependendo da execução. */
export function avaliarRegrasInternas(empresa: EmpresaParaAuditoria): DivergenciaDetectada[] {
  return [avaliarCNPJInvalido(empresa), avaliarSituacaoIrregular(empresa)].filter(
    (divergencia): divergencia is DivergenciaDetectada => divergencia !== null,
  );
}

/** Normaliza espaços/caixa para comparar sem sinalizar diferenças triviais de formatação. */
function normalizarParaComparacao(texto: string): string {
  return texto.trim().replace(/\s+/g, " ").toLowerCase();
}

// BrasilAPI e ReceitaWS formatam `logradouro` de forma diferente para o
// mesmo endereço real (uma inclui prefixo tipo "R"/"Via de acesso", a outra
// não) — sem isso, revalidar a carteira com o provedor "trocado" em relação
// ao usado no cadastro original gera falso positivo de "Endereço" toda vez.
const PREFIXOS_LOGRADOURO = /^(r\.?|rua|av\.?|avenida|al\.?|alameda|trav\.?|travessa|rod\.?|rodovia|pca\.?|praca|praça|estr\.?|estrada|via de acesso|acesso)\s+/;

function normalizarEndereco(texto: string): string {
  return normalizarParaComparacao(texto).replace(PREFIXOS_LOGRADOURO, "");
}

/**
 * Compara os dados salvos com a reconsulta à BrasilAPI. Só deve ser chamada
 * quando o chamador já tiver os dados atuais da BrasilAPI em mãos (reconsulta
 * é responsabilidade da rota, não desta função pura).
 */
export function avaliarRazaoSocialEEndereco(
  empresa: EmpresaParaAuditoria,
  dadosBrasilAPI: EmpresaBrasilAPI,
): DivergenciaDetectada[] {
  const divergencias: DivergenciaDetectada[] = [];

  if (normalizarParaComparacao(empresa.razaoSocial) !== normalizarParaComparacao(dadosBrasilAPI.razaoSocial)) {
    divergencias.push({
      empresaId: empresa.id,
      tipo: "Razão social",
      atual: empresa.razaoSocial,
      sugerido: dadosBrasilAPI.razaoSocial,
    });
  }

  if (normalizarEndereco(empresa.endereco) !== normalizarEndereco(dadosBrasilAPI.endereco)) {
    divergencias.push({
      empresaId: empresa.id,
      tipo: "Endereço",
      atual: empresa.endereco,
      sugerido: dadosBrasilAPI.endereco,
    });
  }

  return divergencias;
}

/** Roda as regras externas (reconsulta BrasilAPI, já resolvida pelo chamador) para uma empresa. */
export function avaliarRegrasExternas(
  empresa: EmpresaParaAuditoria,
  dadosBrasilAPI: EmpresaBrasilAPI,
): DivergenciaDetectada[] {
  return avaliarRazaoSocialEEndereco(empresa, dadosBrasilAPI);
}
