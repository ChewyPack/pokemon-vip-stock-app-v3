/*
 * VALIDATION — shared by the browser (inline errors) and the server function
 * (the real gatekeeper). Pure functions, no DOM, no network.
 *
 *   validateField(field, rawValue, opts)  -> error message ('' when valid)
 *   validateAll(config, values, opts)     -> { ok, errors, clean }
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VIP = root.VIP || {};
    root.VIP.validate = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  var PRICE_RE = /^\$?\s*(\d{1,4})(\.\d{1,2})?$/;

  function str(v) {
    return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
  }

  function requiredMessage(field) {
    if (field.type === 'choice') return 'Pick one to continue.';
    if (field.type === 'datetime') return 'Add when you saw it.';
    return 'Fill this in to continue.';
  }

  function normalizePrice(v) {
    var m = PRICE_RE.exec(str(v));
    if (!m) return '';
    var n = Number(m[1] + (m[2] || ''));
    return n.toFixed(2).replace(/\.00$/, '');
  }

  function validateField(field, raw, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var tolerance = opts.futureToleranceMs === undefined ? 5 * 60 * 1000 : opts.futureToleranceMs;
    var v = field.type === 'textarea' ? String(raw === null || raw === undefined ? '' : raw).trim() : str(raw);

    if (field.type === 'photos') return ''; // photo count and size are checked where the files live

    if (v === '') return field.required ? requiredMessage(field) : '';

    switch (field.type) {
      case 'choice': {
        var ok = (field.options || []).some(function (o) {
          return o.value === v;
        });
        return ok ? '' : 'Pick one of the options.';
      }
      case 'text': {
        if (field.minLength && v.length < field.minLength) {
          return 'Use at least ' + field.minLength + ' characters.';
        }
        if (field.maxLength && v.length > field.maxLength) {
          return 'Keep it under ' + field.maxLength + ' characters.';
        }
        return '';
      }
      case 'textarea': {
        if (field.maxLength && v.length > field.maxLength) {
          return 'Keep it under ' + field.maxLength + ' characters.';
        }
        return '';
      }
      case 'price': {
        return PRICE_RE.test(v) ? '' : 'Enter a price like 59.99, or leave it blank.';
      }
      case 'datetime': {
        var t = Date.parse(v);
        if (isNaN(t)) return 'Enter a valid date and time.';
        if (t > now + tolerance) return 'That time is in the future.';
        return '';
      }
      default:
        return '';
    }
  }

  function clean(field, raw) {
    if (field.type === 'textarea') return String(raw === null || raw === undefined ? '' : raw).trim();
    var v = str(raw);
    if (field.type === 'price') return normalizePrice(v);
    if (field.type === 'datetime') {
      var t = Date.parse(v);
      return isNaN(t) ? '' : new Date(t).toISOString();
    }
    return v;
  }

  function validateAll(config, values, opts) {
    values = values || {};
    var errors = {};
    var out = {};
    config.fields.forEach(function (field) {
      if (field.type === 'photos') return;
      var msg = validateField(field, values[field.id], opts);
      if (msg) errors[field.id] = msg;
      out[field.id] = clean(field, values[field.id]);
    });
    return { ok: Object.keys(errors).length === 0, errors: errors, clean: out };
  }

  return {
    validateField: validateField,
    validateAll: validateAll,
    normalizePrice: normalizePrice
  };
});
