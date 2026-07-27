# Múltiplos responsáveis + calendário por pessoa — design

## Problema

Hoje `tarefas.responsavel_id` e `modelos_recorrencia.responsavel_id` são uma
FK única pra `perfis`. Duas coisas pedidas:

1. Um funcionário, ao abrir o Calendário, deveria ver por padrão só as
   tarefas em que ele é um dos responsáveis — sem ser uma restrição de
   verdade (ele pode trocar o filtro "Responsável" já existente pra ver
   outra pessoa ou "Todos" se precisar). O `responsavel` do escritório
   continua abrindo em "Todos" por padrão.
2. Na hora de escolher quem fica responsável por uma tarefa avulsa ou por um
   modelo de recorrência, deveria ser possível escolher **várias** pessoas,
   com um "+" pra ir adicionando.

`empresas.responsavel_id` ("Responsável interno" da empresa) é conceito
separado e **não muda** — continua único.

## Dados

Duas tabelas de ligação novas, substituindo as colunas `responsavel_id`
únicas (que são apagadas depois do backfill — sem deixar coluna morta):

```sql
create table public.tarefas_responsaveis (
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  perfil_id uuid not null references public.perfis(id),
  primary key (tarefa_id, perfil_id)
);

create table public.modelos_recorrencia_responsaveis (
  modelo_id uuid not null references public.modelos_recorrencia(id) on delete cascade,
  perfil_id uuid not null references public.perfis(id),
  primary key (modelo_id, perfil_id)
);

insert into public.tarefas_responsaveis (tarefa_id, perfil_id)
select id, responsavel_id from public.tarefas where responsavel_id is not null;

insert into public.modelos_recorrencia_responsaveis (modelo_id, perfil_id)
select id, responsavel_id from public.modelos_recorrencia where responsavel_id is not null;

alter table public.tarefas drop column responsavel_id;
alter table public.modelos_recorrencia drop column responsavel_id;
```

RLS: as duas tabelas novas ficam visíveis/edítáveis pra qualquer perfil do
mesmo escritório da tarefa/modelo (mesmo padrão de isolamento por
`escritorio_id` já usado nas outras tabelas — a policy verifica o
escritório através de um `exists` contra `tarefas`/`modelos_recorrencia`,
que já são isoladas por escritório).

## Geração de tarefas a partir de modelos (`lib/tarefas.ts`)

`gerarTarefasDoMes` hoje copia `modelo.responsavel_id` pra cada tarefa nova.
Passa a buscar a lista de `perfil_id`s do modelo
(`modelos_recorrencia_responsaveis`) e, depois de criar a tarefa, inserir a
mesma lista em `tarefas_responsaveis` pra ela.

## API

- `TAREFA_SELECT`/`MODELO_RECORRENCIA_SELECT` passam a fazer embed das
  tabelas de ligação: `responsaveis:tarefas_responsaveis(perfil:perfis(id,nome))`
  (idem pra modelo).
- `paraShapeFrontend` (tarefas e modelos) devolve `responsavelIds: string[]`
  e `responsaveis: string[]` (nomes) no lugar de `responsavelId`/`responsavel`
  únicos.
- `POST`/`PATCH` de `/api/tarefas` e `/api/modelos-recorrencia` recebem
  `responsavelIds?: string[]` no lugar do id único. No `PATCH`, a lista
  antiga de ligações é apagada e a nova é inserida por completo (mais simples
  e sempre consistente do que tentar diffar).
- `GET /api/tarefas?responsavel=` (filtro por nome, já existe) passa a casar
  se o nome estiver **em qualquer posição** da lista de responsáveis da
  tarefa, não mais numa igualdade única.

## Interface

**Seletor de responsáveis (tarefa avulsa e modelo de recorrência):** um
componente novo, reutilizado nos dois formulários — mostra cada responsável
já escolhido como uma "chip" com um "×" pra remover, e um botão "+" que abre
uma lista (reaproveitando `useAccessibleMenu` de `app/accessibility.tsx`,
mesmo padrão de teclado/foco dos outros menus do app) com os demais `perfis`
ativos do escritório ainda não adicionados. Escolher um da lista adiciona
como chip e fecha a lista.

**Filtro "Responsável" do calendário (já existe, sem mudança de
comportamento):** continua sendo o mesmo `<select>` com a lista de nomes +
"Todos", só passa a casar por "está na lista de responsáveis da tarefa" em
vez de igualdade única. A única mudança é o valor inicial: `funcionario`
abre com o próprio nome pré-selecionado (mas pode trocar livremente);
`responsavel` continua abrindo em "Todos".

**Exibição:** onde hoje aparece `t.responsavel` (nome único) — linha da
lista de tarefas e modal de detalhe — passa a mostrar os nomes unidos por
vírgula (`t.responsaveis.join(", ")`, ou "Sem responsável" se vazio).

## Fora de escopo

- `empresas.responsavel_id` continua único — não é tocado.
- Limite de quantidade de responsáveis por tarefa/modelo — não há limite
  imposto (YAGNI; se virar problema real, ajusta-se depois).
