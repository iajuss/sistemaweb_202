-- Rate limit das rotas de autenticação (ver lib/rate-limit.ts).
--
-- Por que no banco: o app roda em Cloudflare Workers, onde cada requisição
-- pode cair num isolate diferente e efêmero — um contador em memória
-- praticamente nunca veria a segunda tentativa. O contador precisa ser
-- compartilhado, e o Postgres já está aqui.
--
-- A tabela guarda um balde por (chave, janela). `chave` é opaca e vem da
-- aplicação: "login:<ip>", "login:<email>", "signup:<ip>", "email:<destino>".

create table if not exists public.rate_limit_tentativas (
  chave text primary key,
  janela_inicio timestamptz not null default now(),
  contador integer not null default 0
);

-- RLS ligada e NENHUMA policy: nem `anon` nem `authenticated` conseguem ler
-- ou escrever direto. O único caminho é a função abaixo, que é
-- `security definer` e roda com os privilégios do dono da tabela. Sem isso,
-- quem estivesse sendo limitado poderia simplesmente apagar o próprio balde.
alter table public.rate_limit_tentativas enable row level security;

-- Consome uma unidade do balde. Retorna true = pode seguir, false = estourou.
--
-- Incremento e decisão numa única instrução (o upsert já devolve o contador
-- novo): ler e depois gravar deixaria uma janela de corrida em que N
-- requisições simultâneas leem "0 tentativas" e passam todas.
--
-- Janela fixa (não deslizante): quando `now()` passa de `janela_inicio +
-- janela`, o balde reinicia. É o suficiente para barrar força bruta e
-- credential stuffing; o custo é que no instante da virada cabem até 2x o
-- limite. Trocar por janela deslizante só se isso virar problema real.
create or replace function public.consumir_rate_limit(
  p_chave text,
  p_limite integer,
  p_janela_segundos integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  contador_atual integer;
begin
  insert into public.rate_limit_tentativas as r (chave, janela_inicio, contador)
  values (p_chave, now(), 1)
  on conflict (chave) do update
    set
      janela_inicio = case
        when r.janela_inicio < now() - make_interval(secs => p_janela_segundos) then now()
        else r.janela_inicio
      end,
      contador = case
        when r.janela_inicio < now() - make_interval(secs => p_janela_segundos) then 1
        else r.contador + 1
      end
  returning r.contador into contador_atual;

  return contador_atual <= p_limite;
end;
$$;

-- Precisa ser chamável por quem ainda NÃO está autenticado (login, cadastro,
-- reset de senha) — é justamente aí que o limite importa.
grant execute on function public.consumir_rate_limit(text, integer, integer) to anon, authenticated;

-- Limpeza dos baldes vencidos. A tabela é naturalmente pequena (uma linha por
-- IP/e-mail ativo), mas sem isso ela cresce para sempre. Chame pelo painel do
-- Supabase (Database > Cron) uma vez por dia, ou manualmente:
--   select public.limpar_rate_limit_antigo();
create or replace function public.limpar_rate_limit_antigo()
returns integer
language sql
security definer
set search_path = public
as $$
  with removidos as (
    delete from public.rate_limit_tentativas
    where janela_inicio < now() - interval '1 day'
    returning 1
  )
  select count(*)::integer from removidos;
$$;
