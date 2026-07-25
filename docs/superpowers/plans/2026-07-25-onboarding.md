# Onboarding de Empresas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os mocks de `src/services/portfolio.ts` usados pela tela de Onboarding por dados reais: consulta de CNPJ via BrasilAPI, persistência em `empresas`/`empresas_socios` no Supabase, listagem e edição.

**Architecture:** Route Handlers em `app/api/empresas/*` usando `createSupabaseRouteHandlerClient()` (auth) / `createSupabaseServerClient()` (leitura), RLS cuida do isolamento por `escritorio_id`. Validação de CNPJ e normalização da resposta da BrasilAPI ficam em módulos puros (`lib/cnpj.ts`, `lib/brasilapi.ts`), testáveis sem rede/banco.

**Depende de:** plano `2026-07-25-backend-fundacao.md` (já mergeado em `main`) — `lib/supabase/server.ts`, RLS, `perfis`/`escritorios`.

## Decisão de shape: id numérico → UUID

O frontend mockado usa `Empresa.id: number`, `Divergencia.empresaId: number` etc. (ver `src/services/portfolio.ts`). O banco real usa `uuid` como chave primária (já aplicado em produção — mudar agora exigiria alterar uma migração já rodada, não vale a pena). Esta é uma mudança de tipo real, não só de dado mockado:

- `Empresa.id`, `Divergencia.id`, `Divergencia.empresaId`, `Tarefa.id` passam de `number` para `string`.
- Qualquer lógica que trate `id` como número (ex.: `Math.max(...companies.map(c => c.id)) + 1` em `Onboarding.save`) precisa ser removida — o id passa a vir sempre do servidor (`POST /api/empresas` retorna a empresa criada com o `id` gerado pelo Postgres).
- `key={c.id}` em listas React funciona igual com string.

## Outras normalizações de shape (servidor → frontend, sem mudar os tipos do frontend além do id)

- `Empresa.abertura`: passa de `number` (ano) para `string` (data ISO `YYYY-MM-DD`, o que a BrasilAPI retorna). Onde o frontend hoje usa o ano puro, ajustar para `new Date(abertura).getFullYear()`.
- `Empresa.status` (`"Ativa" | "Suspensa" | "Baixada"`): normalizado no servidor a partir de `descricao_situacao_cadastral` da BrasilAPI (ver Task 1).
- `Empresa.cnae`: mapeado de `cnaeDescricao` no banco (nome do campo do frontend não muda, só a origem).
- `Empresa.responsavel`: nome resolvido no servidor via join com `perfis` (não expor `responsavelId` cru na listagem principal — mas incluir para uso no formulário de edição).
- `Empresa.socios: string[]`: montado no servidor a partir de `empresas_socios` como `"Nome (Papel)"` (ou só `"Nome"` se `papel` vazio).

## Global Constraints

- Todo acesso a dado passa pela sessão do usuário + RLS (sem `service_role`).
- CNPJ: dígito verificador validado **antes** de qualquer chamada à BrasilAPI.
- Erros da BrasilAPI: 404 (não encontrado) e 429 (rate limit, com uma única retentativa após pequeno backoff) tratados explicitamente; qualquer outro erro de rede vira 502 com mensagem genérica.
- `POST /api/empresas/consultar-cnpj` **não persiste** — só consulta e normaliza.

---

## Task 1: Validação de CNPJ e cliente BrasilAPI (módulos puros, testáveis)

**Files:**
- Create: `lib/cnpj.ts`
- Create: `lib/brasilapi.ts`
- Create: `tests/cnpj.test.mjs`

**Interfaces:**
- Produces: `validarCNPJ(cnpj: string): boolean`, `formatarCNPJ(cnpj: string): string`, `consultarCNPJNaBrasilAPI(cnpj: string): Promise<EmpresaBrasilAPI>` — consumidos pela Task 2.

- [ ] **Step 1: Implementar `lib/cnpj.ts`**

