import assert from "node:assert/strict";
import test from "node:test";
import { calcularVencimentosDoModelo, hojeBrasil, mesAtual, ultimoDiaDoMes } from "../lib/tarefas.ts";

// --- mensal ---------------------------------------------------------------

test("mensal: dia dentro do mês gera um único vencimento nesse dia", () => {
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "mensal",
    diaReferencia: 15,
    mes: "2026-07",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(vencimentos, ["2026-07-15"]);
});

test("mensal: dia 31 num mês de 30 dias (abril) é clampado para o dia 30", () => {
  assert.equal(ultimoDiaDoMes(2026, 4), 30);
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "mensal",
    diaReferencia: 31,
    mes: "2026-04",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(vencimentos, ["2026-04-30"]);
});

test("mensal: dia 31 em fevereiro (28 dias, não bissexto) é clampado para o dia 28", () => {
  assert.equal(ultimoDiaDoMes(2026, 2), 28);
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "mensal",
    diaReferencia: 31,
    mes: "2026-02",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(vencimentos, ["2026-02-28"]);
});

test("mensal: dia 30 em fevereiro bissexto (2028) é clampado para o dia 29", () => {
  assert.equal(ultimoDiaDoMes(2028, 2), 29);
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "mensal",
    diaReferencia: 30,
    mes: "2028-02",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(vencimentos, ["2028-02-29"]);
});

// --- anual ------------------------------------------------------------------

test("anual: gera vencimento quando o mês pedido bate com o mês de criado_em (mesmo ano)", () => {
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "anual",
    diaReferencia: 10,
    mes: "2026-03",
    criadoEm: "2026-03-10T12:00:00Z",
  });
  assert.deepEqual(vencimentos, ["2026-03-10"]);
});

test("anual: gera vencimento quando o mês bate, mesmo em ano diferente do de criado_em", () => {
  // O mês de referência é fixo (mês de criação), mas a recorrência deve
  // repetir todo ano — o vencimento usa o ano do `mes` pedido, não o ano de
  // criado_em.
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "anual",
    diaReferencia: 5,
    mes: "2027-03",
    criadoEm: "2025-03-20T00:00:00Z",
  });
  assert.deepEqual(vencimentos, ["2027-03-05"]);
});

test("anual: não gera nada quando o mês pedido não bate com o mês de criado_em", () => {
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "anual",
    diaReferencia: 10,
    mes: "2026-04",
    criadoEm: "2026-03-10T00:00:00Z",
  });
  assert.deepEqual(vencimentos, []);
});

test("anual: aplica o mesmo clamping de dia do mês que o mensal", () => {
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "anual",
    diaReferencia: 31,
    mes: "2026-02",
    criadoEm: "2025-02-01T00:00:00Z",
  });
  assert.deepEqual(vencimentos, ["2026-02-28"]);
});

// --- semanal ------------------------------------------------------------

test("semanal: gera uma data para cada sexta-feira (diaReferencia=5) de julho de 2026", () => {
  // Julho de 2026: dia 1 é quarta-feira; as sextas caem em 3, 10, 17, 24, 31.
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "semanal",
    diaReferencia: 5,
    mes: "2026-07",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(vencimentos, ["2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24", "2026-07-31"]);
});

test("semanal: dia 7 (domingo) mapeia o domingo, não a segunda", () => {
  // Julho de 2026: os domingos caem em 5, 12, 19, 26.
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "semanal",
    diaReferencia: 7,
    mes: "2026-07",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(vencimentos, ["2026-07-05", "2026-07-12", "2026-07-19", "2026-07-26"]);
});

