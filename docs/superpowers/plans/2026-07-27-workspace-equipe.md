# Workspace multiusuário (equipe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um escritório tenha vários funcionários trabalhando juntos, convidados por e-mail pelo `responsavel`.

**Architecture:** Uma coluna `papel` (`responsavel`/`funcionario`) em `perfis` decide quem convida. O convite usa `supabase.auth.admin.inviteUserByEmail` (client administrativo novo, service-role key) com `escritorio_id` nos metadados; o trigger `handle_new_user()` lê esse metadado para anexar o novo perfil ao escritório existente em vez de criar um novo. O convidado completa o cadastro (nome + senha) reaproveitando a tela `/completar-cadastro` já existente. Uma aba "Equipe" nova em Configurações lista/convida/desativa.

**Tech Stack:** Next.js (vinext) App Router, Supabase (Postgres + Auth + RLS), `@supabase/supabase-js` (client admin), `node --test` para testes de unidade.

## Global Constraints

- Só existe um `responsavel` por escritório; nunca promover `funcionario` a `responsavel` nem transferir posse (fora de escopo).
- `funcionario` tem acesso igual ao `responsavel` em tudo, exceto a aba Equipe.
- `perfis` nunca é apagado (histórico de `responsavel_id` em `empresas`/`tarefas`/`modelos_recorrencia` depende disso) — desativar é `ativo=false` + banir login via Admin API, nunca `delete`.
- Seletores de "Responsável" no app (cadastro/edição de empresa, tarefa, modelo) só listam `perfis` com `ativo=true`.
- `SUPABASE_SERVICE_ROLE_KEY` é server-only: nunca importar `lib/supabase/admin.ts` em código que roda no client (arquivos `"use client"` ou em `src/services/*`).
- `PATCH /api/equipe/:id` só altera a coluna `ativo` — nunca `papel`/`escritorio_id`, mesmo que o corpo da requisição envie outros campos (a policy de RLS não trava isso a nível de coluna; a rota é a única linha de defesa e deve ignorar qualquer campo além de `ativo`).
- Ban permanente via Admin API usa `ban_duration: "876000h"` (~100 anos, padrão documentado do Supabase); reverter usa `ban_duration: "none"`.
- Migrações manuais vão em `supabase/migrations/manual/`, numeração sequencial (`0015_...`), mesmo padrão das anteriores.

---

## Mapa de arquivos

| Arquivo | O que faz |
|---|---|
| `supabase/migrations/manual/0015_perfis_equipe.sql` | Cria colunas, o backfill de e-mail, o trigger novo e a policy de update |
| `db/schema.ts` | Espelha as 3 colunas novas de `perfis` (Drizzle, documentação viva do schema) |
| `lib/equipe.ts` | Tipos (`Papel`, `MembroEquipe`) + validação pura (`validarEmailConvite`) — testável sem banco |
| `tests/equipe.test.mjs` | Testes de unidade de `lib/equipe.ts` |
| `lib/supabase/admin.ts` | Client administrativo (service-role), server-only |
| `app/api/equipe/convites/route.ts` | `POST` — convida por e-mail |
| `app/api/equipe/[id]/route.ts` | `PATCH` — ativa/desativa membro |
| `app/api/equipe/route.ts` | `GET` — lista a equipe do escritório |
| `app/api/perfis/route.ts` | Modificado: filtra `ativo=true` |
| `src/services/portfolio.ts` | Novas funções de client: `listarEquipe`, `convidarFuncionario`, `atualizarMembroEquipe` |
| `app/page.tsx` | Passa `papel` pro `HomeClient` |
| `app/home-client.tsx` | `HomeClient`/`Settings` ganham `papel` + seção "Equipe" |
| `app/completar-cadastro/page.tsx` | Branch de formulário por `papel` |
| `app/api/auth/completar-cadastro/route.ts` | Branch de lógica por `papel` (pula rename de escritório, seta senha) |

---

### Task 1: Migração `0015_perfis_equipe.sql`

**Files:**
- Create: `supabase/migrations/manual/0015_perfis_equipe.sql`
- Modify: `db/schema.ts:21-31` (tabela `perfis`)

**Interfaces:**
- Produces: colunas `perfis.email` (text), `perfis.papel` (text, `'responsavel'|'funcionario'`), `perfis.ativo` (boolean); função `public.sou_responsavel()`; policy `perfis_update_equipe_responsavel`.

Esta é uma migração de banco — não existe suíte automatizada de SQL neste projeto (mesmo padrão das migrações `0001`-`0014`: o arquivo é escrito, comitado, e você roda manualmente no SQL Editor do Supabase). A "verificação" desta task é uma query de conferência que você mesmo roda.

- [ ] **Step 1: Escrever o arquivo de migração**

