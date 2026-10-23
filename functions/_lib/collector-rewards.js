export const COLLECTOR_BUDDY_POKEMON = [
  { key: "pikachu", name: "Pikachu", id: 25 },
  { key: "eevee", name: "Eevee", id: 133 },
  { key: "bulbasaur", name: "Bulbasaur", id: 1 },
  { key: "charmander", name: "Charmander", id: 4 },
  { key: "squirtle", name: "Squirtle", id: 7 },
  { key: "psyduck", name: "Psyduck", id: 54 },
  { key: "gengar", name: "Gengar", id: 94 },
  { key: "snorlax", name: "Snorlax", id: 143 },
  { key: "mew", name: "Mew", id: 151 },
  { key: "charizard", name: "Charizard", id: 6 },
  { key: "dragonite", name: "Dragonite", id: 149 },
  { key: "lucario", name: "Lucario", id: 448 },
  { key: "umbreon", name: "Umbreon", id: 197 },
  { key: "sylveon", name: "Sylveon", id: 700 },
  { key: "rowlet", name: "Rowlet", id: 722 },
  { key: "sprigatito", name: "Sprigatito", id: 906 }
];

export const COLLECTOR_CHAT_COLORS = [
  { value: "#ffd54a", label: "PokePrizePool Gold" },
  { value: "#ffffff", label: "White" },
  { value: "#62d6ff", label: "Electric Blue" },
  { value: "#ff78c8", label: "Pink" },
  { value: "#b4f46e", label: "Green" },
  { value: "#c0a2ff", label: "Purple" },
  { value: "#ffab70", label: "Orange" },
  { value: "#ff7777", label: "Red" }
];

export const COLLECTOR_GYM_BADGES = [
  { id: "boulder", name: "Boulder Badge", icon: "⬟", description: "Add your first collection item.", threshold: 1, color: "#d6b27a" },
  { id: "cascade", name: "Cascade Badge", icon: "◆", description: "Build a collection of 10 items.", threshold: 10, color: "#67c8ff" },
  { id: "thunder", name: "Thunder Badge", icon: "⚡", description: "Build a collection of 25 items.", threshold: 25, color: "#ffe05b" },
  { id: "rainbow", name: "Rainbow Badge", icon: "✿", description: "Build a collection of 50 items.", threshold: 50, color: "#e28cff" },
  { id: "soul", name: "Soul Badge", icon: "♥", description: "Build a collection of 100 items.", threshold: 100, color: "#fa8eb3" },
  { id: "marsh", name: "Marsh Badge", icon: "✦", description: "Build a collection of 250 items.", threshold: 250, color: "#bb9aff" },
  { id: "volcano", name: "Volcano Badge", icon: "♨", description: "Build a collection of 500 items.", threshold: 500, color: "#ff9364" },
  { id: "earth", name: "Earth Badge", icon: "★", description: "Build a collection of 1,000 items.", threshold: 1000, color: "#90d67c" }
];

export async function ensureCollectorRewardSchema(env) {
  const columns = [
    ["buddy_pokemon", "TEXT NOT NULL DEFAULT 'pikachu'"],
    ["chat_name_color", "TEXT NOT NULL DEFAULT '#ffd54a'"]
  ];
  for (const [name, definition] of columns) {
    try {
      await env.DB.prepare("ALTER TABLE collector_profiles ADD COLUMN " + name + " " + definition).run();
    } catch (error) {
      const message = String(error?.message || "").toLowerCase();
      if (!message.includes("duplicate column name") && !message.includes("already exists")) throw error;
    }
  }
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS collector_earned_badges (
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      badge_id TEXT NOT NULL,
      earned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, badge_id)
    )
  `).run();
}

export async function getCollectorAchievements(env, accountId) {
  await ensureCollectorRewardSchema(env);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM collector_items WHERE account_id = ? AND list_type = 'collection'"
  ).bind(accountId).first().catch(() => ({ total: 0 }));
  const total = Math.max(0, Number(row?.total || 0));
  for (const badge of COLLECTOR_GYM_BADGES) {
    if (total >= badge.threshold) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO collector_earned_badges (account_id, badge_id) VALUES (?, ?)"
      ).bind(accountId, badge.id).run();
    }
  }
  const earnedResult = await env.DB.prepare(
    "SELECT badge_id, earned_at FROM collector_earned_badges WHERE account_id = ?"
  ).bind(accountId).all();
  const earned = new Map((earnedResult.results || []).map(item => [item.badge_id, item.earned_at]));
  return {
    collection_items: total,
    earned_count: COLLECTOR_GYM_BADGES.filter(badge => earned.has(badge.id)).length,
    total_badges: COLLECTOR_GYM_BADGES.length,
    badges: COLLECTOR_GYM_BADGES.map(badge => ({
      ...badge,
      earned: earned.has(badge.id),
      earned_at: earned.get(badge.id) || null
    })),
    buddy_options: COLLECTOR_BUDDY_POKEMON.map(({ key, name, id }) => ({
      key, name, image_url: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/" + id + ".png"
    }))
  };
}
