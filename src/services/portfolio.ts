export type StatusEmpresa = "Ativa" | "Suspensa" | "Baixada";
export type Porte = "MEI" | "Microempresa" | "Pequena empresa" | "Médio porte";

export type Empresa = {
  id: string;
  cnpj: string;
  razaoSocial: string;
  fantasia: string;
  cidade: string;
  estado: string;
  endereco: string;
  cnae: string;
  cnaeCodigo: string;
  porte: Porte;
  status: StatusEmpresa;
  abertura: string | null;
  responsavelId?: string | null;
  responsavel: string;
  socios: string[];
  tags: string[];
  observacoes?: string;
  criadoEm?: string;
  atualizadoEm?: string;
};

export type Divergencia = {
  id: string;
  empresaId: string;
  empresa: string;
  tipo: "CNPJ inválido" | "Duplicidade" | "Razão social" | "Endereço" | "Situação irregular" | "Dados ausentes";
  atual: string;
  sugerido?: string;
  status: "Pendente" | "Revisado" | "Ignorado";
};

export type Tarefa = {
  id: number;
  titulo: string;
  tipo: string;
  empresa: string;
  responsavel: string;
  vencimento: string;
  status: "Pendente" | "Concluída" | "Atrasada";
};

const estados = ["SP", "MG", "PR", "SC", "RJ", "RS", "BA", "GO", "PE", "CE"];
const cidades = ["São Paulo", "Belo Horizonte", "Curitiba", "Florianópolis", "Rio de Janeiro", "Porto Alegre", "Salvador", "Goiânia", "Recife", "Fortaleza"];
const nomes = [
  ["Horizonte", "Comércio de alimentos", "4712-1/00"], ["Núcleo", "Serviços de tecnologia", "6204-0/00"],
  ["Ponto Certo", "Transporte rodoviário", "4930-2/02"], ["Viva", "Atividades de saúde", "8630-5/03"],
  ["Estação", "Construção de edifícios", "4120-4/00"], ["Raiz", "Restaurantes e similares", "5611-2/01"],
  ["Crescer", "Educação profissional", "8599-6/04"], ["Prisma", "Comércio varejista", "4781-4/00"],
  ["Ciclo", "Consultoria empresarial", "7020-4/00"], ["Aurora", "Atividades imobiliárias", "6810-2/01"],
  ["Pilar", "Serviços administrativos", "8211-3/00"], ["Verde", "Cultivo de frutas", "0155-5/01"],
];
const sufixos = ["Distribuidora Ltda.", "Soluções Ltda.", "Logística Ltda.", "Clínica Integrada Ltda.", "Engenharia Ltda.", "Bistrô Ltda."];
const responsaveis = ["Mariana Costa", "Lucas Ferreira", "Ana Ribeiro", "Rafael Alves", "Beatriz Lima"];

// Mock ainda usado como base para os dados de `tarefas` abaixo (Calendário —
// escopo de plano futuro, não tocado por esta task). `id`/`abertura` são
// strings aqui só para bater com o shape real de `Empresa` (ver decisão de
// shape no plano de Onboarding); nenhum consumidor atual desses mocks lê
// `id`/`abertura` diretamente.
export const empresas: Empresa[] = Array.from({ length: 38 }, (_, index) => {
  const i = index + 1;
  const nome = nomes[index % nomes.length];
  const estadoIndex = index % estados.length;
  const porte: Porte[] = ["Microempresa", "Pequena empresa", "Médio porte", "MEI"];
  const status: StatusEmpresa[] = ["Ativa", "Ativa", "Ativa", "Ativa", "Suspensa", "Baixada"];
  return {
    id: String(i),
    cnpj: i === 17 ? "12.345.678/0001-0X" : ` ${String(10 + i).padStart(2, "0")}.482.${String(100 + i).padStart(3, "0")}/0001-${String((i * 7) % 99).padStart(2, "0")}`.trim(),
    razaoSocial: `${nome[0]} ${sufixos[index % sufixos.length]}`,
    fantasia: `${nome[0]} ${index % 3 === 0 ? "& Co." : ""}`.trim(),
    cidade: cidades[estadoIndex],
    estado: estados[estadoIndex],
    endereco: i === 23 ? "" : `Av. ${["Brasil", "Central", "das Nações", "Paulista"][index % 4]}, ${120 + i * 11}`,
    cnae: nome[1],
    cnaeCodigo: nome[2],
    porte: porte[index % porte.length],
    status: status[index % status.length],
    abertura: `${2004 + ((index * 3) % 21)}-01-15`,
    responsavel: responsaveis[index % responsaveis.length],
    socios: [`${["João", "Carla", "Pedro", "Fernanda"][index % 4]} ${["Silva", "Oliveira", "Santos", "Mendes"][index % 4]}`, "Sócio administrador"],
    tags: index % 2 ? ["Mensal", "Simples Nacional"] : ["Prioridade", "Lucro Presumido"],
  };
});

