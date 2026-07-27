# Calendário de intervalo para repetição Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir "repetir por N unidades" (quantidade+unidade) por um seletor visual de intervalo de datas (dois calendários), com `repete_inicio`/`repete_fim` reais no banco.

**Architecture:** `modelos_recorrencia.repeticoes_quantidade`/`repeticoes_unidade` viram `repete_inicio`/`repete_fim` (date, nullable, sempre os dois juntos ou os dois `null`). `calcularVencimentosDoModelo` filtra por comparação direta de data em vez de calcular um corte a partir de duração. Um componente novo (`RepeticaoRangePicker`) mostra dois calendários mensais lado a lado num popover.

**Tech Stack:** Next.js (vinext), Supabase (Postgres), `node --test`.

## Global Constraints

- `repete_inicio`/`repete_fim` são sempre gravados juntos: os dois `null` (repete sem limite) ou os dois preenchidos — nunca só um.
- `repete_inicio` pode ser uma data futura (adia o começo da geração) — capacidade nova, sem limite inferior existia antes.
- Nenhuma mudança em `empresas`/`tarefas` avulsas ou no seletor de responsáveis — só o campo de repetição dos modelos.
- A paleta de cores do popover usa as variáveis já existentes (`--primary`, `--primary-dark`, `--border`, `--surface`), não a roxa do print de referência do usuário.

---

## Mapa de arquivos

| Arquivo | O que faz |
|---|---|
| `supabase/migrations/manual/0018_modelos_repete_intervalo.sql` | Troca quantidade+unidade por `repete_inicio`/`repete_fim`, com backfill |
| `db/schema.ts` | Espelha as colunas novas em `modelosRecorrencia` |
| `lib/tarefas.ts` | `calcularVencimentosDoModelo`/`gerarTarefasDoMes` passam a filtrar por data direta |
| `tests/tarefas.test.mjs` | Reescreve a seção "repetições" pro novo formato |
| `lib/modelos-recorrencia.ts` | Nova `validarPeriodoRepeticao`, remove validação de duração antiga |
| `app/api/modelos-recorrencia/route.ts` | `POST` usa `repeteInicio`/`repeteFim` |
| `app/api/modelos-recorrencia/[id]/route.ts` | `PATCH` idem, com merge do valor efetivo quando só um dos dois vem no payload |
| `src/services/portfolio.ts` | Tipos trocam `repeticoesQuantidade`/`repeticoesUnidade` por `repeteInicio`/`repeteFim`; remove `UnidadeRepeticao` |
| `app/calendar-view.tsx` | Novo `RepeticaoRangePicker`; `ModeloEditModal` e `modeloDraft` passam a usá-lo; remove código morto de unidade |
| `app/globals.css` | Estilo do popover de intervalo |

---

### Task 1: Migração `0018` — `repete_inicio`/`repete_fim`

**Files:**
- Create: `supabase/migrations/manual/0018_modelos_repete_intervalo.sql`
- Modify: `db/schema.ts`

- [ ] **Step 1: Escrever a migração**

```sql
-- Troca quantidade+unidade de repetição por datas de início/fim reais.
-- Ver docs/superpowers/specs/2026-07-27-repeticao-calendario-design.md.

alter table public.modelos_recorrencia
  add column if not exists repete_inicio date,
  add column if not exists repete_fim date;

-- Backfill: replica a mesma regra de corte que calcularDataFimRecorrencia
-- já usava (fim exclusivo vira repete_fim = fim - 1 dia, inclusive).
update public.modelos_recorrencia
set repete_inicio = criado_em::date,
    repete_fim = (
      criado_em::date
      + case repeticoes_unidade
          when 'dias' then (repeticoes_quantidade || ' days')::interval
          when 'meses' then (repeticoes_quantidade || ' months')::interval
          when 'anos' then (repeticoes_quantidade || ' years')::interval
        end
      - interval '1 day'
    )::date
where repeticoes_quantidade is not null and repeticoes_unidade is not null;

alter table public.modelos_recorrencia
  drop column repeticoes_quantidade,
  drop column repeticoes_unidade;
```

- [ ] **Step 2: Rodar no Supabase (você) e conferir**

Depois de rodar, confirme com:

```sql
select column_name from information_schema.columns
where table_name = 'modelos_recorrencia' and column_name in ('repete_inicio','repete_fim','repeticoes_quantidade','repeticoes_unidade');
```

Esperado: só `repete_inicio` e `repete_fim` aparecem (as duas antigas sumiram).

- [ ] **Step 3: `db/schema.ts`**

Em `export const modelosRecorrencia = pgTable(...)`, troque:

```typescript
  repeticoesQuantidade: integer("repeticoes_quantidade"),
  repeticoesUnidade: text("repeticoes_unidade"),
```

por:

```typescript
  repeteInicio: date("repete_inicio"),
  repeteFim: date("repete_fim"),
```

