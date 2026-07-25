import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { buscarEmpresaCompletaPorId, paraShapeFrontend } from "@/lib/empresas";

type EmpresaPatchPayload = {
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
  responsavelId?: string | null;
  observacoes?: string;
  tags?: string[];
};

const CAMPOS_EDITAVEIS: { chave: keyof EmpresaPatchPayload; coluna: string }[] = [
  { chave: "cnpj", coluna: "cnpj" },
  { chave: "razaoSocial", coluna: "razao_social" },
  { chave: "fantasia", coluna: "fantasia" },
  { chave: "cidade", coluna: "cidade" },
  { chave: "estado", coluna: "estado" },
  { chave: "endereco", coluna: "endereco" },
  { chave: "cnaeCodigo", coluna: "cnae_codigo" },
  { chave: "cnaeDescricao", coluna: "cnae_descricao" },
  { chave: "porte", coluna: "porte" },
  { chave: "situacaoCadastral", coluna: "situacao_cadastral" },
  { chave: "abertura", coluna: "abertura" },
  { chave: "responsavelId", coluna: "responsavel_id" },
  { chave: "observacoes", coluna: "observacoes" },
  { chave: "tags", coluna: "tags" },
];

// PATCH /api/empresas/:id — atualização parcial. RLS garante que só é
// possível atualizar empresas do próprio escritório; se o id não existir ou
// pertencer a outro escritório, o update afeta 0 linhas e respondemos 404
// (não 403: o id é opaco ao usuário, não há ambiguidade de permissão a
// esclarecer — ver brief da Task 3).
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  let payload: EmpresaPatchPayload;
  try {
    payload = (await request.json()) as EmpresaPatchPayload;
  } catch {
    return applySetCookies(Response.json({ error: "Corpo da requisição inválido." }, { status: 400 }));
  }

  const updates: Record<string, unknown> = {};
  for (const { chave, coluna } of CAMPOS_EDITAVEIS) {
    if (chave in payload) {
      updates[coluna] = payload[chave];
    }
  }
  updates.atualizado_em = new Date().toISOString();

  const { data: empresaAtualizada, error: updateError } = await supabase
    .from("empresas")
    .update(updates)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return applySetCookies(Response.json({ error: "Não foi possível atualizar a empresa." }, { status: 500 }));
  }

  if (!empresaAtualizada) {
    return applySetCookies(Response.json({ error: "Empresa não encontrada." }, { status: 404 }));
  }

  const empresaCompleta = await buscarEmpresaCompletaPorId(supabase, id);

  if (!empresaCompleta) {
    return applySetCookies(Response.json({ error: "Empresa não encontrada." }, { status: 404 }));
  }

  return applySetCookies(Response.json(paraShapeFrontend(empresaCompleta)));
}
