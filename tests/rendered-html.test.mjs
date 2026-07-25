import assert from "node:assert/strict";
import test from "node:test";

// Este teste roda `node --test` diretamente, fora do `vinext dev`/wrangler,
// então `.env.local`/`.dev.vars` nunca são carregados e `process.env.SUPABASE_URL`
// e `SUPABASE_ANON_KEY` ficam undefined. `lib/supabase/server.ts` usa essas
// variáveis (via `!`) para instanciar o cliente Supabase durante o render do
// Server Component de `/`; sem elas, `createServerClient` lança antes mesmo de
// chegar em `getUser()`/`redirect()`. Fornecemos valores fictícios só para este
// processo de teste, para exercitar o guard de autenticação real sem exigir
// credenciais verdadeiras nem enfraquecer `lib/supabase/server.ts`.
process.env.SUPABASE_URL ??= "https://placeholder.supabase.co";
process.env.SUPABASE_ANON_KEY ??= "placeholder-anon-key";

test("the generated worker is available", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(new Request("http://localhost/"), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });

  // `/` agora exige usuário autenticado (ver app/page.tsx); uma requisição sem
  // sessão deve redirecionar para /login em vez de renderizar o dashboard.
  assert.ok([307, 308].includes(response.status), `esperado redirect 307/308, recebido ${response.status}`);
  assert.equal(new URL(response.headers.get("location")).pathname, "/login");
});
