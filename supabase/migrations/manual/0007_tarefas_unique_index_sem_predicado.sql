-- Corrige 0006_tarefas_unique_modelo_vencimento.sql (já aplicada ao vivo):
-- o índice único parcial criado lá (`where modelo_id is not null`) nunca
-- pode ser inferido por um `ON CONFLICT (modelo_id, vencimento)` baseado
-- só em lista de colunas — o Postgres só casa um conflict target de
-- lista-de-colunas com índices únicos SEM predicado; casar um índice
-- parcial exigiria repetir o predicado no próprio `ON CONFLICT` (algo como
-- `ON CONFLICT (modelo_id, vencimento) WHERE modelo_id IS NOT NULL`), o que
-- a opção `onConflict` (string de colunas) do supabase-js não consegue
-- expressar. Resultado: com só a 0006 aplicada, o `upsert(...,
-- { onConflict: "modelo_id,vencimento" })` de `gerarTarefasDoMes`
-- (lib/tarefas.ts) sempre falha com 42P10 ("no unique or exclusion
-- constraint matching the ON CONFLICT specification"), mesmo com o índice
-- existindo — nunca entra no caminho atômico de no-op, só no fallback de
-- insert comum.
--
-- O predicado parcial nunca foi necessário: o Postgres trata valores NULL
-- como distintos entre si em índices únicos por padrão, então um índice
-- único SEM predicado em (modelo_id, vencimento) já permite qualquer
-- quantidade de tarefas avulsas (modelo_id null) compartilhando o mesmo
-- vencimento — exatamente o mesmo comportamento pretendido pelo predicado
-- `where modelo_id is not null`, só que de um jeito que o `ON CONFLICT`
-- baseado em lista de colunas consegue casar.
--
-- Não edito 0006 (já aplicada ao vivo) — esta é uma migração corretiva
-- nova, mesma convenção usada em 0003 (correção de 0002 já aplicada).
drop index if exists public.tarefas_modelo_vencimento_unique;

create unique index tarefas_modelo_vencimento_unique
  on public.tarefas (modelo_id, vencimento);
