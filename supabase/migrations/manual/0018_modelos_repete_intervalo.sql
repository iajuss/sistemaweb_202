-- Troca quantidade+unidade de repetição por datas de início/fim reais.
-- Ver docs/superpowers/specs/2026-07-27-repeticao-calendario-design.md.

alter table public.modelos_recorrencia
  add column if not exists repete_inicio date,
  add column if not exists repete_fim date;

-- Backfill: replica a mesma regra de corte que calcularDataFimRecorrencia
-- já usava (fim exclusivo vira repete_fim = fim - 1 dia, inclusive).
update public.modelos_recorrencia
set repete_inicio = criado_em::date,
    repete_fim = (
      criado_em::date
      + case repeticoes_unidade
          when 'dias' then (repeticoes_quantidade || ' days')::interval
          when 'meses' then (repeticoes_quantidade || ' months')::interval
          when 'anos' then (repeticoes_quantidade || ' years')::interval
        end
      - interval '1 day'
    )::date
where repeticoes_quantidade is not null and repeticoes_unidade is not null;

alter table public.modelos_recorrencia
  drop column repeticoes_quantidade,
  drop column repeticoes_unidade;
