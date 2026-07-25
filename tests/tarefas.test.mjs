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
