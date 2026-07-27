# Controle de Carteira

Frontend white label para escritórios de contabilidade acompanharem a carteira de empresas, regularidade cadastral e obrigações recorrentes. Esta é uma versão de interface navegável: os dados são simulados e não há persistência ou chamadas de rede reais.

## Recursos

- Visão geral com indicadores, próximos vencimentos e atalhos.
- Onboarding de empresas por CNPJ, incluindo máscara, estados de consulta e edição de dados complementares.
- Auditoria de cadastros com filtros e ações locais de correção, revisão ou ignorar divergências.
- Análise da carteira com filtros, gráficos de estado, porte, CNAE, situação cadastral e tempo de abertura.
- Calendário contábil em visualização mensal ou lista, com filtro por responsável, tarefas e alertas de feriado.
- Tema white label: as variáveis em `app/globals.css` centralizam cores, bordas, fundo e raios de arredondamento.
- Interface responsiva, com menu lateral colapsável em telas menores e foco visível nos controles.

## Stack

- React 19 + TypeScript
- Vinext / Vite
- Tailwind CSS
- Recharts

## Executar localmente

Pré-requisito: Node.js 22 ou superior.

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000). Para gerar a versão de produção, use:

```bash
npm run build
npm test
```

## Estrutura

```text
app/
  page.tsx                 # telas, navegação e interações locais
  globals.css              # tema, componentes visuais e responsividade
  layout.tsx               # metadados e imagem de compartilhamento
src/services/
  portfolio.ts             # contratos assíncronos, mocks e pontos de integração
public/
  og.png                   # imagem de compartilhamento social
tests/
  rendered-html.test.mjs   # teste básico de renderização do worker
```

## Dados e integração com o backend

Os dados de empresas, divergências, tarefas e feriados estão em `src/services/portfolio.ts`. O arquivo mantém as assinaturas assíncronas que devem ser preservadas quando a API real estiver disponível:

- `listarEmpresas()` → lista de empresas da carteira.
- `consultarCNPJ(cnpj)` → consulta de dados cadastrais; ponto indicado para BrasilAPI ou endpoint interno.
- `listarDivergencias()` → ocorrências detectadas pela auditoria.
- `listarTarefas()` → tarefas e obrigações contábeis.

Troque somente as implementações mockadas desses serviços por chamadas ao backend do grupo. A interface consome os retornos através dessa camada, evitando refatoração das telas. Para persistir ações, acrescente serviços de criação/edição e substitua as atualizações de estado locais pelos respectivos `POST`, `PATCH` ou `DELETE`.

## Backend / Supabase

Para aplicar o schema em um projeto Supabase novo, execute, nesta ordem, via SQL Editor:

1. `supabase/migrations/*.sql` — migrações geradas pelo drizzle-kit, em ordem numérica.
2. `supabase/migrations/manual/*.sql` — SQL escrito à mão (políticas de RLS, triggers), em
   ordem de nome de arquivo, sempre depois das migrações do passo 1. Veja
   `supabase/migrations/manual/README.md` para detalhes.

### Autenticação

O app aceita **e-mail + senha** (com confirmação obrigatória por e-mail) e **login com Google**.
No painel do Supabase é preciso configurar:

- **Authentication → Sign In / Providers → Email**: "Confirm email" **MARCADO**.
- **Authentication → Emails → template "Confirm signup"**: o link deve apontar para
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`. O formato padrão
  (`?code=`) só funciona no mesmo navegador que iniciou o cadastro, por causa do PKCE.
- **Authentication → Sign In / Providers → Google**: habilitado, com Client ID e Client
  Secret criados no Google Cloud Console (tipo "Aplicativo da Web"). Lá, o URI de
  redirecionamento autorizado é `https://<seu-projeto>.supabase.co/auth/v1/callback`.
- **Authentication → URL Configuration**: *Site URL* e *Redirect URLs* com o endereço onde
  o app roda (ex.: `http://localhost:3000` e `http://localhost:3000/**`).

