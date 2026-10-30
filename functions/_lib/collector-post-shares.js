let tableReady = null;

export async function ensureCollectorPostShares(db) {
  if (!tableReady) {
    tableReady = (async () => {
      await db.prepare(`CREATE TABLE IF NOT EXISTS collector_post_shares (
        post_id INTEGER NOT NULL REFERENCES collector_posts(id) ON DELETE CASCADE,
        share_key_hash TEXT NOT NULL,
        shared_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (post_id, share_key_hash)
      )`).run();
      await db.prepare('CREATE INDEX IF NOT EXISTS idx_collector_post_shares_post ON collector_post_shares(post_id, shared_at DESC)').run();
    })().catch(error => { tableReady = null; throw error; });
  }
  await tableReady;
}
