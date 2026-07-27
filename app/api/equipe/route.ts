import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MembroEquipe } from "@/lib/equipe";

type PerfilRow = {
  id: string;
  nome: string;
  email: string;
  papel: "responsavel" | "funcionario";
  ativo: boolean;
  criado_em: string;
};

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { data: perfil } = await supabase.from("perfis").select("papel").eq("id", user.id).single();

  if (!perfil || perfil.papel !== "responsavel") {
    return Response.json({ error: "Só o responsável pelo escritório pode ver a equipe." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("perfis")
    .select("id, nome, email, papel, ativo, criado_em")
    .order("criado_em", { ascending: true });

  if (error) {
    return Response.json({ error: "Não foi possível carregar a equipe." }, { status: 500 });
  }

  const equipe: MembroEquipe[] = (data as unknown as PerfilRow[]).map((row) => ({
    id: row.id,
    nome: row.nome,
    email: row.email,
    papel: row.papel,
    ativo: row.ativo,
    criadoEm: row.criado_em,
  }));

  return Response.json(equipe);
}
