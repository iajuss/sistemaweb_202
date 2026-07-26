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
