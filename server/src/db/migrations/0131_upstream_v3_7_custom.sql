-- Since 3.5.0 metadata editing needs the Editor or Owner role on the book's library as well as the
-- Edit metadata permission. Every existing grant was Viewer, so the upgrade silently took editing
-- away from each non-superuser who held Edit metadata (issue 1902). Restore it on book libraries
-- for the accounts the upgrade left unable to edit anywhere. An account that already holds Editor
-- or Owner on some book library was set up under the new rules, so its Viewer grants are deliberate.
UPDATE "user_library_access" AS "access"
SET "access_level" = 'editor'
FROM "libraries", "users"
WHERE "libraries"."id" = "access"."library_id"
  AND "libraries"."type" = 'books'
  AND "users"."id" = "access"."user_id"
  AND "users"."is_superuser" = false
  AND "access"."access_level" = 'viewer'
  AND EXISTS (
    SELECT 1 FROM "user_permissions"
    WHERE "user_permissions"."user_id" = "access"."user_id"
      AND "user_permissions"."permission_name" = 'library_edit_metadata'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "user_library_access" AS "editing"
    INNER JOIN "libraries" AS "editing_library" ON "editing_library"."id" = "editing"."library_id"
    WHERE "editing"."user_id" = "access"."user_id"
      AND "editing_library"."type" = 'books'
      AND "editing"."access_level" IN ('editor', 'owner')
  );
