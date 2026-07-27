import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/perfis — lista { id, nome } de todos os perfis do escritório da
// sessão, para o seletor de responsável no cadastro/edição de empresas.
//
// Depende da policy "perfis_select_escritorio" (migração manual
// supabase/migrations/manual/0002_perfis_escritorio_select.sql), já que a
// policy "perfis_select_own" existente só permite ler o próprio perfil.
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("perfis")
    .select("id, nome")
    .eq("ativo", true)
    .order("nome", { ascending: true });

  if (error) {
    return Response.json({ error: "Não foi possível carregar os perfis." }, { status: 500 });
  }

  return Response.json(data);
}
