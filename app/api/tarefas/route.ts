import { createSupabaseServerClient, createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { garantirFeriadosDoAno } from "@/lib/feriados";
import {
  TAREFA_SELECT,
  gerarTarefasDoMes,
  hojeBrasil,
  intervaloDoMes,
  mesAtual,
  montarRespostaTarefa,
  paraShapeFrontend,
  substituirResponsaveisTarefa,
  type TarefaRow,
} from "@/lib/tarefas";

const MES_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const VENCIMENTO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/tarefas?mes=YYYY-MM&responsavel= — garante que as tarefas do mês
// pedido existam (gera a partir dos modelos ativos, dedupe por
// modelo_id+vencimento), depois lista as tarefas do escritório da sessão
// (RLS) dentro do mês, com embeds de empresa/responsável, status efetivo
// ("Atrasada" calculado na leitura) e alerta de feriado.
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Não autenticado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const mesParam = url.searchParams.get("mes");
  const mes = mesParam && MES_REGEX.test(mesParam) ? mesParam : mesAtual();
  const responsavelFiltro = url.searchParams.get("responsavel")?.trim() ?? "";

  const { data: perfil, error: perfilError } = await supabase
    .from("perfis")
    .select("escritorio_id")
    .eq("id", user.id)
    .single();

  if (perfilError || !perfil) {
    return Response.json({ error: "Não foi possível identificar o escritório do usuário." }, { status: 500 });
  }

  const escritorioId = (perfil as { escritorio_id: string }).escritorio_id;

  await gerarTarefasDoMes(supabase, escritorioId, mes);

  const { inicio, fim } = intervaloDoMes(mes);

  const { data, error } = await supabase
    .from("tarefas")
    .select(TAREFA_SELECT)
    .gte("vencimento", inicio)
    .lte("vencimento", fim)
    // "Cancelada" é a "lápide" de uma ocorrência excluída de um modelo de
    // recorrência (ver `StatusTarefa` em lib/tarefas.ts) — existe só para
    // `gerarTarefasDoMes` não regenerá-la, nunca deve aparecer no frontend.
    .neq("status", "Cancelada")
    .order("vencimento", { ascending: true });

  if (error) {
    return Response.json({ error: "Não foi possível carregar as tarefas." }, { status: 500 });
  }

  let linhas = data as unknown as TarefaRow[];

  // Tarefa vinculada a um modelo atualmente inativo some do calendário (mas
  // não é apagada nem alterada) — volta a aparecer assim que o modelo for
  // reativado. Tarefas avulsas (`modelo: null`) nunca são afetadas.
  linhas = linhas.filter((linha) => linha.modelo === null || linha.modelo.ativo);

  if (responsavelFiltro) {
    linhas = linhas.filter((linha) =>
      linha.responsaveis.some((r) => (r.perfil?.nome ?? "").toLowerCase() === responsavelFiltro.toLowerCase()),
    );
  }

  const ano = Number(mes.slice(0, 4));
  const feriados = await garantirFeriadosDoAno(supabase, ano);

  return Response.json(linhas.map((linha) => paraShapeFrontend(linha, feriados, hojeBrasil())));
}

type TarefaPayload = {
  titulo?: string;
  tipo?: string;
  empresaId?: string | null;
  responsavelIds?: string[];
  vencimento?: string;
};

// POST /api/tarefas — cria uma tarefa avulsa (modelo_id: null) no escritório
// da sessão. `tipo` guarda a natureza da tarefa: "Externa" (reunião/obrigação
// com uma empresa cliente, exige `empresaId`) ou "Interna" (reunião da própria
// equipe, sem empresa: `empresa_id = NULL`). Retorna a tarefa criada no shape
// do GET (com embeds e alerta de feriado já calculados).
export async function POST(request: Request) {
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  let payload: TarefaPayload;
  try {
    payload = (await request.json()) as TarefaPayload;
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  const titulo = payload.titulo?.trim() ?? "";
  const tipo = payload.tipo?.trim() ?? "";
  const empresaId = payload.empresaId?.trim?.() ?? "";
  const vencimento = payload.vencimento?.trim() ?? "";
  const interna = tipo === "Interna";

  if (!titulo || !tipo || !vencimento) {
    return applySetCookies(
      Response.json({ error: "Título, tipo e vencimento são obrigatórios." }, { status: 400 }),
    );
  }

  if (!interna && !empresaId) {
    return applySetCookies(
      Response.json({ error: "Selecione a empresa cliente da tarefa externa." }, { status: 400 }),
    );
  }

  if (!VENCIMENTO_REGEX.test(vencimento)) {
    return applySetCookies(Response.json({ error: 'Vencimento deve estar no formato "YYYY-MM-DD".' }, { status: 400 }));
  }

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

  const { data: tarefaInserida, error: insertError } = await supabase
    .from("tarefas")
    .insert({
      escritorio_id: (perfil as { escritorio_id: string }).escritorio_id,
      modelo_id: null,
      empresa_id: interna ? null : empresaId,
      titulo,
      tipo,
      vencimento,
      status: "Pendente",
    })
    .select("id")
    .single();

  if (insertError || !tarefaInserida) {
    return applySetCookies(Response.json({ error: "Não foi possível criar a tarefa." }, { status: 500 }));
  }

  const responsavelIds = Array.isArray(payload.responsavelIds) ? payload.responsavelIds : [];
  if (responsavelIds.length > 0) {
    const erroResponsaveis = await substituirResponsaveisTarefa(supabase, (tarefaInserida as { id: string }).id, responsavelIds);
    if (erroResponsaveis) {
      return applySetCookies(Response.json({ error: "Tarefa criada, mas não foi possível salvar os responsáveis." }, { status: 500 }));
    }
  }

  const resposta = await montarRespostaTarefa(supabase, (tarefaInserida as { id: string }).id);

  if (!resposta) {
    return applySetCookies(Response.json({ error: "Tarefa criada, mas não foi possível carregá-la." }, { status: 500 }));
  }

  return applySetCookies(Response.json(resposta, { status: 201 }));
}
