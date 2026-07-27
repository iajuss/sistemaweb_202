/**
 * Headers de segurança e limite de tamanho de corpo, aplicados num único
 * ponto (worker/index.ts) por onde toda requisição passa — em vez de repetir
 * a mesma lista em cada rota e esquecer de uma.
 */

/**
 * 512 KB. O maior corpo legítimo do app é o cadastro de uma empresa com
 * sócios e observações — alguns KB. O limite existe para que um usuário
 * autenticado não consiga gravar megabytes por requisição (nenhum campo de
 * texto do schema tem limite de tamanho) nem forçar o worker a bufferizar
 * uploads gigantes.
 */
export const LIMITE_CORPO_BYTES = 512 * 1024;

/** `true` quando o `Content-Length` declarado passa do limite. */
export function corpoExcedeLimite(request: Request): boolean {
  const declarado = request.headers.get("content-length");
  if (!declarado) return false;

  const bytes = Number(declarado);
  return Number.isFinite(bytes) && bytes > LIMITE_CORPO_BYTES;
}

// ponytail: 'unsafe-inline' em script-src é necessário enquanto o RSC/vinext
// injeta scripts inline sem nonce. Trocar por 'nonce-...' quando o framework
// expuser um nonce por requisição — aí o CSP passa a valer de fato contra XSS,
// hoje ele cobre principalmente frame-ancestors, object-src e base-uri.
//
// Calculado a cada chamada (não como constante de módulo) para ler
// `process.env.SUPABASE_URL` no momento certo do runtime do Worker, mesmo
// padrão de `lib/supabase/server.ts`.
function construirCSP(): string {
  const supabaseUrl = process.env.SUPABASE_URL;
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    // A logo do cliente (Configurações) é servida direto do bucket público do
    // Supabase Storage — sem o domínio do projeto aqui, o navegador bloqueia
    // silenciosamente o <img>, mesmo com a URL certa e o arquivo acessível
    // (só aparece como "imagem quebrada", nenhum erro visível no app).
    `img-src 'self' data: blob:${supabaseUrl ? ` ${supabaseUrl}` : ""}`,
    "font-src 'self' data:",
    // O navegador nunca fala com o Supabase direto — as chaves e as consultas
    // ficam todas no servidor. Restringir a 'self' fecha um canal cômodo de
    // exfiltração caso algum XSS apareça.
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Anexa os headers de segurança à resposta. `Strict-Transport-Security` só
 * em https: em http o header é ignorado pelo navegador e só polui a auditoria
 * (e no localhost forçaria https num host que não tem certificado).
 */
export function aplicarHeadersDeSeguranca(response: Response, url: URL): Response {
  // Response de rotas de API pode ter headers imutáveis (Response.json com
  // redirect, por exemplo); clonar via construtor garante headers graváveis.
  const comHeaders = new Response(response.body, response);

  comHeaders.headers.set("Content-Security-Policy", construirCSP());
  comHeaders.headers.set("X-Content-Type-Options", "nosniff");
  comHeaders.headers.set("X-Frame-Options", "DENY");
  comHeaders.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  comHeaders.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");

  if (url.protocol === "https:") {
    comHeaders.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return comHeaders;
}
