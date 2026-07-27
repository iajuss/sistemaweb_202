/**
 * Limites de tamanho para os campos de texto que o usuário escreve.
 *
 * Nenhuma coluna de texto do schema tem limite (são todas `text`), e o
 * PostgREST aceita o que mandarem. O corte de 512 KB no worker
 * (lib/headers-seguranca.ts) impede o caso extremo, mas sozinho ele ainda
 * deixaria um usuário autenticado gravar centenas de KB por registro, em
 * quantos registros quisesse. Estes limites são a validação por campo que
 * falta — generosos para o uso real, apertados o bastante para que a tabela
 * não vire depósito.
 */
export const LIMITES = {
  nome: 120,
  email: 255,
  titulo: 200,
  tipo: 60,
  cnpj: 20,
  razaoSocial: 200,
  endereco: 300,
  cidade: 100,
  estado: 20,
  cnae: 200,
  classificacao: 60,
  observacoes: 4000,
  tag: 40,
  tags: 30,
  socios: 50,
  busca: 120,
} as const;

/** Uma regra: [rótulo exibido no erro, valor recebido, máximo de caracteres]. */
type RegraCampo = [rotulo: string, valor: unknown, maximo: number];

/**
 * Valida o tamanho de vários campos de uma vez. Devolve a mensagem do
 * primeiro campo inválido (o frontend mostra um erro por vez) ou `null`.
 *
 * Valor ausente passa: obrigatoriedade é decisão de cada rota, aqui o assunto
 * é só tamanho. Valor não-string também passa — a rota já converte/valida
 * tipo antes de chegar aqui.
 */
export function validarCampos(regras: RegraCampo[]): string | null {
  for (const [rotulo, valor, maximo] of regras) {
    if (typeof valor !== "string") continue;
    // `[...valor]` conta pontos de código, não unidades UTF-16: sem isso um
    // texto com emoji seria rejeitado com metade dos caracteres que aparenta.
    if ([...valor].length > maximo) {
      return `${rotulo} deve ter no máximo ${maximo} caracteres.`;
    }
  }
  return null;
}

/** Valida uma lista de textos (tags, sócios): quantidade e tamanho de cada item. */
export function validarListaTexto(
  rotulo: string,
  valores: unknown,
  maximoItens: number,
  maximoPorItem: number,
): string | null {
  if (valores === undefined || valores === null) return null;
  if (!Array.isArray(valores)) return `${rotulo} deve ser uma lista.`;

  if (valores.length > maximoItens) {
    return `${rotulo} aceita no máximo ${maximoItens} itens.`;
  }

  for (const valor of valores) {
    if (typeof valor !== "string") return `Cada item de ${rotulo} deve ser um texto.`;
    if ([...valor].length > maximoPorItem) {
      return `Cada item de ${rotulo} deve ter no máximo ${maximoPorItem} caracteres.`;
    }
  }

  return null;
}

// Separadores da sintaxe de filtro do PostgREST (`campo.op.valor`, itens
// separados por vírgula, grupos entre parênteses) mais os curingas do LIKE.
// Deixar qualquer um deles passar permite ao usuário escrever, dentro do
// termo de busca, filtros que a rota não pediu.
const CARACTERES_DE_FILTRO = /[%,()*"\\]/g;

/**
 * Prepara um termo digitado pelo usuário para ir dentro de um filtro
 * `.or("campo.ilike.%termo%")`. Remove os metacaracteres e trunca — um termo
 * de busca de 500 caracteres não é busca, é sondagem.
 */
export function termoBuscaSeguro(busca: string): string {
  return busca.replace(CARACTERES_DE_FILTRO, "").trim().slice(0, LIMITES.busca);
}
