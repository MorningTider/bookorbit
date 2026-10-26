CREATE TABLE "book_source_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"library_id" integer NOT NULL,
	"folder_id" integer,
	"source_book_id" varchar(25) NOT NULL,
	"title" varchar(200) DEFAULT '' NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"retryable" boolean DEFAULT true NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result_book_id" integer,
	"error" text,
	"worker_id" varchar(36),
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_source_jobs_status_chk" CHECK ("book_source_jobs"."status" in ('queued', 'downloading', 'importing', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "book_source_jobs" ADD CONSTRAINT "book_source_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_source_jobs" ADD CONSTRAINT "book_source_jobs_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_source_jobs" ADD CONSTRAINT "book_source_jobs_folder_id_library_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."library_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_source_jobs" ADD CONSTRAINT "book_source_jobs_result_book_id_books_id_fk" FOREIGN KEY ("result_book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_source_jobs_user_id_idx" ON "book_source_jobs" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "book_source_jobs_queue_idx" ON "book_source_jobs" USING btree ("status","id");--> statement-breakpoint
CREATE UNIQUE INDEX "book_source_jobs_identity_uidx" ON "book_source_jobs" USING btree ("user_id","library_id","source_book_id") WHERE "book_source_jobs"."status" not in ('failed', 'cancelled') or "book_source_jobs"."retryable" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "book_source_jobs_worker_uidx" ON "book_source_jobs" USING btree ("status") WHERE "book_source_jobs"."status" = 'downloading';