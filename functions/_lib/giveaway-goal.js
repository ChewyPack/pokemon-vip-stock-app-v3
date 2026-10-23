// Shared subscriber milestone logic for giveaway starts and the public meter.
// Keep the temporary -2 calibration aligned with /api/giveaway-meter until legacy
// membership records are reconciled.
export async function getActiveSubscriberCount(env) {
  const result = await env.DB.prepare(
    "SELECT COUNT(DISTINCT id) AS active_subscribers FROM users " +
    "WHERE membership_status = 'active' " +
    "AND lower(COALESCE(membership_type, '')) IN ('monthly', 'yearly')"
  ).first();

  return Math.max(0, Number(result?.active_subscribers || 0) - 2);
}

export async function activateGoalGiveaways(env) {
  const activeSubscribers = await getActiveSubscriberCount(env);
  const table = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'poke_prize_giveaways' LIMIT 1"
  ).first();
  if (!table) return activeSubscribers;

  const activatedAt = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE poke_prize_giveaways " +
    "SET goal_started_at = ?, updated_at = CURRENT_TIMESTAMP " +
    "WHERE status = 'published' " +
    "AND lower(COALESCE(start_mode, 'date')) = 'goal' " +
    "AND start_goal IS NOT NULL " +
    "AND CAST(start_goal AS INTEGER) <= ? " +
    "AND goal_started_at IS NULL"
  ).bind(activatedAt, activeSubscribers).run();
  return activeSubscribers;
}
