-- Duplicidade é o único tipo de divergência com uma "outra empresa"
-- envolvida (o par considerado parecido). Até agora essa outra empresa só
-- existia como texto em `atual` ("Possível duplicidade com {razão social}"),
-- sem id — impossível de usar para uma ação de "excluir a duplicata" no
-- frontend. Esta coluna guarda o id da outra empresa do par.
-- `on delete set null` (não cascade): se a empresa relacionada for excluída,
-- a divergência em si (e seu histórico) continua existindo — só perde a
-- referência viva, não é apagada junto.
alter table public.divergencias
  add column empresa_relacionada_id uuid;

alter table public.divergencias
  add constraint divergencias_empresa_relacionada_id_empresas_id_fk
  foreign key (empresa_relacionada_id) references public.empresas(id) on delete set null;
