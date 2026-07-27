-- Trilha de auditoria dos eventos sensíveis (ver lib/auditoria-seguranca.ts).
--
-- Sem ela não há como responder "alguém tentou invadir?" depois do fato: o
-- banco guarda o estado atual, nunca a sequência de tentativas que levou até
-- ele. Um ataque de força bruta que fracassou não deixava rastro nenhum.

create table if not exists public.eventos_seguranca (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  -- E-mail envolvido no evento. Nulo quando não se aplica.
  email text,
  ip text,
  -- Nulo em eventos anteriores à identificação do usuário (ex.: login que
  -- falhou com um e-mail que não existe em nenhum escritório).
  escritorio_id uuid references public.escritorios (id) on delete cascade,
  -- Rótulo curto e FIXO, escrito pela aplicação. Nunca texto do usuário.
  detalhe text,
  criado_em timestamptz not null default now()
);

create index if not exists eventos_seguranca_escritorio_data
  on public.eventos_seguranca (escritorio_id, criado_em desc);

alter table public.eventos_seguranca enable row level security;

-- Leitura: só o responsável, e só do próprio escritório. Reaproveita as
-- funções security-definer de 0003/0015 (o mesmo motivo de lá: consultar
-- `perfis` dentro de uma policy exige quebrar o ciclo de recursão).
create policy "eventos_seguranca_select_responsavel" on public.eventos_seguranca
  for select using (
    escritorio_id = public.meu_escritorio_id() and public.sou_responsavel()
  );

-- Escrita: NENHUMA policy, de propósito. O único caminho é a função abaixo.
-- Se houvesse policy de insert, quem estivesse sendo auditado poderia forjar
-- eventos; se houvesse de delete, poderia apagar o próprio rastro.

-- Lista fechada de tipos: sem isso a tabela aceita qualquer string e vira
-- depósito de lixo para quem chamar o RPC direto.
create or replace function public.registrar_evento_seguranca(
  p_tipo text,
  p_email text default null,
  p_ip text default null,
  p_detalhe text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  escritorio_do_evento uuid;
begin
  if p_tipo not in (
    'login_ok', 'login_falha', 'login_bloqueado', 'senha_alterada',
    'convite_enviado', 'funcionario_ativado', 'funcionario_desativado'
  ) then
    return;
  end if;

  -- A função é chamável por `anon` (o login que falha ainda não tem sessão),
  -- então ela precisa do próprio limite: sem isto, um script chama o RPC
  -- direto e enche a tabela. 200/hora por IP fica muito acima do uso real.
  if not public.consumir_rate_limit('evento:' || coalesce(p_ip, 'sem-ip'), 200, 3600) then
    return;
  end if;

  -- Com sessão, o escritório é o de quem chamou. Sem sessão (login que
  -- falhou), resolve pelo e-mail — é o que faz o evento aparecer no log do
  -- escritório certo, que é justamente quem precisa enxergar a tentativa.
  if auth.uid() is not null then
    escritorio_do_evento := public.meu_escritorio_id();
  elsif p_email is not null then
    select escritorio_id into escritorio_do_evento
    from public.perfis where email = lower(p_email) limit 1;
  end if;

  insert into public.eventos_seguranca (tipo, email, ip, escritorio_id, detalhe)
  values (
    p_tipo,
    left(p_email, 255),
    left(p_ip, 45),
    escritorio_do_evento,
    left(p_detalhe, 200)
  );
end;
$$;

grant execute on function public.registrar_evento_seguranca(text, text, text, text) to anon, authenticated;

-- Retenção. Chame junto de `limpar_rate_limit_antigo()` no mesmo cron diário.
create or replace function public.limpar_eventos_seguranca(p_dias integer default 180)
returns integer
language sql
security definer
set search_path = public
as $$
  with removidos as (
    delete from public.eventos_seguranca
    where criado_em < now() - make_interval(days => p_dias)
    returning 1
  )
  select count(*)::integer from removidos;
$$;
