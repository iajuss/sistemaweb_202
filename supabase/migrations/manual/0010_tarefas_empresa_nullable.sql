-- Tarefas internas (reuniões da própria equipe) não têm empresa associada.
-- Antes, `tarefas.empresa_id` era NOT NULL, o que só permitia tarefas
-- vinculadas a uma empresa cliente ("externas"). Ao permitir NULL, uma tarefa
-- interna passa a ser representada por `empresa_id IS NULL`, e a natureza
-- (Interna/Externa) é guardada em `tarefas.tipo`.
--
-- O FK `tarefas_empresa_id_empresas_id_fk` (ON DELETE cascade) continua válido:
-- linhas com empresa_id NULL simplesmente não são afetadas pela cascata.
-- A RLS de `tarefas` isola por `escritorio_id` apenas, então empresa_id NULL
-- não afeta o isolamento por tenant.

ALTER TABLE "tarefas" ALTER COLUMN "empresa_id" DROP NOT NULL;
