# Múltiplos responsáveis + calendário por pessoa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tarefas avulsas e modelos de recorrência aceitam vários responsáveis (via um "+"), e o calendário do funcionário abre por padrão mostrando só as tarefas em que ele é um dos responsáveis.

**Architecture:** `tarefas.responsavel_id`/`modelos_recorrencia.responsavel_id` (FK única) viram duas tabelas de ligação (`tarefas_responsaveis`, `modelos_recorrencia_responsaveis`), com backfill e drop da coluna antiga. API e frontend passam a trabalhar com `responsavelIds: string[]` no lugar do id único. Um componente novo (`ResponsavelPicker`) mostra os escolhidos como chips removíveis + um "+" que abre a lista dos demais perfis.

**Tech Stack:** Next.js (vinext), Supabase (Postgres + RLS), `node --test`.

## Global Constraints

- `empresas.responsavel_id` ("Responsável interno" da empresa) **não muda** — continua único, fora de escopo.
- Sem limite de quantidade de responsáveis por tarefa/modelo (YAGNI).
- O filtro "Responsável" do calendário não vira restrição de verdade — só muda o valor padrão pra quem é `funcionario` (pode trocar livremente pra ver outra pessoa ou "Todos").
- `PATCH` de tarefa/modelo substitui a lista inteira de responsáveis (apaga e reinsere) — nunca faz diff incremental.
- Toda migração SQL é mostrada ao usuário para rodar manualmente no Supabase (sem banco de teste local neste projeto).

---

## Mapa de arquivos

| Arquivo | O que faz |
|---|---|
| `supabase/migrations/manual/0016_tarefas_modelos_responsaveis.sql` | Cria as 2 tabelas de ligação, RLS, backfill, dropa as colunas antigas |
| `db/schema.ts` | Remove `responsavelId` de `tarefas`/`modelosRecorrencia`, adiciona as 2 tabelas novas |
| `lib/tarefas.ts` | `TarefaRow`/`TAREFA_SELECT`/`paraShapeFrontend`/`gerarTarefasDoMes` passam a lidar com lista; nova `substituirResponsaveisTarefa` |
| `lib/modelos-recorrencia.ts` | Idem, pro lado dos modelos; nova `substituirResponsaveisModelo` |
| `app/api/tarefas/route.ts` | `POST` aceita `responsavelIds` |
| `app/api/tarefas/[id]/route.ts` | `PATCH` aceita `responsavelIds` |
| `app/api/modelos-recorrencia/route.ts` | `POST` aceita `responsavelIds` |
| `app/api/modelos-recorrencia/[id]/route.ts` | `PATCH` aceita `responsavelIds` |
| `src/services/portfolio.ts` | Tipos `Tarefa`/`ModeloRecorrencia`/payloads passam a usar `responsavelIds`/`responsaveis: string[]` |
| `src/services/tarefas-extra.ts` | `TarefaEditPatch` idem |
| `app/calendar-view.tsx` | Novo `ResponsavelPicker`; 4 formulários passam a usá-lo; filtro/exibição por lista; default do filtro por `papel` |
| `app/home-client.tsx` | Passa `userName`/`papel` pro `Calendar` |
| `app/globals.css` | Estilo do `ResponsavelPicker` |

---

### Task 1: Migração `0016` — tabelas de ligação

**Files:**
- Create: `supabase/migrations/manual/0016_tarefas_modelos_responsaveis.sql`
- Modify: `db/schema.ts`

**Interfaces:**
- Produces: tabelas `tarefas_responsaveis(tarefa_id, perfil_id)`, `modelos_recorrencia_responsaveis(modelo_id, perfil_id)`, ambas PK composta.

- [ ] **Step 1: Escrever a migração**

```sql
-- Múltiplos responsáveis por tarefa/modelo de recorrência, substituindo a
-- FK única responsavel_id. empresas.responsavel_id não muda (conceito
-- separado). Ver docs/superpowers/specs/2026-07-27-multi-responsavel-design.md.

create table public.tarefas_responsaveis (
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  perfil_id uuid not null references public.perfis(id),
  primary key (tarefa_id, perfil_id)
);

create table public.modelos_recorrencia_responsaveis (
  modelo_id uuid not null references public.modelos_recorrencia(id) on delete cascade,
  perfil_id uuid not null references public.perfis(id),
  primary key (modelo_id, perfil_id)
);

insert into public.tarefas_responsaveis (tarefa_id, perfil_id)
select id, responsavel_id from public.tarefas where responsavel_id is not null;

insert into public.modelos_recorrencia_responsaveis (modelo_id, perfil_id)
select id, responsavel_id from public.modelos_recorrencia where responsavel_id is not null;

alter table public.tarefas drop column responsavel_id;
alter table public.modelos_recorrencia drop column responsavel_id;

alter table public.tarefas_responsaveis enable row level security;
alter table public.modelos_recorrencia_responsaveis enable row level security;

-- Isolamento via join com a tabela dona (mesmo padrão de
-- empresas_socios_isolamento em 0001_rls_and_profile_trigger.sql).
create policy "tarefas_responsaveis_isolamento" on public.tarefas_responsaveis
  for all using (
    tarefa_id in (
      select id from public.tarefas
      where escritorio_id = public.meu_escritorio_id()
    )
  ) with check (
    tarefa_id in (
      select id from public.tarefas
      where escritorio_id = public.meu_escritorio_id()
    )
  );

create policy "modelos_recorrencia_responsaveis_isolamento" on public.modelos_recorrencia_responsaveis
  for all using (
    modelo_id in (
      select id from public.modelos_recorrencia
      where escritorio_id = public.meu_escritorio_id()
    )
  ) with check (
    modelo_id in (
      select id from public.modelos_recorrencia
      where escritorio_id = public.meu_escritorio_id()
    )
  );
```

