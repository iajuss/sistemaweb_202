# Test regression fix report — `npm test` on worktree-backend-fundacao

## Root cause (confirmed with real error, not the redacted digest)

`app/page.tsx` is an async Server Component that calls `createSupabaseServerClient()`
(`lib/supabase/server.ts`), which does:

```ts
createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { ... })
```

`node --test tests/rendered-html.test.mjs` runs as a plain Node process — it never goes
through `vinext dev`/wrangler/miniflare's `.env.local`/`.dev.vars` loading, so
`process.env.SUPABASE_URL` and `process.env.SUPABASE_ANON_KEY` are genuinely `undefined`
in that process.

I confirmed this by temporarily instrumenting `lib/supabase/server.ts` with a
`console.error` of the raw env vars and a `try/catch` around `createServerClient(...)`
that re-logged the real thrown error before rethrowing, rebuilt (`npm run build`), and
invoked the built worker directly from a scratch script. The real underlying error
(masked by React's production digest in the test's own output) was:

```
DEBUG_TMP SUPABASE_URL= undefined SUPABASE_ANON_KEY= undefined
DEBUG_TMP createServerClient threw: Error: Your project's URL and Key are required to create a Supabase client!

Check your Supabase project's API settings to find these values

https://supabase.com/dashboard/project/_/settings/api
    at createServerClient (.../dist/server/index.js:36306:42)
    at createSupabaseServerClient (.../dist/server/index.js:36351:10)
    at async Page (.../dist/server/index.js:36375:19)
    ...
```

This confirms hypothesis #1 exactly: `@supabase/ssr`'s `createServerClient` throws
synchronously when given `undefined` URL/key, before the render ever reaches
`getUser()`/`redirect()`. That synchronous throw inside the RSC render is what Next
reports to the caller as the generic, digest-only "error occurred in the Server
Components render" message.

Hypothesis #2 was also confirmed once the crash was fixed: with valid client
construction, an unauthenticated request to `/` now genuinely redirects
(`redirect("/login")` in `app/page.tsx`), which `tests/rendered-html.test.mjs`'s old
assertions (`200` + dashboard markup) did not account for — that test predates the auth
guard added in this branch.

All debug instrumentation (the temporary `console.error`/`try-catch` in
`lib/supabase/server.ts` and a scratch `tests/debug-worker.mjs` script) was removed
before the final commit; `lib/supabase/server.ts` is unchanged from HEAD.

## What I changed and why

**`tests/rendered-html.test.mjs`** — the only file changed:

1. Added a small env-var bootstrap at the top of the test file:
   ```js
   process.env.SUPABASE_URL ??= "https://placeholder.supabase.co";
   process.env.SUPABASE_ANON_KEY ??= "placeholder-anon-key";
   ```
   This supplies clearly-fake placeholder values only for this raw-Node test process,
   using `??=` so it never overrides real values if they happen to be set (e.g. by a
   future CI env or `.env` loader). This does NOT touch `lib/supabase/server.ts` — the
   real auth guard and its "fail loudly if misconfigured" behavior (the `!`
   non-null assertions) are untouched, so a genuine production misconfiguration still
   throws instead of being silently masked. There's no existing `.env.test` or similar
   test-env convention in the repo (checked `.env.example`, `.env.local`, `.gitignore`
   — only `.env.local`/`.env.example` exist, consumed by `vinext dev`/wrangler, not by
   plain `node --test`), so an inline bootstrap in the test file itself was the
   least-invasive, most idiomatic option.

2. Updated the assertions to match the app's actual current behavior for an
   unauthenticated request to `/`: verified by running the built worker directly that
   it now returns a `307` with a `Location` header of `http://localhost/login`
   (absolute, since the worker resolves it against the request's origin). Assertions
   now check:
   ```js
   assert.ok([307, 308].includes(response.status), ...);
   assert.equal(new URL(response.headers.get("location")).pathname, "/login");
   ```
   This keeps the test's original smoke-test spirit (worker boots, serves something
   coherent for `/`) without turning it into a full auth integration test, per the
   task's instructions.

Nothing in `app/page.tsx`, `lib/supabase/server.ts`, the Supabase migrations, or the
auth API routes was modified.

## `npm test` output (final, passing)

```
> controle-de-carteira@0.1.0 test
> npm run build && node --test tests/rendered-html.test.mjs

> controle-de-carteira@0.1.0 build
> vinext build

  vinext build  (Vite 8.0.13)

[1/5] analyze client references...
transforming...✓ 195 modules transformed.
rendering chunks...
✓ built in 384ms
[2/5] analyze server references...
transforming...✓ 534 modules transformed.
rendering chunks...
✓ built in 269ms
[3/5] build rsc environment...
transforming...✓ 201 modules transformed.
rendering chunks...
computing gzip size...
✓ built in 440ms
[4/5] build client environment...
transforming...✓ 634 modules transformed.
rendering chunks...
computing gzip size...
✓ built in 422ms
[5/5] build ssr environment...
transforming...✓ 545 modules transformed.
rendering chunks...
computing gzip size...
✓ built in 416ms

  Route (app)
  ┌ ? /
  ├ λ /api/auth/login
  ├ λ /api/auth/logout
  ├ λ /api/auth/signup
  ├ ? /login
  └ ? /signup

  λ API  ? Unknown

  ? Some routes could not be classified. vinext currently uses static analysis
    and cannot detect dynamic API usage (headers(), cookies(), etc.) at build time.
    Automatic classification will be improved in a future release.

  Build complete. Run `vinext start` to start the production server.

✔ the generated worker is available (51.3389ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 119.4487
```

## `npx tsc --noEmit` output

```
worker/index.ts(6,11): error TS2304: Cannot find name 'Fetcher'.
worker/index.ts(7,7): error TS2552: Cannot find name 'D1Database'. Did you mean 'IDBDatabase'?
```

This error is **pre-existing** and unrelated to this fix — I verified it by stashing my
change and running `npx tsc --noEmit` against the original `HEAD` (`0b9c442`), which
produces the identical two errors (missing Cloudflare Workers ambient types —
`Fetcher`/`D1Database` — likely a `@cloudflare/workers-types` / tsconfig `types` gap).
Per the task's scope ("Do not touch unrelated code ... anything not required to make
`npm test` pass"), I left this untouched. `npm test` itself does not run `tsc` and is
unaffected.

## Files changed

- `tests/rendered-html.test.mjs` — env bootstrap for the raw-Node test process +
  assertions updated to match the real auth-redirect behavior of `/`.

No other files are part of the final diff (temporary debug instrumentation in
`lib/supabase/server.ts` and a scratch `tests/debug-worker.mjs` script used during
investigation were both fully reverted/removed before committing; `tsconfig.tsbuildinfo`
generated by the `tsc --noEmit` run was also deleted, not committed).
