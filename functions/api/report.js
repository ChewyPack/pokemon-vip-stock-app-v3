```javascript
/*
 * POST /api/report
 *
 * Browser sends multipart form data:
 *   data         JSON string with the answers
 *   photos       0-5 image files
 *   elapsedMs    how long the member spent on the form (bot check)
 *   website      honeypot field, must be empty
 *
 * Cloudflare binding:
 *   DB -> pokemon-vip-members
 *
 * Environment variables:
 *   DISCORD_WEBHOOK_URL       required. In-stock alerts post here.
 *   DISCORD_ALERT_ROLE_ID     optional. Role to ping on in-stock alerts.
 *   DISCORD_LOG_WEBHOOK_URL   optional. Every report posts here.
 */

import formConfig from '../../js/shared/form-config.js';
import validate from '../../js/shared/validate.js';
import { buildAlert } from '../discord.js';

const MAX_BODY_BYTES = 14 * 1024 * 1024;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_PHOTO_BYTES = 9 * 1024 * 1024;
const MIN_FILL_MS = 3000;

const WEBHOOK_PREFIX =
  /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
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

  body.append(
    'payload_json',
    JSON.stringify(payload)
  );

  photos.forEach(function (p, i) {
    body.append(
      'files[' + i + ']',
      p.file,
      p.name
    );
  });

  return fetch(url, {
    method: 'POST',
    body
  });
}

export async function onRequestPost({ request, env }) {
  /*
   * Verify Discord configuration.
   */
  const alertUrl = env.DISCORD_WEBHOOK_URL || '';

  if (!WEBHOOK_PREFIX.test(alertUrl)) {
    return json(
      {
        ok: false,
        error: 'not_configured'
      },
      500
    );
  }

  /*
   * Reject extremely large requests.
   */
  const declared = Number(
    request.headers.get('content-length') || 0
  );

  if (declared > MAX_BODY_BYTES) {
    return json(
      {
        ok: false,
        error: 'too_large'
      },
      413
    );
  }

  /*
   * Read multipart form.
   */
  let form;

  try {
    form = await request.formData();
  } catch (e) {
    return json(
      {
        ok: false,
        error: 'bad_request'
      },
      400
    );
  }

  /*
   * Bot checks.
   *
   * Bots that fill the honeypot or submit too quickly
   * receive a fake success response.
   */
  const honeypot = String(
    form.get('website') || ''
  );

  const elapsed = Number(
    form.get('elapsedMs') || 0
  );

  if (honeypot || elapsed < MIN_FILL_MS) {
    return json({
      ok: true
    });
  }

  /*
   * Parse submitted JSON.
   */
  let data;

  try {
    data = JSON.parse(
      String(form.get('data') || '')
    );
  } catch (e) {
    return json(
      {
        ok: false,
        error: 'bad_request'
      },
      400
    );
  }

  /*
   * Validate the report against the shared form config.
   */
  const result = validate.validateAll(
    formConfig,
    data,
    {
      futureToleranceMs: 15 * 60 * 1000
    }
  );

  if (!result.ok) {
    return json(
      {
        ok: false,
        error: 'invalid',
        errors: result.errors
      },
      422
    );
  }

  const report = result.clean;

  /*
   * Process photos.
   */
  const files = form
    .getAll('photos')
    .filter(function (f) {
      return typeof f !== 'string';
    });

  if (
    files.length >
    formConfig.limits.maxPhotos
  ) {
    return json(
      {
        ok: false,
        error: 'too_many_photos'
      },
      422
    );
  }

  let total = 0;
  const photos = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];

    if (
      !/^image\/(jpeg|png|webp)$/.test(f.type)
    ) {
      return json(
        {
          ok: false,
          error: 'bad_photo'
        },
        422
      );
    }

    if (f.size > MAX_PHOTO_BYTES) {
      return json(
        {
          ok: false,
          error: 'photo_too_large'
        },
        413
      );
    }

    total += f.size;

    photos.push({
      file: f,
      name: 'photo' + (i + 1) + '.jpg'
    });
  }

  if (total > MAX_TOTAL_PHOTO_BYTES) {
    return json(
      {
        ok: false,
        error: 'photo_too_large'
      },
      413
    );
  }

  const photoNames = photos.map(function (p) {
    return p.name;
  });

  /*
   * SAVE REPORT TO D1
   *
   * DB is the Cloudflare D1 binding
   * connected to pokemon-vip-members.
   */
  try {
    await env.DB
      .prepare(
        `
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
          still_there
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .bind(
        report.retailer || '',
        report.location || '',
        report.product || '',
        report.qty || '',
        report.price !== undefined &&
        report.price !== ''
          ? Number(report.price)
          : null,
        report.reporter || '',
        photoNames.join(', '),
        report.notes || '',
        report.priceType || '',
        report.productLocated || '',
        report.seenAt || '',
        report.stillThere || ''
      )
      .run();
  } catch (e) {
    return json(
      {
        ok: false,
        error: 'database_error'
      },
      500
    );
  }

  /*
   * Build Discord alert.
   */
  const alert = buildAlert(report, {
    roleId:
      env.DISCORD_ALERT_ROLE_ID || '',
    photoNames
  });

  const sends = [];

  /*
   * In-stock reports only go to the alert channel.
   */
  if (alert.inStock) {
    sends.push(
      postToDiscord(
        alertUrl,
        alert.payload,
        photos
      )
    );
  }

  /*
   * Optional log channel receives every report.
   */
  const logUrl =
    env.DISCORD_LOG_WEBHOOK_URL || '';

  if (WEBHOOK_PREFIX.test(logUrl)) {
    const log = buildAlert(report, {
      roleId: '',
      photoNames
    });

    sends.push(
      postToDiscord(
        logUrl,
        log.payload,
        photos
      )
    );
  }

  /*
   * Send Discord messages.
   */
  let responses;

  try {
    responses = await Promise.all(sends);
  } catch (e) {
    return json(
      {
        ok: false,
        error: 'discord_unreachable'
      },
      502
    );
  }

  /*
   * Discord rate limit.
   */
  if (
    responses.some(function (r) {
      return r.status === 429;
    })
  ) {
    return json(
      {
        ok: false,
        error: 'busy'
      },
      503
    );
  }

  /*
   * Discord returned an error.
   */
  if (
    responses.some(function (r) {
      return !r.ok;
    })
  ) {
    return json(
      {
        ok: false,
        error: 'discord_error'
      },
      502
    );
  }

  /*
   * Successful submission.
   */
  return json({
    ok: true,
    alerted: alert.inStock
  });
}

/*
 * Reject GET/other requests.
 */
export async function onRequest() {
  return json(
    {
      ok: false,
      error: 'method_not_allowed'
    },
    405
  );
}
```
