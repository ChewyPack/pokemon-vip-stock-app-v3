
/*
 * POST /api/report
 *
 * Browser sends multipart form data:
 *   data       JSON string containing form answers
 *   photos     0-5 image files
 *   elapsedMs  time spent filling out the form
 *   website    honeypot field
 *
 * Cloudflare D1 binding:
 *   DB -> pokemon-vip-members
 *
 * Access:
 *   Requires an active paid membership or a signed-in admin account.
 *
 * Notifications:
 *   Saved reports fan out to the in-site inbox and opted-in browser push subscriptions.
 *   VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY enable browser push delivery.
 *
 * IMPORTANT:
 * The existing reports table does not contain a product_type column.
 * This version matches the actual database schema.
 */

import formConfig from '../../js/shared/form-config.js';
import validate from '../../js/shared/validate.js';
import { notifyReport } from '../_lib/notify.js';
import { awardCollectorBasicAchievement } from '../_lib/collector-rewards.js';


const ACCOUNT_COOKIE = 'collector_session';
const PAID_TIERS = new Set(['collector_plus', 'vendor', 'organizer']);

function getCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(name + '=')) return value.slice(name.length + 1);
  }
  return '';
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256Base64Url(value) {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function requireActivePaidAccount(request, env) {
  // Existing VIP subscribers use vip_session and the production users table.
  // Honor their current active session without requiring a duplicate account.
  const vipToken = getCookie(request, 'vip_session');
  if (vipToken) {
    const vipMember = await env.DB.prepare(
      `SELECT id, session_expires_at, membership_status, membership_type
       FROM users WHERE session_token_hash = ? AND membership_status = 'active' LIMIT 1`
    ).bind(await sha256Base64Url(vipToken)).first();

    if (vipMember && vipMember.session_expires_at && Number(vipMember.session_expires_at) > Date.now()) {
      return { ok: true, account: vipMember, legacyVip: true };
    }
  }

  const token = getCookie(request, ACCOUNT_COOKIE);
  if (!token) return { ok: false, status: 401, error: 'login_required' };

  const account = await env.DB.prepare(
    `SELECT id, is_admin, session_expires_at, membership_status, membership_tier,
            membership_entitlement_tier, membership_current_period_end,
            membership_source, stripe_subscription_id
     FROM accounts WHERE session_token_hash = ? LIMIT 1`
  ).bind(await sha256Base64Url(token)).first();

  if (!account || !account.session_expires_at || Number(account.session_expires_at) <= Date.now()) {
    return { ok: false, status: 401, error: 'login_required' };
  }

  if (Number(account.is_admin || 0) === 1) {
    return { ok: true, account, isAdmin: true };
  }

  const tier = String(account.membership_entitlement_tier || account.membership_tier || '').trim().toLowerCase();
  // Admin-granted memberships are explicitly recorded in D1 as membership_source='admin_grant'.
  // They do not have a Stripe subscription or billing-period end, but receive the same tier access.
  const adminGrant = String(account.membership_source || '').trim().toLowerCase() === 'admin_grant';
  if (account.membership_status !== 'active' || !PAID_TIERS.has(tier) ||
      (!adminGrant && !account.stripe_subscription_id)) {
    return { ok: false, status: 403, error: 'paid_membership_required' };
  }

  if (!adminGrant && account.membership_current_period_end) {
    const rawEnd = account.membership_current_period_end;
    const numericEnd = Number(rawEnd);
    const endMs = Number.isFinite(numericEnd) && numericEnd > 0
      ? (numericEnd < 100000000000 ? numericEnd * 1000 : numericEnd)
      : Date.parse(rawEnd);
    if (!Number.isFinite(endMs) || endMs <= Date.now()) {
      return { ok: false, status: 403, error: 'paid_membership_required' };
    }
  }

  return { ok: true, account };
}

const MAX_BODY_BYTES = 14 * 1024 * 1024;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_PHOTO_BYTES = 9 * 1024 * 1024;
const MIN_FILL_MS = 3000;
const MAX_PHOTOS = 5;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}

