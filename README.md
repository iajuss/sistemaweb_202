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

## Observações

- O CNPJ, os cadastros e as tarefas desta versão são fictícios.
- A consulta de CNPJ e a lista de feriados são apenas simuladas; nenhuma informação é enviada para serviços externos.
- O projeto não inclui autenticação, banco de dados ou regras fiscais de produção.