(`date` já é importado no arquivo, usado em `empresas.abertura` e `tarefas.vencimento`.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/manual/0018_modelos_repete_intervalo.sql db/schema.ts
git commit -m "feat: repete_inicio/repete_fim substituem quantidade+unidade em modelos_recorrencia"
```

---

### Task 2: `lib/tarefas.ts` — geração por intervalo de datas

**Files:**
- Modify: `lib/tarefas.ts`
- Modify: `tests/tarefas.test.mjs`

- [ ] **Step 1: Reescrever os testes de "repetições" (vão falhar)**

Em `tests/tarefas.test.mjs`, troque todo o bloco entre `// --- repetições (fim por duração) ---` e `// --- defensivo ---` por:

```javascript
// --- repetições (início/fim por data) --------------------------------------

test("repetições: sem início/fim, repete indefinidamente (comportamento padrão)", () => {
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "diario",
    diaReferencia: 1,
    mes: "2027-01",
    criadoEm: "2026-01-01T00:00:00Z",
  });
  assert.equal(vencimentos.length, 31);
});

test("repetições: 'diario' com fim no 5º dia corta as datas depois dele", () => {
  const vencimentos = calcularVencimentosDoModelo({
    periodicidade: "diario",
    diaReferencia: 1,
    mes: "2026-07",
    criadoEm: "2026-07-01T00:00:00Z",
    repeteInicio: "2026-07-01",
    repeteFim: "2026-07-05",
  });
  assert.deepEqual(vencimentos, ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"]);
});

test("repetições: 'mensal' com fim no mês seguinte ainda gera nele, mas não no terceiro", () => {
  const noSegundoMes = calcularVencimentosDoModelo({
    periodicidade: "mensal",
    diaReferencia: 10,
    mes: "2026-08",
    criadoEm: "2026-07-10T00:00:00Z",
    repeteInicio: "2026-07-10",
    repeteFim: "2026-08-31",
  });
  assert.deepEqual(noSegundoMes, ["2026-08-10"]);

  const noTerceiroMes = calcularVencimentosDoModelo({
    periodicidade: "mensal",
    diaReferencia: 10,
    mes: "2026-09",
    criadoEm: "2026-07-10T00:00:00Z",
    repeteInicio: "2026-07-10",
    repeteFim: "2026-08-31",
  });
  assert.deepEqual(noTerceiroMes, []);
});

test("repetições: 'anual' com fim antes do segundo ano não gera nele", () => {
  const noPrimeiroAno = calcularVencimentosDoModelo({
    periodicidade: "anual",
    diaReferencia: 15,
    mes: "2026-05",
    criadoEm: "2026-05-15T00:00:00Z",
    repeteInicio: "2026-05-15",
    repeteFim: "2027-05-14",
  });
  assert.deepEqual(noPrimeiroAno, ["2026-05-15"]);

  const noSegundoAno = calcularVencimentosDoModelo({
    periodicidade: "anual",
    diaReferencia: 15,
    mes: "2027-05",
    criadoEm: "2026-05-15T00:00:00Z",
    repeteInicio: "2026-05-15",
    repeteFim: "2027-05-14",
  });
  assert.deepEqual(noSegundoAno, []);
});

test("repetições: repeteInicio no futuro não gera antes dele", () => {
  const antesDoInicio = calcularVencimentosDoModelo({
    periodicidade: "diario",
    diaReferencia: 1,
    mes: "2026-07",
    criadoEm: "2026-01-01T00:00:00Z",
    repeteInicio: "2026-08-01",
    repeteFim: null,
  });
  assert.deepEqual(antesDoInicio, []);

  const depoisDoInicio = calcularVencimentosDoModelo({
    periodicidade: "diario",
    diaReferencia: 1,
    mes: "2026-08",
    criadoEm: "2026-01-01T00:00:00Z",
    repeteInicio: "2026-08-01",
    repeteFim: null,
  });
  assert.equal(depoisDoInicio.length, 31);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/tarefas.test.mjs`
Expected: FAIL (a função ainda usa `repeticoesQuantidade`/`repeticoesUnidade`, os testes novos passam `repeteInicio`/`repeteFim` que ela ignora).

- [ ] **Step 3: Reescrever `calcularVencimentosDoModelo` e remover `calcularDataFimRecorrencia`**

Remova a função `calcularDataFimRecorrencia` inteira (não é mais usada). Troque a assinatura e o fim de `calcularVencimentosDoModelo`:

```typescript
export function calcularVencimentosDoModelo(params: {
  periodicidade: string;
  diaReferencia: number;
  mes: string; // "YYYY-MM"
  criadoEm: string; // ISO date ou timestamp
  diasSemana?: number[] | null;
  mesReferencia?: number | null;
  repeteInicio?: string | null;
  repeteFim?: string | null;
}): string[] {
  const [anoStr, mesStr] = params.mes.split("-");
  const ano = Number(anoStr);
  const mesNum = Number(mesStr);
  const ultimoDia = ultimoDiaDoMes(ano, mesNum);

  let datas: string[] = [];

  if (params.periodicidade === "diario") {
    for (let dia = 1; dia <= ultimoDia; dia++) {
      datas.push(formatarData(ano, mesNum, dia));
    }
  } else if (params.periodicidade === "mensal") {
    const dia = Math.min(params.diaReferencia, ultimoDia);
    datas = [formatarData(ano, mesNum, dia)];
  } else if (params.periodicidade === "anual") {
    const mesReferencia = params.mesReferencia ?? new Date(params.criadoEm).getUTCMonth() + 1;
    if (mesReferencia === mesNum) {
      const dia = Math.min(params.diaReferencia, ultimoDia);
      datas = [formatarData(ano, mesNum, dia)];
    }
  } else if (params.periodicidade === "semanal") {
    const diasAlvo = params.diasSemana && params.diasSemana.length > 0 ? params.diasSemana : [params.diaReferencia];
    for (let dia = 1; dia <= ultimoDia; dia++) {
      const data = new Date(Date.UTC(ano, mesNum - 1, dia));
      const diaSemanaJS = data.getUTCDay(); // 0=domingo...6=sábado
      const diaSemana = diaSemanaJS === 0 ? 7 : diaSemanaJS; // 1=segunda...7=domingo
      if (diasAlvo.includes(diaSemana)) {
        datas.push(formatarData(ano, mesNum, dia));
      }
    }
  }

  const repeteInicio = params.repeteInicio ?? null;
  const repeteFim = params.repeteFim ?? null;
  if (repeteInicio || repeteFim) {
    datas = datas.filter((data) => (!repeteInicio || data >= repeteInicio) && (!repeteFim || data <= repeteFim));
  }

  return datas;
}
```

Atualize também o comentário do topo do arquivo (bloco `/** ... */` inicial) removendo a menção a "repeticoesQuantidade/repeticoesUnidade" e trocando por uma linha sobre `repeteInicio`/`repeteFim`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/tarefas.test.mjs`
Expected: PASS, 23 testes (mesma contagem de antes — trocamos os 4 testes de repetição por 5, mas removemos nenhum outro; confira o total exato no output, não precisa bater 23 exatamente, só todos verdes).

- [ ] **Step 5: Atualizar `ModeloRecorrenciaParaGeracao` e `gerarTarefasDoMes`**

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
  repete_inicio: string | null;
  repete_fim: string | null;
  criado_em: string;
  responsaveis: { perfil_id: string }[];
};
```

Na query de `gerarTarefasDoMes`:

```typescript
  const { data: modelos, error: modelosError } = await supabase
    .from("modelos_recorrencia")
    .select("id, empresa_id, titulo, tipo, periodicidade, dia_referencia, dias_semana, mes_referencia, repete_inicio, repete_fim, criado_em, responsaveis:modelos_recorrencia_responsaveis(perfil_id)")
    .eq("escritorio_id", escritorioId)
    .eq("ativo", true);
```

E na chamada de `calcularVencimentosDoModelo` dentro do laço:

```typescript
    const vencimentos = calcularVencimentosDoModelo({
      periodicidade: modelo.periodicidade,
      diaReferencia: modelo.dia_referencia,
      mes,
      criadoEm: modelo.criado_em,
      diasSemana: modelo.dias_semana,
      mesReferencia: modelo.mes_referencia,
      repeteInicio: modelo.repete_inicio,
      repeteFim: modelo.repete_fim,
    });
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: erros novos nos outros arquivos que ainda usam `repeticoesQuantidade`/`repeticoesUnidade`/`UnidadeRepeticao` — Tasks 3-6 corrigem.

- [ ] **Step 7: Commit**

```bash
git add lib/tarefas.ts tests/tarefas.test.mjs
git commit -m "feat: geração de tarefas filtra por repete_inicio/repete_fim (datas)"
```

---

### Task 3: `lib/modelos-recorrencia.ts` — validação do período

**Files:**
- Modify: `lib/modelos-recorrencia.ts`

- [ ] **Step 1: Remover o código de duração antigo**

Remova por completo: `export type UnidadeRepeticao = ...`, `UNIDADES_REPETICAO_VALIDAS`, `ORDEM_UNIDADE`, `UNIDADE_MINIMA_POR_PERIODICIDADE`, `unidadesValidasParaPeriodicidade`, `validarRepeticoes` (a função inteira, com seu comentário).

- [ ] **Step 2: Atualizar `ModeloRecorrenciaRow`**

Troque:

```typescript
  repeticoes_quantidade: number | null;
  repeticoes_unidade: string | null;
```

por:

```typescript
  repete_inicio: string | null;
  repete_fim: string | null;
```

- [ ] **Step 3: Adicionar `validarPeriodoRepeticao`**

No lugar de `validarRepeticoes` removida:

```typescript
const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida a combinação de `repeteInicio`/`repeteFim`: os dois precisam vir
 * juntos (ambos `null` = repete sem fim) e, quando presentes, ambos devem
 * ser datas `"YYYY-MM-DD"` válidas com `fim >= inicio`. Retorna a mensagem
 * de erro, ou `null` se a combinação for válida.
 */
export function validarPeriodoRepeticao(inicio: unknown, fim: unknown): string | null {
  const i = inicio ?? null;
  const f = fim ?? null;

  if ((i === null) !== (f === null)) {
    return "Informe início e fim do período juntos, ou deixe os dois em branco para repetir sem data final.";
  }
  if (i === null) {
    return null;
  }
  if (typeof i !== "string" || !DATA_REGEX.test(i) || typeof f !== "string" || !DATA_REGEX.test(f)) {
    return 'Datas do período devem estar no formato "YYYY-MM-DD".';
  }
  if (f < i) {
    return "A data de fim deve ser igual ou posterior à data de início.";
  }
  return null;
}
```

- [ ] **Step 4: Atualizar `paraShapeFrontend`**

Troque:

```typescript
    repeticoesQuantidade: row.repeticoes_quantidade,
    repeticoesUnidade: row.repeticoes_unidade,
```

por:

```typescript
    repeteInicio: row.repete_inicio,
    repeteFim: row.repete_fim,
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: erros restantes só nas rotas de API e `src/services/portfolio.ts`/`app/calendar-view.tsx` (próximas tasks).

- [ ] **Step 6: Commit**

```bash
git add lib/modelos-recorrencia.ts
git commit -m "feat: validarPeriodoRepeticao substitui validação de quantidade+unidade"
```

---

### Task 4: API de modelos de recorrência — `repeteInicio`/`repeteFim`

**Files:**
- Modify: `app/api/modelos-recorrencia/route.ts`
- Modify: `app/api/modelos-recorrencia/[id]/route.ts`

- [ ] **Step 1: `POST /api/modelos-recorrencia`**

Troque o import (`validarRepeticoes` → `validarPeriodoRepeticao`). Troque o tipo do payload:

```typescript
  repeteInicio?: string | null;
  repeteFim?: string | null;
```

(no lugar de `repeticoesQuantidade?: number | null; repeticoesUnidade?: string | null;`).

Troque:

```typescript
  const repeticoesQuantidade = payload.repeticoesQuantidade ?? null;
  const repeticoesUnidade = payload.repeticoesUnidade ?? null;
  const erroRepeticoes = validarRepeticoes(periodicidade as Periodicidade, repeticoesQuantidade, repeticoesUnidade);
  if (erroRepeticoes) {
    return applySetCookies(Response.json({ error: erroRepeticoes }, { status: 400 }));
  }
```

por:

```typescript
  const repeteInicio = payload.repeteInicio ?? null;
  const repeteFim = payload.repeteFim ?? null;
  const erroPeriodo = validarPeriodoRepeticao(repeteInicio, repeteFim);
  if (erroPeriodo) {
    return applySetCookies(Response.json({ error: erroPeriodo }, { status: 400 }));
  }
```

No `insert`, troque `repeticoes_quantidade: repeticoesQuantidade, repeticoes_unidade: repeticoesUnidade,` por `repete_inicio: repeteInicio, repete_fim: repeteFim,`.

Atualize o comentário acima do `POST` que menciona `repeticoesQuantidade`/`repeticoesUnidade`, trocando pela nova dupla de datas.

- [ ] **Step 2: `PATCH /api/modelos-recorrencia/:id`**

Troque o import (`validarRepeticoes` → `validarPeriodoRepeticao`). Troque no tipo do payload `repeticoesQuantidade?: number | null; repeticoesUnidade?: string | null;` por `repeteInicio?: string | null; repeteFim?: string | null;`.

Em `CAMPOS_EDITAVEIS`, troque:

```typescript
  { chave: "repeticoesQuantidade", coluna: "repeticoes_quantidade" },
  { chave: "repeticoesUnidade", coluna: "repeticoes_unidade" },
```

por:

```typescript
  { chave: "repeteInicio", coluna: "repete_inicio" },
  { chave: "repeteFim", coluna: "repete_fim" },
```

Em `CAMPOS_QUE_AFETAM_GERACAO`, remova `"repeticoesQuantidade", "repeticoesUnidade"` da lista (a validação de período agora é independente, tratada abaixo — essas duas nunca precisaram se combinar com periodicidade/diaReferencia).

Dentro do bloco `if (CAMPOS_QUE_AFETAM_GERACAO.some(...))`, remova as linhas que buscam/validam `repeticoes_quantidade`/`repeticoes_unidade` (o `select` que busca `modeloAtual`, o campo no type `atual`, e o bloco final `quantidadeEfetiva`/`unidadeEfetiva`/`erroRepeticoes`) — sobra só periodicidade/dia/diasSemana/mesReferencia nesse bloco.

Adicione, logo depois desse bloco (antes de `const updates: Record<string, unknown> = {};`):

```typescript
  if ("repeteInicio" in payload || "repeteFim" in payload) {
    let repeteInicioEfetivo = payload.repeteInicio ?? null;
    let repeteFimEfetivo = payload.repeteFim ?? null;

    if (!("repeteInicio" in payload) || !("repeteFim" in payload)) {
      const { data: modeloAtual, error: buscarError } = await supabase
        .from("modelos_recorrencia")
        .select("repete_inicio, repete_fim")
        .eq("id", id)
        .maybeSingle();

      if (buscarError || !modeloAtual) {
        return applySetCookies(Response.json({ error: "Modelo de recorrência não encontrado." }, { status: 404 }));
      }

      const atualPeriodo = modeloAtual as { repete_inicio: string | null; repete_fim: string | null };
      if (!("repeteInicio" in payload)) repeteInicioEfetivo = atualPeriodo.repete_inicio;
      if (!("repeteFim" in payload)) repeteFimEfetivo = atualPeriodo.repete_fim;
    }

    const erroPeriodo = validarPeriodoRepeticao(repeteInicioEfetivo, repeteFimEfetivo);
    if (erroPeriodo) {
      return applySetCookies(Response.json({ error: erroPeriodo }, { status: 400 }));
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: erros restantes só em `src/services/portfolio.ts` e `app/calendar-view.tsx`.

- [ ] **Step 4: Commit**

```bash
git add app/api/modelos-recorrencia/route.ts "app/api/modelos-recorrencia/[id]/route.ts"
git commit -m "feat: API de modelos de recorrência usa repeteInicio/repeteFim"
```

---

### Task 5: Tipos de client (`src/services/portfolio.ts`)

**Files:**
- Modify: `src/services/portfolio.ts`

- [ ] **Step 1: Remover `UnidadeRepeticao` e atualizar `ModeloRecorrencia`**

Remova a linha `export type UnidadeRepeticao = "dias" | "meses" | "anos";` (e o comentário acima dela). Em `ModeloRecorrencia`, troque:

```typescript
  responsavelIds: string[];
  responsaveis: string[];
  ativo: boolean;
  // Fim da recorrência por duração (ex.: repetir por 2 meses), a partir de
  // `criadoEm`. Os dois `null` juntos = repete sem data final.
  repeticoesQuantidade: number | null;
  repeticoesUnidade: UnidadeRepeticao | null;
  criadoEm?: string;
```

por:

```typescript
  responsavelIds: string[];
  responsaveis: string[];
  ativo: boolean;
  // Início/fim reais da recorrência (datas "YYYY-MM-DD"). Os dois `null`
  // juntos = repete sem data final; sempre vêm juntos (nunca só um).
  repeteInicio: string | null;
  repeteFim: string | null;
  criadoEm?: string;
```

- [ ] **Step 2: `ModeloRecorrenciaPayload`/`ModeloRecorrenciaPatch`**

Troque `repeticoesQuantidade?: number | null; repeticoesUnidade?: UnidadeRepeticao | null;` (em `ModeloRecorrenciaPayload`) e `repeticoesQuantidade: number | null; repeticoesUnidade: UnidadeRepeticao | null;` (dentro do `Partial<{...}>` de `ModeloRecorrenciaPatch`) por `repeteInicio?: string | null; repeteFim?: string | null;` (payload) e `repeteInicio: string | null; repeteFim: string | null;` (patch), respectivamente.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: erros restantes só em `app/calendar-view.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/services/portfolio.ts
git commit -m "feat: tipos de client usam repeteInicio/repeteFim"
```

---

### Task 6: `RepeticaoRangePicker` e integração no calendário

**Files:**
- Modify: `app/calendar-view.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `RepeticaoRangePicker({ inicio, fim, onChange })` — componente local (não precisa ser exportado, só usado neste arquivo).

- [ ] **Step 1: Remover o código morto de unidade e ajustar o import**

Troque o import de `../src/services/portfolio` removendo `type UnidadeRepeticao` da lista.

Remova por completo: `UNIDADE_LABEL`, `rotuloUnidade`, `UNIDADE_TEXTO`, `ORDEM_UNIDADE`, `UNIDADE_MINIMA`, `UNIDADES_REPETICAO`, a função `unidadesValidas`. Mantenha `FREQUENCIA_TEXTO` (ainda usada, não depende de unidade).

- [ ] **Step 2: Helpers de data e grade do mês**

Logo abaixo de `formatDataLonga`, adicione:

```typescript
const formatDataCurta = (iso: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${iso}T12:00:00`));

