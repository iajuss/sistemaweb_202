/**
 * Complementos ao serviço de tarefas em `portfolio.ts`, mantidos aqui para não
 * reabrir aquele arquivo: edição completa de uma tarefa (título, natureza
 * Interna/Externa, empresa e responsável) e exclusão. Ambos batem nos mesmos
 * endpoints `/api/tarefas/:id` (PATCH e DELETE).
 */
import type { Tarefa } from "./portfolio";

async function extrairMensagemDeErro(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

export type TarefaEditPatch = Partial<{
  titulo: string;
  tipo: string;
  /** `null` ou `""` → tarefa interna (sem empresa). */
  empresaId: string | null;
  responsavelId: string | null;
  status: "Pendente" | "Concluída" | "Cancelada";
  vencimento: string;
}>;

/** PATCH /api/tarefas/:id — edição de campos da tarefa (título/natureza/empresa/responsável/vencimento). */
export async function editarTarefa(id: string, patch: TarefaEditPatch): Promise<Tarefa> {
  const response = await fetch(`/api/tarefas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível atualizar a tarefa."));
  }

  return response.json();
}

/** DELETE /api/tarefas/:id — remove a tarefa. */
export async function excluirTarefa(id: string): Promise<void> {
  const response = await fetch(`/api/tarefas/${id}`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível excluir a tarefa."));
  }
}
