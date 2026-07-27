import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

const BUCKET = "logos-clientes";
const TAMANHO_MAXIMO = 2 * 1024 * 1024;
const TIPOS_PERMITIDOS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

async function contextoDoResponsavel() {
  const contexto = await createSupabaseRouteHandlerClient();
  const { data: { user } } = await contexto.supabase.auth.getUser();
  if (!user) return { ...contexto, erro: Response.json({ error: "Não autenticado." }, { status: 401 }) };

  const { data: perfil } = await contexto.supabase.from("perfis").select("escritorio_id, papel").eq("id", user.id).single();
  if (!perfil || perfil.papel !== "responsavel") {
    return { ...contexto, erro: Response.json({ error: "Só o responsável pode gerenciar a logo." }, { status: 403 }) };
  }
  return { ...contexto, perfil };
}

export async function POST(request: Request) {
  const contexto = await contextoDoResponsavel();
  if ("erro" in contexto) return contexto.applySetCookies(contexto.erro);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return contexto.applySetCookies(Response.json({ error: "Envie uma imagem válida." }, { status: 400 }));
  }
  const arquivo = form.get("logo");
  if (!(arquivo instanceof File) || !TIPOS_PERMITIDOS[arquivo.type]) {
    return contexto.applySetCookies(Response.json({ error: "Use uma imagem PNG, JPG ou WebP." }, { status: 400 }));
  }
  if (arquivo.size === 0 || arquivo.size > TAMANHO_MAXIMO) {
    return contexto.applySetCookies(Response.json({ error: "A logo deve ter no máximo 2 MB." }, { status: 400 }));
  }

  const { data: escritorio } = await contexto.supabase.from("escritorios").select("logo_path").eq("id", contexto.perfil.escritorio_id).single();
  const extensao = TIPOS_PERMITIDOS[arquivo.type];
  const caminho = `${contexto.perfil.escritorio_id}/logo-${Date.now()}.${extensao}`;
  const { error: erroUpload } = await contexto.supabase.storage.from(BUCKET).upload(caminho, await arquivo.arrayBuffer(), { contentType: arquivo.type, upsert: false });
  if (erroUpload) return contexto.applySetCookies(Response.json({ error: "Não foi possível enviar a logo. Verifique se a migração de armazenamento foi aplicada." }, { status: 500 }));

  const { error: erroEscritorio } = await contexto.supabase.from("escritorios").update({ logo_path: caminho }).eq("id", contexto.perfil.escritorio_id);
  if (erroEscritorio) {
    await contexto.supabase.storage.from(BUCKET).remove([caminho]);
    return contexto.applySetCookies(Response.json({ error: "Não foi possível salvar a logo." }, { status: 500 }));
  }
  if (escritorio?.logo_path) await contexto.supabase.storage.from(BUCKET).remove([escritorio.logo_path]);

  const { data } = contexto.supabase.storage.from(BUCKET).getPublicUrl(caminho);
  return contexto.applySetCookies(Response.json({ logoUrl: data.publicUrl }));
}

export async function DELETE() {
  const contexto = await contextoDoResponsavel();
  if ("erro" in contexto) return contexto.applySetCookies(contexto.erro);

  const { data: escritorio } = await contexto.supabase.from("escritorios").select("logo_path").eq("id", contexto.perfil.escritorio_id).single();
  const { error } = await contexto.supabase.from("escritorios").update({ logo_path: null }).eq("id", contexto.perfil.escritorio_id);
  if (error) return contexto.applySetCookies(Response.json({ error: "Não foi possível remover a logo." }, { status: 500 }));
  if (escritorio?.logo_path) await contexto.supabase.storage.from(BUCKET).remove([escritorio.logo_path]);
  return contexto.applySetCookies(Response.json({ ok: true }));
}
