/**
 * Cliente para a BrasilAPI (consulta de CNPJ), normalizando a resposta
 * externa para o shape interno `EmpresaBrasilAPI`. Função pura em termos de
 * dependências — sem Next.js/Supabase/banco — apenas `fetch` global, para
 * ser testável a partir de um teste Node simples.
 */

export type EmpresaBrasilAPI = {
  cnpj: string;
  razaoSocial: string;
  fantasia: string;
  cidade: string;
  estado: string;
  endereco: string;
  cnaeCodigo: string;
  cnaeDescricao: string;
  porte: string;
  situacaoCadastral: "Ativa" | "Suspensa" | "Baixada" | string;
  abertura: string | null; // ISO YYYY-MM-DD
  socios: { nome: string; papel: string }[];
};

export class BrasilAPIError extends Error {
  constructor(
    public status: 404 | 429 | 502,
    message: string,
  ) {
    super(message);
  }
}

const BRASILAPI_CNPJ_URL = "https://brasilapi.com.br/api/cnpj/v1";
// A BrasilAPI limita por rajada curta (segundos), não por um período longo —
// por isso vale a pena insistir um pouco mais antes de desistir: 3 tentativas
// com espera crescente cobrem rajadas de alguns segundos sem exigir que o
// usuário clique em "Consultar" de novo manualmente.
const ESPERAS_ENTRE_TENTATIVAS_MS = [500, 1500, 3000];

const SITUACOES_CADASTRAIS_CONHECIDAS: Record<string, "Ativa" | "Suspensa" | "Baixada"> = {
  ATIVA: "Ativa",
  BAIXADA: "Baixada",
  SUSPENSA: "Suspensa",
};

type RespostaBrasilAPI = {
  razao_social?: string;
  nome_fantasia?: string;
  municipio?: string;
  uf?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cnae_fiscal?: number | string;
  cnae_fiscal_descricao?: string;
  porte?: string;
  descricao_situacao_cadastral?: string;
  data_inicio_atividade?: string;
  qsa?: { nome_socio?: string; qualificacao_socio?: string }[];
};

function capitalizar(texto: string): string {
  if (texto.length === 0) {
    return texto;
  }
  return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
}

/** Exportada para reuso em outros provedores (ver `lib/receitaws.ts`) — garante que
 * a mesma situação cadastral apareça sempre com a mesma grafia, não importa o provedor. */
export function normalizarSituacaoCadastral(situacao: string | undefined): string {
  if (!situacao) {
    return "";
  }
  const conhecida = SITUACOES_CADASTRAIS_CONHECIDAS[situacao.toUpperCase()];
  return conhecida ?? capitalizar(situacao);
}

function montarEndereco(logradouro?: string, numero?: string, bairro?: string): string {
  return [logradouro, numero, bairro].filter((parte) => parte && parte.trim() !== "").join(", ");
}

function normalizarResposta(cnpjSomenteDigitos: string, resposta: RespostaBrasilAPI): EmpresaBrasilAPI {
  const razaoSocial = resposta.razao_social ?? "";
  const fantasia = resposta.nome_fantasia && resposta.nome_fantasia.trim() !== "" ? resposta.nome_fantasia : razaoSocial;

  return {
    cnpj: cnpjSomenteDigitos,
    razaoSocial,
    fantasia,
    cidade: resposta.municipio ?? "",
    estado: resposta.uf ?? "",
    endereco: montarEndereco(resposta.logradouro, resposta.numero, resposta.bairro),
    cnaeCodigo: resposta.cnae_fiscal !== undefined && resposta.cnae_fiscal !== null ? String(resposta.cnae_fiscal) : "",
    cnaeDescricao: resposta.cnae_fiscal_descricao ?? "",
    porte: resposta.porte ?? "",
    situacaoCadastral: normalizarSituacaoCadastral(resposta.descricao_situacao_cadastral),
    abertura: resposta.data_inicio_atividade ?? null,
    socios: (resposta.qsa ?? []).map((socio) => ({
      nome: socio.nome_socio ?? "",
      papel: socio.qualificacao_socio ?? "",
    })),
  };
}

async function buscarNaBrasilAPI(cnpjSomenteDigitos: string): Promise<Response> {
  try {
    return await fetch(`${BRASILAPI_CNPJ_URL}/${cnpjSomenteDigitos}`);
  } catch {
    throw new BrasilAPIError(502, "Não foi possível consultar a BrasilAPI");
  }
}

/**
 * Consulta um CNPJ na BrasilAPI e normaliza o resultado para
 * `EmpresaBrasilAPI`.
 *
 * - `404` → `BrasilAPIError(404, ...)`.
 * - `429` → tenta de novo com espera crescente (ver `ESPERAS_ENTRE_TENTATIVAS_MS`);
 *   se persistir em todas as tentativas, `BrasilAPIError(429, ...)`.
 * - Qualquer outro erro de rede/status → `BrasilAPIError(502, ...)`.
 */
export async function consultarCNPJNaBrasilAPI(cnpj: string): Promise<EmpresaBrasilAPI> {
  const cnpjSomenteDigitos = cnpj.replace(/\D/g, "");

  let response = await buscarNaBrasilAPI(cnpjSomenteDigitos);

  for (const esperaMs of ESPERAS_ENTRE_TENTATIVAS_MS) {
    if (response.status !== 429) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, esperaMs));
    response = await buscarNaBrasilAPI(cnpjSomenteDigitos);
  }

  if (response.status === 429) {
    throw new BrasilAPIError(429, "Muitas consultas à BrasilAPI, tente novamente em instantes");
  }

  if (response.status === 404) {
    throw new BrasilAPIError(404, "CNPJ não encontrado");
  }

  if (!response.ok) {
    throw new BrasilAPIError(502, "Não foi possível consultar a BrasilAPI");
  }

  let corpo: RespostaBrasilAPI;
  try {
    corpo = (await response.json()) as RespostaBrasilAPI;
  } catch {
    throw new BrasilAPIError(502, "Não foi possível consultar a BrasilAPI");
  }

  return normalizarResposta(cnpjSomenteDigitos, corpo);
}
