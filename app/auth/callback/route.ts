import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") === "/redefinir-senha" ? "/redefinir-senha" : "/";

  if (!code) {
    return Response.redirect(new URL("/login", url.origin), 302);
  }

  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return applySetCookies(Response.redirect(new URL("/login?recuperacao=erro", url.origin), 302));
  }

  return applySetCookies(Response.redirect(new URL(next, url.origin), 302));
}
