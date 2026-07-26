/**
 * Cliente para a ReceitaWS — usado como reserva quando a BrasilAPI falha
 * (rate limit ou indisponibilidade), ver `lib/cnpj-provedores.ts`.
 * Normaliza para o mesmo shape `EmpresaBrasilAPI` usado no resto do app,
 * para que quem consome não precise saber de qual provedor o dado veio.
 */
import { normalizarSituacaoCadastral, type EmpresaBrasilAPI } from "./brasilapi";

export class ReceitaWSError extends Error {
  constructor(
    public status: 404 | 429 | 502,
    message: string,
  ) {
    super(message);
  }
}

const RECEITAWS_URL = "https://www.receitaws.com.br/v1/cnpj";

type QsaReceitaWS = { nome?: string; qual?: string };

type RespostaReceitaWS = {
  status?: string;
  message?: string;
  nome?: string;
  fantasia?: string;
  municipio?: string;
  uf?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  atividade_principal?: { code?: string; text?: string }[];
  porte?: string;
  situacao?: string;
  abertura?: string; // formato DD/MM/AAAA
  qsa?: QsaReceitaWS[];
};

function converterDataBrParaISO(dataBr: string | undefined): string | null {
  const partes = dataBr?.split("/");
  if (!partes || partes.length !== 3) {
    return null;
  }
  const [dia, mes, ano] = partes;
  return `${ano}-${mes}-${dia}`;
}

/** Remove o prefixo numérico de qualificação do sócio (ex.: "16-Presidente" -> "Presidente"). */
function limparQualificacaoSocio(qual: string | undefined): string {
  return qual ? qual.replace(/^\d+-/, "") : "";
}

function montarEndereco(logradouro?: string, numero?: string, bairro?: string): string {
  return [logradouro, numero, bairro].filter((parte) => parte && parte.trim() !== "").join(", ");
}

/**
 * A ReceitaWS retorna um placeholder mascarado (`code: "00.00-0-00"`,
 * `text: "********"` ou `"Não informada"`) para a atividade principal em
 * parte das empresas — normalmente inaptas/baixadas — em vez de omitir o
 * campo. Tratamos isso como "sem CNAE disponível" (string vazia) em vez de
 * exibir o placeholder cru.
 */
function cnaeValido(codigo: string | undefined, texto: string | undefined): boolean {
  const digitosCodigo = codigo?.replace(/\D/g, "") ?? "";
  const codigoValido = digitosCodigo !== "" && !/^0+$/.test(digitosCodigo);
  const textoValido = !!texto && texto.trim() !== "" && texto !== "********" && texto !== "Não informada";
  return codigoValido && textoValido;
}

function normalizarResposta(cnpjSomenteDigitos: string, resposta: RespostaReceitaWS): EmpresaBrasilAPI {
  const atividadePrincipal = resposta.atividade_principal?.[0];
  const razaoSocial = resposta.nome ?? "";
  const fantasia = resposta.fantasia && resposta.fantasia.trim() !== "" ? resposta.fantasia : razaoSocial;
  const temCnaeValido = cnaeValido(atividadePrincipal?.code, atividadePrincipal?.text);

  return {
    cnpj: cnpjSomenteDigitos,
    razaoSocial,
    fantasia,
    cidade: resposta.municipio ?? "",
    estado: resposta.uf ?? "",
    endereco: montarEndereco(resposta.logradouro, resposta.numero, resposta.bairro),
    cnaeCodigo: temCnaeValido ? atividadePrincipal!.code!.replace(/\D/g, "") : "",
    cnaeDescricao: temCnaeValido ? atividadePrincipal!.text! : "",
    porte: resposta.porte ?? "",
    situacaoCadastral: normalizarSituacaoCadastral(resposta.situacao),
    abertura: converterDataBrParaISO(resposta.abertura),
    socios: (resposta.qsa ?? []).map((socio) => ({
      nome: socio.nome ?? "",
      papel: limparQualificacaoSocio(socio.qual),
    })),
  };
}

/**
 * Consulta um CNPJ na ReceitaWS e normaliza para `EmpresaBrasilAPI`.
 *
 * - `429` (rate limit da ReceitaWS, corpo não é JSON) → `ReceitaWSError(429, ...)`.
 * - Corpo com `status: "ERROR"` → `ReceitaWSError(404, ...)` se a mensagem
 *   indicar CNPJ inexistente/inválido, senão `ReceitaWSError(502, ...)`.
 * - Qualquer outro erro de rede/parse → `ReceitaWSError(502, ...)`.
 */
export async function consultarCNPJNaReceitaWS(cnpj: string): Promise<EmpresaBrasilAPI> {
  const cnpjSomenteDigitos = cnpj.replace(/\D/g, "");

  let response: Response;
  try {
    response = await fetch(`${RECEITAWS_URL}/${cnpjSomenteDigitos}`);
  } catch {
    throw new ReceitaWSError(502, "Não foi possível consultar a ReceitaWS");
  }

  if (response.status === 429) {
    throw new ReceitaWSError(429, "Muitas consultas à ReceitaWS");
  }

  let corpo: RespostaReceitaWS;
  try {
    corpo = (await response.json()) as RespostaReceitaWS;
  } catch {
    throw new ReceitaWSError(502, "Resposta inválida da ReceitaWS");
  }

  if (corpo.status === "ERROR") {
    const naoEncontrado = /n(ã|a)o encontrado|inv(á|a)lido/i.test(corpo.message ?? "");
    throw new ReceitaWSError(naoEncontrado ? 404 : 502, corpo.message ?? "Erro ao consultar a ReceitaWS");
  }

  return normalizarResposta(cnpjSomenteDigitos, corpo);
}
