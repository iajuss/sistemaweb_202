export type { MembroEquipe, Papel } from "@/lib/equipe";
import type { MembroEquipe } from "@/lib/equipe";

/** Situações oficiais conhecidas e valores futuros eventualmente devolvidos pela Receita. */
export type StatusEmpresa = "Ativa" | "Suspensa" | "Baixada" | "Inapta" | "Nula" | (string & {});
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

export type EmpresaRelacionada = {
  id: string;
  razaoSocial: string;
  cnpj: string;
  cidade: string;
  estado: string;
  status: string;
};

export type Divergencia = {
  id: string;
  empresaId: string;
  empresa: string;
  tipo: "CNPJ inválido" | "Duplicidade" | "Razão social" | "Endereço" | "Situação irregular" | "Dados ausentes";
  atual: string;
  sugerido?: string;
  status: "Pendente" | "Revisado" | "Ignorado";
  empresaRelacionada?: EmpresaRelacionada | null;
  detectadoEm: string;
  resolvidoEm: string | null;
};

export type Tarefa = {
  id: string;
  modeloId?: string | null;
  empresaId?: string;
  titulo: string;
  tipo: string;
  empresa: string;
  responsavelId?: string | null;
  responsavel: string;
  vencimento: string;
  status: "Pendente" | "Concluída" | "Atrasada" | "Cancelada";
  concluidoEm?: string | null;
  coincideComFeriado: { nome: string } | null;
};

export type Periodicidade = "diario" | "semanal" | "mensal" | "anual";

/** Unidade do "repetir por X" de um modelo de recorrência — ver `ModeloRecorrencia.repeticoesQuantidade`. */
export type UnidadeRepeticao = "dias" | "meses" | "anos";

export type ModeloRecorrencia = {
  id: string;
  empresaId: string | null;
  empresa: string;
  titulo: string;
  tipo: string;
  periodicidade: Periodicidade;
  diaReferencia: number;
  // Só relevante para periodicidade "semanal": um ou mais dias (1=segunda...7=domingo).
  diasSemana: number[] | null;
  // Só relevante para periodicidade "anual": mês do vencimento (1-12).
  mesReferencia: number | null;
  responsavelId?: string | null;
  responsavel: string;
  ativo: boolean;
  // Fim da recorrência por duração (ex.: repetir por 2 meses), a partir de
  // `criadoEm`. Os dois `null` juntos = repete sem data final.
  repeticoesQuantidade: number | null;
  repeticoesUnidade: UnidadeRepeticao | null;
  criadoEm?: string;
};

export type SocioPayload = { nome: string; papel: string };

/** "Nome" + "Papel" (do BrasilAPI/lib/empresas.ts) → "Nome (Papel)" para exibição. */
export function formatarSocio(socio: SocioPayload): string {
  return socio.papel && socio.papel.trim() !== "" ? `${socio.nome} (${socio.papel})` : socio.nome;
}

/** Inverso de `formatarSocio`, usado ao reenviar `Empresa.socios` (string[])
 * para o backend, que espera `{ nome, papel }[]` no corpo de POST/PATCH. */
export function paraSocioPayload(socioFormatado: string): SocioPayload {
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

/** DELETE /api/empresas/:id — remove a empresa (e, em cascata no banco,
 * sócios, divergências, tarefas e modelos de recorrência associados). */
export async function excluirEmpresa(id: string): Promise<void> {
  const response = await fetch(`/api/empresas/${id}`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível excluir a empresa."));
  }
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
  socios: SocioPayload[];
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

/** GET /api/equipe — lista a equipe do escritório (só o responsável enxerga). */
export async function listarEquipe(): Promise<MembroEquipe[]> {
  const response = await fetch("/api/equipe");
  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível carregar a equipe."));
  }
  return response.json();
}

/** POST /api/equipe/convites — convida um funcionário por e-mail (só o responsável). */
export async function convidarFuncionario(email: string): Promise<void> {
  const response = await fetch("/api/equipe/convites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível enviar o convite."));
  }
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

