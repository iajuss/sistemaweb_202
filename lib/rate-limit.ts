/**
 * Rate limit das rotas de autenticação (login, cadastro, reset e reenvio de
 * senha) — o controle que impede alguém de varrer milhares de combinações de
 * e-mail e senha, ou de usar o app como canhão de e-mails.
 *
 * Por que no banco e não em memória: o app roda em Cloudflare Workers, onde
 * cada requisição pode cair num isolate diferente (e efêmero). Um `Map` em
 * memória contaria "1ª tentativa" quase sempre — ou seja, limite nenhum. O
 * contador precisa ser compartilhado, e o Postgres do Supabase já está aí,
 * sem dependência nova.
 *
 * A conta em si vive na função `public.consumir_rate_limit` (migração
 * 0019_rate_limit_auth.sql), que incrementa e decide numa única instrução —
 * ler e depois gravar daqui deixaria uma janela de corrida em que N
 * requisições simultâneas passam todas pelo limite.
 */

type SupabaseComRpc = {
  rpc: (nome: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Rotas protegidas e seus limites: [tentativas, janela em segundos]. */
export const LIMITES_AUTH = {
  // Login por IP é folgado o bastante para uma família/escritório atrás do
  // mesmo NAT, e apertado o bastante para inviabilizar força bruta.
  loginIp: [20, 300],
  // Por e-mail é o limite que realmente barra credential stuffing: mesmo
  // distribuindo o ataque por milhares de IPs, cada conta alvo só aceita
  // 10 tentativas a cada 5 minutos.
  loginEmail: [10, 300],
  signupIp: [5, 3600],
  emailIp: [5, 3600],
  emailDestino: [3, 3600],
  // Convite dispara e-mail e revela se a conta já existe na plataforma —
  // volume por responsável, para inviabilizar varredura de e-mails.
  conviteUsuario: [20, 3600],
} as const satisfies Record<string, readonly [number, number]>;

/**
 * IP de origem da requisição. `cf-connecting-ip` é escrito pela própria
 * Cloudflare e sobrescreve qualquer valor que o cliente tenha mandado — é o
 * único header confiável aqui. No fallback `x-forwarded-for`, o primeiro
 * salto é o cliente e os demais são proxies; pegar o último deixaria o
 * atacante escolher a própria chave de rate limit e anular o controle.
 */
export function ipDoRequest(request: Request): string {
  const cloudflare = request.headers.get("cf-connecting-ip");
  if (cloudflare) return cloudflare.trim();

  const encaminhado = request.headers.get("x-forwarded-for");
  if (encaminhado) {
    const primeiroSalto = encaminhado.split(",")[0]?.trim();
    if (primeiroSalto) return primeiroSalto;
  }

  // Sem header nenhum (dev local, teste): todo mundo cai no mesmo balde. É
  // conservador de propósito — errar para o lado de limitar demais.
  return "desconhecido";
}

/**
 * Chave do balde de contagem. O identificador é normalizado (minúsculas, sem
 * espaços) para que `Ana@x.com` e `ana@x.com ` não virem dois baldes e dobrem
 * o limite efetivo por conta.
 */
export function chaveRateLimit(rota: string, identificador: string): string {
  return `${rota}:${identificador.trim().toLowerCase()}`;
}

/**
 * Consome uma unidade do balde. Retorna `true` quando a requisição deve ser
 * BLOQUEADA (limite estourado).
 *
 * Falha fechado: se o RPC der erro (migração não aplicada, banco fora do ar),
 * bloqueia. Falhar aberto transformaria "derrubar a função de rate limit" no
 * próprio bypass do rate limit.
 */
export async function consumirRateLimit(
  supabase: SupabaseComRpc,
  rota: string,
  identificador: string,
  limite: number,
  janelaSegundos: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("consumir_rate_limit", {
    p_chave: chaveRateLimit(rota, identificador),
    p_limite: limite,
    p_janela_segundos: janelaSegundos,
  });

  if (error) {
    console.error("Rate limit indisponível — bloqueando por precaução:", error);
    return true;
  }

  return data !== true;
}

/** Resposta padrão de limite estourado, com Retry-After para clientes legítimos. */
export function respostaLimiteExcedido(janelaSegundos: number): Response {
  return Response.json(
    { error: "Muitas tentativas. Aguarde alguns minutos e tente de novo." },
    { status: 429, headers: { "Retry-After": String(janelaSegundos) } },
  );
}
