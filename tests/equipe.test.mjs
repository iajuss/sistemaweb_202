import assert from "node:assert/strict";
import test from "node:test";
import { validarEmailConvite } from "../lib/equipe.ts";

test("aceita um e-mail simples válido", () => {
  assert.equal(validarEmailConvite("ana@escritorio.com.br"), null);
});

test("rejeita string vazia", () => {
  assert.equal(validarEmailConvite(""), "Informe o e-mail do funcionário.");
});

test("rejeita undefined", () => {
  assert.equal(validarEmailConvite(undefined), "Informe o e-mail do funcionário.");
});

test("rejeita texto sem @", () => {
  assert.equal(validarEmailConvite("ana.escritorio.com"), "Informe um e-mail válido.");
});

test("rejeita e-mail com espaço", () => {
  assert.equal(validarEmailConvite("ana @escritorio.com"), "Informe um e-mail válido.");
});

test("aceita e remove espaços nas pontas antes de validar", () => {
  assert.equal(validarEmailConvite("  ana@escritorio.com  "), null);
});
