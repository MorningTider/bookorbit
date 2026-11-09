CREATE TABLE "book_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"client_id" uuid NOT NULL,
	"parent_id" integer,
	"thread_id" integer,
	"scope" varchar(16) NOT NULL,
	"book_file_id" integer,
	"anchor_key" varchar(64) NOT NULL,
	"chapter_href" varchar(2048),
	"chapter_title" varchar(500),
	"cfi" text,
	"quote" text,
	"body" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_comments_scope_chk" CHECK ("book_comments"."scope" in ('review', 'chapter', 'paragraph')),
	CONSTRAINT "book_comments_reply_chk" CHECK (("book_comments"."parent_id" is null) = ("book_comments"."thread_id" is null)),
	CONSTRAINT "book_comments_body_chk" CHECK (length("book_comments"."body") <= 5000 and ("book_comments"."deleted_at" is not null or length(trim("book_comments"."body")) > 0))
);
--> statement-breakpoint
ALTER TABLE "book_comments" ADD CONSTRAINT "book_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_comments" ADD CONSTRAINT "book_comments_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_comments" ADD CONSTRAINT "book_comments_parent_id_book_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."book_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_comments" ADD CONSTRAINT "book_comments_thread_id_book_comments_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."book_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_comments" ADD CONSTRAINT "book_comments_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_comments_user_client_idx" ON "book_comments" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "book_comments_book_roots_idx" ON "book_comments" USING btree ("book_id","id") WHERE "book_comments"."thread_id" is null;--> statement-breakpoint
CREATE INDEX "book_comments_book_anchor_idx" ON "book_comments" USING btree ("book_id","book_file_id","scope","anchor_key","id") WHERE "book_comments"."thread_id" is null;--> statement-breakpoint
CREATE INDEX "book_comments_thread_idx" ON "book_comments" USING btree ("book_id","thread_id","id");--> statement-breakpoint
CREATE INDEX "book_comments_parent_idx" ON "book_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "book_comments_user_idx" ON "book_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "book_comments_file_idx" ON "book_comments" USING btree ("book_file_id");