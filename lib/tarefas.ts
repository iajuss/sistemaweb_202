/**
 * Geração sob demanda de tarefas a partir de `modelos_recorrencia`, e shape
 * compartilhado entre GET/POST/PATCH de /api/tarefas (linha bruta do
 * PostgREST com embeds de empresa/responsável + tradução para o formato do
 * frontend). Mesma convenção de `lib/empresas.ts`/`lib/modelos-recorrencia.ts`.
 *
 * Convenção de status armazenado: `tarefas.status` guarda apenas
 * `"Pendente"` ou `"Concluída"` (capitalizado — bate com o default da coluna
 * no schema e com o union `Tarefa["status"]` do frontend em
 * `src/services/portfolio.ts`). `"Atrasada"` **nunca** é persistido: é
 * sempre calculado na leitura (`paraShapeFrontend`) comparando
 * `vencimento < hoje` para tarefas `"Pendente"`.
 *
 * Decisão para `periodicidade: "anual"`: o schema de `modelos_recorrencia`
 * não tem uma coluna dedicada para o "mês de referência" da recorrência
 * anual — só `dia_referencia` (dia do mês). Em vez de migrar o schema já em
 * produção outra vez nesta task, usamos o **mês em que o modelo foi criado**
 * (`criado_em`) como o mês de referência anual: `gerarTarefasDoMes` só gera
 * uma tarefa "anual" quando o mês pedido (`mes`) tem o mesmo número de mês
 * que `criado_em` (independente do ano). Limitação aceita para v1: se o
 * usuário quiser uma recorrência anual num mês diferente do mês de criação,
 * precisa recriar o modelo naquele mês (ou, no futuro, adicionar uma coluna
 * `mes_referencia`).
 */
import type { createServerClient } from "@supabase/ssr";
import { garantirFeriadosDoAno, type Feriado } from "./feriados.ts";

type SupabaseClient = ReturnType<typeof createServerClient>;

export type StatusTarefa = "Pendente" | "Concluída";

export type TarefaRow = {
  id: string;
  escritorio_id: string;
  modelo_id: string | null;
  empresa_id: string;
  titulo: string;
  tipo: string;
  responsavel_id: string | null;
  vencimento: string;
  status: string;
  concluido_em: string | null;
  empresa: { fantasia: string } | null;
  responsavel: { nome: string } | null;
};

export const TAREFA_SELECT = "*, empresa:empresas(fantasia), responsavel:perfis(nome)";

type ModeloRecorrenciaParaGeracao = {
  id: string;
  empresa_id: string;
  titulo: string;
  tipo: string;
  periodicidade: string;
  dia_referencia: number;
  responsavel_id: string | null;
  criado_em: string;
};

