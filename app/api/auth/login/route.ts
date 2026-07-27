import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { LIMITES_AUTH, consumirRateLimit, ipDoRequest, respostaLimiteExcedido } from "@/lib/rate-limit";
import { registrarEvento } from "@/lib/auditoria-seguranca";

export async function POST(request: Request) {
  let payload: { email?: string; senha?: string };

  try {
    payload = (await request.json()) as { email?: string; senha?: string };
  } catch {
    return Response.json({ error: "Informe e-mail e senha." }, { status: 400 });
  }

  const email = payload.email?.trim() ?? "";
  const senha = payload.senha ?? "";

  if (!email || !senha) {
    return Response.json({ error: "Informe e-mail e senha." }, { status: 400 });
  }

  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const ip = ipDoRequest(request);

  // Rate limit em duas chaves, antes de encostar no Supabase Auth:
  // - por IP, que barra força bruta e credential stuffing vindos de poucos
  //   endereços;
  // - por e-mail, que barra o mesmo ataque quando ele vem distribuído por
  //   milhares de IPs diferentes mirando uma conta específica.
  const [limiteIp, janelaIp] = LIMITES_AUTH.loginIp;
  if (await consumirRateLimit(supabase, "login-ip", ip, limiteIp, janelaIp)) {
    await registrarEvento(supabase, "login_bloqueado", { email, ip, detalhe: "limite_por_ip" });
    return applySetCookies(respostaLimiteExcedido(janelaIp));
  }

  const [limiteEmail, janelaEmail] = LIMITES_AUTH.loginEmail;
  if (await consumirRateLimit(supabase, "login-email", email, limiteEmail, janelaEmail)) {
    await registrarEvento(supabase, "login_bloqueado", { email, ip, detalhe: "limite_por_email" });
    return applySetCookies(respostaLimiteExcedido(janelaEmail));
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

  if (error) {
    // Sem esta distinção, quem ainda não clicou no link de confirmação recebe
    // "senha inválida" e fica tentando redefinir uma senha que está certa.
    if (error.code === "email_not_confirmed") {
      await registrarEvento(supabase, "login_falha", { email, ip, detalhe: "email_nao_confirmado" });
      return applySetCookies(
        Response.json(
          {
            error: "Confirme seu e-mail antes de entrar. Veja o link que enviamos para sua caixa de entrada.",
            emailNaoConfirmado: true,
          },
          { status: 401 },
        ),
      );
    }

    // `detalhe` é um rótulo fixo nosso, nunca a mensagem do Supabase: ela
    // pode carregar dados da tentativa, e log não é lugar para isso.
    await registrarEvento(supabase, "login_falha", { email, ip, detalhe: "credencial_invalida" });
    return applySetCookies(Response.json({ error: "E-mail ou senha inválidos." }, { status: 401 }));
  }

  await registrarEvento(supabase, "login_ok", { email, ip });
  return applySetCookies(Response.json({ ok: true }));
}