Funções puras, sem I/O:
- `validarCNPJ(cnpj: string): boolean` — remove não-dígitos, valida os dois dígitos verificadores pelo algoritmo padrão da Receita Federal (pesos 5,4,3,2,9,8,7,6,5,4,3,2 para o primeiro dígito e 6,5,4,3,2,9,8,7,6,5,4,3,2 para o segundo; rejeita sequências de dígito repetido tipo `00000000000000`).
- `formatarCNPJ(cnpj: string): string` — formata 14 dígitos como `00.000.000/0000-00`; se não tiver 14 dígitos, retorna a entrada sem alteração.

- [ ] **Step 2: Escrever teste unitário de `validarCNPJ`**

`tests/cnpj.test.mjs` — casos: CNPJ válido conhecido (calcule um real ou use um CNPJ de teste público válido), CNPJ com dígito verificador errado, CNPJ com todos os dígitos iguais (`11111111111111`), CNPJ com menos de 14 dígitos, CNPJ com máscara (`11.222.333/0001-XX` válido).

Run: `node --test tests/cnpj.test.mjs`
Expected: todos os casos passando.

- [ ] **Step 3: Implementar `lib/brasilapi.ts`**

```ts
export type EmpresaBrasilAPI = {
  cnpj: string;
  razaoSocial: string;
  fantasia: string;
  cidade: string;
  estado: string;
  endereco: string;
  cnaeCodigo: string;
  cnaeDescricao: string;
  porte: string;
  situacaoCadastral: "Ativa" | "Suspensa" | "Baixada" | string;
  abertura: string | null; // ISO YYYY-MM-DD
  socios: { nome: string; papel: string }[];
};

export class BrasilAPIError extends Error {
  constructor(public status: 404 | 429 | 502, message: string) {
    super(message);
  }
}
```

`consultarCNPJNaBrasilAPI(cnpj: string): Promise<EmpresaBrasilAPI>`:
- `GET https://brasilapi.com.br/api/cnpj/v1/{cnpjSomenteDigitos}`.
- `404` da BrasilAPI → lança `BrasilAPIError(404, "CNPJ não encontrado")`.
- `429` → espera ~500ms e tenta **uma vez mais**; se persistir, lança `BrasilAPIError(429, "Muitas consultas à BrasilAPI, tente novamente em instantes")`.
- Qualquer outro erro de rede/status → `BrasilAPIError(502, "Não foi possível consultar a BrasilAPI")`.
- Normaliza a resposta para `EmpresaBrasilAPI`:
  - `razaoSocial` ← `razao_social`, `fantasia` ← `nome_fantasia` (fallback `razao_social` se vazio).
  - `cidade` ← `municipio`, `estado` ← `uf`.
  - `endereco` ← monta a partir de `logradouro`, `numero`, `bairro` (ex.: `"Av. Paulista, 1000, Bela Vista"`, omitindo partes vazias).
  - `cnaeCodigo` ← `cnae_fiscal` (como string), `cnaeDescricao` ← `cnae_fiscal_descricao`.
  - `porte` ← `porte` (repassa como veio).
  - `situacaoCadastral` ← mapear `descricao_situacao_cadastral` (BrasilAPI retorna em maiúsculas, ex. `"ATIVA"`, `"BAIXADA"`, `"SUSPENSA"`, `"INAPTA"`, `"NULA"`) para `"Ativa"`/`"Baixada"`/`"Suspensa"`; valores fora desse conjunto passam como vieram (capitalizados).
  - `abertura` ← `data_inicio_atividade` (já vem como `YYYY-MM-DD`).
  - `socios` ← `qsa[].{nome_socio → nome, qualificacao_socio → papel}`.

- [ ] **Step 4: Commit**

```bash
git add lib/cnpj.ts lib/brasilapi.ts tests/cnpj.test.mjs
git commit -m "feat: adiciona validação de CNPJ e cliente normalizado da BrasilAPI"
```

---

## Task 2: Rota de consulta de CNPJ

**Files:**
- Create: `app/api/empresas/consultar-cnpj/route.ts`

**Interfaces:**
- Consumes: `validarCNPJ`, `consultarCNPJNaBrasilAPI`, `BrasilAPIError` (Task 1).
- Produces: `POST /api/empresas/consultar-cnpj`, consumida pela Task 5 (frontend).

- [ ] **Step 1: Criar a rota**

