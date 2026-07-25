# Backend do Controle de Carteira — Design

Data: 2026-07-25

## Contexto

O frontend ("Controle de Carteira") já existe e roda 100% com dados mockados em
`src/services/portfolio.ts`. O objetivo deste projeto é implantar o backend que
substitui esses mocks, cobrindo as quatro funcionalidades solicitadas pelo
cliente:

1. Onboarding de empresas (consulta de CNPJ)
2. Auditoria de clientes (detecção de divergências cadastrais)
3. Análise da carteira (dashboard e filtros)
4. Calendário contábil (tarefas recorrentes, feriados)

O produto é um AI-Enabled Rollup de escritórios de contabilidade: o sistema
atende **múltiplos escritórios (tenants)**, cada um com sua própria carteira
de empresas isolada dos demais.

## Decisões de arquitetura

| Decisão | Escolha | Motivo |
|---|---|---|
| Multi-tenant | Sim, desde o início | Retrofit depois é caro (reescreve toda query + auth) |
| Fonte de dados de CNPJ | BrasilAPI | Gratuita, sem chave, já referenciada nos comentários do mock |
| Modelo de acesso | Webapp independente com login próprio | Time optou por não depender do login nativo do ChatGPT presente no scaffold |
| Método de login | E-mail + senha | Suficiente para o escopo atual, sem custo extra |
| Provisionamento de escritório | Cadastro aberto (self-service) | Time optou por permitir que o próprio escritório se cadastre |
| Perfis de acesso | Um nível único por enquanto | Extensível depois via coluna `role`, sem redesenho de schema |
| Tarefas recorrentes | Geração automática a partir de modelos | Maior valor pro escritório; mais simples que parece (tabela de modelo + rotina) |
| Banco de dados | Supabase (Postgres) | Auth pronta (menos código de segurança escrito à mão) + Row-Level Security como isolamento de tenant reforçado no próprio banco, além do filtro na aplicação |
| Hospedagem da aplicação | Cloudflare Workers (mantém o scaffold `vinext` existente) | Gratuito inclusive para uso comercial (diferente do plano Hobby da Vercel, que é para uso não-comercial); migrar para Next.js/Vercel seria retrabalho de framework, não só de hospedagem |
| Acesso a dados/auth em runtime | `@supabase/supabase-js` + `@supabase/ssr` (via HTTP/PostgREST) | Funciona nativamente no runtime do Workers (sem TCP); RLS é aplicado automaticamente usando o JWT da sessão do usuário |
| Drizzle ORM | Mantido só para definir o schema e gerar migrações (`drizzle-kit`), dialect trocado de `sqlite` para `postgres` | Reaproveita o padrão já usado no repo para versionar o schema |

## Modelo de dados (Postgres / Supabase)

**Tenant e usuários**
- `escritorios`: `id`, `nome`, `criado_em`
- `perfis`: 1:1 com `auth.users` (mesmo `id`), `escritorio_id`, `nome`. Elo entre sessão autenticada e tenant; usado pelas policies de RLS.

**Onboarding / carteira**
- `empresas`: `id`, `escritorio_id`, `cnpj`, `razao_social`, `fantasia`, `cidade`, `estado`, `endereco`, `cnae_codigo`, `cnae_descricao`, `porte`, `situacao_cadastral`, `abertura`, `responsavel_id` (→ `perfis`), `tags` (array nativo do Postgres), `observacoes`, `criado_em`, `atualizado_em`
- `empresas_socios`: `id`, `empresa_id`, `nome`, `papel`

**Auditoria**
- `divergencias`: `id`, `escritorio_id`, `empresa_id`, `tipo`, `atual`, `sugerido`, `status` (`pendente`/`revisado`/`ignorado`), `detectado_em`, `resolvido_em`

**Calendário**
- `modelos_recorrencia`: `id`, `escritorio_id`, `titulo`, `tipo`, `periodicidade` (`mensal`/`semanal`/`anual`), `dia_referencia`, `responsavel_id`, `ativo`
- `tarefas`: `id`, `escritorio_id`, `modelo_id` (nulo se avulsa), `empresa_id`, `titulo`, `tipo`, `responsavel_id`, `vencimento`, `status` (`pendente`/`concluída` — **"atrasada" é calculado em runtime**, comparando `vencimento` com a data atual, nunca persistido)
- `feriados_cache`: `data`, `nome`, `ano` — global (não por escritório), cache da BrasilAPI

