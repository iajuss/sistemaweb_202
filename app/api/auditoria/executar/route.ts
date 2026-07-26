import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { EMPRESA_SELECT, type EmpresaRow } from "@/lib/empresas";
import {
  avaliarRegrasInternas,
  avaliarRegrasExternas,
  avaliarDadosAusentes,
  type EmpresaParaAuditoria,
  type DivergenciaDetectada,
} from "@/lib/auditoria";
import { BrasilAPIError } from "@/lib/brasilapi";
import { consultarCNPJComCache } from "@/lib/cnpj-cache";

type ExecutarAuditoriaPayload = {
  incluirRegrasExternas?: boolean;
};

type DivergenciaRow = {
  id: string;
  empresa_id: string;
  empresa_relacionada_id: string | null;
  tipo: string;
  atual: string;
  sugerido: string | null;
  status: string;
  detectado_em: string;
};

type DuplicidadeRow = {
  empresa_id: string;
  razao_social: string;
  empresa_similar_id: string;
  razao_social_similar: string;
  similaridade: number;
};

function chaveDivergencia(empresaId: string, tipo: string): string {
  return `${empresaId}::${tipo}`;
}

// Idempotência: para 5 dos 6 tipos, uma empresa só pode ter uma divergência
// "corrente" por vez, então a chave (empresa, tipo) + comparação pela linha
// mais recente é suficiente. "Duplicidade" é a exceção: uma empresa pode ter
// várias divergências de Duplicidade simultâneas e independentes (uma por
// empresa parecida — ex.: C parecida com A e com B ao mesmo tempo), então
// para esse tipo a chave de idempotência precisa identificar o OUTRO lado do
// par de forma inequívoca — `identificadorPar` deve ser o id da outra
// empresa (`empresaRelacionadaId`), nunca o texto `atual` ("Possível
// duplicidade com <razão social>"): quando duas ou mais empresas parecidas
// têm a MESMA razão social (ex.: várias filiais/cadastros do mesmo banco),
// esse texto fica idêntico para pares diferentes e colidiria na mesma
// chave. Quando a outra empresa do par JÁ FOI EXCLUÍDA, `empresaRelacionadaId`
// é null (FK "on delete set null") — nesse caso o chamador deve passar o
// `id` da própria linha de divergência como identificador (nunca `atual`):
// se duas linhas órfãs distintas (parceiros diferentes, ambos já excluídos)
// tiverem o mesmo texto `atual`, usar `atual` como fallback as colidiria de
// novo na mesma chave, e uma das duas nunca mais seria avaliada para
// resolução automática — ficando "Pendente" para sempre. Os outros 5 tipos
// continuam com a chave antiga (sem essa distinção) — não mexer nisso.
function chaveIdempotencia(empresaId: string, tipo: string, identificadorPar: string): string {
  return tipo === "Duplicidade"
    ? `${chaveDivergencia(empresaId, tipo)}::${identificadorPar}`
    : chaveDivergencia(empresaId, tipo);
}

function paraEmpresaParaAuditoria(row: EmpresaRow): EmpresaParaAuditoria {
  return {
    id: row.id,
    cnpj: row.cnpj,
    razaoSocial: row.razao_social,
    endereco: row.endereco,
    cnaeCodigo: row.cnae_codigo,
    porte: row.porte,
    situacaoCadastral: row.situacao_cadastral,
  };
}