`app/api/empresas/consultar-cnpj/route.ts`:
- Requer sessão (`createSupabaseServerClient().auth.getUser()`; sem usuário → 401).
- Body: `{ cnpj: string }`. JSON malformado → 400.
- `validarCNPJ` falha → 400 `{ error: "CNPJ inválido." }`, sem chamar a BrasilAPI.
- Chama `consultarCNPJNaBrasilAPI`; captura `BrasilAPIError` e retorna `{ error: err.message }` com `err.status`.
- Sucesso → 200 com o `EmpresaBrasilAPI` normalizado.
- Não persiste nada.

- [ ] **Step 2: Testar via curl com um CNPJ real conhecido**

Run (com `npm run dev` de pé e sessão autenticada — usar o cookie de uma sessão de teste):
```bash
curl -i -X POST http://localhost:PORT/api/empresas/consultar-cnpj \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"cnpj":"19131243000197"}'
```
Expected: `200` com dados normalizados de uma empresa real (esse CNPJ é público, usado em exemplos da própria BrasilAPI).

- [ ] **Step 3: Commit**

```bash
git add app/api/empresas/consultar-cnpj
git commit -m "feat: adiciona rota de consulta de CNPJ via BrasilAPI"
```

---

## Task 3: CRUD de empresas

**Files:**
- Create: `app/api/empresas/route.ts` (GET, POST)
- Create: `app/api/empresas/[id]/route.ts` (PATCH)
- Create: `app/api/perfis/route.ts` (GET — lista de perfis do escritório, para o seletor de responsável)

**Interfaces:**
- Consumes: RLS + `perfis`/`empresas`/`empresas_socios` (fundação).
- Produces: `GET/POST /api/empresas`, `PATCH /api/empresas/:id`, `GET /api/perfis` — consumidos pela Task 5.

- [ ] **Step 1: `GET /api/empresas`**

Retorna todas as empresas do escritório da sessão (RLS já filtra por `escritorio_id`), com:
- Join em `empresas_socios` agregando `socios: string[]` (formato `"Nome (Papel)"`, ou só `"Nome"` se `papel` vazio).
- Join em `perfis` para resolver `responsavel: string` (nome) a partir de `responsavel_id`; se nulo, `responsavel: ""`.
- Campos renomeados para o shape do frontend: `cnae` (← `cnae_descricao`), mantém `cnaeCodigo`, `status` (← `situacao_cadastral`), `abertura` (ISO string ou `null`), `tags`, `observacoes`.
- Suporta `?busca=` (filtra por `razao_social`/`fantasia`/`cnpj` contendo o termo, case-insensitive).

- [ ] **Step 2: `POST /api/empresas`**

Body: os campos de `EmpresaBrasilAPI` (Task 1) + edição complementar do usuário (`responsavelId?`, `observacoes?`, `tags?`). Insere em `empresas` com `escritorio_id` da sessão; insere as linhas de `empresas_socios` a partir de `socios`. Retorna a empresa criada no mesmo shape do `GET`. Validação: `cnpj`/`razaoSocial` obrigatórios → 400 se ausentes.

- [ ] **Step 3: `PATCH /api/empresas/:id`**

Body parcial (`responsavelId?`, `observacoes?`, `tags?`, e os demais campos editáveis). Atualiza só os campos presentes; `atualizado_em = now()`. RLS bloqueia edição de empresa de outro escritório (retorna 404, não 403, para não revelar existência do recurso — ver Task da fundação sobre erro 403 vs "sem dado": aqui optamos por 404 porque o `id` é opaco ao usuário, não há ambiguidade de permissão a esclarecer). Retorna a empresa atualizada no shape do `GET`.

- [ ] **Step 4: `GET /api/perfis`**

Retorna `{ id, nome }[]` de todos os perfis do escritório da sessão (RLS: hoje só existe a policy `perfis_select_own`, que restringe a leitura ao próprio perfil — **este endpoint precisa de uma policy adicional** para o usuário enxergar os colegas de escritório). Adicionar em uma nova migração `supabase/migrations/manual/0002_perfis_escritorio_select.sql`:

```sql
create policy "perfis_select_escritorio" on public.perfis
  for select using (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  );
```

