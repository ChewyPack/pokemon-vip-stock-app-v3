
/*
 * VALIDATION — shared by the browser (inline errors) and the server function
 * (the real gatekeeper). Pure functions, no DOM, no network.
 *
 *   validateField(field, rawValue, opts) -> error message ('' when valid)
 *   validateAll(config, values, opts) -> { ok, errors, clean }
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
    return v === null || v === undefined
      ? ''
      : String(v).replace(/\s+/g, ' ').trim();
  }

  function requiredMessage(field) {
    if (field.type === 'choice' || field.type === 'select') {
      return 'Pick one to continue.';
    }
    if (field.type === 'datetime') {
      return 'Add when you saw it.';
    }
    return 'Fill this in to continue.';
  }

  function normalizePrice(v) {
    var m = PRICE_RE.exec(str(v));
    if (!m) return '';

    var n = Number(m[1] + (m[2] || ''));
    return n.toFixed(2).replace(/\.00$/, '');
  }

  function getOptions(field, opts) {
    opts = opts || {};

    // Dynamic options can be supplied by validateAll for fields such as
    // the branch dropdown, whose options depend on state and retailer.
    if (Array.isArray(opts.options)) {
      return opts.options;
    }

    if (Array.isArray(field.options)) {
      return field.options;
    }

    return [];
  }

  function validateField(field, raw, opts) {
    opts = opts || {};

    var now = opts.now || Date.now();
    var tolerance =
      opts.futureToleranceMs === undefined
        ? 5 * 60 * 1000
        : opts.futureToleranceMs;

    var v =
      field.type === 'textarea'
        ? String(raw === null || raw === undefined ? '' : raw).trim()
        : str(raw);

    // File count and size are checked by the existing upload-handling code.
    if (field.type === 'photos') return '';

    if (v === '') {
      return field.required ? requiredMessage(field) : '';
    }

    switch (field.type) {
      case 'choice':
      case 'select': {
        var options = getOptions(field, opts);

        var valid = options.some(function (option) {
          return option && String(option.value) === v;
        });

        return valid ? '' : 'Pick one of the available options.';
      }

      case 'number': {
        var number = Number(v);
        if (!Number.isInteger(number)) return 'Enter a whole number.';
        if (field.min !== undefined && number < field.min) return 'Enter at least ' + field.min + '.';
        if (field.max !== undefined && number > field.max) return 'Enter no more than ' + field.max + '.';
        return '';
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
        return PRICE_RE.test(v)
          ? ''
          : 'Enter a price like 59.99, or leave it blank.';
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
    if (field.type === 'textarea') {
      return String(raw === null || raw === undefined ? '' : raw).trim();
    }

    var v = str(raw);

    if (field.type === 'price') {
      return normalizePrice(v);
    }

    if (field.type === 'number') {
      return v === '' ? '' : String(Number(v));
    }

    if (field.type === 'datetime') {
      var t = Date.parse(v);
      return isNaN(t) ? '' : new Date(t).toISOString();
    }

    return v;
  }

  function validateAll(config, values, opts) {
    values = values || {};
    opts = opts || {};

    var errors = {};
    var out = {};

    /*
     * Build a context for dynamic options. The form config can use
     * ctx.get('state') and ctx.get('retailer') to populate the branch list.
     * Already-cleaned values take precedence as fields are processed.
     */
    var ctx = {
      get: function (id) {
        if (Object.prototype.hasOwnProperty.call(out, id)) {
          return out[id];
        }
        return values[id];
      }
    };

    config.fields.forEach(function (field) {
      if (field.type === 'photos') return;

      var fieldOpts = {};
      Object.keys(opts).forEach(function (key) {
        fieldOpts[key] = opts[key];
      });

      // Resolve dynamic dropdown options using the current submitted values.
      if (
        (field.type === 'select' || field.type === 'choice') &&
        config &&
        typeof config.getOptions === 'function'
      ) {
        fieldOpts.options = config.getOptions(field.id, ctx) || [];
      }

      var msg = validateField(field, values[field.id], fieldOpts);

      if (msg) {
        errors[field.id] = msg;
      }

      out[field.id] = clean(field, values[field.id]);
    });

    /*
     * Server-side protection for the manual store-entry path.
     * When branch === "manual", both town and address must be provided,
     * even if those fields are optional for directory-listed branches.
     */
    if (out.branch === 'manual') {
      if (!out.storeTown) {
        errors.storeTown = 'Enter the town or city for this store.';
      }

      if (!out.storeAddress) {
        errors.storeAddress = 'Enter the street address for this store.';
      }
    }

    return {
      ok: Object.keys(errors).length === 0,
      errors: errors,
      clean: out
    };
  }

  return {
    validateField: validateField,
    validateAll: validateAll,
    normalizePrice: normalizePrice
  };
});
