import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

// O link padrão do Supabase usa ?code=, que só funciona no mesmo navegador que
// iniciou o cadastro (o code verifier do PKCE fica em cookie). Com token_hash o
// usuário pode confirmar pelo celular. Requer o template "Confirm signup"
// apontando para /auth/confirm?token_hash={{ .TokenHash }}&type=email
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const redirecionar = (destino: string, response = new Response(null, { status: 302 })) => {
    response.headers.set("Location", new URL(destino, url.origin).toString());
    return response;
  };

  if (!tokenHash || !type) {
    return redirecionar("/login?confirmacao=erro");
  }

  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  return applySetCookies(redirecionar(error ? "/login?confirmacao=erro" : "/"));
}