/** Mês atual no formato "YYYY-MM", usado como padrão de `listarTarefas` quando nenhum mês é passado. */
function mesAtualISO(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

/** GET /api/tarefas?mes=YYYY-MM&responsavel= — lista as tarefas do escritório da sessão autenticada no mês pedido (mês atual por padrão). */
export async function listarTarefas(mes?: string, responsavel?: string): Promise<Tarefa[]> {
  const params = new URLSearchParams({ mes: mes ?? mesAtualISO() });
  if (responsavel) {
    params.set("responsavel", responsavel);
  }

  const response = await fetch(`/api/tarefas?${params.toString()}`);
  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível carregar as tarefas."));
  }
  return response.json();
}

export type TarefaPayload = {
  titulo: string;
  tipo: string;
  empresaId: string;
  responsavelId?: string | null;
  vencimento: string;
};

/** POST /api/tarefas — cria uma tarefa avulsa (não vinculada a nenhum modelo de recorrência). */
export async function criarTarefa(tarefa: TarefaPayload): Promise<Tarefa> {
  const response = await fetch("/api/tarefas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tarefa),
  });

  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível criar a tarefa."));
  }

  return response.json();
}

export type TarefaPatch = Partial<{ status: "Pendente" | "Concluída"; vencimento: string }>;

/** PATCH /api/tarefas/:id — atualização parcial (ex.: marcar como concluída ou reagendar). */
export async function atualizarTarefa(id: string, patch: TarefaPatch): Promise<Tarefa> {
  const response = await fetch(`/api/tarefas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível atualizar a tarefa."));
  }

  return response.json();
}

/** GET /api/modelos-recorrencia — lista os modelos de recorrência (ativos e inativos) do escritório da sessão autenticada. */
export async function listarModelosRecorrencia(): Promise<ModeloRecorrencia[]> {
  const response = await fetch("/api/modelos-recorrencia");
  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível carregar os modelos de recorrência."));
  }
  return response.json();
}

export type ModeloRecorrenciaPayload = {
  titulo: string;
  tipo: string;
  periodicidade: Periodicidade;
  diaReferencia: number;
  diasSemana?: number[];
  mesReferencia?: number;
  empresaId?: string | null;
  responsavelId?: string | null;
  repeticoesQuantidade?: number | null;
  repeticoesUnidade?: UnidadeRepeticao | null;
};

/** POST /api/modelos-recorrencia — cria um modelo de recorrência (tarefas são geradas sob demanda ao abrir o calendário). */
export async function criarModeloRecorrencia(modelo: ModeloRecorrenciaPayload): Promise<ModeloRecorrencia> {
  const response = await fetch("/api/modelos-recorrencia", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(modelo),
  });

  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível criar o modelo de recorrência."));
  }

  return response.json();
}

export type ModeloRecorrenciaPatch = Partial<{
  titulo: string;
  tipo: string;
  periodicidade: Periodicidade;
  diaReferencia: number;
  diasSemana: number[];
  mesReferencia: number;
  empresaId: string | null;
  responsavelId: string | null;
  repeticoesQuantidade: number | null;
  repeticoesUnidade: UnidadeRepeticao | null;
  ativo: boolean;
}>;

/** PATCH /api/modelos-recorrencia/:id — atualização parcial (usada principalmente para desativar: `{ ativo: false }`). */
export async function atualizarModeloRecorrencia(id: string, patch: ModeloRecorrenciaPatch): Promise<ModeloRecorrencia> {
  const response = await fetch(`/api/modelos-recorrencia/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível atualizar o modelo de recorrência."));
  }

  return response.json();
}

/** DELETE /api/modelos-recorrencia/:id — exclui o modelo (tarefas já geradas por ele viram avulsas, não são apagadas). */
export async function excluirModeloRecorrencia(id: string): Promise<void> {
  const response = await fetch(`/api/modelos-recorrencia/${id}`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error(await extrairMensagemDeErro(response, "Não foi possível excluir o modelo de recorrência."));
  }
}
