import assert from "node:assert/strict";
import test from "node:test";
import {
  avaliarCNPJInvalido,
  avaliarSituacaoIrregular,
  avaliarDadosAusentes,
  avaliarRazaoSocialEEndereco,
} from "../lib/auditoria.ts";

function empresaBase(overrides = {}) {
  return {
    id: "empresa-1",
    cnpj: "11222333000181",
    razaoSocial: "Horizonte Distribuidora Ltda.",
    endereco: "Av. Paulista, 1000",
    cnaeCodigo: "4712-1/00",
    porte: "Microempresa",
    situacaoCadastral: "Ativa",
    ...overrides,
  };
}

// --- avaliarCNPJInvalido -----------------------------------------------

test("avaliarCNPJInvalido: retorna null para empresa com CNPJ válido", () => {
  const empresa = empresaBase();
  assert.equal(avaliarCNPJInvalido(empresa), null);
});

test("avaliarCNPJInvalido: retorna divergência para CNPJ com dígito verificador errado", () => {
  const empresa = empresaBase({ cnpj: "11222333000180" });
  const divergencia = avaliarCNPJInvalido(empresa);
  assert.deepEqual(divergencia, {
    empresaId: "empresa-1",
    tipo: "CNPJ inválido",
    atual: "11222333000180",
    sugerido: null,
  });
});

test("avaliarCNPJInvalido: caso de borda — CNPJ mascarado mas ainda inválido", () => {
  const empresa = empresaBase({ cnpj: "11.222.333/0001-80" });
  const divergencia = avaliarCNPJInvalido(empresa);
  assert.ok(divergencia);
  assert.equal(divergencia.tipo, "CNPJ inválido");
  assert.equal(divergencia.atual, "11.222.333/0001-80");
});

// --- avaliarSituacaoIrregular --------------------------------------------

test("avaliarSituacaoIrregular: retorna null para empresa Ativa", () => {
  const empresa = empresaBase({ situacaoCadastral: "Ativa" });
  assert.equal(avaliarSituacaoIrregular(empresa), null);
});

test("avaliarSituacaoIrregular: retorna divergência para empresa Suspensa", () => {
  const empresa = empresaBase({ situacaoCadastral: "Suspensa" });
  const divergencia = avaliarSituacaoIrregular(empresa);
  assert.deepEqual(divergencia, {
    empresaId: "empresa-1",
    tipo: "Situação irregular",
    atual: "Suspensa",
    sugerido: null,
  });
});

test("avaliarSituacaoIrregular: caso de borda — variação de capitalização não é sinalizada", () => {
  const empresa = empresaBase({ situacaoCadastral: "ativa" });
  assert.equal(avaliarSituacaoIrregular(empresa), null);

  const empresaMaiuscula = empresaBase({ situacaoCadastral: "ATIVA" });
  assert.equal(avaliarSituacaoIrregular(empresaMaiuscula), null);
});

test("avaliarSituacaoIrregular: variação de capitalização de uma situação irregular ainda é sinalizada", () => {
  const empresa = empresaBase({ situacaoCadastral: "suspensa" });
  const divergencia = avaliarSituacaoIrregular(empresa);
  assert.ok(divergencia);
  assert.equal(divergencia.atual, "suspensa");
});

// --- avaliarDadosAusentes ------------------------------------------------

test("avaliarDadosAusentes: retorna null quando todos os campos obrigatórios estão preenchidos", () => {
  const empresa = empresaBase();
  assert.equal(avaliarDadosAusentes(empresa), null);
});

test("avaliarDadosAusentes: retorna divergência para um único campo ausente (singular)", () => {
  const empresa = empresaBase({ endereco: "" });
  const divergencia = avaliarDadosAusentes(empresa);
  assert.deepEqual(divergencia, {
    empresaId: "empresa-1",
    tipo: "Dados ausentes",
    atual: "Endereço não informado",
    sugerido: null,
  });
});

