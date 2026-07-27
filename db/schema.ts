import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const escritorios = pgTable("escritorios", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().default(sql`now()`),
});

// Espelha auth.users (1:1). O FK para auth.users é criado na migração
// de RLS (Task 3), pois auth.users não faz parte do schema Drizzle.
export const perfis = pgTable("perfis", {
  id: uuid("id").primaryKey(),
  escritorioId: uuid("escritorio_id")
    .notNull()
    .references(() => escritorios.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  // Falso só para contas criadas por provedor externo (Google), que não informam
  // o nome do escritório. Ver manual/0012_google_oauth_cadastro.sql.
  cadastroCompleto: boolean("cadastro_completo").notNull().default(true),
  email: text("email").notNull().default(""),
  // 'responsavel' cria o escritório e gerencia a equipe; 'funcionario' entra
  // por convite num escritório existente. Ver manual/0015_perfis_equipe.sql.
  papel: text("papel").notNull().default("responsavel"),
  // Falso quando o responsável desativa o acesso do funcionário — o perfil
  // nunca é apagado (responsavel_id em empresas/tarefas depende dele
  // existir), só para de logar e some dos seletores de responsável novos.
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().default(sql`now()`),
});

export const empresas = pgTable("empresas", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  escritorioId: uuid("escritorio_id")
    .notNull()
    .references(() => escritorios.id, { onDelete: "cascade" }),
  cnpj: text("cnpj").notNull(),
  razaoSocial: text("razao_social").notNull(),
  fantasia: text("fantasia").notNull().default(""),
  cidade: text("cidade").notNull().default(""),
  estado: text("estado").notNull().default(""),
  endereco: text("endereco").notNull().default(""),
  cnaeCodigo: text("cnae_codigo").notNull().default(""),
  cnaeDescricao: text("cnae_descricao").notNull().default(""),
  porte: text("porte").notNull().default(""),
  situacaoCadastral: text("situacao_cadastral").notNull().default(""),
  abertura: date("abertura"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  observacoes: text("observacoes").notNull().default(""),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().default(sql`now()`),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().default(sql`now()`),
});

export const empresasResponsaveis = pgTable("empresas_responsaveis", {
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  perfilId: uuid("perfil_id").notNull().references(() => perfis.id),
});

export const empresasSocios = pgTable("empresas_socios", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  empresaId: uuid("empresa_id")
    .notNull()
    .references(() => empresas.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  papel: text("papel").notNull().default(""),
});

export const divergencias = pgTable("divergencias", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  escritorioId: uuid("escritorio_id")
    .notNull()
    .references(() => escritorios.id, { onDelete: "cascade" }),
  empresaId: uuid("empresa_id")
    .notNull()
    .references(() => empresas.id, { onDelete: "cascade" }),
  empresaRelacionadaId: uuid("empresa_relacionada_id").references(() => empresas.id, { onDelete: "set null" }),
  tipo: text("tipo").notNull(),
  atual: text("atual").notNull(),
  sugerido: text("sugerido"),
  status: text("status").notNull().default("Pendente"),
  detectadoEm: timestamp("detectado_em", { withTimezone: true }).notNull().default(sql`now()`),
  resolvidoEm: timestamp("resolvido_em", { withTimezone: true }),
});

export const modelosRecorrencia = pgTable("modelos_recorrencia", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  escritorioId: uuid("escritorio_id")
    .notNull()
    .references(() => escritorios.id, { onDelete: "cascade" }),
  empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "cascade" }),
  titulo: text("titulo").notNull(),
  tipo: text("tipo").notNull(),
  periodicidade: text("periodicidade").notNull(),
  diaReferencia: integer("dia_referencia").notNull(),
  // Só usado quando periodicidade = "semanal": um ou mais dias da semana
  // (1=segunda...7=domingo). Nulo para as demais periodicidades.
  diasSemana: integer("dias_semana").array(),
  // Só usado quando periodicidade = "anual": mês do vencimento (1-12). Nulo
  // em modelos anuais criados antes desta coluna existir — nesse caso,
  // calcularVencimentosDoModelo cai de volta para o mês de criadoEm (ver
  // lib/tarefas.ts).
  mesReferencia: integer("mes_referencia"),
  ativo: boolean("ativo").notNull().default(true),
  // Início/fim reais da recorrência. Ambos nulos = repete indefinidamente
  // (comportamento padrão); sempre vêm juntos (nunca só um). repeteInicio
  // pode ser uma data futura, adiando o começo da geração de tarefas. Ver
  // calcularVencimentosDoModelo em lib/tarefas.ts.
  repeteInicio: date("repete_inicio"),
  repeteFim: date("repete_fim"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().default(sql`now()`),
});

export const tarefas = pgTable("tarefas", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  escritorioId: uuid("escritorio_id")
    .notNull()
    .references(() => escritorios.id, { onDelete: "cascade" }),
  modeloId: uuid("modelo_id").references(() => modelosRecorrencia.id, { onDelete: "set null" }),
  empresaId: uuid("empresa_id")
    .notNull()
    .references(() => empresas.id, { onDelete: "cascade" }),
  titulo: text("titulo").notNull(),
  tipo: text("tipo").notNull(),
  vencimento: date("vencimento").notNull(),
  status: text("status").notNull().default("Pendente"),
  concluidoEm: timestamp("concluido_em", { withTimezone: true }),
});

export const tarefasResponsaveis = pgTable("tarefas_responsaveis", {
  tarefaId: uuid("tarefa_id").notNull().references(() => tarefas.id, { onDelete: "cascade" }),
  perfilId: uuid("perfil_id").notNull().references(() => perfis.id),
});

export const modelosRecorrenciaResponsaveis = pgTable("modelos_recorrencia_responsaveis", {
  modeloId: uuid("modelo_id").notNull().references(() => modelosRecorrencia.id, { onDelete: "cascade" }),
  perfilId: uuid("perfil_id").notNull().references(() => perfis.id),
});

export const feriadosCache = pgTable("feriados_cache", {
  data: date("data").primaryKey(),
  nome: text("nome").notNull(),
  ano: integer("ano").notNull(),
});

export const cnpjCache = pgTable("cnpj_cache", {
  cnpj: text("cnpj").primaryKey(),
  dados: jsonb("dados").notNull(),
  consultadoEm: timestamp("consultado_em", { withTimezone: true }).notNull().default(sql`now()`),
});
