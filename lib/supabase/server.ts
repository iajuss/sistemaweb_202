import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serialize } from "cookie";

/**
 * Flags do cookie de sessão.
 *
 * O padrão do @supabase/ssr é `httpOnly: false` (ver
 * node_modules/@supabase/ssr/dist/main/utils/constants.js) e sem `secure`.
 * Isso deixa o access token E o refresh token legíveis por qualquer
 * JavaScript da página: um único XSS vira sequestro de sessão duradouro, e o
 * próprio usuário logado consegue extrair o token do `document.cookie` para
 * falar direto com o PostgREST do Supabase, pulando toda checagem de papel
 * que mora nas rotas de API (o nome do cookie, `sb-<ref>-auth-token`, já
 * entrega qual é o projeto).
 *
 * Nenhum código de cliente deste app lê cookie de sessão — todo acesso ao
 * Supabase é feito no servidor —, então `httpOnly` não quebra nada.
 *
 * `secure` fica de fora em desenvolvimento porque o dev server é http://.
 */
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
} as const;

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookieOptions: COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Chamado a partir de um Server Component (render de página);
          // rotas de API e Server Actions são onde o cookie de sessão é
          // efetivamente gravado.
        }
      },
    },
  });
}

/**
 * Variante para Route Handlers (signup/login/logout). Em vez de gravar via
 * `cookies().set()` e depender da anexação automática de Set-Cookie do
 * vinext, os cookies pendentes são coletados aqui e anexados explicitamente
 * à Response com `applySetCookies` — determinístico e fácil de auditar,
 * sem depender de mecanismo implícito do framework para algo tão sensível
 * quanto o cookie de sessão.
 */
export async function createSupabaseRouteHandlerClient() {
  const cookieStore = await cookies();
  const pendingCookies: { name: string; value: string; options?: CookieOptions }[] = [];

  const supabase = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookieOptions: COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        pendingCookies.push(...cookiesToSet);
      },
    },
  });

  return {
    supabase,
    applySetCookies(response: Response) {
      for (const { name, value, options } of pendingCookies) {
        response.headers.append("Set-Cookie", serialize(name, value, options));
      }
      return response;
    },
  };
}