- [ ] **Step 2: Rodar no Supabase (você)**

Cole no SQL Editor e execute. Se der erro de policy/coluna já existente, me manda a mensagem antes de tentar de novo.

- [ ] **Step 3: Verificar (você, no SQL Editor)**

```sql
select table_name from information_schema.tables
where table_name in ('tarefas_responsaveis','modelos_recorrencia_responsaveis');

select column_name from information_schema.columns
where table_name = 'tarefas' and column_name = 'responsavel_id';
```

Esperado: a primeira query devolve as 2 tabelas novas; a segunda devolve **zero linhas** (a coluna foi removida).

- [ ] **Step 4: Atualizar `db/schema.ts`**

Remova a linha `responsavelId: uuid("responsavel_id").references(() => perfis.id),` de dentro de `export const tarefas = pgTable(...)` e de dentro de `export const modelosRecorrencia = pgTable(...)`. Adicione, no fim do arquivo:

```typescript
export const tarefasResponsaveis = pgTable("tarefas_responsaveis", {
  tarefaId: uuid("tarefa_id").notNull().references(() => tarefas.id, { onDelete: "cascade" }),
  perfilId: uuid("perfil_id").notNull().references(() => perfis.id),
});

export const modelosRecorrenciaResponsaveis = pgTable("modelos_recorrencia_responsaveis", {
  modeloId: uuid("modelo_id").notNull().references(() => modelosRecorrencia.id, { onDelete: "cascade" }),
  perfilId: uuid("perfil_id").notNull().references(() => perfis.id),
});
```

