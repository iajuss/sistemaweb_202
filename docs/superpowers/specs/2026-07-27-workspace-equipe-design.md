# Workspace multiusuário (equipe) — design

## Problema

Hoje, todo cadastro (`POST /api/auth/signup`) cria um `escritorio` novo via o
trigger `handle_new_user()`. Não existe forma de duas pessoas trabalharem no
mesmo espaço: cada login é sempre dono do seu próprio escritório isolado, e
não há convite, papéis, nem gestão de equipe. `responsavel_id` em
`empresas`/`tarefas`/`modelos_recorrencia` já aponta pra `perfis`, então uma
vez que existam múltiplos perfis num mesmo escritório, tudo mais (seletores
de responsável, atribuição de tarefas) já funciona sem mudança — o único gap
é como um segundo perfil passa a existir dentro do escritório de outra
pessoa.

## Modelo de papéis

- `perfis.papel`: `'responsavel'` | `'funcionario'`.
- Quem faz o cadastro normal (`POST /api/auth/signup` ou primeiro login via
  Google) sempre vira `'responsavel'` do escritório que cria — comportamento
  atual, inalterado.
- `'responsavel'` é quem convida, lista e desativa integrantes, na aba
  Configurações → Equipe. Não existe promoção a `'responsavel'` nem
  transferência de posse — fora de escopo (YAGNI; se necessário no futuro, é
  outra spec).
- `'funcionario'` tem acesso igual a `'responsavel'` em todo o resto do
  sistema (empresas, tarefas, auditoria, calendário) — a única coisa que não
  vê é a aba Equipe.

## Fluxo de convite

1. `responsavel` digita um e-mail na aba Equipe → `POST /api/equipe/convites`.
2. A rota valida que quem chama é `responsavel` (403 caso contrário), que o
   e-mail não pertence a ninguém já no mesmo escritório, e chama
   `supabase.auth.admin.inviteUserByEmail(email, { data: { escritorio_id } })`
   através de um client administrativo novo (`lib/supabase/admin.ts`, usa
   `SUPABASE_SERVICE_ROLE_KEY` — variável server-only nova, nunca exposta ao
   navegador).
3. O Supabase envia o e-mail usando o template **"Invite user"** (diferente
   do "Confirm signup" já configurado) — precisa apontar para
   `/auth/confirm?token_hash={{ .TokenHash }}&type=invite`, mesma rota que já
   trata `type=email` hoje. É um passo manual no dashboard do Supabase
   (mesma mecânica de SMTP/template já feita antes), não código.
4. `handle_new_user()` (trigger em `auth.users`) passa a checar
   `new.raw_user_meta_data ->> 'escritorio_id'`:
   - presente (veio de convite) → não cria escritório novo; insere o perfil
     nesse `escritorio_id`, com `papel='funcionario'`, `cadastro_completo=false`,
     `email=new.email`, `ativo=true`, `nome=''` (preenchido depois).
   - ausente (cadastro normal, comportamento atual) → cria escritório novo,
     `papel='responsavel'`, mesma lógica de `cadastro_completo` de hoje.
5. Usuário clica no link do e-mail → `/auth/confirm` faz `verifyOtp({ type:
   "invite", token_hash })`, cria sessão, redireciona pra `/`.
6. `page.tsx` já redireciona pra `/completar-cadastro` quando
   `cadastro_completo=false` — sem mudança aí.

## Onboarding do convidado (`/completar-cadastro`)

A página e a rota `POST /api/auth/completar-cadastro` ganham um branch pelo
`papel` do perfil (buscado no carregamento da página/rota):

- `papel='responsavel'` (fluxo atual, ex.: Google OAuth): formulário atual,
  sem mudança — pede nome do escritório + nome da pessoa.
- `papel='funcionario'` (veio de convite): formulário mostra só "Seu nome",
  "Senha" e "Confirmar senha" — sem campo de escritório (ele está entrando
  num espaço que já existe e já tem nome). A rota, nesse branch, não faz
  `update` em `escritorios`; atualiza `perfis.nome` e chama
  `supabase.auth.updateUser({ password })` (mesma chamada que
  `/api/auth/password` já faz hoje), então marca `cadastro_completo=true`.

## Gestão de equipe (Configurações → Equipe)

Visível só quando `papel === 'responsavel'` (prop nova `papel` passada de
`page.tsx` → `HomeClient` → `Settings`, mesmo padrão de `userName`/`userEmail`
hoje).