export const tarefas: Tarefa[] = [
  { id: 1, titulo: "Fechamento da folha", tipo: "Folha", empresa: empresas[0].fantasia, responsavel: "Mariana Costa", vencimento: "2026-07-24", status: "Atrasada" },
  { id: 2, titulo: "Emitir guia DAS", tipo: "Fiscal", empresa: empresas[1].fantasia, responsavel: "Lucas Ferreira", vencimento: "2026-07-27", status: "Pendente" },
  { id: 3, titulo: "Conferência mensal", tipo: "Contábil", empresa: empresas[2].fantasia, responsavel: "Ana Ribeiro", vencimento: "2026-07-29", status: "Pendente" },
  { id: 4, titulo: "Enviar documentos", tipo: "Documentação", empresa: empresas[3].fantasia, responsavel: "Rafael Alves", vencimento: "2026-08-07", status: "Pendente" },
  { id: 5, titulo: "Apuração de impostos", tipo: "Fiscal", empresa: empresas[4].fantasia, responsavel: "Beatriz Lima", vencimento: "2026-08-15", status: "Pendente" },
  { id: 6, titulo: "Revisão de balancete", tipo: "Contábil", empresa: empresas[5].fantasia, responsavel: "Mariana Costa", vencimento: "2026-08-20", status: "Pendente" },
  { id: 7, titulo: "Conferir obrigações", tipo: "Fiscal", empresa: empresas[6].fantasia, responsavel: "Lucas Ferreira", vencimento: "2026-09-07", status: "Pendente" },
  { id: 8, titulo: "Fechamento da folha", tipo: "Folha", empresa: empresas[7].fantasia, responsavel: "Ana Ribeiro", vencimento: "2026-09-20", status: "Concluída" },
];

const pause = <T,>(data: T) => new Promise<T>((resolve) => setTimeout(() => resolve(data), 350));

type SocioPayload = { nome: string; papel: string };

/** "Nome" + "Papel" (do BrasilAPI/lib/empresas.ts) → "Nome (Papel)" para exibição. */
function formatarSocio(socio: SocioPayload): string {
  return socio.papel && socio.papel.trim() !== "" ? `${socio.nome} (${socio.papel})` : socio.nome;
}

/** Inverso de `formatarSocio`, usado ao reenviar `Empresa.socios` (string[])
 * para o backend, que espera `{ nome, papel }[]` no corpo de POST/PATCH. */
function paraSocioPayload(socioFormatado: string): SocioPayload {
  const match = socioFormatado.match(/^(.*) \(([^()]*)\)$/);
  if (match) {
    return { nome: match[1], papel: match[2] };
  }
  return { nome: socioFormatado, papel: "" };
}

async function extrairMensagemDeErro(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/** GET /api/empresas — lista as empresas do escritório da sessão autenticada. */
export async function listarEmpresas(): Promise<Empresa[]> {
  const response = await fetch("/api/empresas");
  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível carregar as empresas."));
  }
  return response.json();
}

/** POST /api/empresas/consultar-cnpj — consulta (sem persistir) via BrasilAPI. */
export async function consultarCNPJ(cnpj: string): Promise<Empresa> {
  const response = await fetch("/api/empresas/consultar-cnpj", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cnpj }),
  });

  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível consultar o CNPJ."));
  }

  const body = await response.json();

  // O endpoint devolve o shape "cru" da BrasilAPI (cnaeDescricao,
  // situacaoCadastral, socios como { nome, papel }[]) — aqui traduzimos para
  // o shape de `Empresa` usado pelo restante da tela (cnae, status, socios
  // como string[]). `id` ainda não existe (empresa não persistida).
  return {
    id: "",
    cnpj: body.cnpj,
    razaoSocial: body.razaoSocial,
    fantasia: body.fantasia,
    cidade: body.cidade,
    estado: body.estado,
    endereco: body.endereco,
    cnaeCodigo: body.cnaeCodigo,
    cnae: body.cnaeDescricao,
    porte: body.porte,
    status: body.situacaoCadastral,
    abertura: body.abertura,
    responsavelId: null,
    responsavel: "",
    socios: ((body.socios ?? []) as SocioPayload[]).map(formatarSocio),
    tags: [],
    observacoes: "",
  };
}

