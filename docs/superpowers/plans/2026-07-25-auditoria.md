# Auditoria de Clientes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Motor de regras que detecta, na carteira do escritório: CNPJ inválido, empresas duplicadas, razão social divergente da Receita Federal, endereço desatualizado, situação cadastral irregular e dados obrigatórios ausentes — grava em `divergencias`, e permite ao usuário revisar/ignorar/aplicar a correção sugerida.

**Depende de:** plano `2026-07-25-onboarding.md` — `lib/cnpj.ts` (`validarCNPJ`), `lib/brasilapi.ts` (`consultarCNPJNaBrasilAPI`), `lib/empresas.ts` (`EMPRESA_SELECT`, `paraShapeFrontend`), tabela `empresas` populada de verdade.

## Os 6 tipos de divergência (union já existe no frontend: `Divergencia["tipo"]`)

| `tipo` | Regra | Origem | `sugerido` | Ação "aplicar sugestão"? |
|---|---|---|---|---|
| `"CNPJ inválido"` | `validarCNPJ(empresa.cnpj)` falha | Interna | `null` | Não (usuário corrige editando a empresa) |
| `"Duplicidade"` | `similarity(razao_social, razao_social)` acima do limiar entre duas empresas do mesmo escritório (via `pg_trgm`) | Interna | `null` | Não (usuário decide qual manter, mesclagem é manual) |
| `"Razão social"` | razão social salva ≠ razão social atual na BrasilAPI | Externa (reconsulta) | razão social da BrasilAPI | **Sim** → atualiza `empresas.razao_social` |
| `"Endereço"` | endereço salvo ≠ endereço atual na BrasilAPI | Externa (reconsulta) | endereço da BrasilAPI | **Sim** → atualiza `empresas.endereco` |
| `"Situação irregular"` | `situacao_cadastral` ≠ `"Ativa"` | Interna | `null` | Não (é um alerta, não uma correção de dado) |
| `"Dados ausentes"` | `endereco`, `cnae_codigo` ou `porte` vazios | Interna | `null` | Não (usuário completa editando a empresa) |

## Idempotência do `POST /api/auditoria/executar`

Rodar duas vezes seguidas não pode duplicar linhas nem "ressuscitar" uma divergência que o usuário já tratou, mas também não pode esconder um problema novo. Para cada `(empresa_id, tipo)` detectado nesta execução:
- Não existe divergência aberta para esse par → insere nova, `status = "Pendente"`.
- Existe divergência para esse par com o mesmo `atual` (valor não mudou desde a última detecção) → não faz nada, mantém o status que o usuário já deu (`Pendente`/`Revisado`/`Ignorado`).
- Existe divergência para esse par mas `atual` mudou (o problema evoluiu — ex.: endereço mudou de novo) → insere uma nova linha `Pendente` (histórico da anterior fica preservado, não é sobrescrito).

Para `(empresa_id, tipo)` que **não** foi detectado nesta execução mas tem uma divergência `Pendente` aberta (o problema não existe mais — ex.: usuário corrigiu manualmente): marca como `resolvido_em = now()` e `status = "Revisado"` (resolução automática).

## Global Constraints

- RLS + sessão, sem `service_role`.
- Reconsulta à BrasilAPI (regras externas) só roda no "revalidar carteira" manual — **nunca** automaticamente a cada edição de empresa (rate limit da BrasilAPI é por IP/tempo, não por chave).
- Regras internas (sem chamada externa) continuam podendo rodar automaticamente após salvar/editar uma empresa, além do botão manual.

---

## Task 1: Habilitar `pg_trgm` e função de detecção de duplicidade

**Files:**
- Create: `supabase/migrations/manual/0003_auditoria_pg_trgm.sql`

**Interfaces:**
- Produces: função `detectar_duplicidade_razao_social(p_escritorio_id uuid, p_limiar float)`, consumida pela Task 2.

- [ ] **Step 1: Escrever a migração**

