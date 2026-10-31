CREATE TABLE "book_import_identities" (
	"book_id" integer NOT NULL,
	"provider" varchar(50) NOT NULL,
	"provider_book_id" varchar(255) NOT NULL,
	"original_title" varchar(1000),
	"original_authors" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_import_identities_book_id_provider_provider_book_id_pk" PRIMARY KEY("book_id","provider","provider_book_id")
);
--> statement-breakpoint
CREATE TABLE "book_import_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"library_id" integer NOT NULL,
	"folder_id" integer,
	"filename" varchar(500) NOT NULL,
	"staging_path" text NOT NULL,
	"format" varchar(20) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"incoming_sha256" varchar(64) NOT NULL,
	"identity" jsonb NOT NULL,
	"origin" jsonb,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"result_book_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_source_jobs" DROP CONSTRAINT "book_source_jobs_status_chk";--> statement-breakpoint
DROP INDEX "book_source_jobs_user_active_idx";--> statement-breakpoint
DROP INDEX "book_source_jobs_identity_uidx";--> statement-breakpoint
ALTER TABLE "book_source_jobs" ADD COLUMN "review_id" uuid;--> statement-breakpoint
ALTER TABLE "book_source_jobs" ADD COLUMN "import_resolution" jsonb;--> statement-breakpoint
ALTER TABLE "book_import_identities" ADD CONSTRAINT "book_import_identities_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_import_reviews" ADD CONSTRAINT "book_import_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_import_reviews" ADD CONSTRAINT "book_import_reviews_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_import_reviews" ADD CONSTRAINT "book_import_reviews_folder_id_library_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."library_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_import_reviews" ADD CONSTRAINT "book_import_reviews_result_book_id_books_id_fk" FOREIGN KEY ("result_book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_import_identity_lookup_idx" ON "book_import_identities" USING btree ("provider","provider_book_id");--> statement-breakpoint
CREATE INDEX "book_import_reviews_owner_idx" ON "book_import_reviews" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "book_import_reviews_expiry_idx" ON "book_import_reviews" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "book_import_reviews_pending_idx" ON "book_import_reviews" USING btree ("user_id","created_at") WHERE "book_import_reviews"."status" in ('pending', 'processing');--> statement-breakpoint
ALTER TABLE "book_source_jobs" ADD CONSTRAINT "book_source_jobs_review_id_book_import_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."book_import_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_source_jobs_user_active_idx" ON "book_source_jobs" USING btree ("user_id") WHERE "book_source_jobs"."status" in ('queued', 'downloading', 'importing', 'awaiting_choice');--> statement-breakpoint
CREATE UNIQUE INDEX "book_source_jobs_identity_uidx" ON "book_source_jobs" USING btree ("user_id","library_id","source_book_id") WHERE "book_source_jobs"."status" in ('queued', 'downloading', 'importing', 'awaiting_choice') or ("book_source_jobs"."status" = 'failed' and "book_source_jobs"."retryable" = false);--> statement-breakpoint
ALTER TABLE "book_source_jobs" ADD CONSTRAINT "book_source_jobs_status_chk" CHECK ("book_source_jobs"."status" in ('queued', 'downloading', 'importing', 'completed', 'failed', 'cancelled', 'awaiting_choice'));