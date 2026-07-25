import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serialize } from "cookie";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
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
