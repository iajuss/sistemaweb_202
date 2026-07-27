import assert from "node:assert/strict";
import test from "node:test";
import { LIMITES, validarCampos, validarListaTexto, termoBuscaSeguro } from "../lib/validacao.ts";
import { registrarEvento } from "../lib/auditoria-seguranca.ts";

// --- validarCampos ---------------------------------------------------------
// Nenhuma coluna de texto do schema tem limite. O limite de 512 KB do worker
// impede o extremo, mas sem checagem por campo um usuário autenticado ainda
// grava centenas de KB por registro, indefinidamente.

test("validarCampos aceita valores dentro do limite", () => {
  assert.equal(validarCampos([["Título", "Reunião mensal", 200]]), null);
});

test("validarCampos rejeita valor acima do limite, nomeando o campo", () => {
  const erro = validarCampos([["Título", "x".repeat(201), 200]]);
  assert.equal(erro, "Título deve ter no máximo 200 caracteres.");
});

test("validarCampos aceita ausência de valor (campo opcional não é o assunto aqui)", () => {
  assert.equal(validarCampos([["Observações", undefined, 4000], ["Fantasia", null, 200]]), null);
});

test("validarCampos conta caracteres, não bytes (acento não consome o dobro)", () => {
  assert.equal(validarCampos([["Nome", "ç".repeat(120), 120]]), null);
});

test("validarCampos reporta o primeiro campo inválido e para", () => {
  const erro = validarCampos([
    ["Cidade", "ok", 100],
    ["Endereço", "y".repeat(301), 300],
    ["Porte", "z".repeat(999), 50],
  ]);
  assert.equal(erro, "Endereço deve ter no máximo 300 caracteres.");
});

// --- validarListaTexto -----------------------------------------------------

test("validarListaTexto rejeita lista com itens demais", () => {
  const erro = validarListaTexto("Tags", Array(31).fill("a"), 30, 40);
  assert.equal(erro, "Tags aceita no máximo 30 itens.");
});

test("validarListaTexto rejeita um item longo demais dentro de uma lista curta", () => {
  const erro = validarListaTexto("Tags", ["ok", "b".repeat(41)], 30, 40);
  assert.equal(erro, "Cada item de Tags deve ter no máximo 40 caracteres.");
});

test("validarListaTexto aceita lista vazia e ausente", () => {
  assert.equal(validarListaTexto("Tags", [], 30, 40), null);
  assert.equal(validarListaTexto("Tags", undefined, 30, 40), null);
});

test("validarListaTexto rejeita item que não é string (array vindo cru do JSON)", () => {
  assert.equal(validarListaTexto("Tags", [{ malicioso: true }], 30, 40), "Cada item de Tags deve ser um texto.");
});

// --- termoBuscaSeguro ------------------------------------------------------
// O termo é concatenado dentro do filtro `or(...)` do PostgREST. Vírgula e
// parêntese são separadores da sintaxe do filtro: se passarem, o usuário
// escreve filtros que não foram pedidos.

test("termoBuscaSeguro remove os separadores da sintaxe de filtro do PostgREST", () => {
  const termo = termoBuscaSeguro("acme,razao_social.neq.(x)");
  for (const caractere of [",", "(", ")", "%", "*", '"', "\\"]) {
    assert.equal(termo.includes(caractere), false, `deixou passar ${caractere}`);
  }
});

test("termoBuscaSeguro preserva um termo legítimo com acento e espaço", () => {
  assert.equal(termoBuscaSeguro("  Padaria São João  "), "Padaria São João");
});

test("termoBuscaSeguro trunca termos absurdamente longos", () => {
  assert.equal(termoBuscaSeguro("a".repeat(500)).length, LIMITES.busca);
});

// --- registrarEvento -------------------------------------------------------

test("registrarEvento envia exatamente os campos previstos, sem carona de credencial", async () => {
  let recebido = null;
  const supabaseFake = {
    rpc: async (nome, params) => {
      recebido = { nome, params };
      return { data: null, error: null };
    },
  };

  await registrarEvento(supabaseFake, "login_falha", { email: "Ana@X.com ", ip: "203.0.113.7", detalhe: "senha" });

  assert.equal(recebido.nome, "registrar_evento_seguranca");
  assert.deepEqual(Object.keys(recebido.params).sort(), ["p_detalhe", "p_email", "p_ip", "p_tipo"]);
  assert.equal(recebido.params.p_tipo, "login_falha");
  // E-mail normalizado, para o mesmo usuário não virar duas entradas no log.
  assert.equal(recebido.params.p_email, "ana@x.com");
});

test("registrarEvento nunca lança: falha de log não pode derrubar o login", async () => {
  const supabaseQueExplode = {
    rpc: async () => {
      throw new Error("banco fora do ar");
    },
  };
  await registrarEvento(supabaseQueExplode, "login_ok", { ip: "203.0.113.7" });
});

test("registrarEvento tolera erro devolvido pelo RPC sem lançar", async () => {
  const supabaseComErro = { rpc: async () => ({ data: null, error: { message: "sem permissão" } }) };
  await registrarEvento(supabaseComErro, "login_ok", { ip: "203.0.113.7" });
});