```sql
create extension if not exists pg_trgm;

-- Retorna pares de empresas do mesmo escritório com razão social
-- textualmente parecida (possível duplicidade), id_a sempre < id_b
-- para não retornar o mesmo par duas vezes.
create or replace function public.detectar_duplicidade_razao_social(
  p_escritorio_id uuid,
  p_limiar float default 0.6
)
returns table (empresa_id uuid, razao_social text, empresa_similar_id uuid, razao_social_similar text, similaridade float)
language sql
stable
security invoker
as $$
  select
    a.id, a.razao_social,
    b.id, b.razao_social,
    similarity(a.razao_social, b.razao_social)
  from public.empresas a
  join public.empresas b
    on a.escritorio_id = b.escritorio_id
    and a.id < b.id
    and similarity(a.razao_social, b.razao_social) >= p_limiar
  where a.escritorio_id = p_escritorio_id;
$$;
```

`security invoker` (não `security definer`): a função roda com os privilégios de quem chama, então RLS de `empresas` continua se aplicando normalmente — reforço de isolamento, não um jeito de contornar tenant.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/manual/0003_auditoria_pg_trgm.sql
git commit -m "feat: adiciona extensão pg_trgm e função de detecção de duplicidade"
```

**Nota para quem executa este plano:** esta migração precisa ser aplicada manualmente no SQL Editor do Supabase antes que a Task 2 possa ser testada de ponta a ponta (mesmo processo das migrações anteriores) — reportar isso claramente e seguir para a Task 2 mesmo sem poder validar contra o banco real ainda.

---

## Task 2: Motor de regras e rota de execução

**Files:**
- Create: `lib/auditoria.ts`
- Create: `app/api/auditoria/executar/route.ts`

**Interfaces:**
- Consumes: `validarCNPJ` (lib/cnpj.ts), `consultarCNPJNaBrasilAPI`/`BrasilAPIError` (lib/brasilapi.ts), `detectar_duplicidade_razao_social` (Task 1).
- Produces: `POST /api/auditoria/executar`, `avaliarRegrasInternas`/`avaliarRegrasExternas` (testáveis sem banco), consumidos pela Task 3.

- [ ] **Step 1: Implementar `lib/auditoria.ts` — regras internas (puras, testáveis sem banco/rede)**

```ts
export type EmpresaParaAuditoria = {
  id: string;
  cnpj: string;
  razaoSocial: string;
  endereco: string;
  cnaeCodigo: string;
  porte: string;
  situacaoCadastral: string;
};

