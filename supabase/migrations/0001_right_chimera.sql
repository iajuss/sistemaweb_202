CREATE TABLE "cnpj_cache" (
	"cnpj" text PRIMARY KEY NOT NULL,
	"dados" jsonb NOT NULL,
	"consultado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "divergencias" ADD COLUMN "empresa_relacionada_id" uuid;--> statement-breakpoint
ALTER TABLE "modelos_recorrencia" ADD COLUMN "empresa_id" uuid;--> statement-breakpoint
ALTER TABLE "perfis" ADD COLUMN "cadastro_completo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "divergencias" ADD CONSTRAINT "divergencias_empresa_relacionada_id_empresas_id_fk" FOREIGN KEY ("empresa_relacionada_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelos_recorrencia" ADD CONSTRAINT "modelos_recorrencia_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;