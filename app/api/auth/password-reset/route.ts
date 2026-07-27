import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { LIMITES_AUTH, consumirRateLimit, ipDoRequest, respostaLimiteExcedido } from "@/lib/rate-limit";

export async function POST(request: Request) {
  let payload: { email?: string };

  try {
    payload = (await request.json()) as { email?: string };
  } catch {
    return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
  }

  const email = payload.email?.trim();
  if (!email) {
    return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
  }

  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();

  // Duas chaves: por IP (impede um script de disparar milhares de e-mails) e
  // por destinatário (impede usar o app para inundar a caixa de uma pessoa
  // específica, mesmo trocando de IP a cada envio).
  const [limiteIp, janelaIp] = LIMITES_AUTH.emailIp;
  if (await consumirRateLimit(supabase, "reset-ip", ipDoRequest(request), limiteIp, janelaIp)) {
    return applySetCookies(respostaLimiteExcedido(janelaIp));
  }

  const [limiteDestino, janelaDestino] = LIMITES_AUTH.emailDestino;
  if (await consumirRateLimit(supabase, "reset-destino", email, limiteDestino, janelaDestino)) {
    // Mesma resposta genérica do caminho normal: um 429 aqui revelaria que
    // este e-mail existe e está sendo alvo, quebrando a proteção contra
    // enumeração que a mensagem abaixo garante.
    return applySetCookies(
      Response.json({ message: "Se este e-mail estiver cadastrado, você receberá um link para redefinir a senha." }),
    );
  }

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL("/auth/callback?next=/redefinir-senha", request.url).toString(),
  });

  return applySetCookies(Response.json({ message: "Se este e-mail estiver cadastrado, você receberá um link para redefinir a senha." }));
}
