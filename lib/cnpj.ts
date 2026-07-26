/**
 * Validação e formatação de CNPJ. Funções puras, sem I/O — sem dependência
 * de Next.js, Supabase ou banco de dados, para serem testáveis via
 * `node --test` sem bootstrap de framework.
 */

const PESOS_PRIMEIRO_DIGITO = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_SEGUNDO_DIGITO = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function calcularDigitoVerificador(digitos: number[], pesos: number[]): number {
  const soma = digitos.reduce((acc, digito, indice) => acc + digito * pesos[indice], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * Valida um CNPJ pelo algoritmo padrão da Receita Federal: remove
 * não-dígitos, recalcula os dois dígitos verificadores e rejeita
 * sequências de dígito repetido (ex.: `11111111111111`), que passariam
 * numa implementação ingênua baseada só nos dígitos verificadores.
 */
export function validarCNPJ(cnpj: string): boolean {
  const digitosSomente = cnpj.replace(/\D/g, "");

  if (digitosSomente.length !== 14) {
    return false;
  }

  if (/^(\d)\1{13}$/.test(digitosSomente)) {
    return false;
  }

  const digitos = digitosSomente.split("").map(Number);

  const primeiroDigitoCalculado = calcularDigitoVerificador(digitos.slice(0, 12), PESOS_PRIMEIRO_DIGITO);
  if (primeiroDigitoCalculado !== digitos[12]) {
    return false;
  }

  const segundoDigitoCalculado = calcularDigitoVerificador(digitos.slice(0, 13), PESOS_SEGUNDO_DIGITO);
  if (segundoDigitoCalculado !== digitos[13]) {
    return false;
  }

  return true;
}

/**
 * Formata 14 dígitos como `00.000.000/0000-00`. Se a entrada não contiver
 * exatamente 14 dígitos, retorna a entrada sem alteração.
 */
export function formatarCNPJ(cnpj: string): string {
  const digitosSomente = cnpj.replace(/\D/g, "");

  if (digitosSomente.length !== 14) {
    return cnpj;
  }

  return digitosSomente.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

const PADRAO_CNPJ_PONTUADO = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/;
const PADRAO_CNPJ_14_DIGITOS = /\d{14}/;

/**
 * Extrai um CNPJ de um texto colado que pode conter outros números ao
 * redor (avaliação, telefone, endereço etc. — comum ao colar direto de
 * uma busca do Google). Em vez de concatenar todos os dígitos do texto e
 * pegar os 14 primeiros — o que embaralha o CNPJ quando há dígitos
 * espúrios antes dele —, procura primeiro o padrão pontuado
 * `00.000.000/0000-00`, que é como o CNPJ aparece nesses textos, e só cai
 * para "14 dígitos consecutivos" ou "todos os dígitos" como fallback.
 */
export function extrairCNPJDoTexto(texto: string): string {
  const comPontuacao = texto.match(PADRAO_CNPJ_PONTUADO);
  if (comPontuacao) {
    return comPontuacao[0].replace(/\D/g, "");
  }

  const comDigitos = texto.match(PADRAO_CNPJ_14_DIGITOS);
  if (comDigitos) {
    return comDigitos[0];
  }

  return texto.replace(/\D/g, "").slice(0, 14);
}