Contas criadas pelo Google não informam o nome do escritório, então nascem com
`perfis.cadastro_completo = false` e são levadas a `/completar-cadastro` no primeiro acesso.

O SMTP embutido do Supabase tem limite baixo de envios; para produção, configure um SMTP
próprio em **Authentication → Emails → SMTP Settings**.

### Segurança

Controles em vigor e onde eles moram:

- **Isolamento por escritório**: RLS em todas as tabelas, usando `perfis.escritorio_id` como
  fonte de verdade (`manual/0001`). O trigger `perfis_lock_escritorio_id` impede trocar de
  tenant, e — desde `manual/0019` — congela também `papel`, `email` e o próprio `ativo`, o
  que permitiria a um funcionário se promover a responsável direto no PostgREST.
- **Cookie de sessão**: `HttpOnly`, `SameSite=Lax` e `Secure` em produção
  (`lib/supabase/server.ts`). O padrão do `@supabase/ssr` é `httpOnly: false`, que deixaria
  o token legível por JavaScript.
- **Rate limit** de login, cadastro, reset e reenvio de senha e convites, por IP e por
  identidade (`lib/rate-limit.ts` + `manual/0020`). O contador fica no Postgres porque o app
  roda em Workers, onde memória de processo não é compartilhada entre requisições.
- **Trilha de auditoria** de login (ok/falha/bloqueado), troca de senha, convite e
  ativação/desativação de funcionário, em `eventos_seguranca`
  (`lib/auditoria-seguranca.ts` + `manual/0021`). A tabela não tem policy de escrita: só a
  função `registrar_evento_seguranca` grava, então ninguém forja nem apaga o próprio rastro.
- **Validação de tamanho** em todo campo de texto que o usuário escreve (`lib/validacao.ts`)
  e **limite de 512 KB por requisição** no worker — nenhuma coluna do schema tem limite
  próprio.
- **Headers de segurança** aplicados no worker, para todas as rotas
  (`lib/headers-seguranca.ts` + `worker/index.ts`).

Ao publicar em produção, mantenha *Redirect URLs* (Authentication → URL Configuration) com
os endereços exatos do app — é essa lista que impede que um `Host` forjado desvie o link de
confirmação de e-mail para um domínio de terceiros.

#### Manutenção periódica

Agende em **Database → Cron**, uma vez por dia:

```sql
select public.limpar_rate_limit_antigo();
select public.limpar_eventos_seguranca(180);
```

#### Como ler a trilha de auditoria

Ainda não há tela para isso — consulte pelo **SQL Editor** do Supabase:

```sql
-- Tentativas de login que falharam nas últimas 24h, das mais insistentes para as menos
select email, ip, count(*) as tentativas, max(criado_em) as ultima
from public.eventos_seguranca
where tipo in ('login_falha', 'login_bloqueado') and criado_em > now() - interval '24 hours'
group by email, ip
order by tentativas desc;
```

Um `senha_alterada` sem um `login_ok` do mesmo IP logo antes é o sinal mais claro de conta
tomada. A policy de leitura já existe (responsável enxerga o próprio escritório), então uma
tela futura em Configurações não precisa de mudança no banco.

#### Backup

O backup é o automático do Supabase (**Database → Backups**) — o app não tem rotina própria.
Confira no seu plano qual é a retenção e se há PITR; no plano gratuito são snapshots diários
com retenção curta e **sem** restauração para um instante específico. Antes de qualquer
migração que apague ou reescreva dados, tire um snapshot manual pelo painel.

## Observações

- O CNPJ, os cadastros e as tarefas desta versão são fictícios.
- A consulta de CNPJ e a lista de feriados são apenas simuladas; nenhuma informação é enviada para serviços externos.
- O projeto não inclui autenticação, banco de dados ou regras fiscais de produção.
