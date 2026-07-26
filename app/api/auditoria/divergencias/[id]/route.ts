import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { buscarDivergenciaCompletaPorId, paraShapeFrontend } from "@/lib/divergencias";
import { consultarCNPJComCache } from "@/lib/cnpj-cache";

type DivergenciaPatchPayload = {
  acao?: "revisar" | "ignorar" | "aplicar_sugestao";
};

type DivergenciaResumo = {
  empresa_id: string;
  tipo: string;
  atual: string;
  sugerido: string | null;
};

// Só "Razão social" e "Endereço" têm um campo correspondente em `empresas`
// para receber o valor sugerido — as demais divergências (CNPJ inválido,
// Duplicidade, Situação irregular, Dados ausentes) não têm uma ação
// automática de correção, só revisar/ignorar.
const CAMPO_POR_TIPO: Record<string, "razao_social" | "endereco"> = {
  "Razão social": "razao_social",
  Endereço: "endereco",
};

// PATCH /api/auditoria/divergencias/:id — aplica uma ação sobre uma
// divergência: "revisar"/"ignorar" só mudam o status; "aplicar_sugestao"
// além disso escreve o valor sugerido no campo correspondente de `empresas`.
// RLS garante que só é possível agir sobre divergências do próprio
// escritório; id inexistente ou bloqueado por RLS responde 404 (não 403,
// mesmo padrão de `PATCH /api/empresas/:id`).
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  let payload: DivergenciaPatchPayload;
  try {
    payload = (await request.json()) as DivergenciaPatchPayload;
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  const acao = payload.acao;
  if (acao !== "revisar" && acao !== "ignorar" && acao !== "aplicar_sugestao") {
    return applySetCookies(Response.json({ error: "Ação inválida." }, { status: 400 }));
  }

  const { data: divergenciaAtual, error: buscarError } = await supabase
    .from("divergencias")
    .select("empresa_id, tipo, atual, sugerido")
    .eq("id", id)
    .maybeSingle();

  if (buscarError) {
    return applySetCookies(Response.json({ error: "Não foi possível carregar a divergência." }, { status: 500 }));
  }

  if (!divergenciaAtual) {
    return applySetCookies(Response.json({ error: "Divergência não encontrada." }, { status: 404 }));
  }

  const divergencia = divergenciaAtual as DivergenciaResumo;

  if (acao === "aplicar_sugestao" && divergencia.tipo === "Dados ausentes") {
    if (divergencia.sugerido === null) {
      return applySetCookies(
        Response.json({ error: "Esta divergência não tem sugestão para aplicar." }, { status: 400 }),
      );
    }

    // "Dados ausentes" pode ter mais de um campo faltando ao mesmo tempo
    // (endereço, CNAE, porte) — diferente de "Razão social"/"Endereço" (um
    // valor sugerido, um campo), aqui reconsultamos o cache (mesma função
    // usada pela auditoria, TTL de 24h — não bate na BrasilAPI de novo na
    // maioria dos casos) e aplicamos, de uma vez, todos os campos que
    // estiverem vazios NA EMPRESA e preenchidos NO CACHE. Evita parsear de
    // volta o texto de exibição de `sugerido` (frágil: descrição de CNAE
    // pode conter os mesmos separadores usados para juntar múltiplos campos).
    const { data: empresaAtualDados, error: empresaBuscarError } = await supabase
      .from("empresas")
      .select("cnpj, endereco, cnae_codigo, porte")
      .eq("id", divergencia.empresa_id)
      .maybeSingle();

    if (empresaBuscarError || !empresaAtualDados) {
      return applySetCookies(
        Response.json({ error: "Não foi possível carregar a empresa para aplicar a sugestão." }, { status: 500 }),
      );
    }

    const empresaDados = empresaAtualDados as { cnpj: string; endereco: string; cnae_codigo: string; porte: string };

    let dadosBrasilAPI;
    try {
      dadosBrasilAPI = await consultarCNPJComCache(supabase, empresaDados.cnpj);
    } catch {
      return applySetCookies(
        Response.json({ error: "Não foi possível reconsultar os dados da empresa para aplicar a sugestão." }, { status: 502 }),
      );
    }

    const atualizacoes: Record<string, string> = {};
    if (empresaDados.endereco.trim() === "" && dadosBrasilAPI.endereco) atualizacoes.endereco = dadosBrasilAPI.endereco;
    if (empresaDados.cnae_codigo.trim() === "" && dadosBrasilAPI.cnaeCodigo) {
      atualizacoes.cnae_codigo = dadosBrasilAPI.cnaeCodigo;
      atualizacoes.cnae_descricao = dadosBrasilAPI.cnaeDescricao;
    }
    if (empresaDados.porte.trim() === "" && dadosBrasilAPI.porte) atualizacoes.porte = dadosBrasilAPI.porte;

    if (Object.keys(atualizacoes).length === 0) {
      return applySetCookies(
        Response.json({ error: "Nenhum dado novo disponível para aplicar — revalide a carteira e tente de novo." }, { status: 400 }),
      );
    }

    const { data: empresaAtualizada, error: empresaError } = await supabase
      .from("empresas")
      .update({ ...atualizacoes, atualizado_em: new Date().toISOString() })
      .eq("id", divergencia.empresa_id)
      .select("id")
      .maybeSingle();

    if (empresaError || !empresaAtualizada) {
      return applySetCookies(
        Response.json({ error: "Não foi possível atualizar a empresa com a sugestão." }, { status: 500 }),
      );
    }

    const { data: divergenciaResolvida, error: resolverError } = await supabase
      .from("divergencias")
      .update({ status: "Revisado", resolvido_em: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (resolverError || !divergenciaResolvida) {
      // Compensação: os campos já foram preenchidos, mas marcar a
      // divergência como resolvida falhou — reverte pro vazio (era o valor
      // anterior, já que só preenchemos campos que estavam vazios) pra não
      // deixar a sugestão aplicada silenciosamente sem que a divergência
      // reflita isso.
      const reversao: Record<string, string> = {};
      for (const campo of Object.keys(atualizacoes)) reversao[campo] = "";
      await supabase.from("empresas").update({ ...reversao, atualizado_em: new Date().toISOString() }).eq("id", divergencia.empresa_id);

      return applySetCookies(
        Response.json({ error: "Não foi possível marcar a divergência como resolvida." }, { status: 500 }),
      );
    }
  } else if (acao === "aplicar_sugestao") {
    const coluna = CAMPO_POR_TIPO[divergencia.tipo];

    if (!coluna || divergencia.sugerido === null) {
      return applySetCookies(
        Response.json({ error: "Esta divergência não permite aplicar sugestão." }, { status: 400 }),
      );
    }

    // Escreve a sugestão na empresa ANTES de marcar a divergência como
    // resolvida: se esta escrita falhar, a divergência permanece como
    // estava (nenhum estado inconsistente é criado).
    const { data: empresaAtualizada, error: empresaError } = await supabase
      .from("empresas")
      .update({ [coluna]: divergencia.sugerido, atualizado_em: new Date().toISOString() })
      .eq("id", divergencia.empresa_id)
      .select("id")
      .maybeSingle();

    if (empresaError || !empresaAtualizada) {
      return applySetCookies(
        Response.json({ error: "Não foi possível atualizar a empresa com a sugestão." }, { status: 500 }),
      );
    }

    const { data: divergenciaResolvida, error: resolverError } = await supabase
      .from("divergencias")
      .update({ status: "Revisado", resolvido_em: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (resolverError || !divergenciaResolvida) {
      // Compensação: a empresa já foi atualizada com a sugestão, mas marcar
      // a divergência como resolvida falhou — reverte o campo da empresa
      // para o valor anterior (`atual`) para não deixar a sugestão aplicada
      // silenciosamente sem que a divergência reflita isso (mesmo princípio
      // de não deixar estado inconsistente da compensação em
      // `POST /api/empresas`, que desfaz a empresa se os sócios falharem).
      await supabase
        .from("empresas")
        .update({ [coluna]: divergencia.atual, atualizado_em: new Date().toISOString() })
        .eq("id", divergencia.empresa_id);

      return applySetCookies(
        Response.json({ error: "Não foi possível marcar a divergência como resolvida." }, { status: 500 }),
      );
    }
  } else {
    const novoStatus = acao === "revisar" ? "Revisado" : "Ignorado";

    const { data: divergenciaAtualizada, error: atualizarError } = await supabase
      .from("divergencias")
      .update({ status: novoStatus, resolvido_em: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (atualizarError || !divergenciaAtualizada) {
      return applySetCookies(Response.json({ error: "Não foi possível atualizar a divergência." }, { status: 500 }));
    }
  }

  const divergenciaCompleta = await buscarDivergenciaCompletaPorId(supabase, id);

  if (!divergenciaCompleta) {
    return applySetCookies(Response.json({ error: "Divergência não encontrada." }, { status: 404 }));
  }

  return applySetCookies(Response.json(paraShapeFrontend(divergenciaCompleta)));
}
