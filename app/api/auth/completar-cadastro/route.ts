import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let payload: { escritorioNome?: string; nome?: string; senha?: string };

  try {
    payload = (await request.json()) as { escritorioNome?: string; nome?: string; senha?: string };
  } catch {
    return Response.json({ error: "Informe seu nome." }, { status: 400 });
  }

  const nome = payload.nome?.trim() ?? "";
  if (!nome) {
    return Response.json({ error: "Informe seu nome." }, { status: 400 });
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
    .select("escritorio_id, papel")
    .eq("id", user.id)
    .single();

  if (!perfil) {
    return applySetCookies(Response.json({ error: "Perfil não encontrado." }, { status: 404 }));
  }

  if (perfil.papel === "responsavel") {
    const escritorioNome = payload.escritorioNome?.trim() ?? "";
    if (!escritorioNome) {
      return applySetCookies(Response.json({ error: "Informe o nome do escritório e o seu nome." }, { status: 400 }));
    }
    const { error: erroEscritorio } = await supabase
      .from("escritorios")
      .update({ nome: escritorioNome })
      .eq("id", perfil.escritorio_id);

    if (erroEscritorio) {
      return applySetCookies(Response.json({ error: "Não foi possível salvar o escritório. Tente novamente." }, { status: 400 }));
    }
  } else {
    const senha = payload.senha ?? "";
    if (senha.length < 8) {
      return applySetCookies(Response.json({ error: "A senha deve ter ao menos 8 caracteres." }, { status: 400 }));
    }
    const { error: erroSenha } = await supabase.auth.updateUser({ password: senha });
    if (erroSenha) {
      return applySetCookies(Response.json({ error: "Não foi possível definir a senha. Tente novamente." }, { status: 400 }));
    }
  }

  const { error: erroPerfil } = await supabase.from("perfis").update({ nome, cadastro_completo: true }).eq("id", user.id);

  if (erroPerfil) {
    return applySetCookies(
      Response.json({ error: "Não foi possível salvar o seu nome. Tente novamente." }, { status: 400 }),
    );
  }

  return applySetCookies(Response.json({ ok: true }));
}
