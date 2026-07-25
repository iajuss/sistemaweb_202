import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DIVERGENCIA_SELECT, paraShapeFrontend, type DivergenciaRow } from "@/lib/divergencias";

// GET /api/auditoria/divergencias — lista as divergências do escritório da
// sessão (RLS filtra por escritorio_id), com embed de `empresas(razao_social)`
// para exibir o nome da empresa sem uma segunda consulta.
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("divergencias")
    .select(DIVERGENCIA_SELECT)
    .order("detectado_em", { ascending: false });

  if (error) {
    return Response.json({ error: "Não foi possível carregar as divergências." }, { status: 500 });
  }

  return Response.json((data as unknown as DivergenciaRow[]).map(paraShapeFrontend));
}
