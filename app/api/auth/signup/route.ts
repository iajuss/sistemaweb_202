import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    escritorioNome?: string;
    nome?: string;
    email?: string;
    senha?: string;
  };

  const escritorioNome = payload.escritorioNome?.trim() ?? "";
  const nome = payload.nome?.trim() ?? "";
  const email = payload.email?.trim() ?? "";
  const senha = payload.senha ?? "";

  if (!escritorioNome || !nome || !email || senha.length < 8) {
    return Response.json(
      { error: "Preencha escritório, nome, e-mail e uma senha com pelo menos 8 caracteres." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password: senha,
    options: { data: { escritorio_nome: escritorioNome, nome } },
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ ok: true }, { status: 201 });
}
