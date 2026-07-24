import assert from "node:assert/strict";
import test from "node:test";

test("the generated worker is available", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(new Request("http://localhost/"), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Controle de Carteira/i);
  assert.match(html, /Gestão contábil/i);
});
