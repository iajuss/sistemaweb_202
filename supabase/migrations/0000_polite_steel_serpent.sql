CREATE TABLE "divergencias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escritorio_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"atual" text NOT NULL,
	"sugerido" text,
	"status" text DEFAULT 'Pendente' NOT NULL,
	"detectado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvido_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "empresas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escritorio_id" uuid NOT NULL,
	"cnpj" text NOT NULL,
	"razao_social" text NOT NULL,
	"fantasia" text DEFAULT '' NOT NULL,
	"cidade" text DEFAULT '' NOT NULL,
	"estado" text DEFAULT '' NOT NULL,
	"endereco" text DEFAULT '' NOT NULL,
	"cnae_codigo" text DEFAULT '' NOT NULL,
	"cnae_descricao" text DEFAULT '' NOT NULL,
	"porte" text DEFAULT '' NOT NULL,
	"situacao_cadastral" text DEFAULT '' NOT NULL,
	"abertura" date,
	"responsavel_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"observacoes" text DEFAULT '' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "empresas_socios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"papel" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escritorios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feriados_cache" (
	"data" date PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"ano" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modelos_recorrencia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escritorio_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"tipo" text NOT NULL,
	"periodicidade" text NOT NULL,
	"dia_referencia" integer NOT NULL,
	"responsavel_id" uuid,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "perfis" (
	"id" uuid PRIMARY KEY NOT NULL,
	"escritorio_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tarefas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escritorio_id" uuid NOT NULL,
	"modelo_id" uuid,
	"empresa_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"tipo" text NOT NULL,
	"responsavel_id" uuid,
	"vencimento" date NOT NULL,
	"status" text DEFAULT 'Pendente' NOT NULL,
	"concluido_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "divergencias" ADD CONSTRAINT "divergencias_escritorio_id_escritorios_id_fk" FOREIGN KEY ("escritorio_id") REFERENCES "public"."escritorios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divergencias" ADD CONSTRAINT "divergencias_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_escritorio_id_escritorios_id_fk" FOREIGN KEY ("escritorio_id") REFERENCES "public"."escritorios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_responsavel_id_perfis_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."perfis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "empresas_socios" ADD CONSTRAINT "empresas_socios_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelos_recorrencia" ADD CONSTRAINT "modelos_recorrencia_escritorio_id_escritorios_id_fk" FOREIGN KEY ("escritorio_id") REFERENCES "public"."escritorios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelos_recorrencia" ADD CONSTRAINT "modelos_recorrencia_responsavel_id_perfis_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."perfis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfis" ADD CONSTRAINT "perfis_escritorio_id_escritorios_id_fk" FOREIGN KEY ("escritorio_id") REFERENCES "public"."escritorios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas" ADD CONSTRAINT "tarefas_escritorio_id_escritorios_id_fk" FOREIGN KEY ("escritorio_id") REFERENCES "public"."escritorios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas" ADD CONSTRAINT "tarefas_modelo_id_modelos_recorrencia_id_fk" FOREIGN KEY ("modelo_id") REFERENCES "public"."modelos_recorrencia"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas" ADD CONSTRAINT "tarefas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas" ADD CONSTRAINT "tarefas_responsavel_id_perfis_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."perfis"("id") ON DELETE no action ON UPDATE no action;