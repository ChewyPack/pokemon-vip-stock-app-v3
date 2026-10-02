/*
 * SUBMISSION ADAPTER
 *
 * The UI calls VIP.submit.send(report, photos, meta) and nothing else.
 * The server decides whether the user has access to submit reports.
 */
(function () {
  var VIP = (window.VIP = window.VIP || {});

  function SubmitError(code, message, errors) {
    var e = new Error(message);
    e.code = code;
    e.fieldErrors = errors || null;
    return e;
  }

  var MESSAGES = {
    network: "Couldn't reach the server. Check your connection and try again.",
    busy: 'Discord is busy right now. Wait a few seconds and try again.',
    photo_too_large: 'Your photos are too large to send. Remove one and try again.',
    too_many_photos: 'You can add up to 5 photos.',
    bad_photo: "One of the files isn't a supported photo. Remove it and try again.",
    not_configured: "This site isn't connected to Discord yet. Tell an admin.",
    membership_required: 'VIP membership is required to submit a report.',
    membership_expired: 'Your VIP membership is no longer active. Please renew your membership.',
    default: "Something went wrong sending your report. Try again in a moment."
  };

  async function send(report, photos, meta) {
    var cfg = VIP.siteConfig;

    if (cfg.demoMode) {
      await new Promise(function (r) {
        setTimeout(r, 1300);
      });

      return {
        ok: true,
        demo: true,
        alerted: report.stillThere === 'Yes'
      };
    }

    var fd = new FormData();

    fd.append('data', JSON.stringify(report));
    fd.append('elapsedMs', String(meta.elapsedMs));
    fd.append('website', meta.honeypot || '');

    photos.forEach(function (p, i) {
      fd.append('photos', p.blob, 'photo' + (i + 1) + '.jpg');
    });

    var res;

    try {
      res = await fetch(cfg.submitEndpoint, {
        method: 'POST',
        body: fd,
        credentials: 'include'
      });
    } catch (e) {
      throw SubmitError('network', MESSAGES.network);
    }

    var body = null;

    try {
      body = await res.json();
    } catch (e) {}

    if (res.ok && body && body.ok) {
      return body;
    }

    var code = (body && body.error) || 'default';

    if (code === 'invalid') {
      throw SubmitError(
        'invalid',
        'Some answers need fixing.',
        body.errors
      );
    }

    if (code === 'membership_required') {
      throw SubmitError(
        'membership_required',
        MESSAGES.membership_required
      );
    }

    if (code === 'membership_expired') {
      throw SubmitError(
        'membership_expired',
        MESSAGES.membership_expired
      );
    }

    throw SubmitError(
      code,
      MESSAGES[code] || MESSAGES.default
    );
  }

  VIP.submit = {
    send: send
  };
})();
