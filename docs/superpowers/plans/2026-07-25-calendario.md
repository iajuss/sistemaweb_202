# Calendário Contábil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tarefas recorrentes (modelos + geração automática) e avulsas, exibidas em calendário mensal/lista, com sinalização de atraso, responsável e alerta (não reagendamento automático) quando o vencimento coincidir com feriado nacional.

**Depende de:** plano `2026-07-25-onboarding.md` (empresas reais, `GET /api/perfis`).

## Lacuna na interface atual

`app/home-client.tsx`'s `Calendar` component hoje só cria tarefas avulsas (modal "+ Nova tarefa"); não existe nenhuma tela para cadastrar **modelos de recorrência** (o conceito central do requisito "cadastrar tarefas recorrentes"). Esta é uma lacuna de produto pré-existente, não um bug — este plano adiciona uma seção mínima para isso (Task 4), sem redesenhar a tela.

Também: a visão mensal está fixa em "Agosto de 2026" (sem navegação de mês). Decisão: tornar o mês exibido o **mês atual real** (`new Date()`), sem adicionar navegação entre meses — não foi pedido explicitamente e a visão de lista já cobre "acompanhar tarefas" sem essa limitação.

## Modelo de dados (já existe, ver `db/schema.ts`) + uma coluna nova

- `modelos_recorrencia`: `titulo`, `tipo`, `periodicidade` (`"mensal" | "semanal" | "anual"`), `dia_referencia` (int), `responsavel_id`, `ativo`. **Falta uma coluna**: `tarefas.empresa_id` é `NOT NULL`, mas `modelos_recorrencia` não guarda a empresa a que a recorrência pertence — sem isso, a geração automática (Task 3) não sabe que `empresa_id` usar. Task 1 deste plano adiciona `empresa_id uuid not null references empresas(id) on delete cascade` a `modelos_recorrencia` via uma migração nova (mais um passo manual no SQL Editor).
- `tarefas`: `modelo_id` (nulo se avulsa), `empresa_id`, `titulo`, `tipo`, `responsavel_id`, `vencimento` (date), `status` (`"pendente" | "concluída"` — **"atrasada" é sempre calculado na leitura**, nunca persistido).
- `feriados_cache`: `data`, `nome`, `ano` — global, populada sob demanda a partir da BrasilAPI.

## Global Constraints

- RLS + sessão, sem `service_role`.
- Geração de tarefas é sob demanda (ao abrir o calendário), não por cron — fora de escopo nesta fase (já registrado como tal na spec).
- Feriado nacional: a tarefa **mantém** a data original; o sistema só sinaliza o conflito (decisão confirmada com o usuário) — nenhuma rotina pode alterar `vencimento` automaticamente por causa de feriado.

---

## Task 1: Coluna `empresa_id` em `modelos_recorrencia` + CRUD

**Files:**
- Create: `supabase/migrations/manual/0005_modelos_recorrencia_empresa.sql`
- Modify: `db/schema.ts` (adicionar `empresaId` a `modelosRecorrencia`, refletindo a migração)
- Create: `app/api/modelos-recorrencia/route.ts` (GET, POST)
- Create: `app/api/modelos-recorrencia/[id]/route.ts` (PATCH)

**Interfaces:**
- Produces: `GET/POST /api/modelos-recorrencia`, `PATCH /api/modelos-recorrencia/:id` — consumidos pela Task 3 (geração) e Task 4 (frontend).

- [ ] **Step 1: Escrever e commitar a migração**

`supabase/migrations/manual/0005_modelos_recorrencia_empresa.sql`:
```sql
alter table public.modelos_recorrencia
  add column empresa_id uuid not null references public.empresas(id) on delete cascade;
```

Atualizar `db/schema.ts`: adicionar `empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" })` em `modelosRecorrencia` (mantém o schema Drizzle em sincronia com o banco real, mesmo a migração sendo manual — ver `supabase/migrations/manual/README.md` sobre como esse diretório se relaciona com o `drizzle-kit`).

**Nota para quem executa este plano**: esta migração precisa ser aplicada manualmente no SQL Editor do Supabase antes de testar Tasks 3/4 de ponta a ponta — reportar isso claramente. Como a tabela já existe com dados possivelmente vazios (nenhum modelo foi criado ainda, já que não havia UI/API pra isso), `not null` sem `default` é seguro aqui.

- [ ] **Step 2: `GET /api/modelos-recorrencia`**

Lista os modelos do escritório (RLS), com `responsavel: string` (join em `perfis`) e `empresa: string` (join em `empresas.fantasia`), mesmo padrão de `lib/empresas.ts`. Inclui modelos inativos (o frontend decide como exibir).

- [ ] **Step 3: `POST /api/modelos-recorrencia`**

