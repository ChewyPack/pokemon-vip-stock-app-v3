export async function onRequestGet({ env }) {
  if (!env.DB) return new Response(JSON.stringify({ ok: true, live_usernames: [] }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
  try {
    const { results = [] } = await env.DB.prepare(`
      SELECT DISTINCT lower(trim(p.username)) AS username
      FROM ripz_streams s
      JOIN collector_profiles p ON p.account_id = s.account_id
      WHERE s.status = 'live' AND p.username IS NOT NULL AND trim(p.username) <> ''
      LIMIT 200
    `).all();
    return new Response(JSON.stringify({ ok: true, live_usernames: results.map(row => row.username).filter(Boolean) }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  } catch (error) {
    // Ripz tables are created lazily when the live-stream API is first used.
    // An unavailable status lookup should never break a regular site page.
    return new Response(JSON.stringify({ ok: true, live_usernames: [] }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }
}
