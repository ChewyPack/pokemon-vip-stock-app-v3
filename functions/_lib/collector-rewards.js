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

export const COLLECTOR_BASIC_BADGES = [
  { id: "basic_push_notifications", name: "Enable Push Notifications", icon: "🔔", description: "Enable browser push notifications on your account.", color: "#67c8ff" },
  { id: "basic_choose_alerts", name: "Choose Alerts", icon: "⚙", description: "Choose at least one state or retailer in Alert Preferences.", color: "#90d67c" },
  { id: "basic_profile_picture", name: "Profile Picture", icon: "📸", description: "Add a profile picture to your collector profile.", color: "#e28cff" },
  { id: "basic_first_post", name: "Post in the News Feed for 1st Time", icon: "✎", description: "Publish your first post in the News Feed.", color: "#ffe05b" },
  { id: "basic_first_ripz_live", name: "Go Live on Ripz for 1st Time", icon: "▶", description: "Start your first live Ripz stream.", color: "#fa8eb3" },
  { id: "basic_follow_5_profiles", name: "Follow 5 Profiles", icon: "♡", description: "Follow five collector profiles.", color: "#bb9aff" },
  { id: "basic_make_report", name: "Make a Report", icon: "✓", description: "Submit your first stock or store-line report.", color: "#ff9364" },
  { id: "basic_collector_plus", name: "Subscribe to Collector+", icon: "★", description: "Have an active Collector+ membership or higher.", color: "#d6b27a" }
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

export async function awardCollectorBasicAchievement(env, accountId, achievementId) {
  const numericId = Number(accountId);
  if (!Number.isSafeInteger(numericId) || numericId < 1) return;
  if (!COLLECTOR_BASIC_BADGES.some(badge => badge.id === achievementId)) return;
  await ensureCollectorRewardSchema(env);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO collector_earned_badges (account_id, badge_id) VALUES (?, ?)"
  ).bind(numericId, achievementId).run();
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
  const safeFirst = async sql => env.DB.prepare(sql).bind(accountId).first().catch(() => null);
  const [
    profileRow, preferences, pushRow, postRow, liveRow, followsRow,
    reportRow, accountRow
  ] = await Promise.all([
    safeFirst("SELECT avatar_url FROM collector_profiles WHERE account_id = ? LIMIT 1"),
    safeFirst("SELECT browser_push_enabled, states_json, retailers_json FROM notification_preferences WHERE account_id = ? LIMIT 1"),
    safeFirst("SELECT COUNT(*) AS total FROM push_subscriptions WHERE account_id = ?"),
    safeFirst("SELECT COUNT(*) AS total FROM collector_posts WHERE account_id = ? AND deleted_at IS NULL"),
    safeFirst("SELECT COUNT(*) AS total FROM ripz_streams WHERE account_id = ? AND live_at IS NOT NULL"),
    safeFirst("SELECT COUNT(*) AS total FROM collector_follows WHERE follower_account_id = ?"),
    safeFirst("SELECT COUNT(*) AS total FROM reports WHERE lower(trim(reported_by)) = lower((SELECT username FROM collector_profiles WHERE account_id = ? AND username <> '' LIMIT 1))"),
    safeFirst("SELECT membership_status, membership_tier, membership_entitlement_tier FROM accounts WHERE id = ? LIMIT 1")
  ]);
  const parseSelected = value => {
    try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; }
    catch (_) { return []; }
  };
  const states = parseSelected(preferences?.states_json);
  const retailers = parseSelected(preferences?.retailers_json);
  const tier = String(accountRow?.membership_entitlement_tier || accountRow?.membership_tier || "")
    .trim().toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
  const membershipStatus = String(accountRow?.membership_status || "").trim().toLowerCase();
  const hasCollectorPlus = ["active", "trialing"].includes(membershipStatus) &&
    ["collector+", "collector plus", "vendor", "vendor+", "vendor plus", "organizer", "organizer+"].includes(tier);
  const basicStatus = {
    basic_push_notifications: Number(preferences?.browser_push_enabled || 0) === 1 && Number(pushRow?.total || 0) > 0,
    basic_choose_alerts: states.length > 0 || retailers.length > 0,
    basic_profile_picture: !!String(profileRow?.avatar_url || "").trim(),
    basic_first_post: Number(postRow?.total || 0) > 0,
    basic_first_ripz_live: Number(liveRow?.total || 0) > 0,
    basic_follow_5_profiles: Number(followsRow?.total || 0) >= 5,
    basic_make_report: Number(reportRow?.total || 0) > 0,
    basic_collector_plus: hasCollectorPlus
  };
  for (const badge of COLLECTOR_BASIC_BADGES) {
    if (basicStatus[badge.id]) {
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
    basic_earned_count: COLLECTOR_BASIC_BADGES.filter(badge => earned.has(badge.id)).length,
    total_basics: COLLECTOR_BASIC_BADGES.length,
    basic_achievements: COLLECTOR_BASIC_BADGES.map(badge => ({
      ...badge,
      earned: earned.has(badge.id),
      earned_at: earned.get(badge.id) || null
    })),
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