Body: `{ titulo, tipo, periodicidade, diaReferencia, empresaId, responsavelId? }`. Validação: `titulo`/`tipo`/`periodicidade`/`empresaId` obrigatórios; `periodicidade` restrito a `"mensal" | "semanal" | "anual"`; `diaReferencia` obrigatório e dentro de faixa plausível (1-31 para mensal/anual, 1-7 para semanal — validar conforme a periodicidade escolhida) → 400 se fora da faixa. `ativo: true` por padrão. Retorna o modelo criado no shape do GET.

- [ ] **Step 4: `PATCH /api/modelos-recorrencia/:id`**

Body parcial — usado principalmente para `{ ativo: false }` (desativar um modelo, não excluir — tarefas já geradas continuam existindo). RLS-bloqueado/inexistente → 404.

- [ ] **Step 5: Verificar que compila e testar via curl**

Run: `npx tsc --noEmit`. Testar GET/POST/PATCH com `npm run dev` + sessão autenticada + uma empresa já cadastrada (via Onboarding) para usar como `empresaId`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/manual/0005_modelos_recorrencia_empresa.sql db/schema.ts app/api/modelos-recorrencia
git commit -m "feat: adiciona empresa_id a modelos_recorrencia e CRUD da rota"
```

---

## Task 2: Feriados nacionais (cache sob demanda)

**Files:**
- Create: `lib/feriados.ts`

**Interfaces:**
- Produces: `garantirFeriadosDoAno(supabase, ano: number): Promise<{ data: string; nome: string }[]>` — consumida pela Task 3.

- [ ] **Step 1: Implementar `garantirFeriadosDoAno`**

- Verifica se já existem linhas em `feriados_cache` para o `ano` pedido (`select` filtrando `ano = $1`).
- Se não existir nenhuma, busca `GET https://brasilapi.com.br/api/feriados/v1/{ano}` (resposta: `[{ date: "YYYY-MM-DD", name: string, type: string }]`), insere em `feriados_cache` (`data`, `nome`, `ano`) — `upsert` para tolerar corrida entre duas requisições simultâneas populando o mesmo ano.
- Erro de rede ao buscar feriados **não deve derrubar** quem chama esta função com uma exceção não tratada que quebre a geração de tarefas inteira — se a busca falhar e o cache já estiver vazio para o ano, retorna `[]` (a geração de tarefas simplesmente não sinaliza feriado nenhum daquele ano até a próxima tentativa) e loga o erro.
- Retorna a lista de feriados do ano (do cache, já garantido populado ou vazio).

- [ ] **Step 2: Commit**

```bash
git add lib/feriados.ts
git commit -m "feat: adiciona cache sob demanda de feriados nacionais"
```

---

## Task 3: Geração de tarefas e listagem com alerta de feriado

**Files:**
- Create: `lib/tarefas.ts`
- Create: `app/api/tarefas/route.ts` (GET, POST)
- Create: `app/api/tarefas/[id]/route.ts` (PATCH)

**Interfaces:**
- Consumes: `garantirFeriadosDoAno` (Task 2), modelos de recorrência (Task 1).
- Produces: `GET /api/tarefas?mes=YYYY-MM&responsavel=`, `POST /api/tarefas`, `PATCH /api/tarefas/:id` — consumidos pela Task 4.

- [ ] **Step 1: Rotina de geração em `lib/tarefas.ts`**

`gerarTarefasDoMes(supabase, escritorioId: string, mes: string /* YYYY-MM */)`:
- Busca os modelos `ativo = true` do escritório.
- Para cada modelo, calcula a data de vencimento dentro do mês pedido a partir de `periodicidade`/`diaReferencia`:
  - `"mensal"`: um vencimento no mês, no dia `diaReferencia` (se o mês não tiver esse dia, ex. 31 em fevereiro, usa o último dia do mês).
  - `"anual"`: só gera se o mês pedido bater com o mês de referência do modelo (guardar o mês de referência é necessário — **decisão**: para `"anual"`, `diaReferencia` representa o dia-do-ano-mês fixo definido na criação do modelo; se o schema atual não tem campo de mês para recorrência anual, usar o mês em que o modelo foi criado (`criado_em`) como o mês de referência anual — documentar essa decisão no relatório da task, é uma limitação aceitável para v1 dado que o schema já está em produção).
  - `"semanal"`: gera uma tarefa por semana do mês em que o dia da semana (`diaReferencia`, 1=segunda...7=domingo) ocorrer.
- Para cada vencimento calculado, verifica se já existe uma `tarefa` com esse `modelo_id` + `vencimento` (evita duplicar em re-execuções) — se não existir, insere usando `empresa_id`/`responsavel_id`/`titulo`/`tipo` copiados do modelo (Task 1 já garante que todo modelo tem `empresa_id`).

- [ ] **Step 2: `GET /api/tarefas?mes=YYYY-MM&responsavel=`**

