export type StatusEmpresa = "Ativa" | "Suspensa" | "Baixada";
export type Porte = "MEI" | "Microempresa" | "Pequena empresa" | "Médio porte";

export type Empresa = {
  id: number;
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
  abertura: number;
  responsavel: string;
  socios: string[];
  tags: string[];
  observacoes?: string;
};

export type Divergencia = {
  id: number;
  empresaId: number;
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

export const empresas: Empresa[] = Array.from({ length: 38 }, (_, index) => {
  const i = index + 1;
  const nome = nomes[index % nomes.length];
  const estadoIndex = index % estados.length;
  const porte: Porte[] = ["Microempresa", "Pequena empresa", "Médio porte", "MEI"];
  const status: StatusEmpresa[] = ["Ativa", "Ativa", "Ativa", "Ativa", "Suspensa", "Baixada"];
  return {
    id: i,
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
    abertura: 2004 + ((index * 3) % 21),
    responsavel: responsaveis[index % responsaveis.length],
    socios: [`${["João", "Carla", "Pedro", "Fernanda"][index % 4]} ${["Silva", "Oliveira", "Santos", "Mendes"][index % 4]}`, "Sócio administrador"],
    tags: index % 2 ? ["Mensal", "Simples Nacional"] : ["Prioridade", "Lucro Presumido"],
  };
});

export const divergencias: Divergencia[] = [
  { id: 1, empresaId: 17, empresa: empresas[16].razaoSocial, tipo: "CNPJ inválido", atual: empresas[16].cnpj, sugerido: "12.345.678/0001-09", status: "Pendente" },
  { id: 2, empresaId: 4, empresa: empresas[3].razaoSocial, tipo: "Duplicidade", atual: "Cadastro similar ao ID #28", sugerido: "Unificar cadastros", status: "Pendente" },
  { id: 3, empresaId: 8, empresa: empresas[7].razaoSocial, tipo: "Razão social", atual: "Prisma Comercio Ltda", sugerido: empresas[7].razaoSocial, status: "Revisado" },
  { id: 4, empresaId: 23, empresa: empresas[22].razaoSocial, tipo: "Dados ausentes", atual: "Endereço não informado", sugerido: "Solicitar comprovante", status: "Pendente" },
  { id: 5, empresaId: 5, empresa: empresas[4].razaoSocial, tipo: "Situação irregular", atual: "Suspensa desde 12/04/2026", sugerido: "Confirmar regularização", status: "Pendente" },
  { id: 6, empresaId: 6, empresa: empresas[5].razaoSocial, tipo: "Situação irregular", atual: "Baixada na Receita Federal", sugerido: "Encerrar contrato", status: "Ignorado" },
  { id: 7, empresaId: 11, empresa: empresas[10].razaoSocial, tipo: "Endereço", atual: "Sem complemento", sugerido: "Validar via CNPJ", status: "Pendente" },
  { id: 8, empresaId: 28, empresa: empresas[27].razaoSocial, tipo: "Duplicidade", atual: "Mesmo CNPJ do ID #4", sugerido: "Consolidar registros", status: "Pendente" },
];

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

/** Ponto de integração: trocar pelo GET /empresas da API do grupo. */
export const listarEmpresas = () => pause(empresas);
/** Ponto de integração: BrasilAPI /api/cnpj/v1/{cnpj}, com normalização no backend. */
export const consultarCNPJ = async (cnpj: string) => {
  await pause(null);
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) throw new Error("CNPJ inválido");
  if (digits === "00000000000000") throw new Error("CNPJ não encontrado");
  return { ...empresas[1], cnpj: cnpj || "48.613.992/0001-76", razaoSocial: "Atlas Tecnologia e Serviços Ltda.", fantasia: "Atlas Tecnologia" };
};
/** Ponto de integração: trocar pelo GET /auditoria/divergencias. */
export const listarDivergencias = () => pause(divergencias);
/** Ponto de integração: trocar pelo GET /tarefas e POST /tarefas. */
export const listarTarefas = () => pause(tarefas);
/** Ponto de integração: BrasilAPI /api/feriados/v1/{ano}. */
export const feriadosNacionais = ["2026-01-01", "2026-04-03", "2026-04-21", "2026-05-01", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-12-25"];
