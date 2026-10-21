-- Staging-only community chat schema.
-- Apply ONLY to pokemon-vip-members-staging before testing chat.
CREATE TABLE IF NOT EXISTS chat_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO chat_channels (slug,name,description,position) VALUES
 ('general','General','Collector chat, introductions, and everyday Pokémon talk.',1),
 ('restocks','Restocks & Finds','Share store sightings, pickups, and restock discussions.',2),
 ('market','Market Talk','Prices, collection goals, and Pokémon TCG market discussion.',3),
 ('trades','Trades & Collections','Show off your collection and discuss trades. Do not post payment details.',4),
 ('help','Help Desk','Ask the community for help with PokePrizePool and collecting.',5);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1200),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_created
  ON chat_messages(channel_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_account_created
  ON chat_messages(account_id, created_at DESC);
