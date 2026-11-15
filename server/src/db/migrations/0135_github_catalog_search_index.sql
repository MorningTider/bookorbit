DROP INDEX "github_book_entries_title_idx";--> statement-breakpoint
CREATE INDEX "github_book_entries_title_trgm_idx" ON "github_book_entries" USING gin ("title" gin_trgm_ops);