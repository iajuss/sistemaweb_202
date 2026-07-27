import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HomeClient } from "./home-client";

export default async function Page() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: perfil } = await supabase
    .from("perfis")
    .select("nome, cadastro_completo, papel")
    .eq("id", user.id)
    .single();

  if (perfil && !perfil.cadastro_completo) {
    redirect("/completar-cadastro");
  }

  const nomeDoUsuario = perfil?.nome ?? user.user_metadata?.nome ?? "Usuário";
  const papel = perfil?.papel ?? "responsavel";

  return <HomeClient userName={nomeDoUsuario} userEmail={user.email ?? ""} papel={papel} />;
}
