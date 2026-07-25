# Backend — Fundação (Supabase + Auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provisionar o banco de dados (Supabase/Postgres com RLS) e a autenticação (e-mail+senha, multi-tenant) que sustentam os quatro módulos do Controle de Carteira, entregando um fluxo de cadastro/login funcional ponta a ponta.

**Architecture:** Cloudflare Workers (scaffold `vinext` existente) hospeda a aplicação; Supabase fornece Postgres + Auth, acessados em runtime via `@supabase/supabase-js`/`@supabase/ssr` sobre HTTP (sem binding direto de banco). Drizzle ORM é usado só para definir o schema e gerar as migrações SQL, aplicadas manualmente no Supabase. RLS no Postgres reforça o isolamento por escritório (tenant) além do filtro na aplicação.

**Tech Stack:** Next.js App Router (via `vinext`), Cloudflare Workers, Supabase (Postgres + Auth), Drizzle ORM/Drizzle Kit, `@supabase/ssr`, TypeScript.

## Global Constraints

- Node >= 22.13.0 (de `package.json` `engines`).
- Toda tabela com `escritorio_id` precisa de RLS habilitado e policy de isolamento por tenant.
- Hospedagem permanece em Cloudflare Workers (scaffold `vinext`); não introduzir Next.js "puro" nem outro host.
- Somente serviços com plano gratuito (Cloudflare Workers free tier, Supabase free tier).
- Autenticação: e-mail + senha via Supabase Auth, cadastro aberto (self-service), um único nível de acesso por usuário (sem roles nesta fase).
- Não usar a chave `service_role` do Supabase na aplicação — todo acesso a dado passa pela sessão do usuário + RLS.

---

## Task 1: Criar o projeto Supabase e configurar variáveis de ambiente

**Files:**
- Create: `.env.example`
- Create: `.env.local` (não versionado — já coberto por `.env*` no `.gitignore`)

**Interfaces:**
- Produces: variáveis de ambiente `SUPABASE_URL` e `SUPABASE_ANON_KEY`, consumidas por `lib/supabase/server.ts` (Task 5).

- [ ] **Step 1: Criar o projeto no Supabase (ação manual do usuário)**

Acesse https://supabase.com/dashboard, crie uma conta/organização (gratuita) e um novo projeto (região mais próxima, ex: São Paulo/`sa-east-1` se disponível). Guarde a senha do banco gerada.

- [ ] **Step 2: Desativar confirmação de e-mail obrigatória (para permitir login imediato após cadastro nesta fase de desenvolvimento)**

No painel do projeto: **Authentication → Sign In / Providers → Email** → desmarque "Confirm email". (Pode ser reativado depois, quando houver envio de e-mail transacional configurado.)

- [ ] **Step 3: Copiar as credenciais do projeto**

Em **Project Settings → API**, copie:
- **Project URL** (ex: `https://xxxxxxxxxxxx.supabase.co`)
- **anon public key**

- [ ] **Step 4: Criar `.env.example`**

