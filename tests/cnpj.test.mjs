import assert from "node:assert/strict";
import test from "node:test";
import { validarCNPJ, formatarCNPJ, extrairCNPJDoTexto } from "../lib/cnpj.ts";

test("aceita um CNPJ válido conhecido (dígitos verificadores corretos)", () => {
  assert.equal(validarCNPJ("11222333000181"), true);
});

test("aceita o mesmo CNPJ válido formatado com máscara", () => {
  assert.equal(validarCNPJ("11.222.333/0001-81"), true);
});

test("rejeita um CNPJ com dígito verificador errado", () => {
  // Mesma base do CNPJ válido acima, mas com o último dígito alterado
  // (81 -> 80), então o segundo dígito verificador não bate mais.
  assert.equal(validarCNPJ("11222333000180"), false);
});

test("rejeita CNPJs com todos os dígitos iguais, mesmo que 'passassem' num check ingênuo", () => {
  assert.equal(validarCNPJ("11111111111111"), false);
  assert.equal(validarCNPJ("00000000000000"), false);
});

test("rejeita um CNPJ com menos de 14 dígitos", () => {
  assert.equal(validarCNPJ("1122233300018"), false);
});

test("formatarCNPJ formata 14 dígitos como 00.000.000/0000-00", () => {
  assert.equal(formatarCNPJ("11222333000181"), "11.222.333/0001-81");
});

test("formatarCNPJ é idempotente para uma entrada já mascarada", () => {
  assert.equal(formatarCNPJ("11.222.333/0001-81"), "11.222.333/0001-81");
});

test("formatarCNPJ retorna a entrada sem alteração quando não tem 14 dígitos", () => {
  assert.equal(formatarCNPJ("123"), "123");
});

test("extrairCNPJDoTexto extrai o CNPJ mesmo com texto colado ao redor (ex.: copiado do Google)", () => {
  assert.equal(extrairCNPJDoTexto("CNPJ: 15.436.940/0001-03"), "15436940000103");
  assert.equal(extrairCNPJDoTexto("4,8 · 15.436.940/0001-03"), "15436940000103");
  assert.equal(extrairCNPJDoTexto("15.436.940/0001-03 · Loja de departamentos"), "15436940000103");
});

test("extrairCNPJDoTexto aceita CNPJ colado sem pontuação, sem outros números ao redor", () => {
  assert.equal(extrairCNPJDoTexto("15436940000103"), "15436940000103");
});

test("extrairCNPJDoTexto cai para o fallback de dígitos quando não há padrão reconhecível", () => {
  assert.equal(extrairCNPJDoTexto("abc123"), "123");
});