test("avaliarDadosAusentes: retorna divergência descrevendo múltiplos campos ausentes (plural)", () => {
  const empresa = empresaBase({ endereco: "", cnaeCodigo: "" });
  const divergencia = avaliarDadosAusentes(empresa);
  assert.deepEqual(divergencia, {
    empresaId: "empresa-1",
    tipo: "Dados ausentes",
    atual: "Endereço, CNAE não informados",
    sugerido: null,
  });
});

test("avaliarDadosAusentes: caso de borda — campo só com espaços em branco conta como ausente", () => {
  const empresa = empresaBase({ porte: "   " });
  const divergencia = avaliarDadosAusentes(empresa);
  assert.ok(divergencia);
  assert.equal(divergencia.atual, "Porte não informado");
});

// --- avaliarRazaoSocialEEndereco (regra externa) --------------------------

test("avaliarRazaoSocialEEndereco: retorna [] quando razão social e endereço batem com a BrasilAPI", () => {
  const empresa = empresaBase();
  const dadosBrasilAPI = {
    cnpj: "11222333000181",
    razaoSocial: "Horizonte Distribuidora Ltda.",
    fantasia: "Horizonte",
    cidade: "São Paulo",
    estado: "SP",
    endereco: "Av. Paulista, 1000",
    cnaeCodigo: "4712-1/00",
    cnaeDescricao: "Comércio de alimentos",
    porte: "Microempresa",
    situacaoCadastral: "Ativa",
    abertura: null,
    socios: [],
  };
  assert.deepEqual(avaliarRazaoSocialEEndereco(empresa, dadosBrasilAPI), []);
});

test("avaliarRazaoSocialEEndereco: não sinaliza diferenças triviais de espaço/caixa", () => {
  const empresa = empresaBase({ razaoSocial: "  horizonte distribuidora ltda.  ", endereco: "av. paulista,  1000" });
  const dadosBrasilAPI = {
    cnpj: "11222333000181",
    razaoSocial: "Horizonte Distribuidora Ltda.",
    fantasia: "Horizonte",
    cidade: "São Paulo",
    estado: "SP",
    endereco: "Av. Paulista, 1000",
    cnaeCodigo: "4712-1/00",
    cnaeDescricao: "Comércio de alimentos",
    porte: "Microempresa",
    situacaoCadastral: "Ativa",
    abertura: null,
    socios: [],
  };
  assert.deepEqual(avaliarRazaoSocialEEndereco(empresa, dadosBrasilAPI), []);
});

test("avaliarRazaoSocialEEndereco: sinaliza razão social e endereço divergentes com sugerido = valor da BrasilAPI", () => {
  const empresa = empresaBase({ razaoSocial: "Nome Antigo Ltda.", endereco: "Rua Velha, 1" });
  const dadosBrasilAPI = {
    cnpj: "11222333000181",
    razaoSocial: "Horizonte Distribuidora Ltda.",
    fantasia: "Horizonte",
    cidade: "São Paulo",
    estado: "SP",
    endereco: "Av. Paulista, 1000",
    cnaeCodigo: "4712-1/00",
    cnaeDescricao: "Comércio de alimentos",
    porte: "Microempresa",
    situacaoCadastral: "Ativa",
    abertura: null,
    socios: [],
  };
  const divergencias = avaliarRazaoSocialEEndereco(empresa, dadosBrasilAPI);
  assert.equal(divergencias.length, 2);
  assert.deepEqual(
    divergencias.find((d) => d.tipo === "Razão social"),
    { empresaId: "empresa-1", tipo: "Razão social", atual: "Nome Antigo Ltda.", sugerido: "Horizonte Distribuidora Ltda." },
  );
  assert.deepEqual(
    divergencias.find((d) => d.tipo === "Endereço"),
    { empresaId: "empresa-1", tipo: "Endereço", atual: "Rua Velha, 1", sugerido: "Av. Paulista, 1000" },
  );
});
