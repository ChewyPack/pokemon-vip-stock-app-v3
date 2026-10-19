import { sendWebPush } from './web-push.js';

function parseArray(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function matchesPreference(prefs, report) {
  const states = parseArray(prefs.states_json);
  const retailers = parseArray(prefs.retailers_json);
  if (states.length && !states.includes(String(report.state || ''))) return false;
  if (retailers.length && !retailers.includes(String(report.retailer || ''))) return false;
  if (report.reportType === 'line' && Number(prefs.line_alerts_enabled) !== 1) return false;
  if (report.reportType !== 'line' && Number(prefs.stock_alerts_enabled) !== 1) return false;
  return true;
}
export async function notifyReport(env, report) {
  const { results: accounts = [] } = await env.DB.prepare(`
    SELECT a.id AS account_id,
           COALESCE(p.in_app_enabled, 1) AS in_app_enabled,
           COALESCE(p.browser_push_enabled, 0) AS browser_push_enabled,
           COALESCE(p.states_json, '[]') AS states_json,
           COALESCE(p.retailers_json, '[]') AS retailers_json,
           COALESCE(p.stock_alerts_enabled, 1) AS stock_alerts_enabled,
           COALESCE(p.line_alerts_enabled, 1) AS line_alerts_enabled
    FROM accounts a
    LEFT JOIN notification_preferences p ON p.account_id = a.id
    WHERE COALESCE(p.in_app_enabled, 1) = 1 OR COALESCE(p.browser_push_enabled, 0) = 1
  `).all();

  const line = report.reportType === 'line';
  const title = line
    ? 'Store line report: ' + String(report.retailer || 'Store')
    : 'Pokémon stock report: ' + String(report.retailer || 'Store');
  const body = line
    ? String(report.lineCount || '?') + ' people in line' + (report.location ? ' at ' + report.location : '')
    : String(report.productName || report.product || 'Product update') + (report.location ? ' at ' + report.location : '');
  const url = '/market-intelligence.html';
  let inAppCreated = 0, pushAttempted = 0, pushDelivered = 0, pushFailed = 0;

  for (let offset = 0; offset < accounts.length; offset += 50) {
    const batch = accounts.slice(offset, offset + 50);
    await Promise.all(batch.map(async prefs => {
      if (!matchesPreference(prefs, report)) return;
      const accountId = prefs.account_id;
      if (Number(prefs.in_app_enabled) === 1) {
        await env.DB.prepare(`
          INSERT INTO notifications (account_id, notification_type, title, body, url, data_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(accountId, line ? 'line' : 'stock', title, body, url, JSON.stringify({
          reportType: report.reportType || 'stock',
          state: report.state || '',
          retailer: report.retailer || '',
          location: report.location || ''
        })).run();
        inAppCreated++;
      }
      if (Number(prefs.browser_push_enabled) !== 1 || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
      const { results: subs = [] } = await env.DB.prepare(
        'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE account_id = ?'
      ).bind(accountId).all();
      await Promise.all(subs.map(async sub => {
        pushAttempted++;
        try {
          const response = await sendWebPush(sub, { title, body, url, tag: (line ? 'line-' : 'stock-') + String(report.state || '') + '-' + String(report.retailer || '') }, env);
          if (response.ok || response.status === 201) {
            pushDelivered++;
          } else if (response.status === 404 || response.status === 410) {
            await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
          } else {
            pushFailed++;
            console.error('Web Push endpoint rejected notification:', response.status);
          }
        } catch (error) {
          pushFailed++;
          console.error('Web Push delivery failed:', error);
        }
      }));
    }));
  }
  return { recipients: accounts.length, inAppCreated, pushAttempted, pushDelivered, pushFailed };
}