```
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 5: Criar `.env.local` com os valores reais**

Copie `.env.example` para `.env.local` e preencha com os valores reais copiados no Step 3. Este arquivo não deve ser commitado (já está coberto pela regra `.env*` em `.gitignore`).

- [ ] **Step 6: Verificar que o arquivo não será commitado**

Run: `git status`
Expected: `.env.local` não aparece na lista (nem em "Untracked files"). Se aparecer, pare e revise o `.gitignore` antes de continuar — não prossiga com um `.env.local` rastreado pelo git.

- [ ] **Step 7: Commit**

```bash
git add .env.example
git commit -m "chore: adiciona .env.example para credenciais do Supabase"
```

---

## Task 2: Definir o schema Drizzle e gerar a migração inicial das tabelas

**Files:**
- Modify: `drizzle.config.ts`
- Modify: `db/schema.ts`
- Delete: `db/index.ts` (era o binding D1, substituído pelo cliente Supabase da Task 5)
- Create: `supabase/migrations/*.sql` (gerado pelo drizzle-kit)

**Interfaces:**
- Produces: tabelas `escritorios`, `perfis`, `empresas`, `empresas_socios`, `divergencias`, `modelos_recorrencia`, `tarefas`, `feriados_cache` — consumidas por todas as rotas de API dos módulos (planos seguintes) e pela Task 3 (RLS).

- [ ] **Step 1: Atualizar `drizzle.config.ts` para Postgres**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./supabase/migrations",
  schema: "./db/schema.ts",
  dialect: "postgresql",
});
```

- [ ] **Step 2: Escrever o schema completo em `db/schema.ts`**

```ts
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const escritorios = pgTable("escritorios", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().default(sql`now()`),
});

// Espelha auth.users (1:1). O FK para auth.users é criado na migração
// de RLS (Task 3), pois auth.users não faz parte do schema Drizzle.
export const perfis = pgTable("perfis", {
  id: uuid("id").primaryKey(),
  escritorioId: uuid("escritorio_id")
    .notNull()
    .references(() => escritorios.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().default(sql`now()`),
});

export const empresas = pgTable("empresas", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  escritorioId: uuid("escritorio_id")
    .notNull()
    .references(() => escritorios.id, { onDelete: "cascade" }),
  cnpj: text("cnpj").notNull(),
  razaoSocial: text("razao_social").notNull(),
  fantasia: text("fantasia").notNull().default(""),
  cidade: text("cidade").notNull().default(""),
  estado: text("estado").notNull().default(""),
  endereco: text("endereco").notNull().default(""),
  cnaeCodigo: text("cnae_codigo").notNull().default(""),
  cnaeDescricao: text("cnae_descricao").notNull().default(""),
  porte: text("porte").notNull().default(""),
  situacaoCadastral: text("situacao_cadastral").notNull().default(""),
  abertura: date("abertura"),
  responsavelId: uuid("responsavel_id").references(() => perfis.id),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  observacoes: text("observacoes").notNull().default(""),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().default(sql`now()`),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().default(sql`now()`),
});

export const empresasSocios = pgTable("empresas_socios", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  empresaId: uuid("empresa_id")
    .notNull()
    .references(() => empresas.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  papel: text("papel").notNull().default(""),
});

export const divergencias = pgTable("divergencias", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  escritorioId: uuid("escritorio_id")
    .notNull()
    .references(() => escritorios.id, { onDelete: "cascade" }),
  empresaId: uuid("empresa_id")
    .notNull()
    .references(() => empresas.id, { onDelete: "cascade" }),
  tipo: text("tipo").notNull(),
  atual: text("atual").notNull(),
  sugerido: text("sugerido"),
  status: text("status").notNull().default("Pendente"),
  detectadoEm: timestamp("detectado_em", { withTimezone: true }).notNull().default(sql`now()`),
  resolvidoEm: timestamp("resolvido_em", { withTimezone: true }),
});

export const modelosRecorrencia = pgTable("modelos_recorrencia", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  escritorioId: uuid("escritorio_id")
    .notNull()
    .references(() => escritorios.id, { onDelete: "cascade" }),
  titulo: text("titulo").notNull(),
  tipo: text("tipo").notNull(),
  periodicidade: text("periodicidade").notNull(),
  diaReferencia: integer("dia_referencia").notNull(),
  responsavelId: uuid("responsavel_id").references(() => perfis.id),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().default(sql`now()`),
});

export const tarefas = pgTable("tarefas", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  escritorioId: uuid("escritorio_id")
    .notNull()
    .references(() => escritorios.id, { onDelete: "cascade" }),
  modeloId: uuid("modelo_id").references(() => modelosRecorrencia.id, { onDelete: "set null" }),
  empresaId: uuid("empresa_id")
    .notNull()
    .references(() => empresas.id, { onDelete: "cascade" }),
  titulo: text("titulo").notNull(),
  tipo: text("tipo").notNull(),
  responsavelId: uuid("responsavel_id").references(() => perfis.id),
  vencimento: date("vencimento").notNull(),
  status: text("status").notNull().default("Pendente"),
  concluidoEm: timestamp("concluido_em", { withTimezone: true }),
});

export const feriadosCache = pgTable("feriados_cache", {
  data: date("data").primaryKey(),
  nome: text("nome").notNull(),
  ano: integer("ano").notNull(),
});
```

- [ ] **Step 3: Remover o binding D1 antigo**

Run: `git rm db/index.ts`

(Ele lançava erro se chamado sem o binding `DB` do Cloudflare D1, que não usamos mais — o acesso a dado passa a ser via `lib/supabase/server.ts`, criado na Task 5.)

- [ ] **Step 4: Gerar a migração inicial**

Run: `npm run db:generate`
Expected: saída do drizzle-kit confirmando a criação de um arquivo `.sql` dentro de `supabase/migrations/` (nome gerado automaticamente, ex: `0000_algum-nome.sql`) e uma pasta `supabase/migrations/meta/`.

- [ ] **Step 5: Conferir o SQL gerado**

Run: `ls supabase/migrations/*.sql`

Abra o arquivo listado e confirme que contém `create table` para as 8 tabelas do Step 2, com as colunas esperadas.

- [ ] **Step 6: Commit**

```bash
git add drizzle.config.ts db/schema.ts supabase/migrations
git commit -m "feat: define schema Postgres multi-tenant e gera migração inicial"
```

---

## Task 3: Escrever a migração de RLS e do gatilho de criação de perfil

**Files:**
- Create: `supabase/migrations/0001_rls_and_profile_trigger.sql`

**Interfaces:**
- Consumes: tabelas criadas na Task 2.
- Produces: policies de RLS ativas + trigger `on_auth_user_created`, exigido pelo fluxo de signup da Task 6.

- [ ] **Step 1: Escrever a migração de RLS e do gatilho**

```sql
-- Liga perfis ao auth.users do Supabase
alter table public.perfis
  add constraint perfis_id_fkey foreign key (id) references auth.users (id) on delete cascade;

-- Habilita RLS em todas as tabelas
alter table public.escritorios enable row level security;
alter table public.perfis enable row level security;
alter table public.empresas enable row level security;
alter table public.empresas_socios enable row level security;
alter table public.divergencias enable row level security;
alter table public.modelos_recorrencia enable row level security;
alter table public.tarefas enable row level security;
alter table public.feriados_cache enable row level security;

-- perfis: usuário só enxerga/edita o próprio perfil
create policy "perfis_select_own" on public.perfis
  for select using (id = auth.uid());
create policy "perfis_update_own" on public.perfis
  for update using (id = auth.uid());

-- escritorios: usuário só enxerga o escritório do próprio perfil
create policy "escritorios_select_own" on public.escritorios
  for select using (
    id = (select escritorio_id from public.perfis where id = auth.uid())
  );

-- Tabelas com escritorio_id: isolamento padrão por tenant
create policy "empresas_isolamento" on public.empresas
  for all using (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  ) with check (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  );

create policy "divergencias_isolamento" on public.divergencias
  for all using (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  ) with check (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  );

create policy "modelos_recorrencia_isolamento" on public.modelos_recorrencia
  for all using (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  ) with check (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  );

create policy "tarefas_isolamento" on public.tarefas
  for all using (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  ) with check (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  );

-- empresas_socios: isolamento via join com empresas (não tem escritorio_id direto)
create policy "empresas_socios_isolamento" on public.empresas_socios
  for all using (
    empresa_id in (
      select id from public.empresas
      where escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
    )
  ) with check (
    empresa_id in (
      select id from public.empresas
      where escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
    )
  );

-- feriados_cache: dado global, não sensível — qualquer usuário autenticado lê e popula
create policy "feriados_cache_select" on public.feriados_cache
  for select using (auth.role() = 'authenticated');
create policy "feriados_cache_insert" on public.feriados_cache
  for insert with check (auth.role() = 'authenticated');

-- Gatilho: ao criar um usuário no Supabase Auth, cria o escritório e o perfil dele
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  novo_escritorio_id uuid;
begin
  insert into public.escritorios (nome)
  values (coalesce(new.raw_user_meta_data ->> 'escritorio_nome', 'Meu escritório'))
  returning id into novo_escritorio_id;

  insert into public.perfis (id, escritorio_id, nome)
  values (new.id, novo_escritorio_id, coalesce(new.raw_user_meta_data ->> 'nome', new.email));

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0001_rls_and_profile_trigger.sql
git commit -m "feat: adiciona RLS multi-tenant e gatilho de criação de perfil"
```

---

## Task 4: Aplicar as migrações no Supabase e verificar

**Files:** nenhum arquivo novo — passo operacional contra o projeto Supabase criado na Task 1.

**Interfaces:**
- Consumes: arquivos `supabase/migrations/*.sql` das Tasks 2 e 3.
- Produces: banco de dados real com tabelas + RLS + trigger, usado por todas as tasks seguintes.

- [ ] **Step 1: Abrir o SQL Editor do Supabase**

No painel do projeto: **SQL Editor → New query**.

- [ ] **Step 2: Colar e rodar a migração de tabelas**

Cole o conteúdo do arquivo `supabase/migrations/0000_*.sql` (gerado na Task 2) e clique em **Run**.
Expected: mensagem de sucesso, sem erros. Se der erro de tabela já existente, pare e avise antes de prosseguir.

- [ ] **Step 3: Colar e rodar a migração de RLS/gatilho**

Nova query com o conteúdo de `supabase/migrations/0001_rls_and_profile_trigger.sql` → **Run**.
Expected: sucesso, sem erros.

- [ ] **Step 4: Verificar as tabelas criadas**

Em **Table Editor**, confirme que as 8 tabelas aparecem: `escritorios`, `perfis`, `empresas`, `empresas_socios`, `divergencias`, `modelos_recorrencia`, `tarefas`, `feriados_cache`. Confirme que cada uma mostra o cadeado de RLS habilitado (ícone ao lado do nome da tabela).

- [ ] **Step 5: Registrar a verificação**

Nenhum commit necessário neste passo (nada mudou no repositório) — apenas confirme visualmente antes de seguir para a Task 5.

---

## Task 5: Criar o cliente Supabase para uso no servidor

**Files:**
- Modify: `package.json` (novas dependências)
- Create: `lib/supabase/server.ts`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (Task 1).
- Produces: `createSupabaseServerClient(): Promise<SupabaseClient>`, consumida pelas Tasks 6 e 7 e por todas as rotas de API dos módulos seguintes.

- [ ] **Step 1: Instalar as dependências**

Run: `npm install @supabase/supabase-js @supabase/ssr`
Expected: instalação concluída sem erros, `package.json` atualizado com as duas dependências.

- [ ] **Step 2: Criar `lib/supabase/server.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Chamado a partir de um Server Component (render de página);
          // rotas de API e Server Actions são onde o cookie de sessão é
          // efetivamente gravado.
        }
      },
    },
  });
}
```

- [ ] **Step 3: Verificar que o projeto ainda compila**

Run: `npx tsc --noEmit`
Expected: sem erros relacionados a `lib/supabase/server.ts`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json lib/supabase/server.ts
git commit -m "feat: adiciona cliente Supabase para uso em rotas server-side"
```

---

## Task 6: Rotas de autenticação (signup, login, logout)

**Files:**
- Create: `app/api/auth/signup/route.ts`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient()` (Task 5).
- Produces: endpoints `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, consumidos pelas páginas da Task 7.

- [ ] **Step 1: Criar a rota de signup**

`app/api/auth/signup/route.ts`:

```ts
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    escritorioNome?: string;
    nome?: string;
    email?: string;
    senha?: string;
  };

  const escritorioNome = payload.escritorioNome?.trim() ?? "";
  const nome = payload.nome?.trim() ?? "";
  const email = payload.email?.trim() ?? "";
  const senha = payload.senha ?? "";

  if (!escritorioNome || !nome || !email || senha.length < 8) {
    return Response.json(
      { error: "Preencha escritório, nome, e-mail e uma senha com pelo menos 8 caracteres." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password: senha,
    options: { data: { escritorio_nome: escritorioNome, nome } },
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ ok: true }, { status: 201 });
}
```

- [ ] **Step 2: Criar a rota de login**

`app/api/auth/login/route.ts`:

```ts
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const payload = (await request.json()) as { email?: string; senha?: string };
  const email = payload.email?.trim() ?? "";
  const senha = payload.senha ?? "";

  if (!email || !senha) {
    return Response.json({ error: "Informe e-mail e senha." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

  if (error) {
    return Response.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
  }

  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Criar a rota de logout**

`app/api/auth/logout/route.ts`:

```ts
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Rodar o servidor local e testar o signup via curl**

Run: `npm run dev` (em um terminal separado, mantenha rodando)

Run (em outro terminal, substituindo a porta pela exibida no passo anterior):
```bash
curl -i -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"escritorioNome":"Escritório Teste","nome":"Usuária Teste","email":"teste@example.com","senha":"senha12345"}'
```
Expected: `HTTP/1.1 201` e corpo `{"ok":true}`.

- [ ] **Step 5: Verificar no Supabase que o escritório e o perfil foram criados**

No **Table Editor** do Supabase, confirme: uma linha nova em `escritorios` com `nome = "Escritório Teste"`, e uma linha em `perfis` com `nome = "Usuária Teste"` e `escritorio_id` apontando para o escritório criado.

- [ ] **Step 6: Testar o login via curl**

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@example.com","senha":"senha12345"}' \
  -c cookies.txt
```
Expected: `HTTP/1.1 200`, corpo `{"ok":true}`, e um cookie de sessão salvo em `cookies.txt`.

- [ ] **Step 7: Commit**

```bash
git add app/api/auth
git commit -m "feat: adiciona rotas de signup, login e logout via Supabase Auth"
```

---

## Task 7: Páginas de login/cadastro e proteção da página principal

**Files:**
- Create: `app/login/page.tsx`
- Create: `app/signup/page.tsx`
- Create: `app/home-client.tsx` (conteúdo migrado de `app/page.tsx`)
- Modify: `app/page.tsx` (vira Server Component com guarda de autenticação)

**Interfaces:**
- Consumes: `POST /api/auth/login`, `POST /api/auth/signup` (Task 6); `createSupabaseServerClient()` (Task 5).
- Produces: `HomeClient({ userName: string })`, componente principal da aplicação (usado apenas por `app/page.tsx` nesta fase).

- [ ] **Step 1: Criar a página de login**

`app/login/page.tsx`:

```tsx
"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha }),
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Não foi possível entrar.");
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  };

  return (
    <main className="app-shell">
      <section className="panel onboarding" style={{ maxWidth: 360, margin: "80px auto" }}>
        <h2>Entrar</h2>
        <form onSubmit={submit}>
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="senha">Senha</label>
          <input id="senha" type="password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
          {error && (
            <div className="notice error">
              <p>{error}</p>
            </div>
          )}
          <button className="primary" disabled={loading}>
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>
        <p>
          Não tem conta? <a href="/signup">Cadastre seu escritório</a>
        </p>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Criar a página de cadastro**

`app/signup/page.tsx`:

```tsx
"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [escritorioNome, setEscritorioNome] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ escritorioNome, nome, email, senha }),
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Não foi possível criar a conta.");
      setLoading(false);
      return;
    }

    router.push("/login");
  };

  return (
    <main className="app-shell">
      <section className="panel onboarding" style={{ maxWidth: 400, margin: "80px auto" }}>
        <h2>Cadastrar escritório</h2>
        <form onSubmit={submit}>
          <label htmlFor="escritorioNome">Nome do escritório</label>
          <input
            id="escritorioNome"
            required
            value={escritorioNome}
            onChange={(e) => setEscritorioNome(e.target.value)}
          />
          <label htmlFor="nome">Seu nome</label>
          <input id="nome" required value={nome} onChange={(e) => setNome(e.target.value)} />
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="senha">Senha (mínimo 8 caracteres)</label>
          <input
            id="senha"
            type="password"
            required
            minLength={8}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
          {error && (
            <div className="notice error">
              <p>{error}</p>
            </div>
          )}
          <button className="primary" disabled={loading}>
            {loading ? "Criando…" : "Criar conta"}
          </button>
        </form>
        <p>
          Já tem conta? <a href="/login">Entrar</a>
        </p>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Mover o conteúdo atual de `app/page.tsx` para `app/home-client.tsx`**

Run: `git mv app/page.tsx app/home-client.tsx`

- [ ] **Step 4: Ajustar `app/home-client.tsx` para receber o nome do usuário por prop**

Em `app/home-client.tsx`, troque a linha:

```tsx
export default function Home() {
```

por:

```tsx
export function HomeClient({ userName }: { userName: string }) {
```

E troque a linha (dentro do `<aside>`, rodapé da sidebar):

```tsx
<div className="sidebar-footer"><span className="avatar">MC</span><div><strong>Mariana Costa</strong><small>Administradora</small></div><button aria-label="Configurações">⚙</button></div>
```

por:

```tsx
<div className="sidebar-footer"><span className="avatar">{userName.slice(0, 2).toUpperCase()}</span><div><strong>{userName}</strong><small>Administradora</small></div><button aria-label="Configurações">⚙</button></div>
```

- [ ] **Step 5: Criar o novo `app/page.tsx` como Server Component com guarda de autenticação**

```tsx
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HomeClient } from "./home-client";

export default async function Page() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: perfil } = await supabase.from("perfis").select("nome").eq("id", user.id).single();

  return <HomeClient userName={perfil?.nome ?? user.email ?? "Usuário"} />;
}
```

- [ ] **Step 6: Verificar que o projeto compila**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Testar o fluxo completo no navegador**

Com `npm run dev` rodando, acesse `http://localhost:3000/` no navegador:
- Sem estar logado, deve redirecionar para `/login`.
- Em `/signup`, crie um novo escritório com um e-mail diferente do usado no teste via curl.
- Faça login em `/login` com as credenciais criadas.
- Confirme que é redirecionado para `/` e que a sidebar mostra o nome cadastrado (não mais "Mariana Costa").

- [ ] **Step 8: Commit**

```bash
git add app/login app/signup app/home-client.tsx app/page.tsx
git commit -m "feat: adiciona páginas de login/cadastro e protege a página principal"
```

---

## O que vem depois

Com a fundação funcionando (login real, multi-tenant, RLS ativo), os quatro módulos entram como planos separados, cada um plugando nas rotas e no cliente Supabase já criados aqui:

1. **Onboarding** — consulta de CNPJ (BrasilAPI) + CRUD de `empresas`.
2. **Auditoria** — motor de regras sobre `empresas` → `divergencias`.
3. **Análise da carteira** — agregações sobre `empresas`.
4. **Calendário contábil** — `modelos_recorrencia` + geração de `tarefas`.

Cada um substitui a função correspondente em `src/services/portfolio.ts` pela chamada real, mantendo as assinaturas já usadas por `app/home-client.tsx`.
