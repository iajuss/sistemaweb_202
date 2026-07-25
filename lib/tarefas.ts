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

/** Mês atual no formato "YYYY-MM" (UTC), usado como padrão de `?mes=`. */
export function mesAtual(): string {
  return new Date().toISOString().slice(0, 7);
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
 * (`calcularVencimentosDoModelo`) e insere as tarefas que ainda não existem
 * (dedupe por `modelo_id` + `vencimento`, checado antes de cada insert —
 * evita duplicar em chamadas repetidas de `GET /api/tarefas`).
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

      const { error: insertError } = await supabase.from("tarefas").insert({
        escritorio_id: escritorioId,
        modelo_id: modelo.id,
        empresa_id: modelo.empresa_id,
        titulo: modelo.titulo,
        tipo: modelo.tipo,
        responsavel_id: modelo.responsavel_id,
        vencimento,
        status: "Pendente",
      });

      if (insertError) {
        console.error(`Erro ao gerar tarefa do modelo ${modelo.id} para ${vencimento}:`, insertError);
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
  const hoje = new Date().toISOString().slice(0, 10);

  return paraShapeFrontend(tarefa, feriados, hoje);
}