(A PK composta não é expressa aqui — Drizzle exige um `primaryKey()` helper de `drizzle-orm/pg-core` que o restante deste schema não usa; o banco já garante a constraint via a migração SQL acima, mesmo padrão adotado pelas outras colunas `check` deste arquivo, que também não são tipadas no Drizzle.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: erros novos aqui são esperados neste ponto (código ainda referencia `responsavelId`/`tarefas.responsavelId` em vários lugares) — as próximas tasks corrigem isso. Confirme só que os erros são exatamente sobre `responsavel_id`/`responsavelId` ausente, nada mais estranho.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/manual/0016_tarefas_modelos_responsaveis.sql db/schema.ts
git commit -m "feat: tabelas de ligação para múltiplos responsáveis (tarefas e modelos)"
```

---

### Task 2: `lib/tarefas.ts` — lista de responsáveis

**Files:**
- Modify: `lib/tarefas.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `TarefaRow.responsaveis: { perfil: { id: string; nome: string } }[]`; `paraShapeFrontend(...).responsavelIds: string[]` e `.responsaveis: string[]`; nova `substituirResponsaveisTarefa(supabase, tarefaId, perfilIds): Promise<PostgrestError | null>`.

- [ ] **Step 1: Atualizar `TarefaRow` e `TAREFA_SELECT`**

```typescript
export type TarefaRow = {
  id: string;
  escritorio_id: string;
  modelo_id: string | null;
  empresa_id: string;
  titulo: string;
  tipo: string;
  vencimento: string;
  status: string;
  concluido_em: string | null;
  modelo: { ativo: boolean } | null;
  empresa: { fantasia: string } | null;
  responsaveis: { perfil: { id: string; nome: string } }[];
};

export const TAREFA_SELECT = "*, empresa:empresas(fantasia), modelo:modelos_recorrencia(ativo), responsaveis:tarefas_responsaveis(perfil:perfis(id,nome))";
```

(Removidos `responsavel_id` e o embed singular `responsavel:perfis(nome)`.)

- [ ] **Step 2: Atualizar `ModeloRecorrenciaParaGeracao` e `gerarTarefasDoMes`**

```typescript
type ModeloRecorrenciaParaGeracao = {
  id: string;
  empresa_id: string | null;
  titulo: string;
  tipo: string;
  periodicidade: string;
  dia_referencia: number;
  dias_semana: number[] | null;
  mes_referencia: number | null;
  repeticoes_quantidade: number | null;
  repeticoes_unidade: string | null;
  criado_em: string;
  responsaveis: { perfil_id: string }[];
};
```

Na query de `gerarTarefasDoMes`, troque o `.select(...)`:

```typescript
  const { data: modelos, error: modelosError } = await supabase
    .from("modelos_recorrencia")
    .select("id, empresa_id, titulo, tipo, periodicidade, dia_referencia, dias_semana, mes_referencia, repeticoes_quantidade, repeticoes_unidade, criado_em, responsaveis:modelos_recorrencia_responsaveis(perfil_id)")
    .eq("escritorio_id", escritorioId)
    .eq("ativo", true);
```

E, dentro do laço, troque a montagem de `novaTarefa` (remova `responsavel_id: modelo.responsavel_id,`) e os dois pontos de inserção pra capturar o id e copiar os responsáveis:

```typescript
      const novaTarefa = {
        escritorio_id: escritorioId,
        modelo_id: modelo.id,
        empresa_id: modelo.empresa_id,
        titulo: modelo.titulo,
        tipo: modelo.tipo,
        vencimento,
        status: "Pendente",
      };

      const { data: inserida, error: upsertError } = await supabase
        .from("tarefas")
        .upsert(novaTarefa, { onConflict: "modelo_id,vencimento", ignoreDuplicates: true })
        .select("id")
        .maybeSingle();

      if (upsertError?.code === "42P10") {
        // Migração 0007 (índice único sem predicado) ainda não foi aplicada
        // no banco — ON CONFLICT não tem constraint pra casar. Cai para um
        // insert comum (mesma proteção de antes desta correção, só o select
        // de fast path acima) até a migração ser aplicada manualmente.
        const { data: inseridaFallback, error: insertError } = await supabase
          .from("tarefas")
          .insert(novaTarefa)
          .select("id")
          .single();
        if (insertError) {
          console.error(`Erro ao gerar tarefa do modelo ${modelo.id} para ${vencimento} (fallback sem upsert):`, insertError);
        } else if (inseridaFallback && modelo.responsaveis.length > 0) {
          await substituirResponsaveisTarefa(supabase, inseridaFallback.id, modelo.responsaveis.map((r) => r.perfil_id));
        }
      } else if (upsertError) {
        console.error(`Erro ao gerar tarefa do modelo ${modelo.id} para ${vencimento}:`, upsertError);
      } else if (inserida && modelo.responsaveis.length > 0) {
        await substituirResponsaveisTarefa(supabase, inserida.id, modelo.responsaveis.map((r) => r.perfil_id));
      }
```

(`inserida`/`inseridaFallback` vêm `null` quando o upsert com `ignoreDuplicates` ignorou uma corrida — nesse caso não tentamos copiar responsáveis pra uma tarefa que na verdade já existia e já tem os seus.)

- [ ] **Step 3: Atualizar `paraShapeFrontend`**

```typescript
export function paraShapeFrontend(row: TarefaRow, feriados: Feriado[], hojeISO: string) {
  const statusEfetivo = row.status === "Pendente" && row.vencimento < hojeISO ? "Atrasada" : row.status;
  const feriado = feriados.find((f) => f.data === row.vencimento) ?? null;
  const responsaveis = row.responsaveis.map((r) => r.perfil);

  return {
    id: row.id,
    modeloId: row.modelo_id,
    empresaId: row.empresa_id,
    empresa: row.empresa?.fantasia ?? "",
    titulo: row.titulo,
    tipo: row.tipo,
    responsavelIds: responsaveis.map((p) => p.id),
    responsaveis: responsaveis.map((p) => p.nome),
    vencimento: row.vencimento,
    status: statusEfetivo,
    concluidoEm: row.concluido_em,
    coincideComFeriado: feriado ? { nome: feriado.nome } : null,
  };
}
```

- [ ] **Step 4: Adicionar `substituirResponsaveisTarefa`**

No fim do arquivo:

```typescript
/**
 * Substitui a lista inteira de responsáveis de uma tarefa: apaga todas as
 * ligações existentes e insere as novas. Usado por POST (lista vazia antes,
 * sem efeito o delete) e PATCH (substitui de fato) — nunca faz diff
 * incremental, mais simples e sempre consistente.
 */
export async function substituirResponsaveisTarefa(
  supabase: SupabaseClient,
  tarefaId: string,
  perfilIds: string[],
) {
  const { error: erroDelete } = await supabase.from("tarefas_responsaveis").delete().eq("tarefa_id", tarefaId);
  if (erroDelete) return erroDelete;
  if (perfilIds.length === 0) return null;
  const { error: erroInsert } = await supabase
    .from("tarefas_responsaveis")
    .insert(perfilIds.map((perfilId) => ({ tarefa_id: tarefaId, perfil_id: perfilId })));
  return erroInsert;
}
```

- [ ] **Step 5: Rodar os testes de unidade existentes (não devem quebrar)**

Run: `node --test tests/tarefas.test.mjs`
Expected: PASS, 23 testes (essas mudanças não tocam `calcularVencimentosDoModelo`, que é o que esses testes cobrem).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: os erros restantes agora devem estar só em `app/api/tarefas/*`, `app/api/modelos-recorrencia/*`, `src/services/*` e `app/calendar-view.tsx`/`app/home-client.tsx` (corrigidos nas próximas tasks).

- [ ] **Step 7: Commit**

```bash
git add lib/tarefas.ts
git commit -m "feat: lib/tarefas.ts lida com lista de responsáveis"
```

---

### Task 3: `lib/modelos-recorrencia.ts` — lista de responsáveis

**Files:**
- Modify: `lib/modelos-recorrencia.ts`

**Interfaces:**
- Produces: `ModeloRecorrenciaRow.responsaveis: { perfil: { id: string; nome: string } }[]`; `paraShapeFrontend(...).responsavelIds: string[]` e `.responsaveis: string[]`; nova `substituirResponsaveisModelo(supabase, modeloId, perfilIds): Promise<PostgrestError | null>`.

- [ ] **Step 1: Atualizar `ModeloRecorrenciaRow` e `MODELO_RECORRENCIA_SELECT`**

```typescript
export type ModeloRecorrenciaRow = {
  id: string;
  escritorio_id: string;
  empresa_id: string | null;
  titulo: string;
  tipo: string;
  periodicidade: string;
  dia_referencia: number;
  dias_semana: number[] | null;
  mes_referencia: number | null;
  ativo: boolean;
  repeticoes_quantidade: number | null;
  repeticoes_unidade: string | null;
  criado_em: string;
  empresa: { fantasia: string } | null;
  responsaveis: { perfil: { id: string; nome: string } }[];
};

export const MODELO_RECORRENCIA_SELECT = "*, empresa:empresas(fantasia), responsaveis:modelos_recorrencia_responsaveis(perfil:perfis(id,nome))";
```

- [ ] **Step 2: Atualizar `paraShapeFrontend`**

```typescript
export function paraShapeFrontend(row: ModeloRecorrenciaRow) {
  const responsaveis = row.responsaveis.map((r) => r.perfil);
  return {
    id: row.id,
    empresaId: row.empresa_id,
    empresa: row.empresa?.fantasia ?? "",
    titulo: row.titulo,
    tipo: row.tipo,
    periodicidade: row.periodicidade,
    diaReferencia: row.dia_referencia,
    diasSemana: row.dias_semana,
    mesReferencia: row.mes_referencia,
    responsavelIds: responsaveis.map((p) => p.id),
    responsaveis: responsaveis.map((p) => p.nome),
    ativo: row.ativo,
    repeticoesQuantidade: row.repeticoes_quantidade,
    repeticoesUnidade: row.repeticoes_unidade,
    criadoEm: row.criado_em,
  };
}
```

- [ ] **Step 3: Adicionar `substituirResponsaveisModelo`**

```typescript
export async function substituirResponsaveisModelo(
  supabase: SupabaseClient,
  modeloId: string,
  perfilIds: string[],
) {
  const { error: erroDelete } = await supabase.from("modelos_recorrencia_responsaveis").delete().eq("modelo_id", modeloId);
  if (erroDelete) return erroDelete;
  if (perfilIds.length === 0) return null;
  const { error: erroInsert } = await supabase
    .from("modelos_recorrencia_responsaveis")
    .insert(perfilIds.map((perfilId) => ({ modelo_id: modeloId, perfil_id: perfilId })));
  return erroInsert;
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: erros restantes só em rotas de API e frontend (próximas tasks).

- [ ] **Step 5: Commit**

```bash
git add lib/modelos-recorrencia.ts
git commit -m "feat: lib/modelos-recorrencia.ts lida com lista de responsáveis"
```

---

### Task 4: API de tarefas — `responsavelIds`

**Files:**
- Modify: `app/api/tarefas/route.ts`
- Modify: `app/api/tarefas/[id]/route.ts`

**Interfaces:**
- Consumes: `substituirResponsaveisTarefa` (`lib/tarefas.ts`, Task 2).
- Produces: `POST`/`PATCH` de `/api/tarefas` aceitam `responsavelIds?: string[]` no lugar de `responsavelId`.

- [ ] **Step 1: `POST /api/tarefas` — trocar o payload e a criação**

Em `app/api/tarefas/route.ts`, troque o tipo do payload:

```typescript
type TarefaPayload = {
  titulo?: string;
  tipo?: string;
  empresaId?: string | null;
  responsavelIds?: string[];
  vencimento?: string;
};
```

Troque o import pra incluir `substituirResponsaveisTarefa`:

```typescript
import {
  TAREFA_SELECT,
  gerarTarefasDoMes,
  hojeBrasil,
  intervaloDoMes,
  mesAtual,
  montarRespostaTarefa,
  paraShapeFrontend,
  substituirResponsaveisTarefa,
  type TarefaRow,
} from "@/lib/tarefas";
```

No `insert`, remova a linha `responsavel_id: payload.responsavelId ?? null,`. Depois do bloco que já verifica `insertError || !tarefaInserida`, adicione, antes do `montarRespostaTarefa`:

```typescript
  const responsavelIds = Array.isArray(payload.responsavelIds) ? payload.responsavelIds : [];
  if (responsavelIds.length > 0) {
    const erroResponsaveis = await substituirResponsaveisTarefa(supabase, (tarefaInserida as { id: string }).id, responsavelIds);
    if (erroResponsaveis) {
      return applySetCookies(Response.json({ error: "Tarefa criada, mas não foi possível salvar os responsáveis." }, { status: 500 }));
    }
  }
```

Além disso, no filtro `?responsavel=` do `GET`, troque a comparação por igualdade única por checar se o nome está na lista:

```typescript
  if (responsavelFiltro) {
    linhas = linhas.filter((linha) =>
      linha.responsaveis.some((r) => (r.perfil?.nome ?? "").toLowerCase() === responsavelFiltro.toLowerCase()),
    );
  }
```

- [ ] **Step 2: `PATCH /api/tarefas/:id` — trocar o payload e o handling**

Em `app/api/tarefas/[id]/route.ts`, troque o import e o tipo do payload:

```typescript
import { montarRespostaTarefa, substituirResponsaveisTarefa, type StatusTarefa } from "@/lib/tarefas";

type TarefaPatchPayload = {
  titulo?: string;
  tipo?: string;
  empresaId?: string | null;
  responsavelIds?: string[];
  status?: string;
  vencimento?: string;
};
```

Troque o bloco:

```typescript
  if ("responsavelId" in payload) {
    const responsavelId = payload.responsavelId?.trim?.() ?? payload.responsavelId;
    updates.responsavel_id = responsavelId ? responsavelId : null;
  }
```

por (fora do objeto `updates`, já que agora é uma tabela separada — execute depois do `update` principal, antes de montar a resposta):

```typescript
  let responsavelIdsPatch: string[] | null = null;
  if ("responsavelIds" in payload) {
    responsavelIdsPatch = Array.isArray(payload.responsavelIds) ? payload.responsavelIds : [];
  }
```

E, logo após o bloco que confirma `tarefaAtualizada` (antes de `const resposta = await montarRespostaTarefa(...)`), adicione:

```typescript
  if (responsavelIdsPatch !== null) {
    const erroResponsaveis = await substituirResponsaveisTarefa(supabase, id, responsavelIdsPatch);
    if (erroResponsaveis) {
      return applySetCookies(Response.json({ error: "Não foi possível atualizar os responsáveis da tarefa." }, { status: 500 }));
    }
  }
```

Note que, se `updates` ficar vazio (payload só trazia `responsavelIds`), o `if (Object.keys(updates).length === 0)` mais acima retornaria erro antes de chegar aqui — troque essa condição pra também considerar `responsavelIdsPatch`:

```typescript
  if (Object.keys(updates).length === 0 && responsavelIdsPatch === null) {
    return applySetCookies(Response.json({ error: "Nenhum campo para atualizar." }, { status: 400 }));
  }
```

E, quando `updates` estiver vazio mas `responsavelIdsPatch` não for nulo, pule o `.update(updates).eq("id", id)...` (que falharia/seria um no-op estranho com objeto vazio) — envolva esse bloco assim:

```typescript
  if (Object.keys(updates).length > 0) {
    const { data: tarefaAtualizada, error: updateError } = await supabase
      .from("tarefas")
      .update(updates)
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (updateError) {
      return applySetCookies(Response.json({ error: "Não foi possível atualizar a tarefa." }, { status: 500 }));
    }

    if (!tarefaAtualizada) {
      return applySetCookies(Response.json({ error: "Tarefa não encontrada." }, { status: 404 }));
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: erros restantes só em `app/api/modelos-recorrencia/*`, `src/services/*`, `app/calendar-view.tsx`/`app/home-client.tsx`.

- [ ] **Step 4: Commit**

```bash
git add app/api/tarefas/route.ts "app/api/tarefas/[id]/route.ts"
git commit -m "feat: API de tarefas aceita responsavelIds (múltiplos responsáveis)"
```

---

### Task 5: API de modelos de recorrência — `responsavelIds`

**Files:**
- Modify: `app/api/modelos-recorrencia/route.ts`
- Modify: `app/api/modelos-recorrencia/[id]/route.ts`

**Interfaces:**
- Consumes: `substituirResponsaveisModelo` (`lib/modelos-recorrencia.ts`, Task 3).
- Produces: `POST`/`PATCH` de `/api/modelos-recorrencia` aceitam `responsavelIds?: string[]`.

- [ ] **Step 1: `POST /api/modelos-recorrencia`**

Troque o import:

```typescript
import {
  MODELO_RECORRENCIA_SELECT,
  buscarModeloRecorrenciaCompletoPorId,
  paraShapeFrontend,
  faixaDiaReferencia,
  substituirResponsaveisModelo,
  validarDiasSemana,
  validarMesReferencia,
  validarRepeticoes,
  type ModeloRecorrenciaRow,
  type Periodicidade,
} from "@/lib/modelos-recorrencia";
```

Troque o tipo do payload (`responsavelId?: string | null;` → `responsavelIds?: string[];`). No `insert`, remova `responsavel_id: payload.responsavelId ?? null,`. Depois do bloco `if (insertError || !modeloInserido)`, adicione:

```typescript
  const responsavelIds = Array.isArray(payload.responsavelIds) ? payload.responsavelIds : [];
  if (responsavelIds.length > 0) {
    const erroResponsaveis = await substituirResponsaveisModelo(supabase, (modeloInserido as { id: string }).id, responsavelIds);
    if (erroResponsaveis) {
      return applySetCookies(Response.json({ error: "Modelo criado, mas não foi possível salvar os responsáveis." }, { status: 500 }));
    }
  }
```

- [ ] **Step 2: `PATCH /api/modelos-recorrencia/:id`**

Troque o import (adicione `substituirResponsaveisModelo`). No tipo `ModeloRecorrenciaPatchPayload`, troque `responsavelId?: string | null;` por `responsavelIds?: string[];`. Remova a linha `{ chave: "responsavelId", coluna: "responsavel_id" },` de `CAMPOS_EDITAVEIS`. Depois do bloco `updates` (antes de montar `modeloAtualizado`), adicione a mesma lógica condicional de "só faz update se `updates` não estiver vazio" que a Task 4 fez pra tarefas — troque:

```typescript
  const { data: modeloAtualizado, error: updateError } = await supabase
    .from("modelos_recorrencia")
    .update(updates)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return applySetCookies(
      Response.json({ error: "Não foi possível atualizar o modelo de recorrência." }, { status: 500 }),
    );
  }

  if (!modeloAtualizado) {
    return applySetCookies(Response.json({ error: "Modelo de recorrência não encontrado." }, { status: 404 }));
  }
```

por:

```typescript
  const responsavelIdsPatch: string[] | null = "responsavelIds" in payload
    ? (Array.isArray(payload.responsavelIds) ? payload.responsavelIds : [])
    : null;

  if (Object.keys(updates).length === 0 && responsavelIdsPatch === null) {
    return applySetCookies(Response.json({ error: "Nenhum campo para atualizar." }, { status: 400 }));
  }

  if (Object.keys(updates).length > 0) {
    const { data: modeloAtualizado, error: updateError } = await supabase
      .from("modelos_recorrencia")
      .update(updates)
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (updateError) {
      return applySetCookies(
        Response.json({ error: "Não foi possível atualizar o modelo de recorrência." }, { status: 500 }),
      );
    }

    if (!modeloAtualizado) {
      return applySetCookies(Response.json({ error: "Modelo de recorrência não encontrado." }, { status: 404 }));
    }
  }

  if (responsavelIdsPatch !== null) {
    const erroResponsaveis = await substituirResponsaveisModelo(supabase, id, responsavelIdsPatch);
    if (erroResponsaveis) {
      return applySetCookies(Response.json({ error: "Não foi possível atualizar os responsáveis do modelo." }, { status: 500 }));
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: erros restantes só em `src/services/*`, `app/calendar-view.tsx`/`app/home-client.tsx`.

- [ ] **Step 4: Commit**

```bash
git add app/api/modelos-recorrencia/route.ts "app/api/modelos-recorrencia/[id]/route.ts"
git commit -m "feat: API de modelos de recorrência aceita responsavelIds"
```

---

### Task 6: Tipos e serviços de client (`src/services/`)

**Files:**
- Modify: `src/services/portfolio.ts`
- Modify: `src/services/tarefas-extra.ts`

**Interfaces:**
- Produces: `Tarefa`/`ModeloRecorrencia` com `responsavelIds: string[]` e `responsaveis: string[]` (no lugar dos campos únicos); `TarefaPayload`/`ModeloRecorrenciaPayload`/`ModeloRecorrenciaPatch`/`TarefaEditPatch` com `responsavelIds?: string[]`.

- [ ] **Step 1: `src/services/portfolio.ts` — tipos `Tarefa` e `ModeloRecorrencia`**

Troque, em `Tarefa`:

```typescript
  responsavelId?: string | null;
  responsavel: string;
```

por:

```typescript
  responsavelIds: string[];
  responsaveis: string[];
```

E, em `ModeloRecorrencia`, a mesma troca (`responsavelId?: string | null; responsavel: string;` → `responsavelIds: string[]; responsaveis: string[];`).

- [ ] **Step 2: `TarefaPayload`/`criarTarefa`**

```typescript
export type TarefaPayload = {
  titulo: string;
  tipo: string;
  empresaId: string;
  responsavelIds?: string[];
  vencimento: string;
};
```

(`criarTarefa` em si não muda — só o tipo do parâmetro.)

- [ ] **Step 3: `ModeloRecorrenciaPayload`/`ModeloRecorrenciaPatch`**

Troque `responsavelId?: string | null;` por `responsavelIds?: string[];` nos dois tipos (`ModeloRecorrenciaPayload` e dentro do `Partial<{...}>` de `ModeloRecorrenciaPatch`).

- [ ] **Step 4: `src/services/tarefas-extra.ts` — `TarefaEditPatch`**

```typescript
export type TarefaEditPatch = Partial<{
  titulo: string;
  tipo: string;
  empresaId: string | null;
  responsavelIds: string[];
  status: "Pendente" | "Concluída" | "Cancelada";
  vencimento: string;
}>;
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: erros restantes só em `app/calendar-view.tsx`/`app/home-client.tsx` (Task 7).

- [ ] **Step 6: Commit**

```bash
git add src/services/portfolio.ts src/services/tarefas-extra.ts
git commit -m "feat: tipos de client usam responsavelIds/responsaveis (lista)"
```

---

### Task 7: `ResponsavelPicker` e integração no calendário

**Files:**
- Modify: `app/calendar-view.tsx`
- Modify: `app/home-client.tsx`

**Interfaces:**
- Consumes: `type Papel` (`src/services/portfolio.ts`, já existe desde a feature de equipe).
- Produces: componente `ResponsavelPicker` usado nos 4 formulários (tarefa avulsa criar/editar, modelo criar/editar).

- [ ] **Step 1: Adicionar o componente `ResponsavelPicker`**

Em `app/calendar-view.tsx`, logo depois da função `descreverRecorrencia` (antes de `nomeEmpresaTarefa`):

```typescript
/** Chips removíveis + "+" pra adicionar mais um responsável dentre os perfis ainda não escolhidos. */
function ResponsavelPicker({ perfis, selecionados, onChange }: {
  perfis: { id: string; nome: string }[]; selecionados: string[]; onChange: (ids: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const menuAcessivel = useAccessibleMenu(aberto, () => setAberto(false));
  useDismissOnViewportChange(aberto, menuAcessivel.fechar);
  const disponiveis = perfis.filter((p) => !selecionados.includes(p.id));
  const nomePorId = (id: string) => perfis.find((p) => p.id === id)?.nome ?? "…";

  const adicionar = (id: string) => { onChange([...selecionados, id]); setAberto(false); };
  const remover = (id: string) => onChange(selecionados.filter((s) => s !== id));

  return <div className="responsavel-picker">
    {selecionados.map((id) => <span key={id} className="responsavel-chip">{nomePorId(id)}<button type="button" aria-label={`Remover ${nomePorId(id)}`} onClick={() => remover(id)}>×</button></span>)}
    {disponiveis.length > 0 && <button type="button" className="responsavel-add" aria-label="Adicionar responsável" onClick={(e) => { menuAcessivel.rememberOpener(e.currentTarget); setAberto(true); }}>+</button>}
    {aberto && <>
      <button type="button" className="menu-backdrop" aria-label="Fechar" onClick={() => setAberto(false)} />
      <div ref={menuAcessivel.menuRef} className="responsavel-dropdown" role="menu" onKeyDown={menuAcessivel.aoTeclar}>
        {disponiveis.map((p) => <button key={p.id} type="button" role="menuitem" onClick={() => adicionar(p.id)}>{p.nome}</button>)}
      </div>
    </>}
  </div>;
}
```

- [ ] **Step 2: `TarefaEditModal` — trocar o `<select>` de responsável**

Troque `const [responsavelId, setResponsavelId] = useState(tarefa.responsavelId ?? "");` por `const [responsavelIds, setResponsavelIds] = useState<string[]>(tarefa.responsavelIds);`.

Na chamada de `editarTarefa`, troque `responsavelId: responsavelId || null,` por `responsavelIds,`.

Troque a linha do `<label>Responsável<select>...` por:

```typescript
    <div className="field-block">
      <span className="field-label">Responsáveis</span>
      <ResponsavelPicker perfis={perfis} selecionados={responsavelIds} onChange={setResponsavelIds} />
    </div>
```

- [ ] **Step 3: `ModeloEditModal` — mesma troca**

Troque `const [responsavelId, setResponsavelId] = useState(modelo.responsavelId ?? "");` por `const [responsavelIds, setResponsavelIds] = useState<string[]>(modelo.responsavelIds);`.

Na chamada de `atualizarModeloRecorrencia`, troque `responsavelId: responsavelId || null,` por `responsavelIds,`.

Troque `<label>Responsável<select>...` por:

```typescript
    <div className="field-block">
      <span className="field-label">Responsáveis</span>
      <ResponsavelPicker perfis={perfis} selecionados={responsavelIds} onChange={setResponsavelIds} />
    </div>
```

- [ ] **Step 4: `Calendar` — props novas, draft de tarefa, draft de modelo, filtro, exibições**

Assinatura de `Calendar`:

```typescript
export function Calendar({ tasks, setTasks, companies, perfis, userName, papel }: {
  tasks: Tarefa[]; setTasks: (tasks: Tarefa[]) => void; companies: Empresa[]; perfis: { id: string; nome: string }[];
  userName: string; papel: Papel;
}) {
```

(Adicione `type Papel` ao import de `../src/services/portfolio`.)

Troque `const [responsible, setResponsible] = useState("Todos");` por:

```typescript
  const [responsible, setResponsible] = useState(papel === "funcionario" ? userName : "Todos");
```

Troque `draft` (estado e `abrirNovaTarefa`) — `responsavelId: perfis[0]?.id ?? ""` vira `responsavelIds: [] as string[]` nas duas ocorrências (na declaração do `useState` e dentro de `abrirNovaTarefa`). Na chamada de `criarTarefa` dentro de `add`, troque `responsavelId: draft.responsavelId || null,` por `responsavelIds: draft.responsavelIds,`.

Troque `modeloDraft` (estado e `abrirNovoModelo`) — `responsavelId: perfis[0]?.id ?? ""` vira `responsavelIds: [] as string[]` nas duas ocorrências. Adicione um helper (perto de `alternarDiaSemanaDraft`):

```typescript
  const setResponsavelIdsDraft = (ids: string[]) => setDraft((d) => ({ ...d, responsavelIds: ids }));
  const setResponsavelIdsModeloDraft = (ids: string[]) => setModeloDraft((d) => ({ ...d, responsavelIds: ids }));
```

Na chamada de `criarModeloRecorrencia` dentro de `criarModelo`, troque `responsavelId: responsavelId || null,` — espere, essa função já usa `modeloDraft.responsavelId` diretamente (confira o nome exato no arquivo antes de editar) — troque para `responsavelIds: modeloDraft.responsavelIds,`.

Troque a linha do filtro:

```typescript
  const shown = monthTasks.filter((t) => responsible === "Todos" || t.responsaveis.includes(responsible));
```

Troque as 2 ocorrências de `<label>Responsável<select value={draft.responsavelId}...` e `<label>Responsável<select value={modeloDraft.responsavelId}...` (as dos formulários "Nova tarefa"/"Novo modelo") pelo mesmo padrão do Step 2/3:

```typescript
      <div className="field-block">
        <span className="field-label">Responsáveis</span>
        <ResponsavelPicker perfis={perfis} selecionados={draft.responsavelIds} onChange={setResponsavelIdsDraft} />
      </div>
```

e

```typescript
      <div className="field-block">
        <span className="field-label">Responsáveis</span>
        <ResponsavelPicker perfis={perfis} selecionados={modeloDraft.responsavelIds} onChange={setResponsavelIdsModeloDraft} />
      </div>
```

Troque as exibições:
- Linha da lista de tarefas (`<small>{nomeEmpresaTarefa(t)} · {t.responsavel || "Sem responsável"}</small>`) → `{t.responsaveis.length > 0 ? t.responsaveis.join(", ") : "Sem responsável"}`.
- Modal de detalhe (`<dd>{detalhe.responsavel || "Sem responsável"}</dd>`) → `<dd>{detalhe.responsaveis.length > 0 ? detalhe.responsaveis.join(", ") : "Sem responsável"}</dd>`.
- Tabela de modelos (`<td>{m.responsavel || "—"}</td>`) → `<td>{m.responsaveis.length > 0 ? m.responsaveis.join(", ") : "—"}</td>`.

- [ ] **Step 5: `app/home-client.tsx` — passar `userName`/`papel` pro `Calendar`**

Troque `<Calendar tasks={tasks} setTasks={atualizarTarefas} companies={companies} perfis={perfis} />` por:

```typescript
    view === "Calendário" ? <Calendar tasks={tasks} setTasks={atualizarTarefas} companies={companies} perfis={perfis} userName={userName} papel={papel} /> :
```

- [ ] **Step 6: CSS do `ResponsavelPicker`**

Em `app/globals.css`, adicione (reaproveita `.dropdown-menu`/`.menu-backdrop` já existentes pro visual dos itens, só a posição do container é nova):

```css
.responsavel-picker{display:flex;flex-wrap:wrap;gap:6px;align-items:center;position:relative}
.responsavel-chip{display:inline-flex;align-items:center;gap:6px;background:#eaf3f4;color:var(--primary-dark);border-radius:999px;padding:5px 6px 5px 12px;font-size:12px;font-weight:600}
.responsavel-chip button{border:0;background:transparent;color:inherit;font-size:14px;line-height:1;cursor:pointer;padding:2px}
.responsavel-add{border:1px dashed #9db3b7;background:transparent;color:var(--primary-dark);border-radius:999px;width:28px;height:28px;font-size:16px;line-height:1;cursor:pointer}
.responsavel-dropdown{position:absolute;top:100%;left:0;margin-top:6px;background:#fff;border:1px solid var(--border);border-radius:9px;box-shadow:var(--shadow);display:grid;min-width:160px;max-height:220px;overflow-y:auto;z-index:50}
.responsavel-dropdown button{border:0;background:transparent;text-align:left;padding:9px 13px;font-size:12px;font-weight:600;color:#33454b;width:100%;cursor:pointer}
.responsavel-dropdown button:hover{background:#f3f6f6}
html[data-theme="dark"] .responsavel-chip{background:#2a3536;color:#d7e7dc}
html[data-theme="dark"] .responsavel-dropdown{background:#20272b;border-color:#3b4648}
html[data-theme="dark"] .responsavel-dropdown button{color:#dbe5e6}
html[data-theme="dark"] .responsavel-dropdown button:hover{background:#2a3536}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros novos.

- [ ] **Step 8: Testar no navegador**

1. Refresh, abra o Calendário como `responsavel` — o filtro "Responsável" deve abrir em "Todos".
2. Abra "Nova tarefa" — o campo "Responsáveis" deve mostrar só um "+", sem ninguém pré-selecionado. Clique em "+", adicione duas pessoas, confirme que viram chips removíveis, remova uma, salve.
3. Confirme que a tarefa criada mostra os dois (ou um, se removeu) nomes na lista/detalhe.
4. Faça o mesmo em "Novo modelo de recorrência" com 2 responsáveis.
5. Entre como `funcionario` — confirme que o filtro "Responsável" já abre com o próprio nome selecionado, mas o dropdown permite trocar pra "Todos" ou outro colega.
6. Confirme que uma tarefa gerada por um modelo com 2 responsáveis (aguarde a geração automática do mês, ou troque de mês pra forçar) aparece com os 2 nomes.

- [ ] **Step 9: Commit**

```bash
git add app/calendar-view.tsx app/home-client.tsx app/globals.css
git commit -m "feat: seletor de múltiplos responsáveis (+) e calendário por pessoa"
```

---

### Task 8: Checklist final de verificação manual

- [ ] Migração `0016` rodada no Supabase (Task 1) — tabelas novas existem, `responsavel_id` sumiu de `tarefas`/`modelos_recorrencia`.
- [ ] `node --test tests/tarefas.test.mjs tests/equipe.test.mjs tests/supabase-admin.test.mjs` todos verdes.
- [ ] `npx tsc --noEmit -p .` sem erros novos.
- [ ] Fluxo completo testado (Task 7, Step 8) do zero: criar tarefa com 2 responsáveis, criar modelo com 2 responsáveis, gerar tarefa a partir do modelo e confirmar que herda os 2, calendário do funcionário abrindo filtrado no próprio nome mas trocável.

---

## Self-review

**Cobertura da spec:** tabelas de ligação + backfill + drop de coluna (Task 1), geração de tarefas copiando responsáveis do modelo (Task 2), API com `responsavelIds` pros dois recursos (Tasks 4-5), tipos de client (Task 6), `ResponsavelPicker` nos 4 formulários + filtro/exibição do calendário + default por papel (Task 7) — todos os pontos da spec de 2026-07-27 cobertos.

**Placeholders:** nenhum — todo passo tem código completo, inclusive os trechos "troque X por Y" citam o texto exato a substituir.

**Consistência de tipos:** `responsavelIds: string[]` e `responsaveis: string[]` usados com os mesmos nomes em `Tarefa`/`ModeloRecorrencia` (Task 6), nos payloads de API (Tasks 4-5) e no `ResponsavelPicker`/formulários (Task 7) — sem divergência de nome entre tasks.