```sql
-- Workspace multiusuário: papel (responsavel/funcionario), e-mail
-- denormalizado (pra listar a equipe sem chamar a Admin API) e ativo
-- (desativar sem apagar o perfil — responsavel_id em empresas/tarefas
-- depende dele existir). Ver docs/superpowers/specs/2026-07-27-workspace-equipe-design.md.

alter table public.perfis
  add column if not exists email text not null default '',
  add column if not exists papel text not null default 'responsavel'
    check (papel in ('responsavel','funcionario')),
  add column if not exists ativo boolean not null default true;

-- Backfill do email pros perfis que já existiam antes desta coluna.
update public.perfis p
set email = u.email
from auth.users u
where p.id = u.id and p.email = '';

-- Substitui a função de 0012: agora decide, pelo metadado
-- `escritorio_id` do convite, se o novo perfil entra num escritório
-- existente (convite) ou cria um escritório novo (cadastro normal/Google).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  escritorio_convite uuid;
  novo_escritorio_id uuid;
begin
  escritorio_convite := (new.raw_user_meta_data ->> 'escritorio_id')::uuid;

  if escritorio_convite is not null then
    insert into public.perfis (id, escritorio_id, nome, email, papel, cadastro_completo)
    values (new.id, escritorio_convite, '', new.email, 'funcionario', false);
  else
    insert into public.escritorios (nome)
    values (coalesce(new.raw_user_meta_data ->> 'escritorio_nome', 'Meu escritório'))
    returning id into novo_escritorio_id;

    insert into public.perfis (id, escritorio_id, nome, email, papel, cadastro_completo)
    values (
      new.id,
      novo_escritorio_id,
      coalesce(new.raw_user_meta_data ->> 'nome', new.email),
      new.email,
      'responsavel',
      new.raw_user_meta_data ? 'escritorio_nome'
    );
  end if;

  return new;
end;
$$;

-- Reaproveita o padrão security-definer de 0003 (meu_escritorio_id) pra
-- evitar o mesmo bug de recursão infinita numa policy de SELECT/UPDATE em
-- perfis que reconsulta perfis.
create or replace function public.sou_responsavel()
returns boolean
language sql security definer stable set search_path = public
as $$
  select papel = 'responsavel' from public.perfis where id = auth.uid()
$$;

create policy "perfis_update_equipe_responsavel" on public.perfis
  for update using (
    escritorio_id = public.meu_escritorio_id() and public.sou_responsavel()
  ) with check (
    escritorio_id = public.meu_escritorio_id()
  );
```

- [ ] **Step 2: Rodar no Supabase (você)**

Cole o conteúdo do arquivo no SQL Editor do Supabase (dashboard do projeto compartilhado) e execute. Se aparecer "policy already exists" ou similar por já ter tentado antes, me avise antes de tentar de novo — mesmo caso que já resolvemos com `0012`.

- [ ] **Step 3: Verificar (você, no SQL Editor)**

```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'perfis' and column_name in ('email','papel','ativo');
```

Esperado: 3 linhas — `email` (`text`, default `''`), `papel` (`text`, default `'responsavel'::text`), `ativo` (`boolean`, default `true`).

- [ ] **Step 4: Espelhar no schema Drizzle**

Em `db/schema.ts`, dentro de `export const perfis = pgTable("perfis", { ... })`, depois de `cadastroCompleto`:

```typescript
  email: text("email").notNull().default(""),
  papel: text("papel").notNull().default("responsavel"),
  ativo: boolean("ativo").notNull().default(true),
```

