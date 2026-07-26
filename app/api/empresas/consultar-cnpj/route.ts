import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validarCNPJ } from "@/lib/cnpj";
import { BrasilAPIError } from "@/lib/brasilapi";
import { consultarCNPJComCache } from "@/lib/cnpj-cache";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Não autenticado." }, { status: 401 });
  }

  let payload: { cnpj?: string };
  try {
    payload = (await request.json()) as { cnpj?: string };
  } catch {
    return Response.json({ error: "CNPJ inválido." }, { status: 400 });
  }

  const cnpj = payload.cnpj ?? "";

  if (!validarCNPJ(cnpj)) {
    return Response.json({ error: "CNPJ inválido." }, { status: 400 });
  }

  try {
    const empresa = await consultarCNPJComCache(supabase, cnpj);
    return Response.json(empresa, { status: 200 });
  } catch (err) {
    if (err instanceof BrasilAPIError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