export type DivergenciaDetectada = {
  empresaId: string;
  tipo: "CNPJ inválido" | "Duplicidade" | "Razão social" | "Endereço" | "Situação irregular" | "Dados ausentes";
  atual: string;
  sugerido: string | null;
};
```

- `avaliarCNPJInvalido(empresa)`: usa `validarCNPJ`; se inválido, retorna a divergência (`atual` = o CNPJ salvo, `sugerido: null`).
- `avaliarSituacaoIrregular(empresa)`: se `situacaoCadastral !== "Ativa"`, retorna divergência (`atual` = a situação salva, ex. `"Suspensa"`).
- `avaliarDadosAusentes(empresa)`: verifica `endereco`, `cnaeCodigo`, `porte` vazios/em branco; se algum estiver ausente, retorna UMA divergência descrevendo quais campos faltam (ex. `atual: "Endereço, CNAE não informados"`).
- Cada função roda para uma empresa por vez e retorna `DivergenciaDetectada | null`.

- [ ] **Step 2: Testes unitários das regras internas**

`tests/auditoria.test.mjs`: casos para cada uma das 3 regras acima — empresa sem problema (retorna `null`), empresa com o problema (retorna a divergência com `atual` correto), casos de borda (CNPJ mascarado ainda inválido, situação com variação de capitalização).

Run: `node --test tests/auditoria.test.mjs`
Expected: todos passando.

- [ ] **Step 3: Regras externas (reconsulta BrasilAPI) em `lib/auditoria.ts`**

`avaliarRazaoSocialEEndereco(empresa, dadosBrasilAPI: EmpresaBrasilAPI)`: compara `empresa.razaoSocial` com `dadosBrasilAPI.razaoSocial` (normalizando espaços/caixa antes de comparar, para não sinalizar diferenças triviais de formatação) e `empresa.endereco` com `dadosBrasilAPI.endereco` da mesma forma; retorna até duas `DivergenciaDetectada` (uma por campo divergente), com `sugerido` = o valor da BrasilAPI.

- [ ] **Step 4: `POST /api/auditoria/executar`**

`app/api/auditoria/executar/route.ts`:
- Requer sessão.
- Busca todas as empresas do escritório (via `EMPRESA_SELECT`/RLS).
- Roda as 3 regras internas para cada empresa.
- Roda `detectar_duplicidade_razao_social` via `supabase.rpc(...)` uma vez para o escritório inteiro; para cada par retornado, gera 1 divergência `"Duplicidade"` associada à empresa de id maior (evita duplicar a mesma ocorrência nos dois lados do par), com `atual` descrevendo a outra empresa do par (ex.: `"Possível duplicidade com {razão social B}"`).
- Para cada empresa, reconsulta a BrasilAPI (`consultarCNPJNaBrasilAPI`) e roda `avaliarRazaoSocialEEndereco` — **só quando o body da requisição tiver `{ incluirRegrasExternas: true }`** (o botão "revalidar carteira" do frontend manda esse flag; qualquer disparo automático futuro após salvar/editar uma empresa NÃO deve mandar esse flag). Erros de uma consulta individual (404/429/502) não abortam a rotina inteira — a empresa é pulada e o erro é agregado num resumo (não falha a request toda por causa de uma empresa problemática).
- Aplica a idempotência descrita na seção acima do plano (upsert/expira divergências resolvidas) contra a tabela `divergencias`.
- Retorna um resumo: `{ detectadas: number, resolvidas: number }`.

- [ ] **Step 5: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Testar contra o banco real (regras internas primeiro)**

Com `npm run dev` + sessão autenticada + pelo menos uma empresa com problema conhecido (ex.: edite uma via `PATCH /api/empresas/:id` para ter `situacaoCadastral: "Suspensa"` ou remova o endereço):
```bash
curl -i -X POST http://localhost:PORT/api/auditoria/executar -b cookies.txt -H "Content-Type: application/json" -d '{}'
```
Expected: `200`, resumo com `detectadas >= 1`; `GET /api/auditoria/divergencias` (rota da Task 3 — se ainda não existir, consultar direto via `supabase.from("divergencias").select("*")` num script ad-hoc) mostra a linha criada.

Se a migração da Task 1 ainda não tiver sido aplicada no banco, a chamada ao RPC de duplicidade vai falhar — documentar isso no relatório e não deixar que isso quebre as outras regras (o erro do RPC deve ser isolado, não abortar a request toda, mesmo tratamento dado aos erros de BrasilAPI por empresa).

- [ ] **Step 7: Commit**

```bash
git add lib/auditoria.ts app/api/auditoria/executar tests/auditoria.test.mjs
git commit -m "feat: adiciona motor de regras de auditoria e rota de execução"
```

---

## Task 3: Listagem e tratamento de divergências

**Files:**
- Create: `app/api/auditoria/divergencias/route.ts` (GET)
- Create: `app/api/auditoria/divergencias/[id]/route.ts` (PATCH)

**Interfaces:**
- Consumes: tabela `divergencias` (Task 2 já grava nela).
- Produces: `GET /api/auditoria/divergencias`, `PATCH /api/auditoria/divergencias/:id` — consumidos pela Task 5.

- [ ] **Step 1: `GET /api/auditoria/divergencias`**

Retorna todas as divergências do escritório (RLS), com embed de `empresas(razao_social)` para exibir o nome. Shape de resposta (bate com `Divergencia` do frontend, ver `src/services/portfolio.ts`):
```ts
{ id: string; empresaId: string; empresa: string; tipo: string; atual: string; sugerido: string | null; status: "Pendente" | "Revisado" | "Ignorado" }
```

- [ ] **Step 2: `PATCH /api/auditoria/divergencias/:id`**

Body: `{ acao: "revisar" | "ignorar" | "aplicar_sugestao" }`.
- `"revisar"` → `status = "Revisado"`, `resolvido_em = now()`.
- `"ignorar"` → `status = "Ignorado"`, `resolvido_em = now()`.
- `"aplicar_sugestao"` → só válido para `tipo` em `["Razão social", "Endereço"]` e `sugerido` não nulo (400 nos outros casos); atualiza o campo correspondente em `empresas` (`razao_social` ou `endereco`) com o valor de `sugerido`, e marca a divergência como `status = "Revisado"`, `resolvido_em = now()`.
- RLS bloqueado/id inexistente → 404 (mesmo padrão da Task 3 do Onboarding).

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Testar via curl**

`GET` a lista, `PATCH` uma divergência com `"ignorar"` e outra (de tipo `"Razão social"` ou `"Endereço"`, se houver) com `"aplicar_sugestao"` — confirmar que a empresa correspondente foi atualizada (`GET /api/empresas` reflete o novo valor).

- [ ] **Step 5: Commit**

```bash
git add app/api/auditoria/divergencias
git commit -m "feat: adiciona listagem e tratamento de divergências de auditoria"
```

---

## Task 4: Ligar o frontend

**Files:**
- Modify: `src/services/portfolio.ts`
- Modify: `app/home-client.tsx` (componente `Audit` e o botão "revalidar carteira")

**Interfaces:**
- Consumes: rotas das Tasks 2 e 3.

- [ ] **Step 1: Atualizar `src/services/portfolio.ts`**

- `Divergencia.empresaId: string`, `Divergencia.id: string` (ajuste de shape, mesma decisão do plano de Onboarding).
- `listarDivergencias()`: `GET /api/auditoria/divergencias`.
- Nova função `tratarDivergencia(id: string, acao: "revisar" | "ignorar" | "aplicar_sugestao")`: `PATCH /api/auditoria/divergencias/${id}`.
- Nova função `executarAuditoria(incluirRegrasExternas: boolean)`: `POST /api/auditoria/executar`.

- [ ] **Step 2: Ajustar o componente `Audit` em `app/home-client.tsx`**

- `update(id, next)` hoje só faz `setIssues` local — trocar por chamada a `tratarDivergencia` (mapear `next` do estado do frontend, `"Revisado"`/`"Ignorado"`, para a `acao` da API), e re-buscar a lista (`listarDivergencias()`) após sucesso para refletir o estado real.
- Corrigir o bug pré-existente em `types` (linha usa `divergenciasMock.map(...)` em vez de `issues.map(...)` — a lista de tipos do filtro fica sempre baseada no mock, não nos dados reais). Trocar para `issues`.
- Adicionar um botão "Revalidar carteira" na seção de cabeçalho, chamando `executarAuditoria(true)` e recarregando a lista ao terminar (mostrar estado de carregamento simples, dado que a reconsulta de várias empresas pode demorar).
- Onde fizer sentido no botão de ações da tabela, oferecer "Aplicar sugestão" (além de "Corrigir"/"Ignorar" já existentes) quando `i.sugerido` não for nulo.

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Testar o fluxo completo no navegador**

Com uma empresa cadastrada com algum problema conhecido (situação suspensa, endereço vazio, ou CNPJ inválido salvo manualmente via edição): abrir Auditoria, clicar "Revalidar carteira", confirmar que a divergência aparece; clicar "Ignorar" numa e "Aplicar sugestão" em outra (se houver uma de razão social/endereço); atualizar a página e confirmar que o estado persiste (banco real, não mock).

- [ ] **Step 5: Commit**

```bash
git add src/services/portfolio.ts app/home-client.tsx
git commit -m "feat: liga a tela de Auditoria ao motor de regras real"
```