(Drizzle não tem `check` constraint tipado facilmente aqui — a validação de `papel` fica só no banco, mesmo padrão que o projeto já usa pra outros `check`s manuais.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros novos (os erros pré-existentes de `worker/index.ts` continuam, ignore-os).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/manual/0015_perfis_equipe.sql db/schema.ts
git commit -m "feat: coluna papel/email/ativo em perfis + trigger de convite"
```

---

### Task 2: `lib/equipe.ts` — tipos e validação pura

**Files:**
- Create: `lib/equipe.ts`
- Test: `tests/equipe.test.mjs`

**Interfaces:**
- Produces: `type Papel = "responsavel" | "funcionario"`, `type MembroEquipe = { id: string; nome: string; email: string; papel: Papel; ativo: boolean; criadoEm: string }`, `function validarEmailConvite(email: unknown): string | null` (retorna mensagem de erro ou `null` se válido).
- Consumes: nada (função pura, zero I/O).

- [ ] **Step 1: Escrever o teste (vai falhar — o arquivo ainda não existe)**

```javascript
// tests/equipe.test.mjs
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/equipe.test.mjs`
Expected: FAIL (arquivo `lib/equipe.ts` não existe ainda).

- [ ] **Step 3: Implementar**

```typescript
// lib/equipe.ts
export type Papel = "responsavel" | "funcionario";

export type MembroEquipe = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  criadoEm: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validação de formato só — não confirma que a caixa existe (isso é papel do Supabase ao enviar o convite). */
export function validarEmailConvite(email: unknown): string | null {
  const valor = typeof email === "string" ? email.trim() : "";
  if (!valor) return "Informe o e-mail do funcionário.";
  if (!EMAIL_REGEX.test(valor)) return "Informe um e-mail válido.";
  return null;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/equipe.test.mjs`
Expected: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/equipe.ts tests/equipe.test.mjs
git commit -m "feat: tipos e validação de e-mail de convite (lib/equipe.ts)"
```

---

### Task 3: `lib/supabase/admin.ts` — client administrativo

**Files:**
- Create: `lib/supabase/admin.ts`
- Test: `tests/supabase-admin.test.mjs`

**Interfaces:**
- Consumes: `process.env.SUPABASE_URL`, `process.env.SUPABASE_SERVICE_ROLE_KEY`.
- Produces: `function createSupabaseAdminClient(): SupabaseClient` — usado só em `app/api/equipe/*` (nunca em código client-side).

Antes de começar esta task, você precisa adicionar a variável de ambiente:
em **Project Settings → API** no dashboard do Supabase, copie a **service_role key** (não é a `anon key` que já está no `.env.local`) e adicione uma linha nova no `.env.local`:

```
SUPABASE_SERVICE_ROLE_KEY=<a chave que você copiou>
```

Essa chave nunca deve ir para o navegador nem para um arquivo `"use client"` — só é lida dentro de Route Handlers (`app/api/**/route.ts`), que rodam no servidor.

- [ ] **Step 1: Escrever o teste (vai falhar)**

```javascript
// tests/supabase-admin.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

test("lança erro claro se SUPABASE_SERVICE_ROLE_KEY não está definida", async () => {
  const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const { createSupabaseAdminClient } = await import("../lib/supabase/admin.ts?semkey");
    assert.throws(() => createSupabaseAdminClient(), /SUPABASE_SERVICE_ROLE_KEY/);
  } finally {
    if (original !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = original;
  }
});
```

(O `?semkey` no import força o Node a não reusar um módulo já cacheado de uma execução anterior do mesmo arquivo dentro da suíte — inofensivo, é só um query string ignorado pelo resolvedor de módulo.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/supabase-admin.test.mjs`
Expected: FAIL (arquivo não existe).

- [ ] **Step 3: Implementar**

```typescript
// lib/supabase/admin.ts
import { createClient } from "@supabase/supabase-js";

/**
 * Client com a service_role key — ignora RLS. Só pode ser usado em Route
 * Handlers (server-only), pra ações que exigem a Admin API (convidar
 * usuário, banir login). Nunca importar isto em código que roda no
 * navegador.
 */
export function createSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada. Veja o Project Settings > API no Supabase.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/supabase-admin.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/admin.ts tests/supabase-admin.test.mjs
git commit -m "feat: client administrativo do Supabase (service-role)"
```

---

### Task 4: `POST /api/equipe/convites` — convidar funcionário

**Files:**
- Create: `app/api/equipe/convites/route.ts`
- Modify: `src/services/portfolio.ts` (nova função `convidarFuncionario`)

**Interfaces:**
- Consumes: `createSupabaseRouteHandlerClient` (`lib/supabase/server.ts`), `createSupabaseAdminClient` (`lib/supabase/admin.ts`), `validarEmailConvite` (`lib/equipe.ts`).
- Produces: `POST /api/equipe/convites` body `{ email: string }` → `201 { ok: true }` ou `4xx { error: string }`. `convidarFuncionario(email: string): Promise<void>` no client.

Sem banco de testes local, esta rota não tem teste automatizado (mesmo caso de todas as outras rotas de API do projeto, ex. `app/api/auditoria/executar/route.ts`) — a verificação é manual, contra o Supabase real, no Step 4.

- [ ] **Step 1: Implementar a rota**

```typescript
// app/api/equipe/convites/route.ts
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validarEmailConvite } from "@/lib/equipe";

export async function POST(request: Request) {
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  let payload: { email?: string };
  try {
    payload = (await request.json()) as { email?: string };
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  const erroEmail = validarEmailConvite(payload.email);
  if (erroEmail) {
    return applySetCookies(Response.json({ error: erroEmail }, { status: 400 }));
  }
  const email = (payload.email as string).trim();

  const { data: perfil } = await supabase
    .from("perfis")
    .select("escritorio_id, papel")
    .eq("id", user.id)
    .single();

  if (!perfil || perfil.papel !== "responsavel") {
    return applySetCookies(Response.json({ error: "Só o responsável pelo escritório pode convidar." }, { status: 403 }));
  }

  const { data: jaMembro } = await supabase
    .from("perfis")
    .select("id")
    .eq("escritorio_id", perfil.escritorio_id)
    .eq("email", email)
    .maybeSingle();

  if (jaMembro) {
    return applySetCookies(Response.json({ error: "Este e-mail já faz parte da equipe." }, { status: 409 }));
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { escritorio_id: perfil.escritorio_id },
  });

  if (error) {
    const jaExisteEmOutroEscritorio = error.message.toLowerCase().includes("already");
    return applySetCookies(
      Response.json(
        { error: jaExisteEmOutroEscritorio ? "Este e-mail já está cadastrado no sistema." : "Não foi possível enviar o convite." },
        { status: 400 },
      ),
    );
  }

  return applySetCookies(Response.json({ ok: true }, { status: 201 }));
}
```

- [ ] **Step 2: Adicionar a função de client em `src/services/portfolio.ts`**

Adicione perto de `listarPerfis` (a função `extrairMensagemDeErro` já existe no topo do arquivo, reusada aqui):

```typescript
/** POST /api/equipe/convites — convida um funcionário por e-mail (só o responsável). */
export async function convidarFuncionario(email: string): Promise<void> {
  const response = await fetch("/api/equipe/convites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível enviar o convite."));
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros novos.

- [ ] **Step 4: Verificação manual (você, com o app rodando e logado como responsável)**

1. Confirme que rodou o Step 2 da Task 1 (migração) e configurou `SUPABASE_SERVICE_ROLE_KEY` (Task 3) — sem os dois, esta rota falha.
2. No Supabase, edite o template de e-mail **"Invite user"** (Authentication → Email Templates) pra apontar pro mesmo link que o "Confirm signup" já usa, trocando só o `type`: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`.
3. Chame a rota com um e-mail seu (outra caixa de entrada sua, ex. um alias) via `fetch` no console do navegador (já logado) ou peça pra eu rodar via `curl` com o cookie de sessão.
4. Confirme que o e-mail chegou e que o link leva pra dentro do app com uma sessão nova (sem completar_cadastro pronto ainda — normal, isso é a Task 9).

- [ ] **Step 5: Commit**

```bash
git add app/api/equipe/convites/route.ts src/services/portfolio.ts
git commit -m "feat: rota de convite de funcionário (POST /api/equipe/convites)"
```

---

### Task 5: `GET /api/equipe` — listar a equipe

**Files:**
- Create: `app/api/equipe/route.ts`
- Modify: `src/services/portfolio.ts` (nova função `listarEquipe`)

**Interfaces:**
- Consumes: `MembroEquipe` (`lib/equipe.ts`), `createSupabaseServerClient`.
- Produces: `GET /api/equipe` → `200 MembroEquipe[]`. `listarEquipe(): Promise<MembroEquipe[]>` no client.

- [ ] **Step 1: Implementar a rota**

```typescript
// app/api/equipe/route.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MembroEquipe } from "@/lib/equipe";

type PerfilRow = {
  id: string;
  nome: string;
  email: string;
  papel: "responsavel" | "funcionario";
  ativo: boolean;
  criado_em: string;
};

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { data: perfil } = await supabase.from("perfis").select("papel").eq("id", user.id).single();

  if (!perfil || perfil.papel !== "responsavel") {
    return Response.json({ error: "Só o responsável pelo escritório pode ver a equipe." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("perfis")
    .select("id, nome, email, papel, ativo, criado_em")
    .order("criado_em", { ascending: true });

  if (error) {
    return Response.json({ error: "Não foi possível carregar a equipe." }, { status: 500 });
  }

  const equipe: MembroEquipe[] = (data as unknown as PerfilRow[]).map((row) => ({
    id: row.id,
    nome: row.nome,
    email: row.email,
    papel: row.papel,
    ativo: row.ativo,
    criadoEm: row.criado_em,
  }));

  return Response.json(equipe);
}
```

- [ ] **Step 2: Adicionar a função de client**

```typescript
/** GET /api/equipe — lista a equipe do escritório (só o responsável enxerga). */
export async function listarEquipe(): Promise<MembroEquipe[]> {
  const response = await fetch("/api/equipe");
  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível carregar a equipe."));
  }
  return response.json();
}
```

Adicione `import type { MembroEquipe } from "@/lib/equipe";` no topo de `src/services/portfolio.ts`, e reexporte o tipo pra quem importa de `portfolio.ts` (mesmo padrão dos outros tipos do arquivo): `export type { MembroEquipe } from "@/lib/equipe";`

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add app/api/equipe/route.ts src/services/portfolio.ts
git commit -m "feat: rota de listagem da equipe (GET /api/equipe)"
```

---

### Task 6: `PATCH /api/equipe/:id` — ativar/desativar

**Files:**
- Create: `app/api/equipe/[id]/route.ts`
- Modify: `src/services/portfolio.ts` (nova função `atualizarMembroEquipe`)

**Interfaces:**
- Consumes: `createSupabaseRouteHandlerClient`, `createSupabaseAdminClient`.
- Produces: `PATCH /api/equipe/:id` body `{ ativo: boolean }` → `200 { ok: true }`. `atualizarMembroEquipe(id: string, ativo: boolean): Promise<void>` no client.

- [ ] **Step 1: Implementar a rota**

```typescript
// app/api/equipe/[id]/route.ts
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  let payload: { ativo?: unknown };
  try {
    payload = (await request.json()) as { ativo?: unknown };
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  if (typeof payload.ativo !== "boolean") {
    return applySetCookies(Response.json({ error: "Informe ativo como verdadeiro ou falso." }, { status: 400 }));
  }
  const ativo = payload.ativo;

  const { data: meuPerfil } = await supabase.from("perfis").select("escritorio_id, papel").eq("id", user.id).single();

  if (!meuPerfil || meuPerfil.papel !== "responsavel") {
    return applySetCookies(Response.json({ error: "Só o responsável pelo escritório pode gerenciar a equipe." }, { status: 403 }));
  }

  const { data: alvo } = await supabase
    .from("perfis")
    .select("escritorio_id, papel")
    .eq("id", id)
    .single();

  if (!alvo || alvo.escritorio_id !== meuPerfil.escritorio_id || alvo.papel !== "funcionario") {
    return applySetCookies(Response.json({ error: "Funcionário não encontrado." }, { status: 404 }));
  }

  const { error: erroUpdate } = await supabase.from("perfis").update({ ativo }).eq("id", id);

  if (erroUpdate) {
    return applySetCookies(Response.json({ error: "Não foi possível atualizar o funcionário." }, { status: 500 }));
  }

  const admin = createSupabaseAdminClient();
  const { error: erroBan } = await admin.auth.admin.updateUserById(id, {
    ban_duration: ativo ? "none" : "876000h",
  });

  if (erroBan) {
    // Reverte o ativo já gravado, pra não ficar num estado inconsistente
    // (perfil dizendo ativo mas login ainda banido, ou vice-versa).
    await supabase.from("perfis").update({ ativo: !ativo }).eq("id", id);
    return applySetCookies(Response.json({ error: "Não foi possível atualizar o acesso de login." }, { status: 500 }));
  }

  return applySetCookies(Response.json({ ok: true }));
}
```

- [ ] **Step 2: Adicionar a função de client**

```typescript
/** PATCH /api/equipe/:id — ativa ou desativa o acesso de um funcionário. */
export async function atualizarMembroEquipe(id: string, ativo: boolean): Promise<void> {
  const response = await fetch(`/api/equipe/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ativo }),
  });
  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível atualizar o funcionário."));
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add "app/api/equipe/[id]/route.ts" src/services/portfolio.ts
git commit -m "feat: rota de ativar/desativar funcionário (PATCH /api/equipe/:id)"
```

---

### Task 7: Filtrar `GET /api/perfis` por `ativo=true`

**Files:**
- Modify: `app/api/perfis/route.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: mesmo shape de antes (`{id, nome}[]`) — só o filtro de linhas muda, nenhum consumidor no frontend precisa mudar.

