import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { ipDoRequest } from "@/lib/rate-limit";
import { registrarEvento } from "@/lib/auditoria-seguranca";

export async function POST(request: Request) {
  let payload: { senhaAtual?: string; senha?: string };

  try {
    payload = (await request.json()) as { senha?: string };
  } catch {
    return Response.json({ error: "Informe a nova senha." }, { status: 400 });
  }

  const senhaAtual = payload.senhaAtual ?? "";
  const senha = payload.senha ?? "";
  if (!senhaAtual) {
    return Response.json({ error: "Informe a senha atual." }, { status: 400 });
  }
  if (senha.length < 8) {
    return Response.json({ error: "A senha deve ter ao menos 8 caracteres." }, { status: 400 });
  }

  const { supabase, applySetCookies } = await createSupabaseRouteHandlerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return applySetCookies(Response.json({ error: "Não foi possível confirmar a conta." }, { status: 401 }));

  // Reautentica a própria conta antes de alterar a credencial. A mensagem é
  // propositalmente genérica para não revelar detalhes sobre a autenticação.
  const { error: erroSenhaAtual } = await supabase.auth.signInWithPassword({ email: user.email, password: senhaAtual });
  if (erroSenhaAtual) {
    return applySetCookies(Response.json({ error: "A senha atual está incorreta." }, { status: 401 }));
  }

  const { error } = await supabase.auth.updateUser({ password: senha });

  if (error) {
    return applySetCookies(Response.json({ error: "Não foi possível atualizar a senha." }, { status: 400 }));
  }

  // Troca de senha é o passo que consolida a tomada de uma conta: se ela
  // aparecer no log sem um login legítimo antes, é o sinal mais claro de
  // sequestro que existe.
  await registrarEvento(supabase, "senha_alterada", { ip: ipDoRequest(request) });

  return applySetCookies(Response.json({ ok: true }));
}
