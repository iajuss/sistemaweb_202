/**
 * Trilha de auditoria dos eventos sensíveis (login, troca de senha, convite,
 * ativação/desativação de funcionário).
 *
 * Sem isto não há como responder "alguém tentou invadir?" depois do fato: o
 * app registra o estado atual, nunca a sequência de tentativas que levou até
 * ele. Os eventos vão para `public.eventos_seguranca` (migração
 * manual/0021), gravados por uma função `security definer` — a tabela não
 * tem policy de INSERT, então nem o usuário logado nem o anônimo conseguem
 * forjar ou apagar linhas.
 *
 * O que NUNCA entra aqui: senha, token, hash, cookie. `detalhe` é um rótulo
 * curto e fixo escrito por nós (ex.: "credencial_invalida"), nunca conteúdo
 * vindo do usuário.
 */

type SupabaseComRpc = {
  rpc: (nome: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type TipoEvento =
  | "login_ok"
  | "login_falha"
  | "login_bloqueado"
  | "senha_alterada"
  | "convite_enviado"
  | "funcionario_ativado"
  | "funcionario_desativado";

type DadosEvento = {
  /** E-mail envolvido, quando o evento tem um. Normalizado antes de gravar. */
  email?: string | null;
  ip?: string | null;
  /** Rótulo curto e fixo, escrito por nós — nunca texto do usuário. */
  detalhe?: string | null;
};

/**
 * Registra um evento. Nunca lança e nunca rejeita: falha de auditoria não
 * pode derrubar um login que, de resto, deu certo. Um erro aqui vira log de
 * servidor, que é onde o problema precisa aparecer.
 *
 * Não use `await` no caminho crítico se a latência importar — mas as rotas de
 * auth deste app já fazem várias idas ao banco, então esperar é mais simples
 * do que orquestrar `waitUntil`.
 */
export async function registrarEvento(
  supabase: SupabaseComRpc,
  tipo: TipoEvento,
  dados: DadosEvento = {},
): Promise<void> {
  try {
    const { error } = await supabase.rpc("registrar_evento_seguranca", {
      p_tipo: tipo,
      // Normalizado para o mesmo usuário não virar duas entradas distintas
      // no log só por causa de caixa ou espaço.
      p_email: dados.email?.trim().toLowerCase() ?? null,
      p_ip: dados.ip ?? null,
      p_detalhe: dados.detalhe ?? null,
    });

    if (error) {
      console.error(`Auditoria: não foi possível registrar "${tipo}":`, error);
    }
  } catch (err) {
    console.error(`Auditoria: falha inesperada ao registrar "${tipo}":`, err);
  }
}