- [ ] **Step 1: Editar a query**

Em `app/api/perfis/route.ts`, troque:

```typescript
  const { data, error } = await supabase.from("perfis").select("id, nome").order("nome", { ascending: true });
```

por:

```typescript
  const { data, error } = await supabase
    .from("perfis")
    .select("id, nome")
    .eq("ativo", true)
    .order("nome", { ascending: true });
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add app/api/perfis/route.ts
git commit -m "fix: seletor de responsável só lista perfis ativos"
```

---

### Task 8: Aba "Equipe" em Configurações

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/home-client.tsx` (`HomeClient`, `Settings`)

**Interfaces:**
- Consumes: `listarEquipe`, `convidarFuncionario`, `atualizarMembroEquipe` (`src/services/portfolio.ts`), `type MembroEquipe, type Papel` (`src/services/portfolio.ts` reexport de `lib/equipe.ts`).
- Produces: nenhuma interface nova pra outras tasks (é a ponta final da UI).

- [ ] **Step 1: `app/page.tsx` — buscar e passar `papel`**

```typescript
  const { data: perfil } = await supabase
    .from("perfis")
    .select("nome, cadastro_completo, papel")
    .eq("id", user.id)
    .single();

  if (perfil && !perfil.cadastro_completo) {
    redirect("/completar-cadastro");
  }

  const nomeDoUsuario = perfil?.nome ?? user.user_metadata?.nome ?? "Usuário";
  const papel = perfil?.papel ?? "responsavel";

  return <HomeClient userName={nomeDoUsuario} userEmail={user.email ?? ""} papel={papel} />;
