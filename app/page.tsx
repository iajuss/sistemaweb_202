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

  const { data: perfil } = await supabase.from("perfis").select("nome").eq("id", user.id).single();

  return <HomeClient userName={perfil?.nome ?? user.email ?? "Usuário"} />;
}
