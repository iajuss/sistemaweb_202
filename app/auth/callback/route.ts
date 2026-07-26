import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") === "/redefinir-senha" ? "/redefinir-senha" : "/";

  // Response.redirect() devolve headers imutáveis neste runtime (Workers) — não dá
  // para anexar o Set-Cookie da sessão depois. Por isso montamos a Response à mão,
  // igual ao padrão já usado em /api/auth/google.
  const redirecionar = (destino: string) =>
    new Response(null, { status: 302, headers: { Location: new URL(destino, url.origin).toString() } });

  if (!code) {
    return redirecionar("/login");
  }

  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return applySetCookies(redirecionar("/login?recuperacao=erro"));
  }

  return applySetCookies(redirecionar(next));
}