```

- [ ] **Step 2: `HomeClient` — receber e repassar `papel`**

Em `app/home-client.tsx:203`, troque a assinatura:

```typescript
export function HomeClient({ userName, userEmail, papel }: { userName: string; userEmail: string; papel: "responsavel" | "funcionario" }) {
```

E na linha 288, troque `<Settings userName={userName} userEmail={userEmail} />` por `<Settings userName={userName} userEmail={userEmail} papel={papel} />`.

- [ ] **Step 3: `Settings` — seção Equipe (só pra responsável)**

Troque a assinatura de `Settings` (linha 317):

```typescript
function Settings({ userName, userEmail, papel }: { userName: string; userEmail: string; papel: "responsavel" | "funcionario" }) {
```

Adicione, dentro do componente, antes do `return`:

```typescript
  const [equipe, setEquipe] = useState<MembroEquipe[]>([]);
  const [conviteEmail, setConviteEmail] = useState("");
  const [conviteMessage, setConviteMessage] = useState("");
  const [convidando, setConvidando] = useState(false);
  const [atualizandoId, setAtualizandoId] = useState<string | null>(null);

  useEffect(() => {
    if (papel === "responsavel") listarEquipe().then(setEquipe).catch(() => setEquipe([]));
  }, [papel]);

  const convidar = async (event: FormEvent) => {
    event.preventDefault();
    setConvidando(true); setConviteMessage("");
    try {
      await convidarFuncionario(conviteEmail);
      setConviteEmail("");
      setConviteMessage("Convite enviado com sucesso.");
      setEquipe(await listarEquipe());
    } catch (error) {
      setConviteMessage(error instanceof Error ? error.message : "Não foi possível enviar o convite.");
    } finally {
      setConvidando(false);
    }
  };

  const alternarAtivo = async (membro: MembroEquipe) => {
    setAtualizandoId(membro.id);
    try {
      await atualizarMembroEquipe(membro.id, !membro.ativo);
      setEquipe(await listarEquipe());
    } finally {
      setAtualizandoId(null);
    }
  };
```

E, dentro do `return <> ... </>`, logo depois da `</section>` que fecha `settings-grid` (linha ~371), adicione a seção nova (só renderiza se `papel === "responsavel"`):

```typescript
    {papel === "responsavel" && <section className="settings-grid">
      <article className="panel settings-panel equipe-panel">
        <div className="settings-panel-head"><span aria-hidden="true">◍</span><div><h3>Equipe</h3><p>Convide funcionários para trabalhar junto com você neste espaço.</p></div></div>
        <form className="settings-form" onSubmit={convidar}>
          <label>E-mail do funcionário<input type="email" required value={conviteEmail} onChange={(e) => setConviteEmail(e.target.value)} placeholder="funcionario@email.com" /></label>
          {conviteMessage && <p className={conviteMessage.includes("sucesso") ? "settings-message success" : "settings-message error"} role={conviteMessage.includes("sucesso") ? "status" : "alert"}>{conviteMessage}</p>}
          <button className="primary" disabled={convidando}>{convidando ? "Enviando…" : "Convidar"}</button>
        </form>
        <table className="equipe-table">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th><th></th></tr></thead>
          <tbody>{equipe.map((m) => <tr key={m.id}>
            <td>{m.nome || "Convite pendente"}</td>
            <td>{m.email}</td>
            <td>{m.papel === "responsavel" ? "Responsável" : "Funcionário"}</td>
            <td>{m.ativo ? "Ativo" : "Inativo"}</td>
            <td>{m.papel === "funcionario" && <button type="button" className="secondary" disabled={atualizandoId === m.id} onClick={() => alternarAtivo(m)}>{atualizandoId === m.id ? "Aguarde…" : m.ativo ? "Desativar" : "Reativar"}</button>}</td>
          </tr>)}</tbody>
        </table>
      </article>
    </section>}
```

- [ ] **Step 4: Import**

No topo de `app/home-client.tsx`, adicione ao bloco de imports de `src/services/portfolio.ts` (mesmo import já usado nas linhas ~5-7): `atualizarMembroEquipe, convidarFuncionario, listarEquipe`, e `type MembroEquipe`.

- [ ] **Step 5: CSS mínimo**

Em `app/globals.css`, adicione (reaproveitando classes que já existem: `.panel`, `.settings-form`, `.settings-message` já têm estilo — só a tabela é nova):

```css
.equipe-table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
.equipe-table th, .equipe-table td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border, #2a2a2a); }
```

(Se o projeto já tiver uma variável de borda diferente de `--border`, ajuste pro nome usado nas outras tabelas do `globals.css` — confira com `grep -n "border-bottom" app/globals.css` antes de escrever, pra não inventar uma variável nova.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros novos.

- [ ] **Step 7: Testar no navegador**

Rode `npm run dev`, entre como responsável, abra Configurações — confirme que a seção Equipe aparece, lista você mesmo, e o formulário de convite existe. Entre com um funcionário (depois da Task 9) e confirme que a seção Equipe NÃO aparece pra ele.

- [ ] **Step 8: Commit**

```bash
git add app/page.tsx app/home-client.tsx app/globals.css
git commit -m "feat: aba Equipe em Configurações (convidar, listar, desativar)"
```

---

### Task 9: Onboarding do convidado em `/completar-cadastro`

**Files:**
- Modify: `app/completar-cadastro/page.tsx`
- Modify: `app/api/auth/completar-cadastro/route.ts`

**Interfaces:**
- Consumes: `createSupabaseRouteHandlerClient`.
- Produces: mesmo endpoint, aceita agora `{ nome, senha, escritorioNome? }` (escritorioNome vira opcional).

- [ ] **Step 1: Rota — branch por papel**

Reescreva `app/api/auth/completar-cadastro/route.ts`:

```typescript
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let payload: { escritorioNome?: string; nome?: string; senha?: string };

  try {
    payload = (await request.json()) as { escritorioNome?: string; nome?: string; senha?: string };
  } catch {
    return Response.json({ error: "Informe seu nome." }, { status: 400 });
  }

  const nome = payload.nome?.trim() ?? "";
  if (!nome) {
    return Response.json({ error: "Informe seu nome." }, { status: 400 });
  }

  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 }));
  }

  const { data: perfil } = await supabase
    .from("perfis")
    .select("escritorio_id, papel")
    .eq("id", user.id)
    .single();

  if (!perfil) {
    return applySetCookies(Response.json({ error: "Perfil não encontrado." }, { status: 404 }));
  }

  if (perfil.papel === "responsavel") {
    const escritorioNome = payload.escritorioNome?.trim() ?? "";
    if (!escritorioNome) {
      return applySetCookies(Response.json({ error: "Informe o nome do escritório e o seu nome." }, { status: 400 }));
    }
    const { error: erroEscritorio } = await supabase
      .from("escritorios")
      .update({ nome: escritorioNome })
      .eq("id", perfil.escritorio_id);

    if (erroEscritorio) {
      return applySetCookies(Response.json({ error: "Não foi possível salvar o escritório. Tente novamente." }, { status: 400 }));
    }
  } else {
    const senha = payload.senha ?? "";
    if (senha.length < 8) {
      return applySetCookies(Response.json({ error: "A senha deve ter ao menos 8 caracteres." }, { status: 400 }));
    }
    const { error: erroSenha } = await supabase.auth.updateUser({ password: senha });
    if (erroSenha) {
      return applySetCookies(Response.json({ error: "Não foi possível definir a senha. Tente novamente." }, { status: 400 }));
    }
  }

  const { error: erroPerfil } = await supabase.from("perfis").update({ nome, cadastro_completo: true }).eq("id", user.id);

  if (erroPerfil) {
    return applySetCookies(Response.json({ error: "Não foi possível salvar o seu nome. Tente novamente." }, { status: 400 }));
  }

  return applySetCookies(Response.json({ ok: true }));
}
```

- [ ] **Step 2: Página — branch de formulário por papel**

Reescreva `app/completar-cadastro/page.tsx`:

```typescript
"use client";

