import { createClient } from "@supabase/supabase-js";

/**
 * Client com a service_role key — ignora RLS. Só pode ser usado em Route
 * Handlers (server-only), pra ações que exigem a Admin API (convidar
 * usuário, banir login). Nunca importar isto em código que roda no
 * navegador.
 */
export function createSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada. Veja o Project Settings > API no Supabase.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
