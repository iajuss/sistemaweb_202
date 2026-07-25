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

export function avaliarDadosAusentes(empresa: EmpresaParaAuditoria): DivergenciaDetectada | null {
  const ausentes = CAMPOS_OBRIGATORIOS.filter(({ chave }) => empresa[chave].trim() === "").map(({ rotulo }) => rotulo);

  if (ausentes.length === 0) {
    return null;
  }

  const sufixo = ausentes.length === 1 ? "não informado" : "não informados";

  return {
    empresaId: empresa.id,
    tipo: "Dados ausentes",
    atual: `${ausentes.join(", ")} ${sufixo}`,
    sugerido: null,
  };
}

/** Roda as 3 regras internas (sem I/O) para uma empresa. */
export function avaliarRegrasInternas(empresa: EmpresaParaAuditoria): DivergenciaDetectada[] {
  return [avaliarCNPJInvalido(empresa), avaliarSituacaoIrregular(empresa), avaliarDadosAusentes(empresa)].filter(
    (divergencia): divergencia is DivergenciaDetectada => divergencia !== null,
  );
}

/** Normaliza espaços/caixa para comparar sem sinalizar diferenças triviais de formatação. */
function normalizarParaComparacao(texto: string): string {
  return texto.trim().replace(/\s+/g, " ").toLowerCase();
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

  if (normalizarParaComparacao(empresa.endereco) !== normalizarParaComparacao(dadosBrasilAPI.endereco)) {
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
