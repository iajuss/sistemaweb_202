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

  // Mesmo racional do password-reset: por IP contra disparo em massa, por
  // destinatário contra inundar a caixa de uma pessoa específica.
  const [limiteIp, janelaIp] = LIMITES_AUTH.emailIp;
  if (await consumirRateLimit(supabase, "resend-ip", ipDoRequest(request), limiteIp, janelaIp)) {
    return applySetCookies(respostaLimiteExcedido(janelaIp));
  }

  const [limiteDestino, janelaDestino] = LIMITES_AUTH.emailDestino;
  if (await consumirRateLimit(supabase, "resend-destino", email, limiteDestino, janelaDestino)) {
    // Resposta genérica, igual à do caminho normal — um 429 aqui revelaria
    // que este e-mail existe e está aguardando confirmação.
    return applySetCookies(
      Response.json({ message: "Se este e-mail estiver aguardando confirmação, o link foi reenviado." }),
    );
  }

  await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: new URL("/auth/confirm", request.url).toString() },
  });

  return applySetCookies(
    Response.json({ message: "Se este e-mail estiver aguardando confirmação, o link foi reenviado." }),
  );
}