**Isolamento (RLS)**: toda tabela com `escritorio_id` recebe uma policy:
`escritorio_id = (select escritorio_id from perfis where id = auth.uid())`
para `select`/`insert`/`update`/`delete`.

## Autenticação e fluxo por módulo

**Cadastro/login**
- Signup: nome do escritório + nome do usuário + e-mail + senha → cria o usuário no Supabase Auth e, na mesma operação, as linhas em `escritorios` e `perfis`. O primeiro usuário de um escritório é o dono dele.
- Login: `supabase.auth.signInWithPassword`, sessão em cookie via `@supabase/ssr`.
- Toda rota resolve `escritorio_id` via `perfis` a partir da sessão; RLS é a rede de segurança caso algum filtro seja esquecido na aplicação.

**1. Onboarding**
- `POST /api/empresas/consultar-cnpj`: valida dígito verificador do CNPJ, faz proxy server-side para a BrasilAPI (`/api/cnpj/v1/{cnpj}`), normaliza a resposta. Não persiste.
- `POST /api/empresas`: salva a empresa (dados da consulta + edição complementar do usuário).
- `GET /api/empresas`, `PATCH /api/empresas/:id`: listagem e edição.

**2. Auditoria**
- `POST /api/auditoria/executar`: roda o motor de regras (CNPJ inválido, duplicidade via `pg_trgm` para razão social similar, situação cadastral irregular, endereço/dados ausentes) sobre as empresas do escritório e grava em `divergencias`. Disparado automaticamente após salvar/editar uma empresa, e manualmente via botão "revalidar carteira".
- `GET /api/auditoria/divergencias`, `PATCH /api/auditoria/divergencias/:id` (marcar revisado/ignorado ou aplicar sugestão, atualizando a empresa).

**3. Análise da carteira**
- `GET /api/empresas/resumo`: agregações (`GROUP BY` estado, porte, CNAE, situação, tempo de abertura) calculadas no banco, não no cliente.
- `GET /api/empresas` com filtros/busca para a tabela detalhada.

**4. Calendário**
- `GET /api/tarefas?mes=&responsavel=`, `POST`/`PATCH /api/tarefas` para tarefas avulsas.
- `POST`/`GET`/`PATCH /api/modelos-recorrencia` para o CRUD dos moldes de recorrência.
- Rotina de geração: ao abrir o calendário (ou via job), garante que as tarefas do mês corrente existam para cada modelo ativo, populando `feriados_cache` sob demanda a partir da BrasilAPI e empurrando o vencimento para o próximo dia útil quando cair em feriado.

## Tratamento de erros

- Consulta de CNPJ: 404 (não encontrado), 429 da BrasilAPI (rate limit, com backoff leve e mensagem clara), dígito verificador inválido barrado antes da chamada externa.
- Auth: 401 sem sessão válida; 403 explícito quando RLS bloquear acesso a recurso de outro escritório (evita confundir "sem dado" com "sem permissão").
- Escritas (`POST`/`PATCH`): validação de payload no servidor antes de tocar no banco.

## Testes

- Unitários: motor de regras da Auditoria (lista de empresas → divergências esperadas), geração de tarefas recorrentes (modelo + mês + feriados → datas corretas), validação de dígito verificador de CNPJ — lógica de negócio pura, testável sem banco.
- Mantém o teste de integração existente (`tests/rendered-html.test.mjs`) e adiciona ao menos um teste ponta a ponta por módulo batendo em uma rota real.

## Fora de escopo (v1)

- Perfis de acesso diferenciados (admin vs. colaborador) — schema já comporta via coluna `role` futura.
- Upload/armazenamento de arquivos (R2 fica reservado, não usado nesta fase).
- Geração de tarefas via Cloudflare Cron Trigger — geração é sob demanda (ao abrir o calendário) nesta fase; migrar para cron não exige mudança de schema.
