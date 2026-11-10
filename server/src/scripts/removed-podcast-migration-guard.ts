import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

const REMOVED_TABLES = [
  'collection_podcasts',
  'podcast_bookmarks',
  'podcast_episode_media',
  'podcast_episodes',
  'podcast_feed_aliases',
  'podcast_jobs',
  'podcast_library_settings',
  'podcast_listening_sessions',
  'podcasts',
  'user_podcast_episode_state',
  'user_podcast_follows',
  'user_podcast_queue',
] as const;

export async function assertRemovedPodcastDataEmpty(pool: Pick<Pool, 'query'>, migrations: readonly Pick<MigrationMeta, 'sql'>[]): Promise<void> {
  if (!migrations.some((migration) => migration.sql.some((statement) => /DROP TABLE "podcasts"/.test(statement)))) return;

  let existingTables = 0;
  for (const table of REMOVED_TABLES) {
    const relation = await pool.query<{ name: string | null }>('SELECT to_regclass($1)::text AS name', [`public.${table}`]);
    if (!relation.rows[0]?.name) continue;
    existingTables++;
    const data = await pool.query(`SELECT 1 FROM "${table}" LIMIT 1`);
    if (data.rows.length) throw new Error(`The upgrade removes ${table}, which still contains data. Migration refused.`);
  }
  if (!existingTables) return;
  const libraries = await pool.query(`SELECT 1 FROM libraries WHERE type = 'podcasts' LIMIT 1`);
  if (libraries.rows.length) throw new Error('The upgrade removes podcast libraries. Review those libraries before migrating.');
}