import { FormEvent, useEffect, useState } from "react";

export default function CompletarCadastroPage() {
  const [papel, setPapel] = useState<"responsavel" | "funcionario" | null>(null);
  const [escritorioNome, setEscritorioNome] = useState("");
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/perfis/eu")
      .then((r) => r.json())
      .then((data: { papel: "responsavel" | "funcionario" }) => setPapel(data.papel))
      .catch(() => setPapel("responsavel"));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (papel === "funcionario" && senha !== confirmacao) {
      setError("As senhas informadas não coincidem.");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/auth/completar-cadastro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(papel === "funcionario" ? { nome, senha } : { escritorioNome, nome }),
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Não foi possível salvar seus dados.");
      setLoading(false);
      return;
    }

    window.location.href = "/";
  };

  return (
    <main className="auth-page auth-page-signup">
      <section className="auth-showcase signup-showcase" aria-label="Controle de Carteira">
        <a className="auth-brand" href="/"><span>▣</span> Controle de carteira</a>
        <div className="auth-showcase-copy"><p className="auth-kicker">Falta pouco</p><h1>{papel === "funcionario" ? "Só mais um passo e você já está no espaço da equipe." : "Só mais dois dados e sua carteira está pronta."}</h1><p>{papel === "funcionario" ? "Defina seu nome e uma senha de acesso." : "Precisamos saber como chamar você e qual é o nome do seu escritório."}</p></div>
      </section>
      <section className="auth-access">
        <div className="login-card signup-card">
          <div className="login-heading signup-heading"><h2>Complete seu cadastro</h2></div>
          <form className="login-form signup-form" onSubmit={submit}>
            {papel !== "funcionario" && <label htmlFor="escritorioNome">Nome do escritório<input id="escritorioNome" autoComplete="organization" placeholder="Ex.: Escritório Contábil Silva" required value={escritorioNome} onChange={(e) => setEscritorioNome(e.target.value)} /></label>}
            <label htmlFor="nome">Seu nome<input id="nome" autoComplete="name" placeholder="Como podemos chamar você?" required value={nome} onChange={(e) => setNome(e.target.value)} /></label>
            {papel === "funcionario" && <>
              <label htmlFor="senha">Senha<input id="senha" type="password" autoComplete="new-password" minLength={8} required value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
              <label htmlFor="confirmacao">Confirmar senha<input id="confirmacao" type="password" autoComplete="new-password" minLength={8} required value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} /></label>
            </>}
            {error && <div className="notice error" role="alert"><p>{error}</p></div>}
            <button className="login-submit" disabled={loading || papel === null}>{loading ? "Salvando…" : "Entrar na plataforma"}<span aria-hidden="true">→</span></button>
          </form>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Nova rota `GET /api/perfis/eu`**