- `GET /api/equipe` — lista `{ id, nome, email, papel, ativo, criadoEm }` de
  todo mundo no escritório da sessão, ordenado por `criadoEm`. Reusa a RLS
  `perfis_select_escritorio` já existente (só precisa expor a coluna `email`
  nova no select).
- `POST /api/equipe/convites` — descrito acima.
- `PATCH /api/equipe/:id` body `{ ativo: boolean }` — só `responsavel`, só
  sobre um `perfil` com `papel='funcionario'` no mesmo escritório (nunca
  sobre si mesmo/outro `responsavel`, já que só existe um por escritório).
  Efeitos:
  - `ativo=false`: marca a coluna e bane o login de verdade via
    `supabase.auth.admin.updateUserById(id, { ban_duration: "876000h" })`
    (padrão documentado do Supabase pra "banimento permanente").
  - `ativo=true`: reverte (`ban_duration: "none"`) e volta `ativo=true`.
  - Histórico intacto: `perfis` nunca é apagado, então `responsavel_id` em
    tarefas/empresas antigas continua resolvendo o nome normalmente.

Seletores de "Responsável" (cadastro/edição de empresa, criação de
tarefa/modelo) passam a filtrar só `perfis` com `ativo=true` — pessoa
desativada não aparece como opção nova, mas continua aparecendo em registros
onde já era a responsável.

## Dados (migração `0015_perfis_equipe.sql`)

```sql
alter table public.perfis
  add column if not exists email text not null default '',
  add column if not exists papel text not null default 'responsavel'
    check (papel in ('responsavel','funcionario')),
  add column if not exists ativo boolean not null default true;

-- Backfill do email para perfis já existentes (novos cadastros o trigger já preenche).
update public.perfis p
set email = u.email
from auth.users u
where p.id = u.id and p.email = '';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  escritorio_convite uuid;
  novo_escritorio_id uuid;
begin
  escritorio_convite := (new.raw_user_meta_data ->> 'escritorio_id')::uuid;

  if escritorio_convite is not null then
    insert into public.perfis (id, escritorio_id, nome, email, papel, cadastro_completo)
    values (new.id, escritorio_convite, '', new.email, 'funcionario', false);
  else
    insert into public.escritorios (nome)
    values (coalesce(new.raw_user_meta_data ->> 'escritorio_nome', 'Meu escritório'))
    returning id into novo_escritorio_id;

    insert into public.perfis (id, escritorio_id, nome, email, papel, cadastro_completo)
    values (
      new.id,
      novo_escritorio_id,
      coalesce(new.raw_user_meta_data ->> 'nome', new.email),
      new.email,
      'responsavel',
      new.raw_user_meta_data ? 'escritorio_nome'
    );
  end if;

  return new;
end;
$$;

create or replace function public.sou_responsavel()
returns boolean
language sql security definer stable set search_path = public
as $$
  select papel = 'responsavel' from public.perfis where id = auth.uid()
$$;

create policy "perfis_update_equipe_responsavel" on public.perfis
  for update using (
    escritorio_id = public.meu_escritorio_id() and public.sou_responsavel()
  ) with check (
    escritorio_id = public.meu_escritorio_id()
  );
```

`meu_escritorio_id()` e o padrão `security definer` já existem desde a
correção de recursão em `0003` — reaproveitados aqui, sem risco de repetir
aquele bug.

A policy de update é ampla (`for update using ... with check ...` sem trava
de coluna); a rota `PATCH /api/equipe/:id` é quem garante, na aplicação, que
só o campo `ativo` é alterado e nunca sobre si mesmo/outro responsável — não
há necessidade de um trigger de banco adicional pra travar coluna, já que a
única rota que faz esse update é a nossa.

## Fora de escopo

- Múltiplos `responsavel` / promoção de papel.
- Permissões granulares por funcionário (tudo-ou-nada além da aba Equipe).
- Reenvio de convite expirado (Supabase mantém o link válido por um período
  padrão; se expirar, o `responsavel` convida de novo com o mesmo e-mail —
  suficiente para o volume esperado).

## Passos manuais (fora de código)

1. Rodar a migração `0015_perfis_equipe.sql` no SQL Editor do Supabase.
2. Configurar o template de e-mail **"Invite user"** no Supabase (mesmo
   processo já feito para "Confirm signup"), apontando para
   `/auth/confirm?token_hash={{ .TokenHash }}&type=invite`.
3. Pegar a `service_role key` em Project Settings → API e adicionar como
   `SUPABASE_SERVICE_ROLE_KEY` no `.env.local` (e nas variáveis de ambiente
   de produção, se houver deploy).
