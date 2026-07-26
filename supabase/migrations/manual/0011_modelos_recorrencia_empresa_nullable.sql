-- Modelos de recorrência internos (reuniões/rotinas da própria equipe) não
-- têm empresa associada — mesmo racional de `0010_tarefas_empresa_nullable.sql`
-- para `tarefas`. Antes, `modelos_recorrencia.empresa_id` era NOT NULL, o que
-- só permitia modelos vinculados a uma empresa cliente ("externos").
--
-- As tarefas geradas a partir de um modelo interno (`gerarTarefasDoMes` em
-- lib/tarefas.ts) herdam `empresa_id = NULL` do modelo, o que já é suportado
-- por `tarefas` desde a migração 0010.
--
-- O FK `modelos_recorrencia_empresa_id_empresas_id_fk` continua válido:
-- linhas com empresa_id NULL simplesmente não são afetadas por nenhuma
-- cascata. A RLS de `modelos_recorrencia` isola por `escritorio_id` apenas.

ALTER TABLE "modelos_recorrencia" ALTER COLUMN "empresa_id" DROP NOT NULL;
