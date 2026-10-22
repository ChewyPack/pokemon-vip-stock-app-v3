import { sendWebPush } from './web-push.js';

export async function notifyCollector(env, accountId, notification) {
  const recipientId = Number(accountId);
  if (!env?.DB || !Number.isSafeInteger(recipientId) || recipientId < 1) return;
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO notification_preferences (account_id) VALUES (?)').bind(recipientId).run();
    const prefs = await env.DB.prepare(
      'SELECT in_app_enabled, browser_push_enabled FROM notification_preferences WHERE account_id = ?'
    ).bind(recipientId).first();
    const inAppEnabled = !prefs || Number(prefs.in_app_enabled ?? 1) === 1;
    const pushEnabled = !!prefs && Number(prefs.browser_push_enabled || 0) === 1;

    if (inAppEnabled) {
      await env.DB.prepare(
        'INSERT INTO notifications (account_id, notification_type, title, body, url, data_json) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(
        recipientId,
        String(notification.type || 'collector_activity').slice(0, 40),
        String(notification.title || 'Collector update').slice(0, 140),
        String(notification.body || '').slice(0, 1000),
        String(notification.url || '/notifications.html').slice(0, 1000),
        JSON.stringify(notification.data || {})
      ).run();
    }

    if (!pushEnabled || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
    const { results = [] } = await env.DB.prepare(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE account_id = ?'
    ).bind(recipientId).all();
    await Promise.all(results.map(async subscription => {
      try {
        const response = await sendWebPush(subscription, {
          title: String(notification.title || 'Collector update').slice(0, 120),
          body: String(notification.body || '').slice(0, 180),
          url: String(notification.url || '/notifications.html'),
          tag: String(notification.type || 'collector-activity') + '-' + String((notification.data && (notification.data.message_id || notification.data.offer_id || notification.data.comment_id || notification.data.post_id)) || Date.now()) + '-' + recipientId
        }, env);
        if (response.status === 404 || response.status === 410) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(subscription.id).run();
        }
      } catch (error) {
        console.warn('Collector activity push delivery failed:', error);
      }
    }));
  } catch (error) {
    // Notification failures should never undo a successful collector action, message, or offer.
    console.warn('Collector activity notification failed:', error);
  }
}
