# Calendário de intervalo para "repetir por um período" — design

## Problema

Hoje, um modelo de recorrência limitado no tempo salva `repeticoes_quantidade`
+ `repeticoes_unidade` (ex.: "2 meses"), e a data-fim é calculada a partir de
`criado_em` na leitura (`calcularVencimentosDoModelo`). A escolha no
formulário é um número + uma unidade — pouco visual. Também não existe hoje
nenhum limite **inferior**: um modelo gera tarefas retroativamente pra
qualquer mês, mesmo anteriores à criação dele.

## Dados

Substituir `repeticoes_quantidade`/`repeticoes_unidade` por duas colunas de
data em `modelos_recorrencia`:

- `repete_inicio date` — `null` = sem limite inferior (gera tarefas pra
  qualquer mês, comportamento idêntico ao de hoje).
- `repete_fim date` — `null` = sem limite superior (repete indefinidamente,
  comportamento idêntico ao "Sem data final" de hoje).

Os dois sempre juntos: ou os dois são `null` (repete sem limite, padrão), ou
os dois têm data (um intervalo de verdade). Nunca só um dos dois.

Migração `0018`: adiciona as colunas, faz backfill dos modelos existentes
(calcula `repete_inicio = criado_em::date` e `repete_fim` a partir da
quantidade/unidade antigas, replicando a mesma regra de corte que
`calcularDataFimRecorrencia` já usa hoje), depois derruba
`repeticoes_quantidade`/`repeticoes_unidade`.

`repete_inicio` pode ser uma data futura — isso é uma capacidade nova: adia
o começo da geração de tarefas do modelo, não existia antes.

## Geração de tarefas (`lib/tarefas.ts`)

`calcularVencimentosDoModelo` troca os parâmetros `repeticoesQuantidade`/
`repeticoesUnidade` por `repeteInicio: string | null` e
`repeteFim: string | null` (datas no formato `"YYYY-MM-DD"`). Em vez de
calcular uma data de corte a partir de `criadoEm` + duração
(`calcularDataFimRecorrencia`, que deixa de existir), filtra as datas já
calculadas por comparação direta: mantém `data` se (`repeteInicio` é `null`
ou `data >= repeteInicio`) **e** (`repeteFim` é `null` ou `data <=
repeteFim`).

`gerarTarefasDoMes` busca `repete_inicio`/`repete_fim` no lugar das colunas
antigas e repassa pros parâmetros novos da função acima.

## API (`lib/modelos-recorrencia.ts`, rotas)

- Nova validação `validarPeriodoRepeticao(inicio, fim)`: os dois `null` é
  válido (sem limite); se algum dos dois vier preenchido, o outro também
  precisa vir, ambos como datas `"YYYY-MM-DD"` válidas, e `fim >= inicio`.
  Substitui `validarRepeticoes`/`unidadesValidasParaPeriodicidade`/
  `UnidadeRepeticao`, que deixam de existir (não fazem mais sentido sem
  quantidade/unidade).
- `POST`/`PATCH` de `/api/modelos-recorrencia` trocam `repeticoesQuantidade`/
  `repeticoesUnidade` por `repeteInicio`/`repeteFim` no payload e na coluna.

## Interface

Componente novo, `RepeticaoRangePicker`, usado nos formulários "Novo modelo"
e "Editar modelo" (calendar-view.tsx), no lugar dos campos de
quantidade+unidade dentro da opção "Repetir por um período" do segmentado
que já existe (esse segmentado, "Sem data final" / "Repetir por um
período", não muda):

- Botão-gatilho: mostra "Selecionar período" (nada escolhido ainda) ou o
  intervalo já escolhido formatado (`"01/08/2026 – 23/09/2026"`).
- Ao clicar (ou automaticamente, ao entrar em "Repetir por um período" pela
  primeira vez, mesma conveniência que `iniciarRepeticaoLimitada` já dá
  hoje), abre um popover com **dois calendários mensais lado a lado**: o mês
  base e o seguinte, sempre consecutivos. Setas nas pontas externas (‹ à
  esquerda do primeiro calendário, › à direita do segundo) avançam/recuam os
  dois meses juntos.
- Clique nos dias: o primeiro clique define o início (marcado com um
  indicador cheio); o segundo define o fim (idem); se o segundo clique cair
  antes do início já escolhido, os dois se reordenam automaticamente. Com só
  o início escolhido, passar o mouse sobre os dias mostra uma prévia do
  intervalo (mesmo efeito visual do intervalo final, mas provisório).
- Todos os dias entre início e fim (incluindo os dois) recebem um fundo mais
  suave, derivado de `--primary` (a paleta do site — azul-petróleo — não a
  roxa do print de referência).
- Rodapé: **Apagar** (limpa a seleção em andamento, popover continua aberto)
  e **Aplicar** (confirma `repeteInicio`/`repeteFim` no draft do formulário e
  fecha o popover).
- Reaproveita o padrão de popover/backdrop de `ResponsavelPicker` (mesmo
  arquivo) para fechar ao clicar fora ou `Escape`.

## Fora de escopo

- Nenhuma mudança em `empresas`/`tarefas` avulsas — isso é específico de
  `modelos_recorrencia`.
- Não há validação de "início no passado" — um `repete_inicio` no passado é
  válido (só não teria efeito prático diferente de `null`, já que não há
  limite inferior implícito hoje além dele).