test("semanal: dia 1 (segunda) mapeia as segundas-feiras do mês", () => {
  // Julho de 2026: as segundas caem em 6, 13, 20, 27.
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "semanal",
    diaReferencia: 1,
    mes: "2026-07",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(vencimentos, ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"]);
});


test("semanal: diasSemana com múltiplos dias gera uma data por dia selecionado (terça e quinta)", () => {
  // Julho de 2026: as terças caem em 7, 14, 21, 28; as quintas em 2, 9, 16, 23, 30.
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "semanal",
    diaReferencia: 2,
    diasSemana: [2, 4],
    mes: "2026-07",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(vencimentos, [
    "2026-07-02", "2026-07-07", "2026-07-09", "2026-07-14",
    "2026-07-16", "2026-07-21", "2026-07-23", "2026-07-28", "2026-07-30",
  ]);
});

test("semanal: diasSemana vazio/ausente cai de volta para o único diaReferencia (compatibilidade)", () => {
  const comArrayVazio = calcularVencimentosDoModelo({
    periodicidade: "semanal",
    diaReferencia: 5,
    diasSemana: [],
    mes: "2026-07",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  const semArray = calcularVencimentosDoModelo({
    periodicidade: "semanal",
    diaReferencia: 5,
    mes: "2026-07",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(comArrayVazio, ["2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24", "2026-07-31"]);
  assert.deepEqual(comArrayVazio, semArray);
});

// --- anual com mês explícito -------------------------------------------------

test("anual: mesReferencia explícito é usado no lugar do mês de criadoEm", () => {
  // Modelo criado em janeiro, mas configurado para vencer em março.
  const noMesConfigurado = calcularVencimentosDoModelo({
    periodicidade: "anual",
    diaReferencia: 20,
    mesReferencia: 3,
    mes: "2026-03",
    criadoEm: "2026-01-05T00:00:00Z",
  });
  const noMesDeCriacao = calcularVencimentosDoModelo({
    periodicidade: "anual",
    diaReferencia: 20,
    mesReferencia: 3,
    mes: "2026-01",
    criadoEm: "2026-01-05T00:00:00Z",
  });
  assert.deepEqual(noMesConfigurado, ["2026-03-20"]);
  assert.deepEqual(noMesDeCriacao, []);
});

test("anual: mesReferencia nulo cai de volta para o mês de criadoEm (modelos antigos)", () => {
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "anual",
    diaReferencia: 10,
    mesReferencia: null,
    mes: "2026-03",
    criadoEm: "2026-03-10T12:00:00Z",
  });
  assert.deepEqual(vencimentos, ["2026-03-10"]);
});
// --- diario -----------------------------------------------------------------

test("diario: gera um vencimento para cada dia do mês", () => {
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "diario",
    diaReferencia: 1,
    mes: "2026-02",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  assert.equal(vencimentos.length, 28);
  assert.equal(vencimentos[0], "2026-02-01");
  assert.equal(vencimentos[27], "2026-02-28");
});

// --- repetições (início/fim por data) --------------------------------------

test("repetições: sem início/fim, repete indefinidamente (comportamento padrão)", () => {
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "diario",
    diaReferencia: 1,
    mes: "2027-01",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  assert.equal(vencimentos.length, 31);
});

test("repetições: 'diario' com fim no 5º dia corta as datas depois dele", () => {
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "diario",
    diaReferencia: 1,
    mes: "2026-07",
    criadoEm: "2026-07-01T00:00:00Z",
    repeteInicio: "2026-07-01",
    repeteFim: "2026-07-05",
  });
  assert.deepEqual(vencimentos, ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"]);
});

test("repetições: 'mensal' com fim no mês seguinte ainda gera nele, mas não no terceiro", () => {
  const noSegundoMes = calcularVencimentosDoModelo({
    periodicidade: "mensal",
    diaReferencia: 10,
    mes: "2026-08",
    criadoEm: "2026-07-10T00:00:00Z",
    repeteInicio: "2026-07-10",
    repeteFim: "2026-08-31",
  });
  assert.deepEqual(noSegundoMes, ["2026-08-10"]);

  const noTerceiroMes = calcularVencimentosDoModelo({
    periodicidade: "mensal",
    diaReferencia: 10,
    mes: "2026-09",
    criadoEm: "2026-07-10T00:00:00Z",
    repeteInicio: "2026-07-10",
    repeteFim: "2026-08-31",
  });
  assert.deepEqual(noTerceiroMes, []);
});

test("repetições: 'anual' com fim antes do segundo ano não gera nele", () => {
  const noPrimeiroAno = calcularVencimentosDoModelo({
    periodicidade: "anual",
    diaReferencia: 15,
    mes: "2026-05",
    criadoEm: "2026-05-15T00:00:00Z",
    repeteInicio: "2026-05-15",
    repeteFim: "2027-05-14",
  });
  assert.deepEqual(noPrimeiroAno, ["2026-05-15"]);

  const noSegundoAno = calcularVencimentosDoModelo({
    periodicidade: "anual",
    diaReferencia: 15,
    mes: "2027-05",
    criadoEm: "2026-05-15T00:00:00Z",
    repeteInicio: "2026-05-15",
    repeteFim: "2027-05-14",
  });
  assert.deepEqual(noSegundoAno, []);
});

test("repetições: repeteInicio no futuro não gera antes dele", () => {
  const antesDoInicio = calcularVencimentosDoModelo({
    periodicidade: "diario",
    diaReferencia: 1,
    mes: "2026-07",
    criadoEm: "2026-01-01T00:00:00Z",
    repeteInicio: "2026-08-01",
    repeteFim: null,
  });
  assert.deepEqual(antesDoInicio, []);

  const depoisDoInicio = calcularVencimentosDoModelo({
    periodicidade: "diario",
    diaReferencia: 1,
    mes: "2026-08",
    criadoEm: "2026-01-01T00:00:00Z",
    repeteInicio: "2026-08-01",
    repeteFim: null,
  });
  assert.equal(depoisDoInicio.length, 31);
});

// --- defensivo ------------------------------------------------------------

test("periodicidade desconhecida retorna lista vazia (defensivo)", () => {
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "quinzenal",
    diaReferencia: 1,
    mes: "2026-07",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  assert.deepEqual(vencimentos, []);
});

// --- hojeBrasil / mesAtual --------------------------------------------------
//
// O valor exato depende do relógio real no momento em que o teste roda (não
// há injeção de clock aqui), então não dá pra fixar um valor esperado sem
// tornar o teste frágil/data-dependente. O que é testável sem depender do
// relógio: o formato da saída ("YYYY-MM-DD" válido) e a consistência entre
// `hojeBrasil()` e `mesAtual()` (o segundo deve ser sempre o prefixo do
// primeiro). A correção do fuso horário em si (América/São_Paulo vs. UTC) é
// verificada por leitura de código/comentário em `lib/tarefas.ts`, não por
// este teste.

test("hojeBrasil: retorna uma data no formato YYYY-MM-DD que o Date consegue parsear", () => {
  const hoje = hojeBrasil();
  assert.match(hoje, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(new Date(hoje).getTime()), `"${hoje}" deveria ser uma data válida`);
});

test("mesAtual: é sempre o prefixo YYYY-MM de hojeBrasil()", () => {
  assert.equal(mesAtual(), hojeBrasil().slice(0, 7));
  assert.match(mesAtual(), /^\d{4}-(0[1-9]|1[0-2])$/);
});
