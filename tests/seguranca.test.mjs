import assert from "node:assert/strict";
import test from "node:test";
import { ipDoRequest, chaveRateLimit, consumirRateLimit } from "../lib/rate-limit.ts";
import { aplicarHeadersDeSeguranca, corpoExcedeLimite, LIMITE_CORPO_BYTES } from "../lib/headers-seguranca.ts";

// --- ipDoRequest -----------------------------------------------------------
// O IP é a chave do rate limit de autenticação. Se um atacante conseguir
// forjá-lo, cada tentativa vira um "cliente novo" e o limite deixa de existir.

test("ipDoRequest prefere cf-connecting-ip (definido pela Cloudflare, não forjável pelo cliente)", () => {
  const request = new Request("https://app.local/api/auth/login", {
    headers: { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" },
  });
  assert.equal(ipDoRequest(request), "203.0.113.7");
});

test("ipDoRequest usa o PRIMEIRO salto de x-forwarded-for quando não há cf-connecting-ip", () => {
  // Um cliente pode enviar seu próprio x-forwarded-for; o proxy acrescenta o IP
  // real ao final. Pegar o último salto deixaria o atacante escolher a chave.
  const request = new Request("https://app.local/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.9, 10.0.0.1" },
  });
  assert.equal(ipDoRequest(request), "198.51.100.9");
});

test("ipDoRequest devolve 'desconhecido' quando nenhum header de origem existe", () => {
  const request = new Request("https://app.local/api/auth/login");
  assert.equal(ipDoRequest(request), "desconhecido");
});

// --- chaveRateLimit --------------------------------------------------------

test("chaveRateLimit separa rotas diferentes com o mesmo identificador", () => {
  assert.notEqual(chaveRateLimit("login", "203.0.113.7"), chaveRateLimit("signup", "203.0.113.7"));
});

test("chaveRateLimit normaliza o e-mail (caixa e espaços) para o mesmo balde", () => {
  assert.equal(chaveRateLimit("login", "  Ana@Escritorio.com "), chaveRateLimit("login", "ana@escritorio.com"));
});

// --- consumirRateLimit -----------------------------------------------------

test("consumirRateLimit bloqueia quando o RPC devolve false", async () => {
  const supabaseFake = { rpc: async () => ({ data: false, error: null }) };
  assert.equal(await consumirRateLimit(supabaseFake, "login", "203.0.113.7", 5, 300), true);
});

test("consumirRateLimit libera quando o RPC devolve true", async () => {
  const supabaseFake = { rpc: async () => ({ data: true, error: null }) };
  assert.equal(await consumirRateLimit(supabaseFake, "login", "203.0.113.7", 5, 300), false);
});

test("consumirRateLimit falha FECHADO: erro no RPC bloqueia em vez de liberar", async () => {
  // Se a tabela/função de rate limit sumir, o comportamento seguro é negar —
  // caso contrário derrubar essa dependência vira o próprio bypass do limite.
  const supabaseFake = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
  assert.equal(await consumirRateLimit(supabaseFake, "login", "203.0.113.7", 5, 300), true);
});

// --- headers de segurança --------------------------------------------------

test("aplicarHeadersDeSeguranca proíbe enquadrar a página em iframe (clickjacking)", () => {
  const response = aplicarHeadersDeSeguranca(new Response("ok"), new URL("https://app.local/"));
  assert.match(response.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
});

test("aplicarHeadersDeSeguranca envia nosniff e Referrer-Policy", () => {
  const response = aplicarHeadersDeSeguranca(new Response("ok"), new URL("https://app.local/"));
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
});

test("aplicarHeadersDeSeguranca só manda HSTS em https (em http o header é ignorado e confunde)", () => {
  const emHttps = aplicarHeadersDeSeguranca(new Response("ok"), new URL("https://app.local/"));
  const emHttp = aplicarHeadersDeSeguranca(new Response("ok"), new URL("http://localhost:3000/"));
  assert.match(emHttps.headers.get("Strict-Transport-Security"), /max-age=/);
  assert.equal(emHttp.headers.get("Strict-Transport-Security"), null);
});

test("aplicarHeadersDeSeguranca preserva o corpo e o status da resposta original", async () => {
  const response = aplicarHeadersDeSeguranca(new Response("conteudo", { status: 201 }), new URL("https://app.local/"));
  assert.equal(response.status, 201);
  assert.equal(await response.text(), "conteudo");
});

// --- limite de tamanho de corpo -------------------------------------------

test("corpoExcedeLimite rejeita content-length acima do limite", () => {
  const request = new Request("https://app.local/api/empresas", {
    method: "POST",
    headers: { "content-length": String(LIMITE_CORPO_BYTES + 1) },
    body: "x",
  });
  assert.equal(corpoExcedeLimite(request), true);
});

test("corpoExcedeLimite aceita um corpo normal e requisições sem corpo", () => {
  const comCorpo = new Request("https://app.local/api/empresas", {
    method: "POST",
    headers: { "content-length": "512" },
    body: "x",
  });
  assert.equal(corpoExcedeLimite(comCorpo), false);
  assert.equal(corpoExcedeLimite(new Request("https://app.local/")), false);
});