function numericPrice(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function numericQuantity(value) {
  // Preserve the original quantity field for older dashboards.
  // The exact range is also saved in quantity_text.
  if (value === '1') return 1;
  if (value === '2-3') return 2;
  if (value === '4-10') return 4;
  if (value === '10+') return 10;

  return null;
}


async function persistReportPhotos(env, photos) {
  if (!photos.length) return [];
  if (!env.VENDOR_MEDIA) throw new Error('report_photo_storage_not_configured');
  const urls = [];
  for (const photo of photos) {
    const extension = photo.name.split('.').pop().toLowerCase();
    const key = 'reports/' + crypto.randomUUID() + '.' + extension;
    await env.VENDOR_MEDIA.put(key, photo.file, {
      httpMetadata: {
        contentType: photo.file.type,
        cacheControl: 'public, max-age=31536000, immutable'
      }
    });
    urls.push('/api/vendor/image?key=' + encodeURIComponent(key));
  }
  return urls;
}

function makeStoreDetails(report) {
  const ctx = {
    get: function (id) {
      return report[id] || '';
    }
  };

  const option =
    typeof formConfig.getOption === 'function'
      ? formConfig.getOption('branch', report.branch, ctx)
      : null;

  let branchLabel = option ? option.label : '';

  if (report.branch === 'manual') {
    branchLabel = 'Manually entered store';
  }

  // Use the directory label as the authoritative location for a listed branch.
  // Its expected format is "Town — street address".
  if (report.branch !== 'manual' && option) {
    const parts = String(option.label).split(' — ');

    return {
      branchLabel: option.label,
      town: parts.length > 1 ? parts[0].trim() : '',
      address: parts.length > 1
        ? parts.slice(1).join(' — ').trim()
        : '',
      location: option.label
    };
  }

  const town = String(report.storeTown || '').trim();
  const address = String(report.storeAddress || '').trim();

  return {
    branchLabel: branchLabel || 'Manually entered store',
    town,
    address,
    location: [town, address].filter(Boolean).join(' — ')
  };
}

async function handleLineReport(data, env, form, access) {
  // Line-report columns are only available after the dedicated schema migration.
  // Fail clearly before uploading photos or attempting an INSERT against legacy production D1.
  try {
    const schema = await env.DB.prepare('PRAGMA table_info(reports)').all();
    const columns = new Set((schema.results || []).map(column => column.name));
    const required = ['report_type', 'line_count', 'stocked_by'];
    if (!required.every(column => columns.has(column))) {
      return json({
        ok: false,
        error: 'line_reports_not_enabled',
        message: 'Line reports are temporarily unavailable while this database uses the legacy schema.'
      }, 503);
    }
  } catch (error) {
    console.error('Line report schema check failed:', error);
    return json({ ok: false, error: 'database_schema_check_failed' }, 503);
  }


  const errors = {};
  ['state', 'retailer', 'branch'].forEach(function (id) {
    const field = formConfig.getField(id);
    const options = formConfig.getOptions(id, {
      get: function (key) { return data[key] || ''; }
    }) || [];
    const message = validate.validateField(field, data[id], { options });
    if (message) errors[id] = message;
  });

  ['lineCount', 'lineSeenAt', 'stockedBy'].forEach(function (id) {
    const field = formConfig.getField(id);
    const options = formConfig.getOptions(id) || [];
    const message = validate.validateField(field, data[id], {
      options,
      futureToleranceMs: 15 * 60 * 1000
    });
    if (message) errors[id] = message;
  });

  if (data.branch === 'manual') {
    if (String(data.storeTown || '').trim().length < 2) {
      errors.storeTown = 'Enter the town or city for this store.';
    }
    if (String(data.storeAddress || '').trim().length < 3) {
      errors.storeAddress = 'Enter the street address for this store.';
    }
  }

  if (Object.keys(errors).length) {
    return json({ ok: false, error: 'invalid', errors }, 422);
  }

  // Optional photo evidence is processed using the same limits as stock reports.
  const files = form.getAll('photos').filter(function (file) {
    return typeof file !== 'string' && file.size > 0;
  });

  if (files.length > MAX_PHOTOS) {
    return json({ ok: false, error: 'too_many_photos' }, 422);
  }

  let totalPhotoBytes = 0;
  const photos = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      return json({ ok: false, error: 'bad_photo' }, 422);
    }

    if (file.size > MAX_PHOTO_BYTES) {
      return json({ ok: false, error: 'photo_too_large' }, 413);
    }

    totalPhotoBytes += file.size;
    if (totalPhotoBytes > MAX_TOTAL_PHOTO_BYTES) {
      return json({ ok: false, error: 'photo_too_large' }, 413);
    }

    const extension = file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
        ? 'webp'
        : 'jpg';

    photos.push({ file, name: 'line-photo' + (i + 1) + '.' + extension });
  }

  let photoNames;
  try {
    photoNames = await persistReportPhotos(env, photos);
  } catch (error) {
    console.error('Report photo upload failed:', error);
    return json({ ok: false, error: String(error && error.message || '').includes('not_configured') ? 'photo_storage_not_configured' : 'photo_upload_failed' }, String(error && error.message || '').includes('not_configured') ? 503 : 500);
  }

  const store = makeStoreDetails(data);
  const lineNotes = String(data.lineNotes || '').trim().slice(0, 1000);
  const stockedByLabels = {
    vendor: 'Vendor',
    store_employees: 'Store employees',
    unknown: 'Not sure'
  };
  const report = {
    reportType: 'line',
    state: data.state,
    retailer: data.retailer,
    branch: data.branch,
    branchLabel: store.branchLabel,
    storeTown: store.town,
    storeAddress: store.address,
    location: store.location,
    lineCount: data.lineCount,
    lineSeenAt: new Date(data.lineSeenAt).toISOString(),
    stockedBy: data.stockedBy,
    stockedByLabel: stockedByLabels[data.stockedBy] || 'Not sure',
    submittedByUsername: data.submittedByUsername || ''
  };

  try {
    await env.DB.prepare(`
      INSERT INTO reports (
        store, location, product, quantity, price, reported_by, photo_url,
        notes, price_type, product_located, seen_at, still_there, state,
        branch_id, store_town, store_address, product_name, quantity_text,
        shelf_price, msrp, report_type, line_count, stocked_by
      ) VALUES (
        ?, ?, '', NULL, NULL, '', ?, ?, 'Line report', '', ?, '', ?,
        ?, ?, ?, '', ?, NULL, NULL, 'line', ?, ?
      )
    `).bind(
      report.retailer,
      report.location,
      photoNames.join(', '),
      [
        'Line report — ' + report.lineCount + ' people; stocked by ' + report.stockedByLabel,
        lineNotes ? 'Additional notes: ' + lineNotes : ''
      ].filter(Boolean).join('\\n'),
      report.lineSeenAt,
      report.state,
      report.branch,
      report.storeTown,
      report.storeAddress,
      Number(report.lineCount),
      report.lineCount,
      report.stockedBy
    ).run();
  } catch (error) {
    console.error('Line report D1 database error:', error);
    return json({ ok: false, error: 'database_error' }, 500);
  }

  if (access?.account?.id && !access.legacyVip) {
    try { await awardCollectorBasicAchievement(env, Number(access.account.id), 'basic_make_report'); }
    catch (error) { console.warn('Could not record report achievement:', error); }
  }

  try {
    const delivery = await notifyReport(env, report);
    return json({ ok: true, alerted: delivery.inAppCreated > 0 || delivery.pushDelivered > 0, delivery });
  } catch (error) {
    console.error('Line report notification fan-out failed after report was saved:', error);
    return json({ ok: true, alerted: false, warning: 'notification_delivery_failed' });
  }
}

