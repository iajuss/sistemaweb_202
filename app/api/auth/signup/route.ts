import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { LIMITES_AUTH, consumirRateLimit, ipDoRequest, respostaLimiteExcedido } from "@/lib/rate-limit";
import { LIMITES, validarCampos } from "@/lib/validacao";

export async function POST(request: Request) {
  let payload: {
    escritorioNome?: string;
    nome?: string;
    email?: string;
    senha?: string;
  };

  try {
    payload = (await request.json()) as {
      escritorioNome?: string;
      nome?: string;
      email?: string;
      senha?: string;
    };
  } catch {
    return Response.json(
      { error: "Preencha escritório, nome, e-mail e uma senha com pelo menos 8 caracteres." },
      { status: 400 },
    );
  }

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

  const erroTamanho = validarCampos([
    ["Nome do escritório", escritorioNome, LIMITES.nome],
    ["Nome", nome, LIMITES.nome],
    ["E-mail", email, LIMITES.email],
  ]);
  if (erroTamanho) {
    return Response.json({ error: erroTamanho }, { status: 400 });
  }

  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();

  // Cada cadastro dispara um e-mail de confirmação e cria um escritório novo
  // no banco (trigger on_auth_user_created). Sem limite por IP, um script
  // enche a base de escritórios fantasma e usa o app como canhão de e-mails
  // contra endereços de terceiros.
  const [limiteSignup, janelaSignup] = LIMITES_AUTH.signupIp;
  if (await consumirRateLimit(supabase, "signup-ip", ipDoRequest(request), limiteSignup, janelaSignup)) {
    return applySetCookies(respostaLimiteExcedido(janelaSignup));
  }

  const { error } = await supabase.auth.signUp({
    email,
    password: senha,
    options: {
      data: { escritorio_nome: escritorioNome, nome },
      emailRedirectTo: new URL("/auth/confirm", request.url).toString(),
    },
  });

  if (error) {
    return applySetCookies(
      Response.json(
        { error: "Não foi possível criar a conta. Verifique os dados e tente novamente." },
        { status: 400 },
      ),
    );
  }

  return applySetCookies(Response.json({ ok: true }, { status: 201 }));
}