/** POST /api/empresas — persiste a empresa consultada/editada na carteira. */
export async function salvarEmpresa(empresa: Empresa): Promise<Empresa> {
  const payload = {
    cnpj: empresa.cnpj,
    razaoSocial: empresa.razaoSocial,
    fantasia: empresa.fantasia,
    cidade: empresa.cidade,
    estado: empresa.estado,
    endereco: empresa.endereco,
    cnaeCodigo: empresa.cnaeCodigo,
    cnaeDescricao: empresa.cnae,
    porte: empresa.porte,
    situacaoCadastral: empresa.status,
    abertura: empresa.abertura,
    socios: empresa.socios.map(paraSocioPayload),
    responsavelId: empresa.responsavelId ?? null,
    observacoes: empresa.observacoes ?? "",
    tags: empresa.tags ?? [],
  };

  const response = await fetch("/api/empresas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível salvar a empresa."));
  }

  return response.json();
}

export type EmpresaPatch = Partial<{
  cnpj: string;
  razaoSocial: string;
  fantasia: string;
  cidade: string;
  estado: string;
  endereco: string;
  cnaeCodigo: string;
  cnaeDescricao: string;
  porte: string;
  situacaoCadastral: string;
  abertura: string | null;
  responsavelId: string | null;
  observacoes: string;
  tags: string[];
}>;

/** PATCH /api/empresas/:id — atualização parcial (campos no shape do servidor). */
export async function atualizarEmpresa(id: string, patch: EmpresaPatch): Promise<Empresa> {
  const response = await fetch(`/api/empresas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível atualizar a empresa."));
  }

  return response.json();
}

/** GET /api/perfis — lista { id, nome } dos perfis do escritório, para o seletor de responsável. */
export async function listarPerfis(): Promise<{ id: string; nome: string }[]> {
  const response = await fetch("/api/perfis");
  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível carregar os perfis."));
  }
  return response.json();
}

/** GET /api/auditoria/divergencias — lista as divergências do escritório da sessão autenticada. */
export async function listarDivergencias(): Promise<Divergencia[]> {
  const response = await fetch("/api/auditoria/divergencias");
  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível carregar as divergências."));
  }
  return response.json();
}

/** PATCH /api/auditoria/divergencias/:id — aplica uma ação de tratamento sobre a divergência. */
export async function tratarDivergencia(
  id: string,
  acao: "revisar" | "ignorar" | "aplicar_sugestao",
): Promise<Divergencia> {
  const response = await fetch(`/api/auditoria/divergencias/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao }),
  });

  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível atualizar a divergência."));
  }

  return response.json();
}

/** `puladas`: divergências Pendentes preservadas por falta de avaliação nesta
 * execução (falha isolada de BrasilAPI/RPC de duplicidade, ou execução
 * interna-only) — opcional para não quebrar chamadores que ainda não leem
 * este campo (ver `app/api/auditoria/executar/route.ts`). */
export type ResumoAuditoria = { detectadas: number; resolvidas: number; puladas?: number };

/** POST /api/auditoria/executar — roda o motor de regras (interno sempre, externo/BrasilAPI quando `incluirRegrasExternas`) e sincroniza `divergencias`. */
export async function executarAuditoria(incluirRegrasExternas: boolean): Promise<ResumoAuditoria> {
  const response = await fetch("/api/auditoria/executar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incluirRegrasExternas }),
  });

  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível revalidar a carteira."));
  }

  return response.json();
}

/** Ponto de integração: trocar pelo GET /tarefas e POST /tarefas (plano futuro). */
export const listarTarefas = () => pause(tarefas);
/** Ponto de integração: BrasilAPI /api/feriados/v1/{ano}. */
export const feriadosNacionais = ["2026-01-01", "2026-04-03", "2026-04-21", "2026-05-01", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-12-25"];