/** Último dia do mês (1-12) do `ano` pedido, em UTC. */
export function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function formatarData(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Retorna o primeiro dia útil-do-mês do formato "YYYY-MM-DD" e o último,
 * para filtrar `tarefas.vencimento` num intervalo fechado do mês pedido.
 */
export function intervaloDoMes(mes: string): { inicio: string; fim: string } {
  const [anoStr, mesStr] = mes.split("-");
  const ano = Number(anoStr);
  const mesNum = Number(mesStr);
  return {
    inicio: `${mes}-01`,
    fim: formatarData(ano, mesNum, ultimoDiaDoMes(ano, mesNum)),
  };
}

/**
 * `Intl.DateTimeFormat` fixado em "America/Sao_Paulo", reutilizado por
 * `hojeBrasil`/`mesAtual` — formatar em `"en-CA"` dá direto o formato
 * "YYYY-MM-DD" (ISO-like), sem precisar remontar a string a partir de
 * `{ year, month, day }`.
 */
const FORMATADOR_DATA_BRASIL = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Data de "hoje" no formato "YYYY-MM-DD", no fuso de São Paulo — não UTC.
 *
 * Por quê: o servidor roda em UTC (típico de Workers/edge), e
 * `new Date().toISOString()` reflete o relógio UTC. São Paulo está
 * atualmente UTC-3 (sem horário de verão desde 2019), então das 21h às
 * 23h59 (horário de Brasília) o UTC já virou o dia seguinte — usar
 * `toISOString()` faria tarefas "Pendente" vencendo hoje (no Brasil) virarem
 * "Atrasada" até 3h mais cedo do que deveriam, e o mês padrão de `?mes=`
 * viraria cedo demais nas últimas horas do último dia do mês. `Intl` com
 * `timeZone: "America/Sao_Paulo"` corrige isso sem depender de nenhuma
 * lib de datas externa.
 */
export function hojeBrasil(): string {
  return FORMATADOR_DATA_BRASIL.format(new Date());
}

/** Mês atual no formato "YYYY-MM", no fuso de São Paulo (ver `hojeBrasil`), usado como padrão de `?mes=`. */
export function mesAtual(): string {
  return hojeBrasil().slice(0, 7);
}

/**
 * Função pura (sem I/O) que calcula as datas de vencimento de um modelo de
 * recorrência dentro de um mês pedido. Isolada de `gerarTarefasDoMes` para
 * ser testável sem banco — ver `tests/tarefas.test.mjs`.
 *
 * - `"mensal"`: um vencimento em `diaReferencia`, "clampado" ao último dia
 *   do mês se este não tiver `diaReferencia` dias (ex. 31 em abril → 30).
 * - `"anual"`: só gera se o mês de `mes` bater com o mês de `criadoEm` (ver
 *   decisão documentada no topo do arquivo); quando bate, mesma regra de
 *   clamping do mensal.
 * - `"semanal"`: uma data por ocorrência do dia da semana `diaReferencia`
 *   (1=segunda ... 7=domingo) dentro do mês.
 * - qualquer outro valor de `periodicidade`: retorna `[]` (defensivo — não
 *   deveria ocorrer, já que a validação de POST/PATCH de modelos restringe
 *   os valores possíveis).
 */
export function calcularVencimentosDoModelo(params: {
  periodicidade: string;
  diaReferencia: number;
  mes: string; // "YYYY-MM"
  criadoEm: string; // ISO date ou timestamp
}): string[] {
  const [anoStr, mesStr] = params.mes.split("-");
  const ano = Number(anoStr);
  const mesNum = Number(mesStr);
  const ultimoDia = ultimoDiaDoMes(ano, mesNum);

  if (params.periodicidade === "mensal") {
    const dia = Math.min(params.diaReferencia, ultimoDia);
    return [formatarData(ano, mesNum, dia)];
  }

  if (params.periodicidade === "anual") {
    const criado = new Date(params.criadoEm);
    const mesReferencia = criado.getUTCMonth() + 1;
    if (mesReferencia !== mesNum) {
      return [];
    }
    const dia = Math.min(params.diaReferencia, ultimoDia);
    return [formatarData(ano, mesNum, dia)];
  }

  if (params.periodicidade === "semanal") {
    const datas: string[] = [];
    for (let dia = 1; dia <= ultimoDia; dia++) {
      const data = new Date(Date.UTC(ano, mesNum - 1, dia));
      const diaSemanaJS = data.getUTCDay(); // 0=domingo...6=sábado
      const diaSemana = diaSemanaJS === 0 ? 7 : diaSemanaJS; // 1=segunda...7=domingo
      if (diaSemana === params.diaReferencia) {
        datas.push(formatarData(ano, mesNum, dia));
      }
    }
    return datas;
  }

  return [];
}

/**
 * Garante que as tarefas do mês pedido existam para todos os modelos ativos
 * do escritório: busca os modelos, calcula os vencimentos do mês
 * (`calcularVencimentosDoModelo`) e insere as tarefas que ainda não existem.
 *
 * Dedupe por `modelo_id` + `vencimento` em duas camadas:
 * 1. Um `select` de "fast path" antes de cada insert — evita bater no banco
 *    com um insert desnecessário na maioria das chamadas (o caso comum é o
 *    mês já ter sido gerado antes).
 * 2. O insert em si é um `upsert` com `{ onConflict: "modelo_id,vencimento",
 *    ignoreDuplicates: true }`, mesmo padrão de `garantirFeriadosDoAno` em
 *    `lib/feriados.ts`: o `select` acima sozinho não é suficiente contra uma
 *    corrida real (duas chamadas concorrentes de `GET /api/tarefas` — duas
 *    abas abertas, um duplo clique) porque ambas podem passar pelo `select`
 *    antes de qualquer uma inserir. O `upsert` com `ignoreDuplicates` faz a
 *    segunda inserção da corrida virar um no-op silencioso em vez de criar
 *    uma linha duplicada, **desde que exista o índice único**
 *    `tarefas_modelo_vencimento_unique` (`supabase/migrations/manual/
 *    0007_tarefas_unique_index_sem_predicado.sql` — sem `where`, porque
 *    tarefas avulsas com `modelo_id: null` já não são restringidas por um
 *    índice único comum, já que o Postgres trata NULLs como distintos).
 *
 *    Essa migração substitui a tentativa anterior (`0006_tarefas_unique_
 *    modelo_vencimento.sql`), que criava esse mesmo índice como **parcial**
 *    (`where modelo_id is not null`). Um índice parcial nunca pode ser
 *    inferido por um `ON CONFLICT (coluna, coluna)` que só lista colunas —
 *    o Postgres exige que o predicado seja repetido no próprio `ON CONFLICT`,
 *    algo que a API do supabase-js não permite expressar. Por isso 0006
 *    sozinha nunca teria feito o `upsert` funcionar (sempre cairia no
 *    fallback abaixo, permanentemente, não só até ser aplicada).
 *
 *    **Importante, verificado ao vivo**: diferente do que se poderia supor,
 *    um `upsert` com `onConflict` apontando para uma constraint que ainda
 *    não existe **não** degrada silenciosamente para um insert comum — o
 *    Postgres recusa com o erro `42P10` ("no unique or exclusion constraint
 *    matching the ON CONFLICT specification"), porque `ON CONFLICT` precisa
 *    que o índice já exista para ter contra o que casar. Isso foi
 *    reproduzido ao vivo nesta task (antes de a migração 0007 ser aplicada)
 *    e quebraria a geração de tarefas por completo até a migração ser
 *    aplicada manualmente. Por isso, o catch abaixo detecta especificamente
 *    `42P10` e cai para um `insert` comum (mesmo comportamento de antes
 *    desta correção — protegido só pelo `select` de fast path, sem proteção
 *    real contra corrida) até a migração 0007 ser aplicada; depois disso, o
 *    `upsert` com `onConflict` passa a funcionar e a proteção fica completa.
 *
 * Erros são isolados por modelo/vencimento: uma falha ao gerar a tarefa de
 * um modelo (ou checar duplicidade) é logada e não impede a geração dos
 * demais modelos, mesma filosofia de degradação de `lib/feriados.ts`.
 */
export async function gerarTarefasDoMes(supabase: SupabaseClient, escritorioId: string, mes: string): Promise<void> {
  const { data: modelos, error: modelosError } = await supabase
    .from("modelos_recorrencia")
    .select("id, empresa_id, titulo, tipo, periodicidade, dia_referencia, responsavel_id, criado_em")
    .eq("escritorio_id", escritorioId)
    .eq("ativo", true);

  if (modelosError || !modelos) {
    console.error(`Erro ao buscar modelos de recorrência ativos do escritório ${escritorioId}:`, modelosError);
    return;
  }

  for (const modelo of modelos as unknown as ModeloRecorrenciaParaGeracao[]) {
    const vencimentos = calcularVencimentosDoModelo({
      periodicidade: modelo.periodicidade,
      diaReferencia: modelo.dia_referencia,
      mes,
      criadoEm: modelo.criado_em,
    });

    for (const vencimento of vencimentos) {
      const { data: existente, error: existenteError } = await supabase
        .from("tarefas")
        .select("id")
        .eq("modelo_id", modelo.id)
        .eq("vencimento", vencimento)
        .maybeSingle();

      if (existenteError) {
        console.error(`Erro ao checar tarefa existente do modelo ${modelo.id} em ${vencimento}:`, existenteError);
        continue;
      }

      if (existente) {
        continue;
      }

      const novaTarefa = {
        escritorio_id: escritorioId,
        modelo_id: modelo.id,
        empresa_id: modelo.empresa_id,
        titulo: modelo.titulo,
        tipo: modelo.tipo,
        responsavel_id: modelo.responsavel_id,
        vencimento,
        status: "Pendente",
      };

      const { error: upsertError } = await supabase
        .from("tarefas")
        .upsert(novaTarefa, { onConflict: "modelo_id,vencimento", ignoreDuplicates: true });

      if (upsertError?.code === "42P10") {
        // Migração 0007 (índice único sem predicado) ainda não foi aplicada
        // no banco — ON CONFLICT não tem constraint pra casar. Cai para um
        // insert comum (mesma proteção de antes desta correção, só o select
        // de fast path acima) até a migração ser aplicada manualmente.
        const { error: insertError } = await supabase.from("tarefas").insert(novaTarefa);
        if (insertError) {
          console.error(`Erro ao gerar tarefa do modelo ${modelo.id} para ${vencimento} (fallback sem upsert):`, insertError);
        }
      } else if (upsertError) {
        console.error(`Erro ao gerar tarefa do modelo ${modelo.id} para ${vencimento}:`, upsertError);
      }
    }
  }
}

/**
 * Traduz uma `TarefaRow` (com embeds) para o shape do frontend, calculando
 * `status` efetivo ("Atrasada" na leitura, nunca persistido) e cruzando
 * `vencimento` com a lista de feriados do ano já garantida por
 * `garantirFeriadosDoAno`.
 */
export function paraShapeFrontend(row: TarefaRow, feriados: Feriado[], hojeISO: string) {
  const statusEfetivo = row.status === "Pendente" && row.vencimento < hojeISO ? "Atrasada" : row.status;
  const feriado = feriados.find((f) => f.data === row.vencimento) ?? null;

  return {
    id: row.id,
    modeloId: row.modelo_id,
    empresaId: row.empresa_id,
    empresa: row.empresa?.fantasia ?? "",
    titulo: row.titulo,
    tipo: row.tipo,
    responsavelId: row.responsavel_id,
    responsavel: row.responsavel?.nome ?? "",
    vencimento: row.vencimento,
    status: statusEfetivo,
    concluidoEm: row.concluido_em,
    coincideComFeriado: feriado ? { nome: feriado.nome } : null,
  };
}

/**
 * Rebusca uma tarefa pelo id no shape completo (com embeds), usado por
 * POST/PATCH após a escrita para devolver a resposta no mesmo formato do
 * GET. Retorna `null` se a linha não for encontrada (RLS ou id inexistente).
 */
export async function buscarTarefaCompletaPorId(supabase: SupabaseClient, id: string): Promise<TarefaRow | null> {
  const { data, error } = await supabase.from("tarefas").select(TAREFA_SELECT).eq("id", id).maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as unknown as TarefaRow;
}

/**
 * Monta o shape de resposta de uma tarefa recém-criada/atualizada: busca a
 * linha completa e os feriados do ano do seu vencimento, e aplica
 * `paraShapeFrontend`. Usado por POST e PATCH para não duplicar essa
 * sequência em cada rota.
 */
export async function montarRespostaTarefa(supabase: SupabaseClient, id: string) {
  const tarefa = await buscarTarefaCompletaPorId(supabase, id);
  if (!tarefa) {
    return null;
  }

  const ano = Number(tarefa.vencimento.slice(0, 4));
  const feriados = await garantirFeriadosDoAno(supabase, ano);

  return paraShapeFrontend(tarefa, feriados, hojeBrasil());
}
