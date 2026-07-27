import assert from "node:assert/strict";
import test from "node:test";
import {
  avaliarCNPJInvalido,
  avaliarSituacaoIrregular,
  avaliarDadosAusentes,
  avaliarRazaoSocialEEndereco,
  avaliarCnaeEPorte,
  avaliarLocalidade,
} from "../lib/auditoria.ts";

function empresaBase(overrides = {}) {
  return {
    id: "empresa-1",
    cnpj: "11222333000181",
    razaoSocial: "Horizonte Distribuidora Ltda.",
    endereco: "Av. Paulista, 1000",
    cidade: "São Paulo",
    estado: "SP",
    cnaeCodigo: "4712-1/00",
    cnaeDescricao: "Comércio de alimentos",
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

// --- avaliarCnaeEPorte (regra externa) ------------------------------------

function dadosBrasilAPIBase(overrides = {}) {
  return {
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
    ...overrides,
  };
}

test("avaliarCnaeEPorte: retorna [] quando CNAE e porte batem com a BrasilAPI", () => {
  const empresa = empresaBase();
  assert.deepEqual(avaliarCnaeEPorte(empresa, dadosBrasilAPIBase()), []);
});

test("avaliarCnaeEPorte: sinaliza CNAE errado — o bug relatado (campo preenchido com valor incorreto passava batido)", () => {
  const empresa = empresaBase({ cnaeCodigo: "0000-0/00" });
  const divergencias = avaliarCnaeEPorte(empresa, dadosBrasilAPIBase());
  assert.deepEqual(divergencias, [
    { empresaId: "empresa-1", tipo: "CNAE", atual: "0000-0/00 · Comércio de alimentos", sugerido: "4712-1/00 · Comércio de alimentos" },
  ]);
});

test("avaliarCnaeEPorte: sinaliza descrição do CNAE adulterada mesmo com o código certo — segundo bug relatado", () => {
  const empresa = empresaBase({ cnaeDescricao: "Bancos Pinto" });
  const divergencias = avaliarCnaeEPorte(empresa, dadosBrasilAPIBase());
  assert.deepEqual(divergencias, [
    { empresaId: "empresa-1", tipo: "CNAE", atual: "4712-1/00 · Bancos Pinto", sugerido: "4712-1/00 · Comércio de alimentos" },
  ]);
});

test("avaliarCnaeEPorte: não sinaliza diferença só de máscara no CNAE (com ou sem hífen/barra)", () => {
  const empresa = empresaBase({ cnaeCodigo: "47121 00" });
  assert.deepEqual(avaliarCnaeEPorte(empresa, dadosBrasilAPIBase()), []);
});

test("avaliarCnaeEPorte: sinaliza porte errado com sugerido = valor da BrasilAPI", () => {
  const empresa = empresaBase({ porte: "Grande porte" });
  const divergencias = avaliarCnaeEPorte(empresa, dadosBrasilAPIBase());
  assert.deepEqual(divergencias, [
    { empresaId: "empresa-1", tipo: "Porte", atual: "Grande porte", sugerido: "Microempresa" },
  ]);
});

test("avaliarCnaeEPorte: campo vazio não é sinalizado aqui — é responsabilidade de avaliarDadosAusentes", () => {
  const empresa = empresaBase({ cnaeCodigo: "", porte: "" });
  assert.deepEqual(avaliarCnaeEPorte(empresa, dadosBrasilAPIBase()), []);
});

// --- avaliarLocalidade (regra externa) ------------------------------------

test("avaliarLocalidade: retorna [] quando cidade e estado batem com a BrasilAPI", () => {
  const empresa = empresaBase();
  assert.deepEqual(avaliarLocalidade(empresa, dadosBrasilAPIBase()), []);
});

test("avaliarLocalidade: sinaliza estado errado mesmo com a cidade certa — o bug relatado (RJ preenchido numa empresa que a fonte oficial diz SP)", () => {
  const empresa = empresaBase({ estado: "RJ" });
  const divergencias = avaliarLocalidade(empresa, dadosBrasilAPIBase());
  assert.deepEqual(divergencias, [
    { empresaId: "empresa-1", tipo: "Localidade", atual: "São Paulo/RJ", sugerido: "São Paulo/SP" },
  ]);
});

test("avaliarLocalidade: sinaliza cidade errada mesmo com o estado certo", () => {
  const empresa = empresaBase({ cidade: "Campinas" });
  const divergencias = avaliarLocalidade(empresa, dadosBrasilAPIBase());
  assert.deepEqual(divergencias, [
    { empresaId: "empresa-1", tipo: "Localidade", atual: "Campinas/SP", sugerido: "São Paulo/SP" },
  ]);
});

test("avaliarLocalidade: campos vazios não são sinalizados aqui — é responsabilidade de avaliarDadosAusentes", () => {
  const empresa = empresaBase({ cidade: "", estado: "" });
  assert.deepEqual(avaliarLocalidade(empresa, dadosBrasilAPIBase()), []);
});
