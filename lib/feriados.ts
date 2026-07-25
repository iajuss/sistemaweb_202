/**
 * Cache sob demanda de feriados nacionais brasileiros. `feriados_cache` é
 * uma tabela global (não por escritório), alimentada lazily: a primeira
 * chamada para um `ano` ainda não cacheado busca a lista completa na
 * BrasilAPI e faz upsert; chamadas seguintes leem só do cache.
 *
 * Falha de rede/parse ao consultar a BrasilAPI não deve derrubar quem chama
 * esta função (ex.: uma futura rotina de geração de tarefas recorrentes) —
 * degrada para `[]` e loga o erro; a próxima chamada tenta popular o cache
 * de novo.
 */
import type { createServerClient } from "@supabase/ssr";

type SupabaseClient = ReturnType<typeof createServerClient>;

export type Feriado = { data: string; nome: string };

type FeriadoBrasilAPI = {
  date: string;
  name: string;
  type: string;
};

const BRASILAPI_FERIADOS_URL = "https://brasilapi.com.br/api/feriados/v1";

/**
 * Busca a lista de feriados de um ano na BrasilAPI. Qualquer falha (rede,
 * status não-ok, JSON inválido) é logada e resolve para `[]` em vez de
 * lançar — quem chama (`garantirFeriadosDoAno`) trata isso como "cache
 * segue vazio até a próxima tentativa", nunca como exceção não tratada.
 */
async function buscarFeriadosNaBrasilAPI(ano: number): Promise<Feriado[]> {
  let response: Response;
  try {
    response = await fetch(`${BRASILAPI_FERIADOS_URL}/${ano}`);
  } catch (err) {
    console.error(`Erro de rede ao buscar feriados de ${ano} na BrasilAPI:`, err);
    return [];
  }

  if (!response.ok) {
    console.error(`BrasilAPI respondeu status ${response.status} ao buscar feriados de ${ano}`);
    return [];
  }

  let corpo: FeriadoBrasilAPI[];
  try {
    corpo = (await response.json()) as FeriadoBrasilAPI[];
  } catch (err) {
    console.error(`Resposta inválida (JSON) da BrasilAPI ao buscar feriados de ${ano}:`, err);
    return [];
  }

  return corpo.map((feriado) => ({ data: feriado.date, nome: feriado.name }));
}

/**
 * Garante que `feriados_cache` tenha as linhas do `ano` pedido.
 *
 * - Se já existir ao menos uma linha para o `ano`, retorna direto do cache
 *   (sem bater na BrasilAPI de novo).
 * - Caso contrário, busca na BrasilAPI e faz `upsert` (não `insert`) das
 *   linhas — `upsert` tolera duas requisições simultâneas tentando popular
 *   o mesmo ano ao mesmo tempo, já que `data` é chave primária e um
 *   `insert` simples colidiria com erro de duplicidade nessa corrida.
 *   Usa `ignoreDuplicates: true` (`ON CONFLICT DO NOTHING`) em vez do
 *   merge padrão (`ON CONFLICT DO UPDATE`): a política de RLS de
 *   `feriados_cache` só concede `insert`/`select` a usuários autenticados,
 *   sem política de `update` (ver `0001_rls_and_profile_trigger.sql`), então
 *   um upsert que tentasse fazer `DO UPDATE` seria barrado pelo RLS na
 *   corrida; `DO NOTHING` não exige a política de update.
 * - Se a busca na BrasilAPI falhar, retorna `[]` (loga o erro em
 *   `buscarFeriadosNaBrasilAPI`) sem lançar exceção.
 */
export async function garantirFeriadosDoAno(supabase: SupabaseClient, ano: number): Promise<Feriado[]> {
  const { data: existentes, error: erroSelect } = await supabase
    .from("feriados_cache")
    .select("data, nome")
    .eq("ano", ano);

  if (erroSelect) {
    console.error(`Erro ao consultar feriados_cache para o ano ${ano}:`, erroSelect);
    return [];
  }

  if (existentes && existentes.length > 0) {
    return existentes as Feriado[];
  }

  const feriadosBuscados = await buscarFeriadosNaBrasilAPI(ano);

  if (feriadosBuscados.length === 0) {
    return [];
  }

  const { error: erroUpsert } = await supabase.from("feriados_cache").upsert(
    feriadosBuscados.map((feriado) => ({ data: feriado.data, nome: feriado.nome, ano })),
    { onConflict: "data", ignoreDuplicates: true },
  );

  if (erroUpsert) {
    console.error(`Erro ao gravar feriados de ${ano} em feriados_cache:`, erroUpsert);
  }

  return feriadosBuscados;
}