- Chama `gerarTarefasDoMes` para o `mes` pedido (padrão: mês atual) antes de listar — garante que as tarefas do mês existam.
- Busca as tarefas do escritório no intervalo do mês, com `empresa: string` (join em `empresas.fantasia`) e `responsavel: string` (join em `perfis.nome`).
- Calcula `status` efetivo na leitura: se `status` salvo é `"pendente"` e `vencimento < hoje`, retorna `"Atrasada"`; senão retorna `"Pendente"`/`"Concluída"` (capitalizado, para bater com o union do frontend).
- Chama `garantirFeriadosDoAno` para o(s) ano(s) envolvidos e cruza `vencimento` com a lista; adiciona `coincideComFeriado: { nome: string } | null` em cada tarefa.
- Filtra por `?responsavel=` (nome) se presente.

- [ ] **Step 3: `POST /api/tarefas` (tarefa avulsa)**

Body: `{ titulo, tipo, empresaId, responsavelId?, vencimento }`. `modelo_id: null`. Retorna a tarefa criada no shape do GET.

- [ ] **Step 4: `PATCH /api/tarefas/:id`**

Body: `{ status?: "pendente" | "concluída", vencimento? }` — usado para marcar concluída ou reagendar manualmente (inclusive para o caso de feriado, onde o usuário decide mover a data). `concluido_em` setado quando `status` vira `"concluída"`. RLS-bloqueado/inexistente → 404.

- [ ] **Step 5: Verificar que compila e testar via curl**

Run: `npx tsc --noEmit`. Testar: criar um modelo mensal com `diaReferencia` = dia atual + 1 (pra garantir que caia no mês corrente), chamar `GET /api/tarefas` e confirmar que a tarefa foi gerada; testar `PATCH` marcando concluída; testar um modelo cujo `diaReferencia` coincida com uma data de `feriados_cache` (após popular via a chamada) e confirmar `coincideComFeriado` preenchido.

- [ ] **Step 6: Commit**

```bash
git add lib/tarefas.ts app/api/tarefas
git commit -m "feat: adiciona geração de tarefas recorrentes e listagem com alerta de feriado"
```

---

## Task 4: Ligar o frontend

**Files:**
- Modify: `src/services/portfolio.ts`
- Modify: `app/home-client.tsx` (componente `Calendar`)

**Interfaces:**
- Consumes: rotas das Tasks 1 e 3.

- [ ] **Step 1: Atualizar `src/services/portfolio.ts`**

- `Tarefa.id: string`, adicionar `coincideComFeriado: { nome: string } | null` ao tipo.
- `listarTarefas()`: `GET /api/tarefas?mes=` (mês atual por padrão).
- Nova `criarTarefa(tarefa)`: `POST /api/tarefas`.
- Nova `atualizarTarefa(id, patch)`: `PATCH /api/tarefas/${id}`.
- Nova `listarModelosRecorrencia()`, `criarModeloRecorrencia(modelo)`, `atualizarModeloRecorrencia(id, patch)`: rotas de `/api/modelos-recorrencia`.

- [ ] **Step 2: Ajustar o componente `Calendar`**

- Mês exibido: `new Date()` (mês/ano atual), não mais a string fixa "Agosto de 2026".
- `add()` (criar tarefa avulsa): chama `criarTarefa(...)` de verdade (hoje só faz `setTasks` local com `id: Date.now()`); após sucesso, recarrega via `listarTarefas()`.
- Badge "Feriado": usar `t.coincideComFeriado` (vindo do servidor) em vez do array estático `feriadosNacionais` importado do mock.
- Adicionar uma seção simples "Modelos recorrentes" (lista + um modal "+ Novo modelo" com os campos de `POST /api/modelos-recorrencia`, incluindo o seletor de empresa e responsável a partir de `listarEmpresas()`/`listarPerfis()`) — pode reaproveitar o estilo visual do modal de "Nova tarefa" já existente. Cada modelo listado tem um botão para desativar (`ativo: false`).
- Seletor de "Responsável" no formulário de nova tarefa avulsa: hoje é uma lista fixa de nomes (`people.slice(1)`); passa a vir de `listarPerfis()`.

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Testar o fluxo completo no navegador**

Criar um modelo de recorrência mensal para uma empresa cadastrada; abrir o Calendário e confirmar que a tarefa do mês corrente foi gerada automaticamente; criar uma tarefa avulsa manualmente; marcar uma como concluída; confirmar que uma tarefa cujo vencimento caia num feriado real mostra o alerta sem ter sua data alterada; atualizar a página e confirmar que tudo persiste (banco real).

- [ ] **Step 5: Commit**

```bash
git add src/services/portfolio.ts app/home-client.tsx
git commit -m "feat: liga o Calendário contábil ao backend real"
```
