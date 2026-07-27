export type Papel = "responsavel" | "funcionario";

export type MembroEquipe = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  criadoEm: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validação de formato só — não confirma que a caixa existe (isso é papel do Supabase ao enviar o convite). */
export function validarEmailConvite(email: unknown): string | null {
  const valor = typeof email === "string" ? email.trim() : "";
  if (!valor) return "Informe o e-mail do funcionário.";
  if (!EMAIL_REGEX.test(valor)) return "Informe um e-mail válido.";
  return null;
}