Aplicar manualmente no SQL Editor do Supabase (mesmo fluxo da Task 4 da fundação) e documentar o passo no relatório da task.

- [ ] **Step 5: Verificar que o projeto compila**

Run: `npx tsc --noEmit`
Expected: sem erros novos (os 2 erros pré-existentes em `worker/index.ts` continuam, não são desta task).

- [ ] **Step 6: Commit**

```bash
git add app/api/empresas app/api/perfis supabase/migrations/manual/0002_perfis_escritorio_select.sql
git commit -m "feat: adiciona CRUD de empresas e listagem de perfis do escritório"
```

---

## Task 4: Ligar o frontend às rotas reais

**Files:**
- Modify: `src/services/portfolio.ts`
- Modify: `app/home-client.tsx` (só a parte de Onboarding — `Onboarding`, tipos importados, e o `useEffect` de carga inicial em `Home`/`HomeClient`)

**Interfaces:**
- Consumes: rotas das Tasks 2 e 3.

- [ ] **Step 1: Reescrever os tipos e as funções de integração em `src/services/portfolio.ts`**

- `Empresa.id: string`, `abertura: string | null` (ver decisão de shape no topo do plano). Mantém os demais campos.
- `listarEmpresas()`: `GET /api/empresas` → `Empresa[]`.
- `consultarCNPJ(cnpj: string)`: `POST /api/empresas/consultar-cnpj` → lança `Error` com a mensagem do backend se a resposta não for `ok`.
- Nova função `salvarEmpresa(empresa)`: `POST /api/empresas`.
- Nova função `atualizarEmpresa(id: string, patch)`: `PATCH /api/empresas/${id}`.
- Nova função `listarPerfis()`: `GET /api/perfis` → `{ id: string; nome: string }[]`.
- Mantém `divergencias`/`tarefas`/`listarDivergencias`/`listarTarefas`/`feriadosNacionais` como estão nesta task (são escopo dos próximos planos) — só ajuste `Divergencia.empresaId: string` e `Tarefa` conforme necessário para não quebrar a compilação (sem mudar comportamento).

- [ ] **Step 2: Ajustar o componente `Onboarding` em `app/home-client.tsx`**

- `save()`: chama `salvarEmpresa(result)` (não monta mais `id` manualmente); em caso de sucesso, prepende o retorno real (com `id` do servidor) na lista local e mostra a mensagem de sucesso; em caso de erro, mostra a mensagem de erro em vez do toast de sucesso.
- Após salvar com sucesso, dá para simplesmente re-chamar `listarEmpresas()` e substituir a lista local (mais simples e evita divergência de shape) — usar o padrão que exigir menos mudança estrutural no componente.
- O `<select>` de "Responsável interno" (hoje com `<option>` fixas) passa a ser populado por `listarPerfis()` (chamado no mesmo carregamento inicial da tela). Se a lista vier vazia (não deveria, o próprio usuário sempre tem um perfil), mostra só o usuário atual como fallback.
- O botão "⋯" (`Editar {empresa}`) nas linhas da tabela **não é desta task** — deixar como está (sem `onClick`), é bug pré-existente fora deste escopo.

- [ ] **Step 3: Verificar que o projeto compila**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Testar o fluxo completo no navegador**

Com `npm run dev` rodando e uma sessão autenticada:
1. Ir em Onboarding, consultar um CNPJ real (ex.: `19.131.243/0001-97`).
2. Conferir que os dados voltam preenchidos (razão social, fantasia, endereço, CNAE, porte, situação, sócios).
3. Salvar — conferir toast de sucesso e a empresa aparecendo na tabela.
4. Atualizar a página (F5) — a empresa **deve continuar lá** (prova de que persistiu de verdade, não é só estado local).

- [ ] **Step 5: Commit**

```bash
git add src/services/portfolio.ts app/home-client.tsx
git commit -m "feat: liga a tela de Onboarding ao backend real (consulta, salvar, listar)"
```

---

## O que vem depois

Com Onboarding persistindo de verdade, os planos seguintes (Auditoria, Análise da carteira, Calendário) consomem `empresas` real via `listarEmpresas()`/rotas equivalentes, cada um substituindo a função mockada correspondente em `src/services/portfolio.ts`.
