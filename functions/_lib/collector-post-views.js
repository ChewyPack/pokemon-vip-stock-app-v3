let tableReady = null;
export async function ensureCollectorPostViews(db) {
  if (!tableReady) {
    tableReady = (async () => {
      await db.prepare(`CREATE TABLE IF NOT EXISTS collector_post_views (
        post_id INTEGER NOT NULL REFERENCES collector_posts(id) ON DELETE CASCADE,
        viewer_key_hash TEXT NOT NULL,
        viewer_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (post_id, viewer_key_hash)
      )`).run();
      await db.prepare('CREATE INDEX IF NOT EXISTS idx_collector_post_views_post ON collector_post_views(post_id, viewed_at DESC)').run();
      await db.prepare('CREATE INDEX IF NOT EXISTS idx_collector_post_views_creator ON collector_post_views(viewer_account_id, viewed_at DESC)').run();
    })().catch(error => { tableReady = null; throw error; });
  }
  await tableReady;
}
