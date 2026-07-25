-- Índice único parcial para permitir upsert com ignoreDuplicates em
-- gerarTarefasDoMes (lib/tarefas.ts) — sem isso, duas chamadas concorrentes
-- de GET /api/tarefas para o mesmo mês podem ambas passar pelo
-- select-then-insert de dedupe antes de qualquer uma inserir, gerando
-- tarefas duplicadas para o mesmo modelo_id + vencimento.
--
-- Parcial (where modelo_id is not null) porque tarefas avulsas (modelo_id
-- null) não devem ser restringidas por essa unicidade — várias tarefas
-- avulsas sem modelo podem legitimamente ter o mesmo vencimento.
create unique index tarefas_modelo_vencimento_unique
  on public.tarefas (modelo_id, vencimento)
  where modelo_id is not null;
