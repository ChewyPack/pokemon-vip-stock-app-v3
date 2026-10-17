const COOKIE = 'collector_session';
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function cookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(name + '=')) return value.slice(name.length + 1);
  }
  return '';
}
function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
async function currentAccount(request, env) {
  const token = cookie(request, COOKIE);
  if (!token) return null;
  const account = await env.DB.prepare('SELECT id, session_expires_at FROM accounts WHERE session_token_hash = ? LIMIT 1')
    .bind(await sha256(token)).first();
  return account && account.session_expires_at && Number(account.session_expires_at) > Date.now() ? account : null;
}
async function blocksEitherWay(db, a, b) {
  const row = await db.prepare(`SELECT 1 AS blocked FROM collector_blocks
    WHERE (blocker_account_id = ? AND blocked_account_id = ?)
       OR (blocker_account_id = ? AND blocked_account_id = ?) LIMIT 1`).bind(a, b, b, a).first();
  return !!row;
}
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  const account = await currentAccount(request, env);
  if (!account) return json({ ok: false, error: 'login_required' }, 401);
  try {
    const rows = await env.DB.prepare(`
      SELECT o.id, o.proposer_account_id, o.recipient_account_id, o.status, o.message, o.offer_type, o.cash_amount_cents, o.created_at, o.updated_at,
        CASE WHEN o.proposer_account_id = ? THEN 'outgoing' ELSE 'incoming' END AS direction,
        pp.username AS proposer_username, rp.username AS recipient_username
      FROM collector_trade_offers o
      JOIN collector_profiles pp ON pp.account_id = o.proposer_account_id
      JOIN collector_profiles rp ON rp.account_id = o.recipient_account_id
      WHERE o.proposer_account_id = ? OR o.recipient_account_id = ?
      ORDER BY o.created_at DESC LIMIT 100
    `).bind(account.id, account.id, account.id).all();
    const offers = [];
    for (const row of rows.results || []) {
      const parts = await env.DB.prepare(`
        SELECT oi.side, oi.quantity, i.product_type, i.product_name, i.set_name, i.card_number
        FROM collector_trade_offer_items oi JOIN collector_items i ON i.id = oi.collector_item_id
        WHERE oi.offer_id = ? ORDER BY oi.side, oi.id
      `).bind(row.id).all();
      offers.push({ ...row, items: parts.results || [] });
    }
    return json({ ok: true, offers });
  } catch (error) {
    console.error('Trade offer list failed:', error);
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('no such table') || message.includes('no such column')) return json({ ok: false, error: 'wishlist_trades_migration_required' }, 500);
    return json({ ok: false, error: 'trade_list_failed' }, 500);
  }
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  const account = await currentAccount(request, env);
  if (!account) return json({ ok: false, error: 'login_required' }, 401);
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  const recipientUsername = typeof data.recipient_username === 'string' ? data.recipient_username.trim() : '';
  const offerType = data.offer_type === 'cash' ? 'cash' : 'trade';
  const offering = Array.isArray(data.offering) ? data.offering : [];
  const requesting = Array.isArray(data.requesting) ? data.requesting : [];
  const message = typeof data.message === 'string' ? data.message.trim().slice(0, 500) : '';
  const cashAmount = Number(data.cash_amount);
  const cashAmountCents = Math.round(cashAmount * 100);
  if (!recipientUsername) return json({ ok: false, error: 'recipient_not_found' }, 400);
  if (offerType === 'cash' && (!Number.isFinite(cashAmount) || cashAmount <= 0 || cashAmount > 1000000 || !Number.isSafeInteger(cashAmountCents))) return json({ ok: false, error: 'invalid_cash_amount' }, 400);
  if (offerType === 'trade' && (!offering.length || !requesting.length || offering.length > 20 || requesting.length > 20)) return json({ ok: false, error: 'invalid_trade_items' }, 400);
  try {
    const recipient = await env.DB.prepare('SELECT account_id, username FROM collector_profiles WHERE username = ? COLLATE NOCASE AND is_public = 1 LIMIT 1').bind(recipientUsername).first();
    if (!recipient) return json({ ok: false, error: 'recipient_not_found' }, 404);
    if (Number(recipient.account_id) === Number(account.id)) return json({ ok: false, error: 'cannot_trade_self' }, 400);
    if (await blocksEitherWay(env.DB, account.id, recipient.account_id)) return json({ ok: false, error: 'collector_unavailable' }, 403);
    let validOffering = [], validRequesting = [];
    if (offerType === 'trade') {
      const validate = async (ids, ownerId) => {
        const normalized = ids.map(item => ({ id: Number(item.id), quantity: Number(item.quantity || 1) }));
        if (normalized.some(item => !Number.isInteger(item.id) || item.id < 1 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999)) return null;
        if (new Set(normalized.map(item => item.id)).size !== normalized.length) return null;
        for (const item of normalized) {
          const row = await env.DB.prepare('SELECT id, account_id, list_type, quantity FROM collector_items WHERE id = ? LIMIT 1').bind(item.id).first();
          if (!row || Number(row.account_id) !== Number(ownerId) || row.list_type !== 'collection') return null;
          if (item.quantity > Number(row.quantity)) return null;
        }
        return normalized;
      };
      validOffering = await validate(offering, account.id);
      validRequesting = await validate(requesting, recipient.account_id);
      if (!validOffering || !validRequesting) return json({ ok: false, error: 'invalid_or_unavailable_items' }, 400);
    }
    const created = await env.DB.prepare('INSERT INTO collector_trade_offers (proposer_account_id, recipient_account_id, message, offer_type, cash_amount_cents) VALUES (?, ?, ?, ?, ?)').bind(account.id, recipient.account_id, message, offerType, offerType === 'cash' ? cashAmountCents : null).run();
    const offerId = Number(created.meta?.last_row_id);
    if (!offerId) return json({ ok: false, error: 'trade_create_failed' }, 500);
    for (const item of validOffering) await env.DB.prepare('INSERT INTO collector_trade_offer_items (offer_id, collector_item_id, side, quantity) VALUES (?, ?, ?, ?)').bind(offerId, item.id, 'offering', item.quantity).run();
    for (const item of validRequesting) await env.DB.prepare('INSERT INTO collector_trade_offer_items (offer_id, collector_item_id, side, quantity) VALUES (?, ?, ?, ?)').bind(offerId, item.id, 'requesting', item.quantity).run();
    return json({ ok: true, offer_id: offerId, status: 'pending', offer_type: offerType }, 201);
  } catch (error) {
    console.error('Trade offer create failed:', error);
    return json({ ok: false, error: 'trade_create_failed' }, 500);
  }
}
export async function onRequestPatch({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
  const account = await currentAccount(request, env);
  if (!account) return json({ ok: false, error: 'login_required' }, 401);
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  const id = Number(data.id), action = String(data.action || '');
  if (!Number.isInteger(id) || id < 1 || !['accept', 'decline', 'cancel', 'complete'].includes(action)) return json({ ok: false, error: 'invalid_trade_action' }, 400);
  try {
    const offer = await env.DB.prepare('SELECT * FROM collector_trade_offers WHERE id = ? LIMIT 1').bind(id).first();
    if (!offer) return json({ ok: false, error: 'trade_not_found' }, 404);
    const proposer = Number(offer.proposer_account_id), recipient = Number(offer.recipient_account_id), me = Number(account.id);
    let next = '';
    if (action === 'accept' || action === 'decline') {
      if (me !== recipient || offer.status !== 'pending') return json({ ok: false, error: 'trade_action_not_allowed' }, 403);
      next = action === 'accept' ? 'accepted' : 'declined';
    } else if (action === 'cancel') {
      if (me !== proposer || offer.status !== 'pending') return json({ ok: false, error: 'trade_action_not_allowed' }, 403);
      next = 'cancelled';
    } else {
      if ((me !== proposer && me !== recipient) || offer.status !== 'accepted') return json({ ok: false, error: 'trade_action_not_allowed' }, 403);
      const other = me === proposer ? recipient : proposer;
      const confirmed = await env.DB.prepare('SELECT 1 FROM collector_trade_completions WHERE offer_id = ? AND account_id = ? LIMIT 1').bind(id, other).first().catch(() => null);
      if (!confirmed) {
        await env.DB.prepare('INSERT OR IGNORE INTO collector_trade_completions (offer_id, account_id) VALUES (?, ?)').bind(id, me).run();
        const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM collector_trade_completions WHERE offer_id = ?').bind(id).first();
        if (Number(count?.total || 0) < 2) return json({ ok: true, status: 'accepted', completion_confirmed: true, waiting_for_other: true });
      }
      next = 'completed';
    }
    await env.DB.prepare('UPDATE collector_trade_offers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(next, id).run();
    return json({ ok: true, status: next });
  } catch (error) {
    console.error('Trade offer update failed:', error);
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('no such table') || message.includes('no such column')) return json({ ok: false, error: 'wishlist_trades_migration_required' }, 500);
    return json({ ok: false, error: 'trade_update_failed' }, 500);
  }
}
export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
