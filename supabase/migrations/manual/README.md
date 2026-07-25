# Migrações manuais

Este diretório guarda SQL escrito à mão — políticas de RLS, triggers e qualquer coisa que
toque `auth.*` — que o `drizzle-kit` não é capaz de gerar a partir do schema Drizzle.

- Os arquivos aqui são aplicados manualmente via Supabase SQL Editor, em ordem de nome de
  arquivo, sempre depois de todas as migrações geradas pelo drizzle-kit (`supabase/migrations/*.sql`)
  que existirem no momento em que forem escritos.
- `npm run db:generate` (drizzle-kit) nunca toca neste diretório e não sabe que estes
  arquivos existem — isso é intencional, não um bug. O journal do drizzle
  (`supabase/migrations/meta/_journal.json`) não referencia estes arquivos.
