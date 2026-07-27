import { garantirFeriadosDoAno } from "@/lib/feriados";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado." }, { status: 401 });

  const ano = Number(new URL(request.url).searchParams.get("ano"));
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    return Response.json({ error: "Informe um ano válido." }, { status: 400 });
  }
  return Response.json(await garantirFeriadosDoAno(supabase, ano));
}
