/**
 * Cache de consultas de CNPJ (BrasilAPI, com reserva na ReceitaWS via
 * `lib/cnpj-provedores.ts`). `cnpj_cache` guarda a última resposta
 * normalizada por CNPJ; uma consulta só bate nos provedores de novo se o
 * cache não existir ou tiver passado da validade (`TTL_HORAS`) — evita
 * reconsultar a mesma empresa a cada "Revalidar carteira", que é a fonte
 * mais comum de rate limit neste app.
 *
 * Mesmo princípio de degradação de `lib/feriados.ts`: falha ao ler/gravar o
 * cache não deve impedir a consulta em si, só faz o código seguir sem cache
 * (mais lento/exposto a rate limit, mas nunca quebrado).
 */
import type { createServerClient } from "@supabase/ssr";
import { BrasilAPIError, type EmpresaBrasilAPI } from "./brasilapi";
import { consultarCNPJComFallback } from "./cnpj-provedores";

type SupabaseClient = ReturnType<typeof createServerClient>;

const TTL_HORAS = 24;

type CnpjCacheRow = {
  cnpj: string;
  dados: EmpresaBrasilAPI;
  consultado_em: string;
};

function estaDentroDoTTL(consultadoEm: string): boolean {
  const limiteMs = TTL_HORAS * 60 * 60 * 1000;
  return Date.now() - new Date(consultadoEm).getTime() < limiteMs;
}

/**
 * Consulta um CNPJ usando `cnpj_cache` como camada de cache:
 * - Cache válido (dentro do TTL) → retorna direto, sem consultar nenhum provedor.
 * - Cache ausente ou expirado → consulta BrasilAPI (com reserva na
 *   ReceitaWS se ela falhar, ver `consultarCNPJComFallback`) e grava
 *   (`upsert`) o resultado no cache antes de retornar.
 * - Os dois provedores falharam com 429 e existe cache expirado (mas
 *   presente) para este CNPJ → serve o cache mesmo vencido, em vez de
 *   falhar: dado desatualizado é melhor que nenhum dado durante uma janela
 *   de rate limit, e a próxima consulta dentro do TTL tenta de novo.
 *   Outros tipos de erro (404, 502) continuam propagando normalmente.
 */
export async function consultarCNPJComCache(supabase: SupabaseClient, cnpj: string): Promise<EmpresaBrasilAPI> {
  const cnpjSomenteDigitos = cnpj.replace(/\D/g, "");

  const { data: cacheado, error: erroSelect } = await supabase
    .from("cnpj_cache")
    .select("cnpj, dados, consultado_em")
    .eq("cnpj", cnpjSomenteDigitos)
    .maybeSingle();

  if (erroSelect) {
    console.error(`Erro ao consultar cnpj_cache para ${cnpjSomenteDigitos}:`, erroSelect);
  }

  const linhaCache = cacheado as CnpjCacheRow | null;

  if (linhaCache && estaDentroDoTTL(linhaCache.consultado_em)) {
    return linhaCache.dados;
  }

  try {
    const dados = await consultarCNPJComFallback(cnpjSomenteDigitos);

    const { error: erroUpsert } = await supabase
      .from("cnpj_cache")
      .upsert({ cnpj: cnpjSomenteDigitos, dados, consultado_em: new Date().toISOString() }, { onConflict: "cnpj" });

    if (erroUpsert) {
      console.error(`Erro ao gravar cnpj_cache para ${cnpjSomenteDigitos}:`, erroUpsert);
    }

    return dados;
  } catch (err) {
    if (err instanceof BrasilAPIError && err.status === 429 && linhaCache) {
      console.error(`BrasilAPI em rate limit para ${cnpjSomenteDigitos} — servindo cache vencido de ${linhaCache.consultado_em}.`);
      return linhaCache.dados;
    }

    throw err;
  }
}

export type ResultadoCnpjEmLote = { ok: true; dados: EmpresaBrasilAPI } | { ok: false; erro: unknown };