A página acima precisa descobrir o `papel` do usuário logado antes de decidir o formulário. Crie:

```typescript
// app/api/perfis/eu/route.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { data: perfil } = await supabase.from("perfis").select("papel").eq("id", user.id).single();

  return Response.json({ papel: perfil?.papel ?? "responsavel" });
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros novos.

- [ ] **Step 5: Verificação manual end-to-end (você)**

1. Como responsável, convide um e-mail de teste (Task 4, Step 4).
2. Abra o link do convite (em uma janela anônima, pra não misturar sessão com a sua).
3. Confirme que a tela mostra só "Seu nome" + senha/confirmar senha (sem pedir nome de escritório).
4. Preencha e envie — confirme que cai na tela principal do app.
5. Na sua sessão (responsável), vá em Configurações → Equipe e confirme que o novo funcionário aparece, com o nome que ele escolheu.
6. Cadastre uma empresa e confirme que o funcionário aparece como opção no seletor "Responsável interno".
7. Desative o funcionário (botão "Desativar") e confirme, na janela anônima dele, que tentar logar de novo (se a sessão expirar) falha.

- [ ] **Step 6: Commit**

```bash
git add app/completar-cadastro/page.tsx app/api/auth/completar-cadastro/route.ts app/api/perfis/eu/route.ts
git commit -m "feat: onboarding de funcionário convidado em /completar-cadastro"
```

---

### Task 10: Checklist final de verificação manual

Sem passos de código — é a conferência de ponta a ponta antes de considerar a feature pronta.

- [ ] Migração `0015` rodada no Supabase (Task 1).
- [ ] Template de e-mail "Invite user" configurado apontando pra `/auth/confirm?token_hash={{ .TokenHash }}&type=invite` (Task 4).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` no `.env.local` (Task 3) — e, se houver ambiente de produção/deploy, também lá.
- [ ] Fluxo completo testado uma vez do zero: convite → e-mail recebido → onboarding → aparece na lista de Equipe → aparece como opção de responsável → desativação bloqueia login.
- [ ] `npm test` (suíte existente) e `node --test tests/equipe.test.mjs tests/supabase-admin.test.mjs tests/tarefas.test.mjs` todos verdes.
- [ ] `npx tsc --noEmit -p .` sem erros novos.

---

## Self-review

**Cobertura da spec:** papéis (Task 1), fluxo de convite (Tasks 1, 4), onboarding do convidado (Task 9), gestão de equipe/listar/desativar (Tasks 5, 6, 8), filtro de seletores por `ativo` (Task 7), migração completa (Task 1), passos manuais (Tasks 1/3/4/10) — todos cobertos.

**Placeholders:** nenhum "TBD"/"implementar depois" — toda task tem código completo.

**Consistência de tipos:** `MembroEquipe` definido uma vez em `lib/equipe.ts` (Task 2), reexportado por `portfolio.ts` (Task 5) e consumido sem redefinição em `home-client.tsx` (Task 8). `Papel` usado como literal `"responsavel" | "funcionario"` de forma consistente em todas as tasks (rotas, `HomeClient`, `Settings`).
