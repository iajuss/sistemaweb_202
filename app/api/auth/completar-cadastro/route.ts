import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let payload: { escritorioNome?: string; nome?: string };

  try {
    payload = (await request.json()) as { escritorioNome?: string; nome?: string };
  } catch {
    return Response.json({ error: "Informe o nome do escritório e o seu nome." }, { status: 400 });
  }

  const escritorioNome = payload.escritorioNome?.trim() ?? "";
  const nome = payload.nome?.trim() ?? "";

  if (!escritorioNome || !nome) {
    return Response.json({ error: "Informe o nome do escritório e o seu nome." }, { status: 400 });
  }

  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applySetCookies(Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 }));
  }

  const { data: perfil } = await supabase
    .from("perfis")
    .select("escritorio_id")
    .eq("id", user.id)
    .single();

  if (!perfil) {
    return applySetCookies(Response.json({ error: "Perfil não encontrado." }, { status: 404 }));
  }

  const { error: erroEscritorio } = await supabase
    .from("escritorios")
    .update({ nome: escritorioNome })
    .eq("id", perfil.escritorio_id);

  if (erroEscritorio) {
    return applySetCookies(
      Response.json({ error: "Não foi possível salvar o escritório. Tente novamente." }, { status: 400 }),
    );
  }

  const { error: erroPerfil } = await supabase
    .from("perfis")
    .update({ nome, cadastro_completo: true })
    .eq("id", user.id);

  if (erroPerfil) {
    return applySetCookies(
      Response.json({ error: "Não foi possível salvar o seu nome. Tente novamente." }, { status: 400 }),
    );
  }

  return applySetCookies(Response.json({ ok: true }));
}