// "Revalidar carteira" chama isto para N empresas de uma vez — nunca de uma
// em uma. Um teto baixo já evita estourar o rate limit de rajada curta dos
// provedores (ver `lib/brasilapi.ts`), sem serializar tudo como antes.
const CONCORRENCIA_MAXIMA = 5;

/**
 * Versão em lote de `consultarCNPJComCache`: um único SELECT cobre todos os
 * CNPJs (em vez de um round-trip ao banco por empresa), e só quem não tem
 * cache válido reconsulta os provedores — em paralelo, respeitando
 * `CONCORRENCIA_MAXIMA`. Antes desta função, "Revalidar carteira" rodava um
 * `await` por empresa dentro de um `for`, então N empresas custavam N idas e
 * vindas sequenciais ao banco/API — a fonte da lentidão relatada.
 *
 * Um único `upsert` no fim grava todos os resultados novos de uma vez.
 * `consultarCNPJComCache` continua existindo para o caso de uma única
 * empresa (ex.: aplicar a sugestão de uma divergência isolada).
 */
export async function consultarVariosCNPJsComCache(
  supabase: SupabaseClient,
  cnpjs: string[],
): Promise<Map<string, ResultadoCnpjEmLote>> {
  const cnpjsUnicos = Array.from(new Set(cnpjs.map((cnpj) => cnpj.replace(/\D/g, ""))));
  const resultado = new Map<string, ResultadoCnpjEmLote>();

  if (cnpjsUnicos.length === 0) {
    return resultado;
  }

  const { data: cacheadas, error: erroSelect } = await supabase
    .from("cnpj_cache")
    .select("cnpj, dados, consultado_em")
    .in("cnpj", cnpjsUnicos);

  if (erroSelect) {
    console.error("Erro ao consultar cnpj_cache em lote:", erroSelect);
  }

  const cachePorCnpj = new Map<string, CnpjCacheRow>();
  for (const row of (cacheadas ?? []) as CnpjCacheRow[]) {
    cachePorCnpj.set(row.cnpj, row);
  }

  const paraReconsultar: string[] = [];
  for (const cnpj of cnpjsUnicos) {
    const linhaCache = cachePorCnpj.get(cnpj);
    if (linhaCache && estaDentroDoTTL(linhaCache.consultado_em)) {
      resultado.set(cnpj, { ok: true, dados: linhaCache.dados });
    } else {
      paraReconsultar.push(cnpj);
    }
  }

  const paraUpsert: { cnpj: string; dados: EmpresaBrasilAPI; consultado_em: string }[] = [];

  for (let i = 0; i < paraReconsultar.length; i += CONCORRENCIA_MAXIMA) {
    const lote = paraReconsultar.slice(i, i + CONCORRENCIA_MAXIMA);
    await Promise.all(
      lote.map(async (cnpj) => {
        try {
          const dados = await consultarCNPJComFallback(cnpj);
          resultado.set(cnpj, { ok: true, dados });
          paraUpsert.push({ cnpj, dados, consultado_em: new Date().toISOString() });
        } catch (err) {
          const linhaCache = cachePorCnpj.get(cnpj);
          if (err instanceof BrasilAPIError && err.status === 429 && linhaCache) {
            console.error(`BrasilAPI em rate limit para ${cnpj} — servindo cache vencido de ${linhaCache.consultado_em}.`);
            resultado.set(cnpj, { ok: true, dados: linhaCache.dados });
          } else {
            resultado.set(cnpj, { ok: false, erro: err });
          }
        }
      }),
    );
  }

  if (paraUpsert.length > 0) {
    const { error: erroUpsert } = await supabase
      .from("cnpj_cache")
      .upsert(paraUpsert, { onConflict: "cnpj" });

    if (erroUpsert) {
      console.error("Erro ao gravar cnpj_cache em lote:", erroUpsert);
    }
  }

  return resultado;
}