export async function onRequestPost({ request, env }) {
  let access;
  try {
    access = await requireActivePaidAccount(request, env);
  } catch (error) {
    console.error('Paid report access check failed:', error);
    return json({ ok: false, error: 'membership_check_failed' }, 500);
  }
  if (!access.ok) {
    return json({
      ok: false,
      error: access.error,
      message: access.error === 'login_required'
        ? 'Sign in to a PokePrizePool account with an active paid membership to submit reports.'
        : 'An active paid PokePrizePool membership is required to submit reports.'
    }, access.status);
  }

  // Resolve the submitter's username from the authenticated account, not client input.
  let submittedByUsername = '';
  if (!access.legacyVip && access.account && access.account.id) {
    try {
      const profile = await env.DB.prepare(
        `SELECT p.username, a.display_name
         FROM accounts a
         LEFT JOIN collector_profiles p ON p.account_id = a.id
         WHERE a.id = ? LIMIT 1`
      ).bind(access.account.id).first();
      submittedByUsername = String(profile && (profile.username || profile.display_name) || '').trim();
    } catch (error) {
      console.warn('Could not resolve report submitter username:', error);
    }
  }

  const declared = Number(
    request.headers.get('content-length') || 0
  );

  if (declared > MAX_BODY_BYTES) {
    return json({
      ok: false,
      error: 'too_large'
    }, 413);
  }

  let form;

  try {
    form = await request.formData();
  } catch (error) {
    console.error('Report form parsing error:', error);

    return json({
      ok: false,
      error: 'bad_request'
    }, 400);
  }

  const honeypot = String(form.get('website') || '');
  const elapsed = Number(form.get('elapsedMs') || 0);

  // Keep the existing bot-trap behavior.
  if (honeypot || elapsed < MIN_FILL_MS) {
    return json({ ok: true });
  }

  let data;

  try {
    data = JSON.parse(String(form.get('data') || ''));
  } catch (error) {
    return json({
      ok: false,
      error: 'bad_request'
    }, 400);
  }

  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    return json({
      ok: false,
      error: 'bad_request'
    }, 400);
  }

  if (data.reportType === 'line') {
    if (submittedByUsername) data.submittedByUsername = submittedByUsername;
    return handleLineReport(data, env, form, access);
  }

  const result = validate.validateAll(
    formConfig,
    data,
    {
      futureToleranceMs: 15 * 60 * 1000
    }
  );

  if (!result.ok) {
    return json({
      ok: false,
      error: 'invalid',
      errors: result.errors
    }, 422);
  }

  const report = result.clean;
  if (submittedByUsername) report.submittedByUsername = submittedByUsername;

  /*
   * Resolve the chosen branch against the configured directory.
   * Do not trust a submitted branch label or address for listed stores.
   */
  const store = makeStoreDetails(report);

  report.branchLabel = store.branchLabel;
  report.storeTown = store.town;
  report.storeAddress = store.address;
  report.location = store.location;

  // Compatibility fields for the current Discord alert builder.
  report.price = report.shelfPrice;
  report.priceType = 'Shelf price';

  /*
   * Validate uploaded photos.
   */
  const files = form.getAll('photos').filter(function (file) {
    return typeof file !== 'string';
  });

  if (files.length > MAX_PHOTOS) {
    return json({
      ok: false,
      error: 'too_many_photos'
    }, 422);
  }

  let total = 0;
  const photos = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      return json({
        ok: false,
        error: 'bad_photo'
      }, 422);
    }

    if (file.size > MAX_PHOTO_BYTES) {
      return json({
        ok: false,
        error: 'photo_too_large'
      }, 413);
    }

    total += file.size;

    if (total > MAX_TOTAL_PHOTO_BYTES) {
      return json({
        ok: false,
        error: 'photo_too_large'
      }, 413);
    }

    const extension = file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
        ? 'webp'
        : 'jpg';

    photos.push({
      file,
      name: 'photo' + (i + 1) + '.' + extension
    });
  }

  let photoNames;
  try {
    photoNames = await persistReportPhotos(env, photos);
  } catch (error) {
    console.error('Report photo upload failed:', error);
    return json({ ok: false, error: String(error && error.message || '').includes('not_configured') ? 'photo_storage_not_configured' : 'photo_upload_failed' }, String(error && error.message || '').includes('not_configured') ? 503 : 500);
  }

  /*
   * SAVE REPORT TO D1.
   *
   * This INSERT matches the existing reports table:
   * id and created_at are populated automatically.
   * product_type is intentionally omitted because that column does not exist.
   */
  try {
    const sql = `
      INSERT INTO reports (
        store,
        location,
        product,
        quantity,
        price,
        reported_by,
        photo_url,
        notes,
        price_type,
        product_located,
        seen_at,
        still_there,
        state,
        branch_id,
        store_town,
        store_address,
        product_name,
        quantity_text,
        shelf_price,
        msrp
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `;

    const productForLegacyViews = [
      report.product || '',
      report.productName || ''
    ].filter(Boolean).join(' — ');

    await env.DB.prepare(sql)
      .bind(
        report.retailer || '',
        report.location || '',
        productForLegacyViews,
        numericQuantity(report.qty),
        numericPrice(report.shelfPrice),
        report.reporter || '',
        photoNames.join(', '),
        report.notes || '',
        'Shelf price',
        report.productLocated || '',
        report.seenAt || '',
        report.stillThere || '',
        report.state || '',
        report.branch || '',
        report.storeTown || '',
        report.storeAddress || '',
        report.productName || '',
        report.qty || '',
        numericPrice(report.shelfPrice),
        numericPrice(report.msrp)
      )
      .run();
  } catch (error) {
    console.error('D1 database error:', error);

    return json({
      ok: false,
      error: 'database_error'
    }, 500);
  }

  if (access?.account?.id && !access.legacyVip) {
    try { await awardCollectorBasicAchievement(env, Number(access.account.id), 'basic_make_report'); }
    catch (error) { console.warn('Could not record report achievement:', error); }
  }

  /*
   * Reports are stored before notification delivery. Push failures must not
   * make a successful database write look like a failed report submission.
   */
  try {
    const delivery = await notifyReport(env, report);
    return json({ ok: true, alerted: delivery.inAppCreated > 0 || delivery.pushDelivered > 0, delivery });
  } catch (error) {
    console.error('Stock report notification fan-out failed after report was saved:', error);
    return json({ ok: true, alerted: false, warning: 'notification_delivery_failed' });
  }
}

export async function onRequest() {
  return json({
    ok: false,
    error: 'method_not_allowed'
  }, 405);
}
