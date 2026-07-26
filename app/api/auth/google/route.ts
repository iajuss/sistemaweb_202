import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: new URL("/auth/callback", request.url).toString(),
      skipBrowserRedirect: true,
    },
  });

  const destino = error || !data?.url ? new URL("/login?google=erro", request.url).toString() : data.url;

  // Response.redirect() devolve headers imutáveis; applySetCookies precisa
  // anexar o cookie do code verifier (PKCE), sem o qual /auth/callback falha.
  return applySetCookies(new Response(null, { status: 302, headers: { Location: destino } }));
}
