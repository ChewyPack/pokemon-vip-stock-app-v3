
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
 * Environment variables:
 *   DISCORD_WEBHOOK_URL       required
 *   DISCORD_ALERT_ROLE_ID     optional
 *   DISCORD_LOG_WEBHOOK_URL   optional
 *
 * IMPORTANT:
 * The existing reports table does not contain a product_type column.
 * This version matches the actual database schema.
 */

import formConfig from '../../js/shared/form-config.js';
import validate from '../../js/shared/validate.js';
import { buildAlert } from '../discord.js';

const MAX_BODY_BYTES = 14 * 1024 * 1024;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_PHOTO_BYTES = 9 * 1024 * 1024;
const MIN_FILL_MS = 3000;
const MAX_PHOTOS = 5;

const WEBHOOK_PREFIX =
  /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//;

const SESSION_COOKIE = 'vip_session';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';

  for (const part of header.split(';')) {
    const trimmed = part.trim();

    if (trimmed.startsWith(name + '=')) {
      return trimmed.substring(name.length + 1);
    }
  }

  return '';
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256(value) {
  return crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
}

async function getActiveMember(request, env) {
  const token = getCookie(request, SESSION_COOKIE);

  if (!token) {
    return null;
  }

  const hashBuffer = await sha256(token);
  const tokenHash = base64Url(hashBuffer);

  const result = await env.DB.prepare(
    `SELECT id, name, email, membership_status,
            membership_type, session_expires_at
     FROM users
     WHERE session_token_hash = ?
       AND membership_status = 'active'
     LIMIT 1`
  )
    .bind(tokenHash)
    .first();

  if (!result) {
    return null;
  }

  if (
    !result.session_expires_at ||
    Number(result.session_expires_at) < Date.now()
  ) {
    return null;
  }

  return result;
}

async function postToDiscord(webhookUrl, payload, photos) {
  const url =
    webhookUrl +
    (webhookUrl.includes('?') ? '&' : '?') +
    'wait=true';

  if (!photos.length) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  }

  const body = new FormData();

  body.append('payload_json', JSON.stringify(payload));

  photos.forEach(function (photo, index) {
    body.append(
      'files[' + index + ']',
      photo.file,
      photo.name
    );
  });

  return fetch(url, {
    method: 'POST',
    body
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

export async function onRequestPost({ request, env }) {
  /*
   * MEMBERSHIP CHECK
   * Only active members with a valid session can submit reports.
   */
  try {
    const member = await getActiveMember(request, env);

    if (!member) {
      return json({
        ok: false,
        error: 'membership_required'
      }, 403);
    }
  } catch (error) {
    console.error('Membership check error:', error);

    return json({
      ok: false,
      error: 'membership_check_failed'
    }, 500);
  }

  const alertUrl = env.DISCORD_WEBHOOK_URL || '';

  if (!WEBHOOK_PREFIX.test(alertUrl)) {
    return json({
      ok: false,
      error: 'not_configured'
    }, 500);
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

  const photoNames = photos.map(function (photo) {
    return photo.name;
  });

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

  /*
   * BUILD DISCORD ALERT.
   * The current alert builder receives compatibility fields above.
   */
  let alert;

  try {
    alert = buildAlert(report, {
      roleId: env.DISCORD_ALERT_ROLE_ID || '',
      photoNames
    });
  } catch (error) {
    console.error('Discord alert build error:', error);

    // The report has already been saved. Do not report it as unsaved.
    return json({
      ok: true,
      alerted: false,
      warning: 'alert_build_failed'
    });
  }

  const sends = [];

  // Main alert channel: only reports marked as still in stock.
  if (alert.inStock) {
    sends.push(postToDiscord(alertUrl, alert.payload, photos));
  }

  // Optional log channel: all valid reports.
  const logUrl = env.DISCORD_LOG_WEBHOOK_URL || '';

  if (WEBHOOK_PREFIX.test(logUrl)) {
    try {
      const log = buildAlert(report, {
        roleId: '',
        photoNames
      });

      sends.push(postToDiscord(logUrl, log.payload, photos));
    } catch (error) {
      console.error('Discord log alert build error:', error);
    }
  }

  let responses;

  try {
    responses = await Promise.all(sends);
  } catch (error) {
    console.error('Discord connection error:', error);

    // D1 already contains the report. Return success to prevent accidental
    // duplicate submissions when only Discord delivery failed.
    return json({
      ok: true,
      alerted: false,
      warning: 'discord_unreachable'
    });
  }

  if (responses.some(function (response) {
    return response.status === 429;
  })) {
    console.error('Discord rate limit reached after report was saved.');

    return json({
      ok: true,
      alerted: false,
      warning: 'discord_rate_limited'
    });
  }

  if (responses.some(function (response) {
    return !response.ok;
  })) {
    console.error(
      'Discord rejected an alert after report was saved:',
      responses.map(function (response) {
        return response.status;
      })
    );

    return json({
      ok: true,
      alerted: false,
      warning: 'discord_rejected'
    });
  }

  return json({
    ok: true,
    alerted: !!alert.inStock
  });
}

export async function onRequest() {
  return json({
    ok: false,
    error: 'method_not_allowed'
  }, 405);
}
