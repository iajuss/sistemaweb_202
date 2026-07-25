import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
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
  responsavelId: uuid("responsavel_id").references(() => perfis.id),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  observacoes: text("observacoes").notNull().default(""),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().default(sql`now()`),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().default(sql`now()`),
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
  empresaId: uuid("empresa_id")
    .notNull()
    .references(() => empresas.id, { onDelete: "cascade" }),
  titulo: text("titulo").notNull(),
  tipo: text("tipo").notNull(),
  periodicidade: text("periodicidade").notNull(),
  diaReferencia: integer("dia_referencia").notNull(),
  responsavelId: uuid("responsavel_id").references(() => perfis.id),
  ativo: boolean("ativo").notNull().default(true),
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
  responsavelId: uuid("responsavel_id").references(() => perfis.id),
  vencimento: date("vencimento").notNull(),
  status: text("status").notNull().default("Pendente"),
  concluidoEm: timestamp("concluido_em", { withTimezone: true }),
});

export const feriadosCache = pgTable("feriados_cache", {
  data: date("data").primaryKey(),
  nome: text("nome").notNull(),
  ano: integer("ano").notNull(),
});
