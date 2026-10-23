import { activateGoalGiveaways } from '../_lib/giveaway-goal.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300'
    }
  });
}

// Public meter intentionally returns an aggregate only; never expose member names or email addresses.
export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);

  try {
    const activeSubscribers = await activateGoalGiveaways(env);

    return json({
      ok: true,
      active_subscribers: activeSubscribers
    });
  } catch (error) {
    console.error('Giveaway meter subscriber count failed:', error);
    return json({ ok: false, error: 'giveaway_meter_unavailable' }, 503);
  }
}

export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
