import { createSupabaseServerClient, createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import {
  MODELO_RECORRENCIA_SELECT,
  buscarModeloRecorrenciaCompletoPorId,
  paraShapeFrontend,
  faixaDiaReferencia,
  type ModeloRecorrenciaRow,
  type Periodicidade,
} from "@/lib/modelos-recorrencia";

const PERIODICIDADES_VALIDAS: Periodicidade[] = ["mensal", "semanal", "anual"];

// GET /api/modelos-recorrencia — lista os modelos de recorrência do
// escritório da sessão (RLS filtra por escritorio_id), com embeds de
// `responsavel:perfis(nome)` e `empresa:empresas(fantasia)`, mesmo padrão de
// `lib/empresas.ts`. Inclui modelos inativos — o frontend decide como
// exibir (ex.: seção "Inativos" ou toggle de filtro).
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("modelos_recorrencia")
    .select(MODELO_RECORRENCIA_SELECT)
    .order("titulo", { ascending: true });

  if (error) {
    return Response.json({ error: "Não foi possível carregar os modelos de recorrência." }, { status: 500 });
  }

  return Response.json((data as unknown as ModeloRecorrenciaRow[]).map(paraShapeFrontend));
}

type ModeloRecorrenciaPayload = {
  titulo?: string;
  tipo?: string;
  periodicidade?: string;
  diaReferencia?: number;
  empresaId?: string | null;
  responsavelId?: string | null;
};

// POST /api/modelos-recorrencia — cria um modelo de recorrência no
// escritório da sessão. `diaReferencia` é validado contra a faixa plausível
// para a `periodicidade` escolhida (1-7 para semanal, dia da semana; 1-31
// para mensal/anual, dia do mês). `empresaId` é opcional: um modelo interno
// (reunião/rotina da própria equipe) não tem empresa associada — mesmo
// racional de `tarefas.empresa_id` (ver `0010_tarefas_empresa_nullable.sql`).
// A obrigatoriedade de escolher uma empresa quando o modelo é "externo" é
// decisão de frontend (mesmo padrão de `POST /api/tarefas`), não da API.
export async function POST(request: Request) {
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  let payload: ModeloRecorrenciaPayload;
  try {
    payload = (await request.json()) as ModeloRecorrenciaPayload;
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  const titulo = payload.titulo?.trim() ?? "";
  const tipo = payload.tipo?.trim() ?? "";
  const empresaId = payload.empresaId?.trim() ?? "";
  const periodicidade = payload.periodicidade;

  if (!titulo || !tipo) {
    return applySetCookies(
      Response.json({ error: "Título e tipo são obrigatórios." }, { status: 400 }),
    );
  }

  if (!periodicidade || !PERIODICIDADES_VALIDAS.includes(periodicidade as Periodicidade)) {
    return applySetCookies(
      Response.json({ error: 'Periodicidade deve ser "mensal", "semanal" ou "anual".' }, { status: 400 }),
    );
  }

  const diaReferencia = payload.diaReferencia;
  if (typeof diaReferencia !== "number" || !Number.isInteger(diaReferencia)) {
    return applySetCookies(Response.json({ error: "Dia de referência é obrigatório." }, { status: 400 }));
  }

  const maxDia = faixaDiaReferencia(periodicidade);
  if (diaReferencia < 1 || diaReferencia > maxDia) {
    return applySetCookies(
      Response.json(
        { error: `Dia de referência deve estar entre 1 e ${maxDia} para periodicidade "${periodicidade}".` },
        { status: 400 },
      ),
    );
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

  const { data: modeloInserido, error: insertError } = await supabase
    .from("modelos_recorrencia")
    .insert({
      escritorio_id: (perfil as { escritorio_id: string }).escritorio_id,
      empresa_id: empresaId || null,
      titulo,
      tipo,
      periodicidade,
      dia_referencia: diaReferencia,
      responsavel_id: payload.responsavelId ?? null,
      ativo: true,
    })
    .select("id")
    .single();

  if (insertError || !modeloInserido) {
    return applySetCookies(
      Response.json({ error: "Não foi possível criar o modelo de recorrência." }, { status: 500 }),
    );
  }

  const modeloCompleto = await buscarModeloRecorrenciaCompletoPorId(
    supabase,
    (modeloInserido as { id: string }).id,
  );

  if (!modeloCompleto) {
    return applySetCookies(
      Response.json({ error: "Modelo criado, mas não foi possível carregá-lo." }, { status: 500 }),
    );
  }

  return applySetCookies(Response.json(paraShapeFrontend(modeloCompleto), { status: 201 }));
}
