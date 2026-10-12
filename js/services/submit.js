
/*
 * SUBMISSION ADAPTER
 *
 * The UI calls VIP.submit.send(report, photos, meta).
 * The server controls membership access, validation, storage and alerts.
 *
 * This version reports known server errors clearly so failures can be
 * diagnosed without blindly resubmitting a report.
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
    network:
      "Couldn't reach the server. Check your connection and try again.",

    busy:
      'Discord is busy right now. Wait a few seconds before trying again.',

    photo_too_large:
      'Your photos are too large to send. Remove a photo and try again.',

    too_many_photos:
      'You can add up to 5 photos.',

    bad_photo:
      "One of the files isn't a supported photo. Use JPG, PNG or WebP.",

    not_configured:
      "The report alert system isn't configured correctly. Please tell an admin.",

    membership_required:
      'VIP membership is required to submit a report. Please sign in again.',

    membership_expired:
      'Your VIP membership is no longer active. Please renew your membership.',

    membership_check_failed:
      'The server could not verify your membership. Please try again later.',

    database_error:
      'The report could not be saved to the database. Please contact an admin before submitting it again.',

    discord_unreachable:
      'The report may already be saved, but the server could not reach Discord. Check the report dashboard before submitting again.',

    discord_error:
      'The report may already be saved, but Discord rejected the alert. Check the report dashboard before submitting again.',

    too_large:
      'The report or its photos are too large. Remove some photos and try again.',

    bad_request:
      'The server could not read the report. Refresh the page and try again.',

    invalid:
      'Some answers need fixing. Review the highlighted fields.',

    method_not_allowed:
      'The report endpoint received an unsupported request.',

    default:
      'The server returned an unexpected error. Check the report dashboard before trying again.'
  };

  async function send(report, photos, meta) {
    var cfg = VIP.siteConfig;

    if (cfg.demoMode) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 1300);
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

    (photos || []).forEach(function (photo, index) {
      if (!photo || !photo.blob) {
        return;
      }

      fd.append(
        'photos',
        photo.blob,
        'photo' + (index + 1) + '.jpg'
      );
    });

    var response;

    try {
      response = await fetch(cfg.submitEndpoint, {
        method: 'POST',
        body: fd,
        credentials: 'include'
      });
    } catch (error) {
      throw SubmitError('network', MESSAGES.network);
    }

    var body;

    try {
      body = await response.json();
    } catch (error) {
      throw SubmitError(
        'invalid_server_response',
        'The server returned an unreadable response. Check the report dashboard before submitting again.'
      );
    }

    if (response.ok && body && body.ok) {
      return body;
    }

    var code =
      body && typeof body.error === 'string'
        ? body.error
        : 'default';

    if (code === 'invalid') {
      throw SubmitError(
        'invalid',
        MESSAGES.invalid,
        body.errors || {}
      );
    }

    if (code === 'membership_required') {
      throw SubmitError(
        code,
        MESSAGES[code]
      );
    }

    if (code === 'membership_expired') {
      throw SubmitError(
        code,
        MESSAGES[code]
      );
    }

    /*
     * Keep the actual server error code on the Error object for debugging.
     * Never display raw server stack traces or secrets to members.
     */
    throw SubmitError(
      code,
      MESSAGES[code] || MESSAGES.default
    );
  }

  VIP.submit = {
    send: send
  };
})();