/** Grade de um mês pro seletor de intervalo: `null` nas células antes do dia 1 (mesmo padrão do calendário principal), datas "YYYY-MM-DD" depois. */
function mesGrid(ano: number, mes: number): (string | null)[] {
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
  const dias: (string | null)[] = Array.from({ length: primeiroDiaSemana }, () => null);
  for (let d = 1; d <= diasNoMes; d++) {
    dias.push(`${ano}-${pad2(mes + 1)}-${pad2(d)}`);
  }
  return dias;
}
```

- [ ] **Step 3: O componente `RepeticaoRangePicker`**

Logo depois do componente `ResponsavelPicker`:

```typescript
/** Seletor de intervalo de datas (início/fim) pra "repetir por um período" — dois calendários mensais consecutivos, num popover. */
function RepeticaoRangePicker({ inicio, fim, onChange }: {
  inicio: string | null; fim: string | null; onChange: (inicio: string | null, fim: string | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const menuAcessivel = useAccessibleMenu(aberto, () => setAberto(false));
  useDismissOnViewportChange(aberto, menuAcessivel.fechar);
  const hoje = new Date();
  const [mesBaseAno, setMesBaseAno] = useState(hoje.getFullYear());
  const [mesBaseMes, setMesBaseMes] = useState(hoje.getMonth());
  const [selecaoInicio, setSelecaoInicio] = useState<string | null>(inicio);
  const [selecaoFim, setSelecaoFim] = useState<string | null>(fim);
  const [hoverDia, setHoverDia] = useState<string | null>(null);

  const abrir = (e: React.MouseEvent<HTMLButtonElement>) => {
    menuAcessivel.rememberOpener(e.currentTarget);
    setSelecaoInicio(inicio);
    setSelecaoFim(fim);
    setAberto(true);
  };

  const clicarDia = (dia: string) => {
    if (!selecaoInicio || selecaoFim) {
      setSelecaoInicio(dia);
      setSelecaoFim(null);
      return;
    }
    if (dia < selecaoInicio) {
      setSelecaoFim(selecaoInicio);
      setSelecaoInicio(dia);
    } else {
      setSelecaoFim(dia);
    }
  };

  const apagar = () => { setSelecaoInicio(null); setSelecaoFim(null); };
  const aplicar = () => { onChange(selecaoInicio, selecaoFim); setAberto(false); };

  const emIntervalo = (dia: string) => {
    const limiteSuperior = selecaoFim ?? hoverDia;
    if (!selecaoInicio || !limiteSuperior) return false;
    const [a, b] = selecaoInicio <= limiteSuperior ? [selecaoInicio, limiteSuperior] : [limiteSuperior, selecaoInicio];
    return dia >= a && dia <= b;
  };

  const renderCalendario = (ano: number, mes: number) => <div className="range-calendar">
    <div className="range-weekdays">{["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
    <div className="range-day-grid">{mesGrid(ano, mes).map((dia, i) => {
      if (!dia) return <span key={`blank-${i}`} className="range-day range-day-blank" />;
      const classes = ["range-day"];
      if (dia === selecaoInicio) classes.push("range-day-start");
      if (dia === selecaoFim) classes.push("range-day-end");
      if (emIntervalo(dia)) classes.push("range-day-in");
      return <button type="button" key={dia} className={classes.join(" ")} onClick={() => clicarDia(dia)} onMouseEnter={() => setHoverDia(dia)}>{Number(dia.slice(-2))}</button>;
    })}</div>
  </div>;

  const indiceMesSeguinte = mesBaseAno * 12 + mesBaseMes + 1;
  const mesSeguinteAno = Math.floor(indiceMesSeguinte / 12);
  const mesSeguinteMes = indiceMesSeguinte % 12;

  const navegar = (delta: number) => {
    const novoIndice = mesBaseAno * 12 + mesBaseMes + delta;
    setMesBaseAno(Math.floor(novoIndice / 12));
    setMesBaseMes(((novoIndice % 12) + 12) % 12);
  };

  return <div className="repeticao-range">
    <button type="button" className="secondary repeticao-range-trigger" onClick={abrir}>
      {inicio && fim ? `${formatDataCurta(inicio)} – ${formatDataCurta(fim)}` : "Selecionar período"}
    </button>
    {aberto && <>
      <button type="button" className="menu-backdrop" aria-label="Fechar" onClick={() => setAberto(false)} />
      <div ref={menuAcessivel.menuRef} className="range-popover" role="dialog" aria-label="Selecionar período" onKeyDown={menuAcessivel.aoTeclar} onMouseLeave={() => setHoverDia(null)}>
        <div className="range-header">
          <button type="button" className="nav-arrow" aria-label="Mês anterior" onClick={() => navegar(-1)}>‹</button>
          <strong>{MESES_PT[mesBaseMes]} {mesBaseAno}</strong>
          <strong>{MESES_PT[mesSeguinteMes]} {mesSeguinteAno}</strong>
          <button type="button" className="nav-arrow" aria-label="Próximo mês" onClick={() => navegar(1)}>›</button>
        </div>
        <div className="range-calendars">
          {renderCalendario(mesBaseAno, mesBaseMes)}
          {renderCalendario(mesSeguinteAno, mesSeguinteMes)}
        </div>
        <div className="range-popover-footer">
          <button type="button" className="secondary" onClick={apagar}>Apagar</button>
          <button type="button" className="primary" onClick={aplicar}>Aplicar</button>
        </div>
      </div>
    </>}
  </div>;
}
```

- [ ] **Step 4: `descreverRecorrencia` — mostrar o intervalo**

Troque:

```typescript
  if (m.repeticoesQuantidade && m.repeticoesUnidade) {
    base += ` · por ${m.repeticoesQuantidade} ${rotuloUnidade(m.repeticoesQuantidade, m.repeticoesUnidade)}`;
  }
```

por:

```typescript
  if (m.repeteInicio && m.repeteFim) {
    base += ` · ${formatDataCurta(m.repeteInicio)} – ${formatDataCurta(m.repeteFim)}`;
  }
```

- [ ] **Step 5: `ModeloEditModal`**

Troque:

```typescript
  const [repeticoesQuantidade, setRepeticoesQuantidade] = useState<number | null>(modelo.repeticoesQuantidade);
  const [repeticoesUnidade, setRepeticoesUnidade] = useState<UnidadeRepeticao | null>(modelo.repeticoesUnidade);
```

por:

```typescript
  const [modoRepeticao, setModoRepeticao] = useState<"indefinido" | "periodo">(modelo.repeteInicio ? "periodo" : "indefinido");
  const [repeteInicio, setRepeteInicio] = useState<string | null>(modelo.repeteInicio);
  const [repeteFim, setRepeteFim] = useState<string | null>(modelo.repeteFim);
```

Em `alterarPeriodicidade`, remova a linha `if (repeticoesQuantidade !== null) setRepeticoesUnidade(unidadesValidas(p)[0]);` (não sobra nada relacionado a unidade pra ajustar ao trocar periodicidade).

Remova a função `iniciarRepeticaoLimitada` inteira.

Em `save`, adicione a validação (junto das outras, antes de `setSaving(true)`):

```typescript
    if (modoRepeticao === "periodo" && (!repeteInicio || !repeteFim)) { setError("Selecione o período de repetição."); return; }
```

E troque, na chamada de `atualizarModeloRecorrencia`:

```typescript
        titulo, tipo, periodicidade, diaReferencia, repeticoesQuantidade, repeticoesUnidade,
```

por:

```typescript
        titulo, tipo, periodicidade, diaReferencia,
        repeteInicio: modoRepeticao === "periodo" ? repeteInicio : null,
        repeteFim: modoRepeticao === "periodo" ? repeteFim : null,
```

Na JSX, troque o bloco inteiro de "Repetição":

```typescript
    <div className="field-block">
      <span className="field-label">Repetição</span>
      <div className="segmented" role="group" aria-label="Repetição">
        <button type="button" className={repeticoesQuantidade === null ? "selected" : ""} onClick={() => { setRepeticoesQuantidade(null); setRepeticoesUnidade(null); }}>Sem data final</button>
        <button type="button" className={repeticoesQuantidade !== null ? "selected" : ""} onClick={iniciarRepeticaoLimitada}>Repetir por um período</button>
      </div>
      <small className="field-hint">{repeticoesQuantidade === null ? `Gera tarefas indefinidamente, ${FREQUENCIA_TEXTO[periodicidade]}.` : "Para de gerar novas tarefas após o período informado."}</small>
      {repeticoesQuantidade !== null && <div className="field-grid">
        <label>Quantidade<input type="number" min={1} required value={repeticoesQuantidade} onChange={(e) => setRepeticoesQuantidade(Number(e.target.value))} /></label>
        <label>Unidade<select value={repeticoesUnidade ?? unidadesValidas(periodicidade)[0]} onChange={(e) => setRepeticoesUnidade(e.target.value as UnidadeRepeticao)}>{unidadesValidas(periodicidade).map((u) => <option key={u} value={u}>{UNIDADE_TEXTO[u]}</option>)}</select></label>
      </div>}
    </div>
```

por:

```typescript
    <div className="field-block">
      <span className="field-label">Repetição</span>
      <div className="segmented" role="group" aria-label="Repetição">
        <button type="button" className={modoRepeticao === "indefinido" ? "selected" : ""} onClick={() => { setModoRepeticao("indefinido"); setRepeteInicio(null); setRepeteFim(null); }}>Sem data final</button>
        <button type="button" className={modoRepeticao === "periodo" ? "selected" : ""} onClick={() => setModoRepeticao("periodo")}>Repetir por um período</button>
      </div>
      <small className="field-hint">{modoRepeticao === "indefinido" ? `Gera tarefas indefinidamente, ${FREQUENCIA_TEXTO[periodicidade]}.` : "Para de gerar novas tarefas após o período informado."}</small>
      {modoRepeticao === "periodo" && <RepeticaoRangePicker inicio={repeteInicio} fim={repeteFim} onChange={(i, f) => { setRepeteInicio(i); setRepeteFim(f); }} />}
    </div>
```

- [ ] **Step 6: `modeloDraft` (Novo modelo)**

No `useState` de `modeloDraft`, troque `repeticoesQuantidade: null as number | null, repeticoesUnidade: null as UnidadeRepeticao | null,` por `modoRepeticao: "indefinido" as "indefinido" | "periodo", repeteInicio: null as string | null, repeteFim: null as string | null,` — nas **duas** ocorrências (declaração inicial do `useState` e dentro de `abrirNovoModelo`).

Remova `alterarPeriodicidadeDraft`'s linha `repeticoesUnidade: d.repeticoesQuantidade !== null ? unidadesValidas(p)[0] : d.repeticoesUnidade,` (some do objeto retornado, sem substituto — nada de unidade sobra pra ajustar).

Remova a função `iniciarRepeticaoLimitadaDraft` inteira.

Em `criarModelo`, adicione a validação (junto das outras):

```typescript
    if (modeloDraft.modoRepeticao === "periodo" && (!modeloDraft.repeteInicio || !modeloDraft.repeteFim)) {
      setModeloError("Selecione o período de repetição.");
      return;
    }
```

E troque, na chamada de `criarModeloRecorrencia`:

```typescript
        repeticoesQuantidade: modeloDraft.repeticoesQuantidade,
        repeticoesUnidade: modeloDraft.repeticoesUnidade,
```

por:

```typescript
        repeteInicio: modeloDraft.modoRepeticao === "periodo" ? modeloDraft.repeteInicio : null,
        repeteFim: modeloDraft.modoRepeticao === "periodo" ? modeloDraft.repeteFim : null,
```

Na JSX (formulário "Novo modelo"), troque o bloco de "Repetição" da mesma forma que no Step 5, usando `modeloDraft.modoRepeticao`/`modeloDraft.repeteInicio`/`modeloDraft.repeteFim` e `setModeloDraft` no lugar dos setters locais:

```typescript
      <div className="field-block">
        <span className="field-label">Repetição</span>
        <div className="segmented" role="group" aria-label="Repetição">
          <button type="button" className={modeloDraft.modoRepeticao === "indefinido" ? "selected" : ""} onClick={() => setModeloDraft({ ...modeloDraft, modoRepeticao: "indefinido", repeteInicio: null, repeteFim: null })}>Sem data final</button>
          <button type="button" className={modeloDraft.modoRepeticao === "periodo" ? "selected" : ""} onClick={() => setModeloDraft({ ...modeloDraft, modoRepeticao: "periodo" })}>Repetir por um período</button>
        </div>
        <small className="field-hint">{modeloDraft.modoRepeticao === "indefinido" ? `Gera tarefas indefinidamente, ${FREQUENCIA_TEXTO[modeloDraft.periodicidade]}.` : "Para de gerar novas tarefas após o período informado."}</small>
        {modeloDraft.modoRepeticao === "periodo" && <RepeticaoRangePicker inicio={modeloDraft.repeteInicio} fim={modeloDraft.repeteFim} onChange={(i, f) => setModeloDraft({ ...modeloDraft, repeteInicio: i, repeteFim: f })} />}
      </div>
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros novos.

- [ ] **Step 8: CSS do popover de intervalo**

Em `app/globals.css`, adicione:

```css
.repeticao-range{position:relative;display:inline-block}
.range-popover{position:absolute;top:100%;left:0;margin-top:8px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px;z-index:50;width:min(560px,90vw)}
.range-header{display:grid;grid-template-columns:auto 1fr 1fr auto;align-items:center;gap:8px;margin-bottom:12px;font-size:13px;font-weight:700;color:var(--text)}
.range-header strong{text-align:center}
.range-calendars{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.range-weekdays{display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px}
.range-day-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.range-day{border:0;background:transparent;border-radius:6px;padding:6px 0;font-size:12px;color:var(--text);cursor:pointer}
.range-day:hover{background:#eaf3f4}
.range-day-blank{cursor:default}
.range-day-in{background:#eaf3f4;border-radius:0}
.range-day-start{background:var(--primary);color:#fff;border-radius:6px 0 0 6px}
.range-day-end{background:var(--primary);color:#fff;border-radius:0 6px 6px 0}
.range-popover-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:14px}
html[data-theme="dark"] .range-popover{background:var(--surface)}
html[data-theme="dark"] .range-day:hover{background:#2a3536}
html[data-theme="dark"] .range-day-in{background:#2a3536}
```

- [ ] **Step 9: Testar no navegador**

1. Rode `npm test`/`node --test tests/tarefas.test.mjs` (Task 2 já cobriu, mas confirme de novo depois de todas as tasks).
2. Abra "Novo modelo de recorrência" no Calendário, clique em "Repetir por um período" — deve aparecer o botão "Selecionar período".
3. Clique nele — deve abrir o popover com dois calendários consecutivos (mês atual + o seguinte).
4. Clique num dia (início) e depois outro (fim) — confirme que o intervalo fica destacado e os dois extremos ficam marcados.
5. Clique "Aplicar" — o botão-gatilho deve mostrar as duas datas escolhidas.
6. Salve o modelo e confirme, na tabela "Modelos recorrentes", que a coluna de periodicidade mostra o intervalo (`descreverRecorrencia`).
7. Edite esse modelo de novo — confirme que o popover abre já com o intervalo salvo.
8. Troque pra "Sem data final" e salve — confirme que volta a gerar indefinidamente.
9. Teste os botões ‹/› do popover — devem avançar/recuar os dois calendários juntos, sempre consecutivos.
10. Teste "Apagar" dentro do popover — deve limpar a seleção em andamento sem fechar.

- [ ] **Step 10: Commit**

```bash
git add app/calendar-view.tsx app/globals.css
git commit -m "feat: seletor de intervalo de datas (RepeticaoRangePicker) pra repetição de modelos"
```

---

### Task 7: Checklist final de verificação manual

- [ ] Migração `0018` rodada no Supabase (Task 1).
- [ ] `node --test tests/tarefas.test.mjs tests/equipe.test.mjs tests/supabase-admin.test.mjs` todos verdes.
- [ ] `npx tsc --noEmit -p .` sem erros novos.
- [ ] Fluxo completo testado (Task 6, Step 9) do zero: criar modelo com período, editar, ver o intervalo na tabela, voltar pra "sem data final", navegar os meses do popover.

---

## Self-review

**Cobertura da spec:** dados (Task 1), geração por comparação de data (Task 2), validação (Task 3), API (Task 4), tipos de client (Task 5), componente visual + integração nos dois formulários (Task 6) — todos os pontos cobertos.

**Placeholders:** nenhum — todo passo tem código completo, inclusive os blocos "troque X por Y".

**Consistência de tipos:** `repeteInicio`/`repeteFim` como `string | null` em todas as camadas (banco via `date`, lib, API, client, componente) — sem `UnidadeRepeticao`/quantidade sobrando em nenhuma camada depois da Task 6.
