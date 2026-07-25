import { createSupabaseServerClient, createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { EMPRESA_SELECT, buscarEmpresaCompletaPorId, paraShapeFrontend, type EmpresaRow } from "@/lib/empresas";

// GET /api/empresas — lista as empresas do escritório da sessão (RLS filtra
// por escritorio_id). Suporta ?busca= para filtrar por razão social,
// fantasia ou CNPJ.
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Não autenticado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const busca = url.searchParams.get("busca")?.trim() ?? "";

  let query = supabase.from("empresas").select(EMPRESA_SELECT).order("razao_social", { ascending: true });

  if (busca) {
    const termo = `%${busca.replace(/[%,]/g, "")}%`;
    query = query.or(`razao_social.ilike.${termo},fantasia.ilike.${termo},cnpj.ilike.${termo}`);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: "Não foi possível carregar as empresas." }, { status: 500 });
  }

  return Response.json((data as unknown as EmpresaRow[]).map(paraShapeFrontend));
}

type EmpresaPayload = {
  cnpj?: string;
  razaoSocial?: string;
  fantasia?: string;
  cidade?: string;
  estado?: string;
  endereco?: string;
  cnaeCodigo?: string;
  cnaeDescricao?: string;
  porte?: string;
  situacaoCadastral?: string;
  abertura?: string | null;
  socios?: { nome: string; papel: string }[];
  responsavelId?: string | null;
  observacoes?: string;
  tags?: string[];
};

// POST /api/empresas — cria uma empresa (+ sócios) no escritório da sessão.
export async function POST(request: Request) {
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  let payload: EmpresaPayload;
  try {
    payload = (await request.json()) as EmpresaPayload;
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  const cnpj = payload.cnpj?.trim() ?? "";
  const razaoSocial = payload.razaoSocial?.trim() ?? "";

  if (!cnpj || !razaoSocial) {
    return applySetCookies(Response.json({ error: "CNPJ e razão social são obrigatórios." }, { status: 400 }));
  }

  const { data: perfil, error: perfilError } = await supabase
    .from("perfis")
    .select("escritorio_id")
    .eq("id", user.id)
    .single();

  if (perfilError || !perfil) {
    return applySetCookies(Response.json({ error: "Não foi possível identificar o escritório do usuário." }, { status: 500 }));
  }

  const { data: empresaInserida, error: insertError } = await supabase
    .from("empresas")
    .insert({
      escritorio_id: (perfil as { escritorio_id: string }).escritorio_id,
      cnpj,
      razao_social: razaoSocial,
      fantasia: payload.fantasia ?? "",
      cidade: payload.cidade ?? "",
      estado: payload.estado ?? "",
      endereco: payload.endereco ?? "",
      cnae_codigo: payload.cnaeCodigo ?? "",
      cnae_descricao: payload.cnaeDescricao ?? "",
      porte: payload.porte ?? "",
      situacao_cadastral: payload.situacaoCadastral ?? "",
      abertura: payload.abertura ?? null,
      responsavel_id: payload.responsavelId ?? null,
      tags: payload.tags ?? [],
      observacoes: payload.observacoes ?? "",
    })
    .select("id")
    .single();

  if (insertError || !empresaInserida) {
    return applySetCookies(Response.json({ error: "Não foi possível criar a empresa." }, { status: 500 }));
  }

  const empresaId = (empresaInserida as { id: string }).id;
  const socios = payload.socios ?? [];

  if (socios.length > 0) {
    const { error: sociosError } = await supabase.from("empresas_socios").insert(
      socios.map((socio) => ({
        empresa_id: empresaId,
        nome: socio.nome,
        papel: socio.papel ?? "",
      })),
    );

    if (sociosError) {
      return applySetCookies(Response.json({ error: "Empresa criada, mas não foi possível salvar os sócios." }, { status: 500 }));
    }
  }

  const empresaCompleta = await buscarEmpresaCompletaPorId(supabase, empresaId);

  if (!empresaCompleta) {
    return applySetCookies(Response.json({ error: "Empresa criada, mas não foi possível carregá-la." }, { status: 500 }));
  }

  return applySetCookies(Response.json(paraShapeFrontend(empresaCompleta), { status: 201 }));
}
