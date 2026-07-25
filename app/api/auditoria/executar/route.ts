import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { EMPRESA_SELECT, type EmpresaRow } from "@/lib/empresas";
import {
  avaliarRegrasInternas,
  avaliarRegrasExternas,
  type EmpresaParaAuditoria,
  type DivergenciaDetectada,
} from "@/lib/auditoria";
import { consultarCNPJNaBrasilAPI, BrasilAPIError } from "@/lib/brasilapi";

type ExecutarAuditoriaPayload = {
  incluirRegrasExternas?: boolean;
};

type DivergenciaRow = {
  id: string;
  empresa_id: string;
  tipo: string;
  atual: string;
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
// - par tinha divergência Pendente e não foi detectado nesta execução → resolve automaticamente.
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

  for (const empresa of empresas) {
    detectadas.push(...avaliarRegrasInternas(empresa));
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
      });
    }
  } catch (err) {
    console.error("detectar_duplicidade_razao_social falhou (auditoria segue sem checar duplicidade):", err);
  }

  // Regras externas (reconsulta BrasilAPI) — só quando explicitamente
  // pedido pelo botão "revalidar carteira" do frontend. Nunca deve rodar
  // automaticamente após salvar/editar uma empresa (rate limit por IP).
  if (incluirRegrasExternas) {
    for (const empresa of empresas) {
      try {
        const dadosBrasilAPI = await consultarCNPJNaBrasilAPI(empresa.cnpj);
        detectadas.push(...avaliarRegrasExternas(empresa, dadosBrasilAPI));
      } catch (err) {
        // Uma consulta individual falhando (404/429/502) não pode abortar
        // a rotina inteira — a empresa é pulada e o erro é apenas logado.
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
    .select("id, empresa_id, tipo, atual, status, detectado_em");

  if (divergenciasExistentesError) {
    return applySetCookies(
      Response.json({ error: "Não foi possível carregar as divergências existentes." }, { status: 500 }),
    );
  }

  // Última linha conhecida por par (empresa_id, tipo) — histórico preserva
  // linhas antigas, então precisamos da mais recente por `detectado_em`
  // para decidir o que fazer com cada divergência detectada nesta execução.
  const ultimaPorPar = new Map<string, DivergenciaRow>();
  for (const row of (divergenciasExistentesData ?? []) as DivergenciaRow[]) {
    const chave = chaveDivergencia(row.empresa_id, row.tipo);
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
  }[] = [];

  for (const divergencia of detectadas) {
    const chave = chaveDivergencia(divergencia.empresaId, divergencia.tipo);
    chavesDetectadasNestaExecucao.add(chave);

    const existente = ultimaPorPar.get(chave);

    if (existente && existente.atual === divergencia.atual) {
      // Valor não mudou desde a última detecção: mantém o status que o
      // usuário já deu (Pendente/Revisado/Ignorado), não faz nada.
      continue;
    }

    // Par novo, ou `atual` mudou desde a última detecção: insere uma nova
    // linha Pendente (se `atual` mudou, a linha anterior é preservada
    // intacta — não é sobrescrita).
    paraInserir.push({
      escritorio_id: escritorioId,
      empresa_id: divergencia.empresaId,
      tipo: divergencia.tipo,
      atual: divergencia.atual,
      sugerido: divergencia.sugerido,
    });

    // Atualiza o "último conhecido" em memória: se a mesma empresa/tipo for
    // detectada mais de uma vez nesta mesma execução (ex.: duas
    // duplicidades simultâneas com parceiros diferentes), a próxima
    // comparação deve ser contra este valor recém-processado, não contra a
    // linha antiga do banco.
    ultimaPorPar.set(chave, {
      id: "",
      empresa_id: divergencia.empresaId,
      tipo: divergencia.tipo,
      atual: divergencia.atual,
      status: "Pendente",
      detectado_em: new Date().toISOString(),
    });
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
  // foram detectados nesta execução (o problema não existe mais).
  const idsParaResolver: string[] = [];
  for (const [chave, row] of ultimaPorPar) {
    if (row.id && row.status === "Pendente" && !chavesDetectadasNestaExecucao.has(chave)) {
      idsParaResolver.push(row.id);
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

  return applySetCookies(
    Response.json({ detectadas: paraInserir.length, resolvidas: idsParaResolver.length }),
  );
}
