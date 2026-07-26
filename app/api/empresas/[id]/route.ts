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
  socios?: { nome: string; papel: string }[];
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

  // `empresas_socios` não é coluna de `empresas` — substituímos a lista
  // inteira (delete + insert) quando o corpo traz `socios`, mesmo padrão do
  // POST de criação. Sem transação multi-tabela via PostgREST, mas o pior
  // caso de falha no insert é ficar sem sócios até o próximo PATCH, não
  // perder a empresa em si (já persistida acima).
  if ("socios" in payload) {
    const { error: deleteSociosError } = await supabase.from("empresas_socios").delete().eq("empresa_id", id);

    if (deleteSociosError) {
      return applySetCookies(Response.json({ error: "Não foi possível atualizar o quadro societário." }, { status: 500 }));
    }

    const socios = payload.socios ?? [];
    if (socios.length > 0) {
      const { error: insertSociosError } = await supabase.from("empresas_socios").insert(
        socios.map((socio) => ({ empresa_id: id, nome: socio.nome, papel: socio.papel ?? "" })),
      );

      if (insertSociosError) {
        return applySetCookies(Response.json({ error: "Não foi possível atualizar o quadro societário." }, { status: 500 }));
      }
    }
  }

  const empresaCompleta = await buscarEmpresaCompletaPorId(supabase, id);

  if (!empresaCompleta) {
    return applySetCookies(Response.json({ error: "Empresa não encontrada." }, { status: 404 }));
  }

  return applySetCookies(Response.json(paraShapeFrontend(empresaCompleta)));
}

// DELETE /api/empresas/:id — remove a empresa do escritório da sessão. RLS
// garante que só é possível excluir empresas do próprio escritório; se o id
// não existir ou pertencer a outro escritório, o delete afeta 0 linhas e
// respondemos 404 (mesma convenção do PATCH acima). `empresas_socios` e
// `modelos_recorrencia`/`tarefas` referenciam `empresas` com
// `on delete cascade` (ver migrations), então não é preciso limpar
// manualmente linhas relacionadas aqui.
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Não autenticado." }, { status: 401 }));
  }

  const { data: empresaExcluida, error: deleteError } = await supabase
    .from("empresas")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    return applySetCookies(Response.json({ error: "Não foi possível excluir a empresa." }, { status: 500 }));
  }

  if (!empresaExcluida) {
    return applySetCookies(Response.json({ error: "Empresa não encontrada." }, { status: 404 }));
  }

  return applySetCookies(new Response(null, { status: 204 }));
}
