CREATE TABLE "github_book_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"generation" uuid NOT NULL,
	"path" text NOT NULL,
	"commit_sha" varchar(64) NOT NULL,
	"blob_sha" varchar(64) NOT NULL,
	"format" varchar(8) NOT NULL,
	"size_bytes" integer NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_book_repositories" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar(120) NOT NULL,
	"repository" varchar(200) NOT NULL,
	"branch" varchar(200) DEFAULT '' NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"formats" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"index_id" uuid,
	"run_id" uuid,
	"lease_until" timestamp with time zone,
	"index_state" varchar(16) DEFAULT 'idle' NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"indexed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "book_source_jobs" ADD COLUMN "source_file" jsonb;--> statement-breakpoint
ALTER TABLE "github_book_entries" ADD CONSTRAINT "github_book_entries_repository_id_github_book_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_book_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_book_entries_generation_idx" ON "github_book_entries" USING btree ("repository_id","generation");--> statement-breakpoint
CREATE INDEX "github_book_entries_blob_idx" ON "github_book_entries" USING btree ("blob_sha","id");--> statement-breakpoint
CREATE INDEX "github_book_entries_title_idx" ON "github_book_entries" USING btree ("title");--> statement-breakpoint
CREATE UNIQUE INDEX "github_book_repositories_identity_idx" ON "github_book_repositories" USING btree ("repository","branch","path");