// POST /api/auditoria/executar — roda o motor de regras (interno sempre,
// externo/BrasilAPI só quando `incluirRegrasExternas: true`) para todas as
// empresas do escritório da sessão e sincroniza a tabela `divergencias` de
// forma idempotente (ver seção "Idempotência" do plano):
// - par (empresa, tipo) novo → insere Pendente.
// - par já existe com o mesmo `atual` → não mexe (preserva decisão do usuário).
// - par já existe mas `atual` mudou → insere uma nova linha Pendente (histórico preservado).
// - par tinha divergência Pendente, não foi detectado nesta execução E a
//   regra correspondente foi de fato avaliada para aquela empresa nesta
//   execução → resolve automaticamente. Se a regra não rodou (falha isolada
//   de BrasilAPI para a empresa, falha do RPC de duplicidade, ou regras
//   externas nem tentadas nesta chamada) a divergência Pendente é preservada
//   intacta — "não detectado" não pode ser confundido com "não avaliado"
//   (ver `chavesAvaliadasNestaExecucao` abaixo).
export async function POST(request: Request) {
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  let payload: ExecutarAuditoriaPayload = {};
  try {
    const corpo = await request.text();
    payload = corpo.trim() ? (JSON.parse(corpo) as ExecutarAuditoriaPayload) : {};
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  const incluirRegrasExternas = payload.incluirRegrasExternas === true;

  const { data: perfil, error: perfilError } = await supabase
    .from("perfis")
    .select("escritorio_id")
    .eq("id", user.id)
    .single();

  if (perfilError || !perfil) {
    return applySetCookies(
      Response.json({ error: "Não foi possível identificar o escritório do usuário." }, { status: 500 }),
    );
  }

  const escritorioId = (perfil as { escritorio_id: string }).escritorio_id;

  const { data: empresasData, error: empresasError } = await supabase.from("empresas").select(EMPRESA_SELECT);

  if (empresasError) {
    return applySetCookies(
      Response.json({ error: "Não foi possível carregar as empresas para auditoria." }, { status: 500 }),
    );
  }

  const empresas = (empresasData as unknown as EmpresaRow[]).map(paraEmpresaParaAuditoria);

  const detectadas: DivergenciaDetectada[] = [];

  // Chaves (empresa, tipo) efetivamente AVALIADAS nesta execução — distinto
  // de "detectadas" (abaixo). Usado só para decidir quais divergências
  // Pendentes podem ser resolvidas automaticamente: uma chave só entra aqui
  // quando a regra correspondente de fato rodou (com sucesso) para aquela
  // empresa nesta chamada, nunca só porque a categoria de regra "existe" ou
  // foi tentada em geral. Sem isso, uma falha de rede isolada (BrasilAPI) ou
  // uma execução interna-only (sem `incluirRegrasExternas`) faria o loop de
  // resolução (mais abaixo) interpretar "não veio na lista de detectadas"
  // como "o problema sumiu", quando na verdade é "nunca chegamos a checar".
  const chavesAvaliadasNestaExecucao = new Set<string>();

  for (const empresa of empresas) {
    detectadas.push(...avaliarRegrasInternas(empresa));
    // Regras internas (CNPJ inválido, Situação irregular) rodam sempre,
    // incondicionalmente, para toda empresa — sempre avaliadas.
    chavesAvaliadasNestaExecucao.add(chaveDivergencia(empresa.id, "CNPJ inválido"));
    chavesAvaliadasNestaExecucao.add(chaveDivergencia(empresa.id, "Situação irregular"));

    // "Dados ausentes" só entra aqui (sem sugestão) quando esta execução NÃO
    // vai reconsultar a BrasilAPI — se vai (`incluirRegrasExternas`), ela é
    // avaliada de novo mais abaixo, desta vez com os dados cacheados/
    // reconsultados em mãos, pra poder sugerir o valor que falta (CNAE,
    // endereço, porte). Avaliar as duas vezes na mesma execução geraria duas
    // detecções conflitantes pra mesma empresa/tipo neste mesmo lote.
    if (!incluirRegrasExternas) {
      const dadosAusentes = avaliarDadosAusentes(empresa);
      if (dadosAusentes) detectadas.push(dadosAusentes);
      chavesAvaliadasNestaExecucao.add(chaveDivergencia(empresa.id, "Dados ausentes"));
    }
  }

  // Duplicidade — roda 1x para o escritório inteiro. Isolada num try/catch:
  // se a migração 0003 (Task 1) ainda não tiver sido aplicada no banco, o
  // RPC não existe e falharia — isso não pode abortar as regras internas
  // já coletadas acima, nem as regras externas que rodam a seguir.
  try {
    const { data: paresDuplicados, error: duplicidadeError } = await supabase.rpc(
      "detectar_duplicidade_razao_social",
      { p_escritorio_id: escritorioId },
    );

    if (duplicidadeError) {
      throw duplicidadeError;
    }

    // `a.id < b.id` sempre (garantido pela função SQL): a divergência é
    // associada à empresa de id maior (empresa_similar_id) para não
    // duplicar a mesma ocorrência nos dois lados do par; `atual` descreve
    // a outra empresa do par (a de id menor, razao_social/empresa_id).
    for (const par of (paresDuplicados ?? []) as DuplicidadeRow[]) {
      detectadas.push({
        empresaId: par.empresa_similar_id,
        tipo: "Duplicidade",
        atual: `Possível duplicidade com ${par.razao_social}`,
        sugerido: null,
        empresaRelacionadaId: par.empresa_id,
      });
    }

    // O RPC teve êxito para o escritório inteiro: a verdade sobre
    // duplicidade de TODA empresa foi obtida nesta execução — inclusive as
    // que não apareceram em nenhum par retornado (ausência de par também é
    // um resultado, não uma omissão). Por isso toda empresa entra no
    // conjunto avaliado, não só as que aparecem em `paresDuplicados`.
    for (const empresa of empresas) {
      chavesAvaliadasNestaExecucao.add(chaveDivergencia(empresa.id, "Duplicidade"));
    }
  } catch (err) {
    console.error("detectar_duplicidade_razao_social falhou (auditoria segue sem checar duplicidade):", err);
    // RPC falhou: nenhuma empresa teve sua duplicidade avaliada nesta
    // execução — não adiciona nada ao conjunto avaliado, então nenhuma
    // divergência "Duplicidade" Pendente existente é resolvida automaticamente.
  }

  // Regras externas (reconsulta BrasilAPI) — só quando explicitamente
  // pedido pelo botão "revalidar carteira" do frontend. Nunca deve rodar
  // automaticamente após salvar/editar uma empresa (rate limit por IP). Se
  // `incluirRegrasExternas` não foi pedido, nenhuma empresa entra no
  // conjunto avaliado para "Razão social"/"Endereço" — divergências
  // Pendentes existentes desses tipos ficam intocadas nesta execução.
  if (incluirRegrasExternas) {
    for (const empresa of empresas) {
      try {
        const dadosBrasilAPI = await consultarCNPJComCache(supabase, empresa.cnpj);
        detectadas.push(...avaliarRegrasExternas(empresa, dadosBrasilAPI));
        const dadosAusentes = avaliarDadosAusentes(empresa, dadosBrasilAPI);
        if (dadosAusentes) detectadas.push(dadosAusentes);
        // Consulta OK: razão social, endereço e dados ausentes desta empresa
        // foram de fato reavaliados contra a BrasilAPI/cache nesta execução.
        chavesAvaliadasNestaExecucao.add(chaveDivergencia(empresa.id, "Razão social"));
        chavesAvaliadasNestaExecucao.add(chaveDivergencia(empresa.id, "Endereço"));
        chavesAvaliadasNestaExecucao.add(chaveDivergencia(empresa.id, "Dados ausentes"));
      } catch (err) {
        // Uma consulta individual falhando (404/429/502) não pode abortar
        // a rotina inteira — a empresa é pulada e o erro é apenas logado.
        // Como esta empresa não entra no conjunto avaliado acima, eventuais
        // divergências Pendentes de "Razão social"/"Endereço" já existentes
        // para ela são preservadas (não resolvidas por engano).
        if (err instanceof BrasilAPIError) {
          console.error(`BrasilAPI falhou para empresa ${empresa.id} (status ${err.status}): ${err.message}`);
        } else {
          console.error(`Erro inesperado ao reconsultar BrasilAPI para empresa ${empresa.id}:`, err);
        }
      }
    }
  }

  // --- Idempotência contra a tabela `divergencias` ------------------------
  const { data: divergenciasExistentesData, error: divergenciasExistentesError } = await supabase
    .from("divergencias")
    .select("id, empresa_id, empresa_relacionada_id, tipo, atual, sugerido, status, detectado_em");

  if (divergenciasExistentesError) {
    return applySetCookies(
      Response.json({ error: "Não foi possível carregar as divergências existentes." }, { status: 500 }),
    );
  }

  // Última linha conhecida por chave de idempotência — histórico preserva
  // linhas antigas, então precisamos da mais recente por `detectado_em`
  // para decidir o que fazer com cada divergência detectada nesta execução.
  // Para "Duplicidade" a chave inclui o id da outra empresa do par (ver
  // `chaveIdempotencia`), então cada par empresa-parceiro tem sua própria
  // entrada nesta Map. Quando o parceiro já foi excluído (`empresa_relacionada_id`
  // null), usamos o `id` da própria linha — nunca `atual` — para não colidir
  // com outra linha órfã de texto idêntico (ver comentário em `chaveIdempotencia`).
  const ultimaPorPar = new Map<string, DivergenciaRow>();
  for (const row of (divergenciasExistentesData ?? []) as DivergenciaRow[]) {
    const chave = chaveIdempotencia(row.empresa_id, row.tipo, row.empresa_relacionada_id ?? row.id);
    const atual = ultimaPorPar.get(chave);
    if (!atual || new Date(row.detectado_em) > new Date(atual.detectado_em)) {
      ultimaPorPar.set(chave, row);
    }
  }

  const chavesDetectadasNestaExecucao = new Set<string>();
  const paraInserir: {
    escritorio_id: string;
    empresa_id: string;
    tipo: string;
    atual: string;
    sugerido: string | null;
    empresa_relacionada_id: string | null;
  }[] = [];
  // Quando o valor/sugestão muda e a linha anterior ainda estava Pendente,
  // ela é "superada" pela nova detecção (marcada Revisado) — sem isso, as
  // duas ficariam Pendente ao mesmo tempo dizendo a mesma coisa (ex.: "CNAE
  // não informado" sem sugestão E com sugestão simultaneamente), parecendo
  // uma pendência duplicada pro usuário. Só supera quem ainda estava
  // Pendente: uma linha que o usuário já Ignorou/Revisou não é mexida.
  const idsParaSuperar: string[] = [];

  for (const divergencia of detectadas) {
    // `divergencia.empresaRelacionadaId` sempre vem preenchido para
    // "Duplicidade" aqui (vem direto do par retornado pelo RPC, que só
    // existe entre empresas que ainda existem) — o fallback pra `atual` é
    // só defensivo, nunca deveria ser exercido na prática.
    const chave = chaveIdempotencia(divergencia.empresaId, divergencia.tipo, divergencia.empresaRelacionadaId ?? divergencia.atual);
    chavesDetectadasNestaExecucao.add(chave);

    const existente = ultimaPorPar.get(chave);

    if (existente && existente.atual === divergencia.atual && existente.sugerido === divergencia.sugerido) {
      // Nem o valor nem a sugestão mudaram desde a última detecção: mantém
      // o status que o usuário já deu (Pendente/Revisado/Ignorado), não faz
      // nada. A comparação inclui `sugerido` porque "Dados ausentes" pode
      // ganhar uma sugestão (CNAE/endereço/porte do cache) numa execução
      // posterior sem o texto `atual` mudar — sem checar `sugerido` aqui,
      // essa sugestão nova nunca seria persistida.
      continue;
    }

    if (existente && existente.id && existente.status === "Pendente") {
      idsParaSuperar.push(existente.id);
    }

    // Par novo, ou `atual`/`sugerido` mudou desde a última detecção: insere
    // uma nova linha Pendente (a linha anterior vira Revisado acima, mas
    // continua intacta no histórico — não é sobrescrita nem apagada).
    paraInserir.push({
      escritorio_id: escritorioId,
      empresa_id: divergencia.empresaId,
      tipo: divergencia.tipo,
      atual: divergencia.atual,
      sugerido: divergencia.sugerido,
      empresa_relacionada_id: divergencia.empresaRelacionadaId ?? null,
    });

    // Atualiza o "último conhecido" em memória: se a mesma empresa/tipo for
    // detectada mais de uma vez nesta mesma execução (ex.: duas
    // duplicidades simultâneas com parceiros diferentes), a próxima
    // comparação deve ser contra este valor recém-processado, não contra a
    // linha antiga do banco.
    ultimaPorPar.set(chave, {
      id: "",
      empresa_id: divergencia.empresaId,
      empresa_relacionada_id: divergencia.empresaRelacionadaId ?? null,
      tipo: divergencia.tipo,
      atual: divergencia.atual,
      sugerido: divergencia.sugerido,
      status: "Pendente",
      detectado_em: new Date().toISOString(),
    });
  }

  if (idsParaSuperar.length > 0) {
    const { error: superarError } = await supabase
      .from("divergencias")
      .update({ status: "Revisado", resolvido_em: new Date().toISOString() })
      .in("id", idsParaSuperar);

    if (superarError) {
      return applySetCookies(
        Response.json({ error: "Não foi possível atualizar divergências superadas por uma nova detecção." }, { status: 500 }),
      );
    }
  }

  if (paraInserir.length > 0) {
    const { error: insertError } = await supabase.from("divergencias").insert(paraInserir);

    if (insertError) {
      return applySetCookies(
        Response.json({ error: "Não foi possível gravar as divergências detectadas." }, { status: 500 }),
      );
    }
  }

  // Resolução automática: pares com divergência Pendente aberta que não
  // foram detectados nesta execução (o problema não existe mais) E cuja
  // regra (empresa, tipo) foi de fato avaliada nesta execução — a
  // interseção entre "não detectado" e "avaliado" é o que garante que uma
  // falha isolada (BrasilAPI de uma empresa, RPC de duplicidade, ou uma
  // chamada interna-only sem `incluirRegrasExternas`) nunca seja confundida
  // com "o problema não existe mais" e apague um Pendente real (Finding 1).
  const idsParaResolver: string[] = [];
  let puladas = 0;
  for (const [chave, row] of ultimaPorPar) {
    if (!row.id || row.status !== "Pendente" || chavesDetectadasNestaExecucao.has(chave)) {
      continue;
    }

    const chaveAvaliacao = chaveDivergencia(row.empresa_id, row.tipo);
    if (chavesAvaliadasNestaExecucao.has(chaveAvaliacao)) {
      idsParaResolver.push(row.id);
    } else {
      // Regra não avaliada para esta empresa nesta execução: a divergência
      // Pendente é preservada, e contabilizada aqui para tornar visível na
      // resposta uma degradação parcial (RPC/BrasilAPI fora do ar, ou run
      // interno-only) em vez de silenciá-la.
      puladas += 1;
    }
  }

  if (idsParaResolver.length > 0) {
    const { error: resolverError } = await supabase
      .from("divergencias")
      .update({ status: "Revisado", resolvido_em: new Date().toISOString() })
      .in("id", idsParaResolver);

    if (resolverError) {
      return applySetCookies(
        Response.json({ error: "Não foi possível resolver divergências automaticamente." }, { status: 500 }),
      );
    }
  }

  // `puladas`: quantas divergências Pendentes existentes NÃO foram
  // resolvidas automaticamente por falta de avaliação nesta execução (RPC de
  // duplicidade fora do ar, BrasilAPI falhou para a empresa, ou execução
  // interna-only sem `incluirRegrasExternas`) — torna uma degradação parcial
  // visível na resposta em vez de silenciosa. Campo aditivo: consumidores
  // existentes que só leem `detectadas`/`resolvidas` continuam funcionando.
  return applySetCookies(
    Response.json({ detectadas: paraInserir.length, resolvidas: idsParaResolver.length, puladas }),
  );
}