--> statement-breakpoint
CREATE TABLE "book_duplicate_resolutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"scan_id" integer,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"current_group_id" integer,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "book_duplicate_resolutions_status_chk" CHECK ("book_duplicate_resolutions"."status" in ('running', 'completed', 'failed')),
	CONSTRAINT "book_duplicate_resolutions_counts_chk" CHECK ("book_duplicate_resolutions"."processed" >= 0 and "book_duplicate_resolutions"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "book_link_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_book_id" integer,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_links" (
	"book_id" integer PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"linked_by_user_id" integer,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_merge_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"library_id" integer NOT NULL,
	"library_ids" integer[],
	"target_book_id" integer NOT NULL,
	"destination_book_id" integer,
	"source_book_ids" integer[] NOT NULL,
	"requested_by_user_id" integer,
	"status" varchar(20) DEFAULT 'planned' NOT NULL,
	"plan" jsonb NOT NULL,
	"moves" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"current_source_book_id" integer,
	"processed" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "book_merge_jobs_status_chk" CHECK ("book_merge_jobs"."status" in ('planned', 'moving', 'committing', 'committed', 'done', 'failed', 'rolled_back')),
	CONSTRAINT "book_merge_jobs_counts_nonnegative_chk" CHECK ("book_merge_jobs"."processed" >= 0 and "book_merge_jobs"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "book_merges" (
	"source_book_id" integer PRIMARY KEY NOT NULL,
	"target_book_id" integer NOT NULL,
	"library_id" integer NOT NULL,
	"merged_by_user_id" integer,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" integer,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_chapter_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"kind" varchar(10) NOT NULL,
	"base_revision" varchar(64) NOT NULL,
	"status" varchar(12) DEFAULT 'queued' NOT NULL,
	"files_written" integer DEFAULT 0 NOT NULL,
	"files_total" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_chapter_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"chapters" jsonb NOT NULL,
	"source" varchar(20) NOT NULL,
	"chapter_count" integer NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_provider_ids" (
	"book_id" integer NOT NULL,
	"provider" varchar(32) NOT NULL,
	"external_id" varchar(512) NOT NULL,
	"source_url" varchar(2048),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_provider_ids_book_id_provider_pk" PRIMARY KEY("book_id","provider")
);
--> statement-breakpoint
CREATE TABLE "chapter_lookup_queue" (
	"claim_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"book_id" integer PRIMARY KEY NOT NULL,
	"user_id" integer,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"reason" varchar(40),
	"result" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audiobook_manifest_revisions" (
	"book_id" integer NOT NULL,
	"revision" varchar(64) NOT NULL,
	"positions_key" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audiobook_manifest_revisions_book_id_revision_pk" PRIMARY KEY("book_id","revision")
);
--> statement-breakpoint
CREATE TABLE "kobo_device_entitlement_tombstones" (
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"legacy_numeric_removal" boolean DEFAULT false NOT NULL,
	CONSTRAINT "kobo_device_entitlement_tombstones_device_id_entitlement_id_pk" PRIMARY KEY("device_id","entitlement_id")
);
--> statement-breakpoint
CREATE TABLE "kobo_entitlement_tombstones" (
	"user_id" integer NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"legacy_book_id" integer,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_entitlement_tombstones_user_id_entitlement_id_pk" PRIMARY KEY("user_id","entitlement_id")
);
--> statement-breakpoint
CREATE TABLE "read_aloud_job_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" varchar(5) NOT NULL,
	"stage" varchar(30),
	"code" varchar(60) NOT NULL,
	"message" varchar(500),
	"data" jsonb,
	CONSTRAINT "read_aloud_job_events_level_chk" CHECK ("read_aloud_job_events"."level" in ('info', 'warn', 'error'))
);
--> statement-breakpoint
CREATE TABLE "read_aloud_job_reports" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"chapters" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_aloud_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" integer NOT NULL,
	"requested_by_user_id" integer,
	"output_file_id" integer,
	"replace_file_id" integer,
	"status" varchar(30) DEFAULT 'queued' NOT NULL,
	"stage" varchar(30) DEFAULT 'queued' NOT NULL,
	"progress" smallint DEFAULT 0 NOT NULL,
	"stage_current" integer,
	"stage_total" integer,
	"stage_unit" varchar(10),
	"input" jsonb NOT NULL,
	"decisions" jsonb DEFAULT '{"chapters":{},"audio":[]}'::jsonb NOT NULL,
	"resume_from" varchar(30),
	"report" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coverage" jsonb,
	"error_code" varchar(50),
	"last_error" varchar(2000),
	"device" varchar(20),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"publish_approved" boolean DEFAULT false NOT NULL,
	"worker_event_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"work_expires_at" timestamp with time zone,
	CONSTRAINT "read_aloud_jobs_status_chk" CHECK ("read_aloud_jobs"."status" in ('queued', 'processing', 'awaiting_review', 'completed', 'completed_with_warnings', 'failed', 'cancelled')),
	CONSTRAINT "read_aloud_jobs_stage_chk" CHECK ("read_aloud_jobs"."stage" in ('queued', 'preparing_audio', 'downloading_model', 'generating_emissions', 'marking_up_ebook', 'aligning', 'validating', 'awaiting_review', 'publishing', 'completed')),
	CONSTRAINT "read_aloud_jobs_stage_unit_chk" CHECK ("read_aloud_jobs"."stage_unit" is null or "read_aloud_jobs"."stage_unit" in ('file', 'track', 'chapter')),
	CONSTRAINT "read_aloud_jobs_progress_chk" CHECK ("read_aloud_jobs"."progress" between 0 and 100),
	CONSTRAINT "read_aloud_jobs_attempt_nonnegative_chk" CHECK ("read_aloud_jobs"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "metadata_http_provider_icons" (
	"provider_id" integer PRIMARY KEY NOT NULL,
	"source_url" text NOT NULL,
	"content_type" varchar(32) NOT NULL,
	"hash" varchar(16) NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metadata_http_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(32) NOT NULL,
	"base_url" text NOT NULL,
	"authorization_enc" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"allow_private_address" boolean DEFAULT false NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"info" jsonb,
	"info_fetched_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'ok' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metadata_http_providers_timeout_chk" CHECK ("metadata_http_providers"."timeout_ms" >= 2000 and "metadata_http_providers"."timeout_ms" <= 30000),
	CONSTRAINT "metadata_http_providers_status_chk" CHECK ("metadata_http_providers"."status" in ('ok', 'stale', 'unreachable', 'key_changed', 'incompatible')),
	CONSTRAINT "metadata_http_providers_failures_chk" CHECK ("metadata_http_providers"."consecutive_failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE "story_edits" (
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"data" jsonb NOT NULL,
	"position" double precision,
	"client_updated_at" timestamp with time zone NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"revision" bigserial NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_edits_user_id_book_id_id_pk" PRIMARY KEY("user_id","book_id","id"),
	CONSTRAINT "story_edits_kind_not_empty_chk" CHECK (char_length("story_edits"."kind") >= 1),
	CONSTRAINT "story_edits_data_object_chk" CHECK (jsonb_typeof("story_edits"."data") = 'object'),
	CONSTRAINT "story_edits_position_range_chk" CHECK ("story_edits"."position" is null or ("story_edits"."position" >= 0 and "story_edits"."position" <= 1))
);
--> statement-breakpoint
ALTER TABLE "collection_podcasts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_bookmarks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_episode_media" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_episodes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_feed_aliases" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_jobs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_library_settings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_listening_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcasts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_podcast_episode_state" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_podcast_follows" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_podcast_queue" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "collection_podcasts" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_bookmarks" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_episode_media" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_episodes" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_feed_aliases" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_jobs" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_library_settings" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_listening_sessions" CASCADE;--> statement-breakpoint
DROP TABLE "podcasts" CASCADE;--> statement-breakpoint
DROP TABLE "user_podcast_episode_state" CASCADE;--> statement-breakpoint
DROP TABLE "user_podcast_follows" CASCADE;--> statement-breakpoint
DROP TABLE "user_podcast_queue" CASCADE;--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP CONSTRAINT "smart_scopes_user_id_media_type_name_unique";--> statement-breakpoint
ALTER TABLE "libraries" DROP CONSTRAINT "libraries_type_chk";--> statement-breakpoint
ALTER TABLE "library_folders" DROP CONSTRAINT "library_folders_role_chk";--> statement-breakpoint
ALTER TABLE "book_duplicate_scan_keys" DROP CONSTRAINT "book_duplicate_scan_keys_kind_chk";--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT "collections_media_type_chk";--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT "collections_kobo_books_only_chk";--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP CONSTRAINT "smart_scopes_media_type_chk";--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP CONSTRAINT "smart_scopes_library_scope_chk";--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP CONSTRAINT "smart_scopes_kobo_books_only_chk";--> statement-breakpoint
ALTER TABLE "download_clients" DROP CONSTRAINT "download_clients_adapter_type_chk";--> statement-breakpoint
ALTER TABLE "book_file_hash_history" DROP CONSTRAINT "book_file_hash_history_reason_chk";--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP CONSTRAINT "smart_scopes_library_id_libraries_id_fk";
--> statement-breakpoint
ALTER TABLE "reading_attempts" DROP CONSTRAINT "reading_attempts_book_id_books_id_fk";
--> statement-breakpoint
DROP INDEX "book_duplicate_group_members_group_idx";--> statement-breakpoint
DROP INDEX "collections_user_media_type_name_uidx";--> statement-breakpoint
DROP INDEX "smart_scopes_user_media_type_idx";--> statement-breakpoint
DROP INDEX "book_duplicate_groups_scan_root_uidx";--> statement-breakpoint
ALTER TABLE "book_duplicate_group_members" DROP CONSTRAINT "book_duplicate_group_members_scan_id_book_id_pk";--> statement-breakpoint
ALTER TABLE "reading_attempts" ALTER COLUMN "book_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "book_duplicate_group_members" ADD CONSTRAINT "book_duplicate_group_members_group_id_book_id_pk" PRIMARY KEY("group_id","book_id");--> statement-breakpoint
ALTER TABLE "book_files" ADD COLUMN "chapter_write_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "book_duplicate_dismissals" ADD COLUMN "kind" varchar(20) DEFAULT 'duplicate' NOT NULL;--> statement-breakpoint
ALTER TABLE "book_duplicate_groups" ADD COLUMN "kind" varchar(20) DEFAULT 'duplicate' NOT NULL;--> statement-breakpoint
ALTER TABLE "book_duplicate_pairs" ADD COLUMN "kind" varchar(20) DEFAULT 'duplicate' NOT NULL;--> statement-breakpoint
ALTER TABLE "book_duplicate_scans" ADD COLUMN "total_other_format_pairs" integer;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "cover_aspect_ratio" varchar(10) DEFAULT '2/3' NOT NULL;--> statement-breakpoint
ALTER TABLE "smart_scopes" ADD COLUMN "cover_aspect_ratio" varchar(10) DEFAULT '2/3' NOT NULL;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "chapter_count" integer GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(chapters) = 'array' THEN jsonb_array_length(chapters) ELSE 0 END) STORED;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "numbered_chapter_count" integer GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(chapters) = 'array' THEN jsonb_array_length(jsonb_path_query_array(chapters, '$[*] ? (@.title like_regex "^[[:space:]]*((track|disc|cd|part)[[:space:]]*)?[#._-]*[[:space:]]*[0-9]+([[:space:]]*(of|/)[[:space:]]*[0-9]+)?[[:space:]]*$" flag "i")')) ELSE 0 END) STORED;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "manifest_legacy_recorded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "chapters_source" varchar(20);--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "chapters_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "chapters_updated_by" integer;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "rating" smallint;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "book_title_snapshot" varchar(1000);--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "book_authors_snapshot" text;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "book_format_snapshot" varchar(20);--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "book_page_count_snapshot" integer;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "book_library_id_snapshot" integer;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "book_removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "book_duplicate_resolutions" ADD CONSTRAINT "book_duplicate_resolutions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_resolutions" ADD CONSTRAINT "book_duplicate_resolutions_scan_id_book_duplicate_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."book_duplicate_scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_link_groups" ADD CONSTRAINT "book_link_groups_lead_book_id_books_id_fk" FOREIGN KEY ("lead_book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_link_groups" ADD CONSTRAINT "book_link_groups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_links" ADD CONSTRAINT "book_links_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_links" ADD CONSTRAINT "book_links_group_id_book_link_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."book_link_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_links" ADD CONSTRAINT "book_links_linked_by_user_id_users_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_merge_jobs" ADD CONSTRAINT "book_merge_jobs_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_merge_jobs" ADD CONSTRAINT "book_merge_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_merges" ADD CONSTRAINT "book_merges_target_book_id_books_id_fk" FOREIGN KEY ("target_book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_merges" ADD CONSTRAINT "book_merges_merged_by_user_id_users_id_fk" FOREIGN KEY ("merged_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_merges" ADD CONSTRAINT "book_merges_job_id_book_merge_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."book_merge_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_chapter_jobs" ADD CONSTRAINT "book_chapter_jobs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_chapter_jobs" ADD CONSTRAINT "book_chapter_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_chapter_versions" ADD CONSTRAINT "book_chapter_versions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_chapter_versions" ADD CONSTRAINT "book_chapter_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_provider_ids" ADD CONSTRAINT "book_provider_ids_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_lookup_queue" ADD CONSTRAINT "chapter_lookup_queue_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_lookup_queue" ADD CONSTRAINT "chapter_lookup_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_manifest_revisions" ADD CONSTRAINT "audiobook_manifest_revisions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_entitlement_tombstones" ADD CONSTRAINT "kobo_device_entitlement_tombstones_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."kobo_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_entitlement_tombstones" ADD CONSTRAINT "kobo_device_entitlement_tombstones_tombstone_fk" FOREIGN KEY ("user_id","entitlement_id") REFERENCES "public"."kobo_entitlement_tombstones"("user_id","entitlement_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_entitlement_tombstones" ADD CONSTRAINT "kobo_entitlement_tombstones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_aloud_job_events" ADD CONSTRAINT "read_aloud_job_events_job_id_read_aloud_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."read_aloud_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_aloud_job_reports" ADD CONSTRAINT "read_aloud_job_reports_job_id_read_aloud_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."read_aloud_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_aloud_jobs" ADD CONSTRAINT "read_aloud_jobs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_aloud_jobs" ADD CONSTRAINT "read_aloud_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_aloud_jobs" ADD CONSTRAINT "read_aloud_jobs_output_file_id_book_files_id_fk" FOREIGN KEY ("output_file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_aloud_jobs" ADD CONSTRAINT "read_aloud_jobs_replace_file_id_book_files_id_fk" FOREIGN KEY ("replace_file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_http_provider_icons" ADD CONSTRAINT "metadata_http_provider_icons_provider_id_metadata_http_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."metadata_http_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_http_providers" ADD CONSTRAINT "metadata_http_providers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_edits" ADD CONSTRAINT "story_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_edits" ADD CONSTRAINT "story_edits_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_duplicate_resolutions_user_created_idx" ON "book_duplicate_resolutions" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "book_duplicate_resolutions_running_idx" ON "book_duplicate_resolutions" USING btree ("status") WHERE "book_duplicate_resolutions"."status" = 'running';--> statement-breakpoint
CREATE INDEX "book_links_group_book_idx" ON "book_links" USING btree ("group_id","book_id");--> statement-breakpoint
CREATE INDEX "book_merge_jobs_unfinished_idx" ON "book_merge_jobs" USING btree ("status") WHERE "book_merge_jobs"."status" not in ('done', 'failed', 'rolled_back');--> statement-breakpoint
CREATE INDEX "book_merge_jobs_library_idx" ON "book_merge_jobs" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "book_merges_target_book_id_idx" ON "book_merges" USING btree ("target_book_id");--> statement-breakpoint
CREATE INDEX "bcj_status_created_idx" ON "book_chapter_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bcj_request_idx" ON "book_chapter_jobs" USING btree ("user_id","book_id","kind","base_revision");--> statement-breakpoint
CREATE INDEX "bcv_book_created_idx" ON "book_chapter_versions" USING btree ("book_id","created_at");--> statement-breakpoint
CREATE INDEX "bcv_created_by_idx" ON "book_chapter_versions" USING btree ("created_by") WHERE "book_chapter_versions"."created_by" is not null;--> statement-breakpoint
CREATE INDEX "book_provider_ids_provider_external_id_idx" ON "book_provider_ids" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "clq_status_available_idx" ON "chapter_lookup_queue" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "clq_user_status_idx" ON "chapter_lookup_queue" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "amr_book_created_idx" ON "audiobook_manifest_revisions" USING btree ("book_id","created_at");--> statement-breakpoint
CREATE INDEX "kobo_device_entitlement_tombstones_user_entitlement_idx" ON "kobo_device_entitlement_tombstones" USING btree ("user_id","entitlement_id");--> statement-breakpoint
CREATE INDEX "kobo_entitlement_tombstones_user_removed_at_idx" ON "kobo_entitlement_tombstones" USING btree ("user_id","removed_at");--> statement-breakpoint
CREATE INDEX "read_aloud_job_events_job_idx" ON "read_aloud_job_events" USING btree ("job_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "read_aloud_jobs_active_book_uidx" ON "read_aloud_jobs" USING btree ("book_id") WHERE "read_aloud_jobs"."status" in ('queued', 'processing', 'awaiting_review');--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_due_idx" ON "read_aloud_jobs" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_book_updated_idx" ON "read_aloud_jobs" USING btree ("book_id","updated_at" desc);--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_user_updated_idx" ON "read_aloud_jobs" USING btree ("requested_by_user_id","updated_at" desc);--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_output_file_idx" ON "read_aloud_jobs" USING btree ("output_file_id");--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_replace_file_idx" ON "read_aloud_jobs" USING btree ("replace_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metadata_http_providers_key_uq" ON "metadata_http_providers" USING btree ("key");--> statement-breakpoint
CREATE INDEX "story_edits_user_book_revision_idx" ON "story_edits" USING btree ("user_id","book_id","revision");--> statement-breakpoint
CREATE INDEX "story_edits_book_id_idx" ON "story_edits" USING btree ("book_id");--> statement-breakpoint
ALTER TABLE "book_metadata" ADD CONSTRAINT "book_metadata_chapters_updated_by_users_id_fk" FOREIGN KEY ("chapters_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD CONSTRAINT "reading_attempts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_duplicate_group_members_scan_book_idx" ON "book_duplicate_group_members" USING btree ("scan_id","book_id");--> statement-breakpoint
CREATE INDEX "book_duplicate_groups_scan_kind_idx" ON "book_duplicate_groups" USING btree ("scan_id","kind","id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_user_name_uidx" ON "collections" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "bm_chapter_count_idx" ON "book_metadata" USING btree ("chapter_count","book_id");--> statement-breakpoint
CREATE INDEX "bm_numbered_chapters_idx" ON "book_metadata" USING btree ("book_id") WHERE numbered_chapter_count >= chapter_count * 0.8 AND chapter_count >= 2;--> statement-breakpoint
CREATE INDEX "bm_chapters_updated_by_idx" ON "book_metadata" USING btree ("chapters_updated_by") WHERE "book_metadata"."chapters_updated_by" is not null;--> statement-breakpoint
CREATE INDEX "bm_hardcover_id_idx" ON "book_metadata" USING btree ("hardcover_id") WHERE "book_metadata"."hardcover_id" is not null;--> statement-breakpoint
CREATE INDEX "bm_open_library_id_idx" ON "book_metadata" USING btree ("open_library_id") WHERE "book_metadata"."open_library_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "book_duplicate_groups_scan_root_uidx" ON "book_duplicate_groups" USING btree ("scan_id","root_book_id") WHERE "book_duplicate_groups"."kind" = 'duplicate';--> statement-breakpoint
ALTER TABLE "libraries" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "libraries" DROP COLUMN "watch_local_folders";--> statement-breakpoint
ALTER TABLE "library_folders" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "collections" DROP COLUMN "media_type";--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP COLUMN "media_type";--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP COLUMN "library_id";--> statement-breakpoint
ALTER TABLE "smart_scopes" ADD CONSTRAINT "smart_scopes_user_id_name_unique" UNIQUE("user_id","name");--> statement-breakpoint
ALTER TABLE "book_duplicate_dismissals" ADD CONSTRAINT "book_duplicate_dismissals_kind_chk" CHECK ("book_duplicate_dismissals"."kind" in ('duplicate', 'other_format'));--> statement-breakpoint
ALTER TABLE "book_duplicate_groups" ADD CONSTRAINT "book_duplicate_groups_kind_chk" CHECK ("book_duplicate_groups"."kind" in ('duplicate', 'other_format'));--> statement-breakpoint
ALTER TABLE "book_duplicate_pairs" ADD CONSTRAINT "book_duplicate_pairs_kind_chk" CHECK ("book_duplicate_pairs"."kind" in ('duplicate', 'other_format'));--> statement-breakpoint
ALTER TABLE "book_duplicate_scan_keys" ADD CONSTRAINT "book_duplicate_scan_keys_kind_chk" CHECK ("book_duplicate_scan_keys"."kind" in ('file_hash', 'isbn', 'exact_metadata', 'of_work', 'of_title', 'of_series'));--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD CONSTRAINT "reading_attempts_rating_range_chk" CHECK ("reading_attempts"."rating" is null or ("reading_attempts"."rating" >= 1 and "reading_attempts"."rating" <= 5));--> statement-breakpoint
ALTER TABLE "download_clients" ADD CONSTRAINT "download_clients_adapter_type_chk" CHECK ("download_clients"."adapter_type" in ('qbittorrent', 'transmission', 'deluge', 'rtorrent', 'nzbget', 'sabnzbd'));--> statement-breakpoint
ALTER TABLE "book_file_hash_history" ADD CONSTRAINT "book_file_hash_history_reason_chk" CHECK ("book_file_hash_history"."reason" in ('file_write', 'external_change', 'rescan', 'kobo_download', 'read_aloud_replace'));
--> statement-breakpoint
-- Chapter lists stored before their source was recorded. A provider lookup stored a durationMs on
-- every chapter, which a list read from the audio files never carries.
UPDATE "book_metadata"
SET "chapters_source" = CASE WHEN jsonb_path_exists("chapters", '$[*].durationMs') THEN 'provider' ELSE 'embedded' END
WHERE "chapters_source" IS NULL AND jsonb_typeof("chapters") = 'array' AND jsonb_array_length("chapters") > 0;
--> statement-breakpoint
-- A book locked with "lock all" stays fully locked now that chapters can be locked too.
UPDATE "book_metadata"
SET "locked_fields" = array_append("locked_fields", 'chapters')
WHERE "locked_fields" @> ARRAY['title', 'subtitle', 'authors', 'description', 'publisher', 'publishedYear', 'language', 'pageCount', 'seriesName', 'seriesIndex', 'isbn13', 'isbn10', 'genres', 'tags', 'rating', 'communityRating', 'narrators', 'durationSeconds', 'abridged', 'googleBooksId', 'goodreadsId', 'amazonId', 'hardcoverId', 'hardcoverEditionId', 'openLibraryId', 'itunesId', 'audibleId', 'librofmId', 'koboId', 'comicvineId', 'ranobedbId', 'lubimyczytacId', 'aladinId', 'comicIssueNumber', 'comicVolumeName', 'comicStoryArcs', 'comicPencillers', 'comicInkers', 'comicColorists', 'comicLetterers', 'comicCoverArtists', 'comicCharacters', 'comicTeams', 'comicLocations', 'cover', 'audioCover']::text[]
  AND NOT ('chapters' = ANY("locked_fields"));
--> statement-breakpoint
-- Merging books moves files and deletes the merged-away records, so it starts with the accounts
-- that could already do both halves by hand: delete books and edit their metadata.
INSERT INTO "user_permissions" ("user_id", "permission_name")
SELECT "deleting"."user_id", 'library_merge_books'
FROM "user_permissions" AS "deleting"
WHERE "deleting"."permission_name" = 'library_delete_books'
  AND EXISTS (
    SELECT 1 FROM "user_permissions" AS "editing"
    WHERE "editing"."user_id" = "deleting"."user_id"
      AND "editing"."permission_name" = 'library_edit_metadata'
  )
ON CONFLICT DO NOTHING;
