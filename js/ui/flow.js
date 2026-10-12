
/*
 * MULTI-STEP REPORT FORM FLOW
 *
 * Coordinates form steps, field renderers, draft state, validation,
 * conditional store fields, progress, and final submission.
 *
 * Dynamic select options are passed to validateField() during
 * per-step validation so the store branch dropdown validates correctly.
 */
(function () {
  var VIP = (window.VIP = window.VIP || {});
  var cfg = VIP.formConfig;
  var V = VIP.validate;

  if (!cfg || !V || !VIP.fields || !VIP.h) {
    console.error('VIP form dependencies are missing.');
    return;
  }

  var h = VIP.h;
  var STORAGE_KEY = 'vip_report_draft_v1';

  function readDraft() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function saveDraft(values) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    } catch (err) {
      // The form remains usable if browser storage is unavailable.
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      // Ignore storage errors.
    }
  }

  function createElement(tag, attrs, children) {
    return h(tag, attrs || {}, children);
  }

  function init(root) {
    root = root || document.querySelector('[data-report-form]');

    if (!root) {
      console.error('Report form root was not found.');
      return;
    }

    var draft = readDraft();
    var state = {
      step: 0,
      values: {},
      errors: {}
    };

    var fields = {};
    var fieldConfigs = {};
    var progress;
    var title;
    var blurb;
    var body;
    var backButton;
    var continueButton;
    var status;
    var review;
    var stepsContainer;

    cfg.fields.forEach(function (field) {
      fieldConfigs[field.id] = field;

      if (Object.prototype.hasOwnProperty.call(draft, field.id)) {
        state.values[field.id] = draft[field.id];
      } else {
        state.values[field.id] = '';
      }
    });

    if (!state.values.reporter) {
      state.values.reporter = '';
    }

    if (!state.values.seenAt) {
      state.values.seenAt = new Date().toISOString();
    }

    function getValue(id) {
      return state.values[id] === undefined
        ? ''
        : state.values[id];
    }

    function getDynamicOptions(fieldId) {
      var field = fieldConfigs[fieldId];

      if (!field) return [];

      if (typeof cfg.getOptions === 'function') {
        var options = cfg.getOptions(fieldId, {
          get: getValue
        });

        if (Array.isArray(options)) {
          return options;
        }
      }

      if (typeof field.getOptions === 'function') {
        var result = field.getOptions({
          get: getValue
        });

        return Array.isArray(result) ? result : [];
      }

      return Array.isArray(field.options) ? field.options : [];
    }

    function setValue(id, value) {
      state.values[id] = value;

      if (id === 'state' || id === 'retailer') {
        state.values.branch = '';

        if (id === 'state' || id === 'retailer') {
          state.values.storeTown = '';
          state.values.storeAddress = '';
        }
      }

      state.errors[id] = '';

      if (fields[id] && fields[id].setError) {
        fields[id].setError('');
      }

      saveDraft(state.values);

      if (id === 'state' || id === 'retailer') {
        if (fields.branch && fields.branch.refreshOptions) {
          fields.branch.refreshOptions();
        }

        if (fields.branch && fields.branch.sync) {
          fields.branch.sync();
        }

        if (fields.storeTown && fields.storeTown.sync) {
          fields.storeTown.sync();
        }

        if (fields.storeAddress && fields.storeAddress.sync) {
          fields.storeAddress.sync();
        }
      }

      if (id === 'branch') {
        updateConditionalFields();
      }
    }

    var ctx = {
      get: getValue,
      set: setValue,
      limits: cfg.limits || {}
    };

    function buildFields() {
      cfg.fields.forEach(function (field) {
        fields[field.id] = VIP.fields.create(field, ctx);
      });
    }

    function updateConditionalFields() {
      var manual = getValue('branch') === 'manual';

      ['storeTown', 'storeAddress'].forEach(function (id) {
        var item = fields[id];

        if (!item || !item.el) return;

        item.el.hidden = !manual;
      });
    }

    function clearErrors() {
      state.errors = {};

      Object.keys(fields).forEach(function (id) {
        if (fields[id] && fields[id].setError) {
          fields[id].setError('');
        }
      });

      if (status) {
        status.textContent = '';
      }
    }

    function setFieldError(id, message) {
      state.errors[id] = message;

      if (fields[id] && fields[id].setError) {
        fields[id].setError(message);
      }
    }

    function renderProgress() {
      if (!progress) return;

      VIP.clear(progress);

      var total = cfg.steps.length + 1;
      var labels = cfg.steps.map(function (step) {
        return step.label || step.title || 'Step';
      }).concat(['Review']);

      labels.forEach(function (label, index) {
        var item = createElement(
          'div',
          {
            class:
              'progress__item' +
              (index === state.step ? ' is-active' : '') +
              (index < state.step ? ' is-complete' : ''),
            'aria-current': index === state.step ? 'step' : null
          },
          [
            createElement(
              'span',
              { class: 'progress__number' },
              index < state.step ? '✓' : String(index + 1)
            ),
            createElement(
              'span',
              { class: 'progress__label' },
              label
            )
          ]
        );

        progress.appendChild(item);
      });

      progress.setAttribute(
        'aria-label',
        'Step ' + (state.step + 1) + ' of ' + total
      );
    }

    function renderStep() {
      clearErrors();

      if (review) {
        review.hidden = state.step < cfg.steps.length;
      }

      if (state.step >= cfg.steps.length) {
        renderReview();
        renderProgress();

        if (title) title.textContent = 'Review your report';
        if (blurb) {
          blurb.textContent =
            'Check the details before sending your report.';
        }

        if (backButton) backButton.hidden = false;

        if (continueButton) {
          continueButton.textContent = 'Submit report';
          continueButton.disabled = false;
        }

        if (body) body.hidden = true;

        return;
      }

      if (body) {
        body.hidden = false;
        VIP.clear(body);
      }

      var step = cfg.steps[state.step];

      if (title) {
        title.textContent = step.title || step.label || 'Report details';
      }

      if (blurb) {
        blurb.textContent =
          step.blurb || step.description || '';
      }

      step.fields.forEach(function (id) {
        var item = fields[id];

        if (!item) return;

        if (typeof item.sync === 'function') {
          item.sync();
        }

        body.appendChild(item.el);
      });

      updateConditionalFields();
      renderProgress();

      if (backButton) {
        backButton.hidden = state.step === 0;
      }

      if (continueButton) {
        continueButton.textContent = 'Continue';
        continueButton.disabled = false;
      }
    }

    function validateStep() {
      var step = cfg.steps[state.step];
      var firstInvalid = null;
      var valid = true;

      clearErrors();

      step.fields.forEach(function (id) {
        var field = fieldConfigs[id];

        if (!field) return;

        if (
          (id === 'storeTown' || id === 'storeAddress') &&
          getValue('branch') !== 'manual'
        ) {
          return;
        }

        /*
         * FIX: Supply the current options for dynamic selects.
         * In particular, the branch dropdown depends on state
         * and retailer and cannot be validated using static options.
         */
        var options = getDynamicOptions(field.id);

        var message = V.validateField(
          field,
          state.values[id],
          { options: options }
        );

        if (
          id === 'storeTown' &&
          getValue('branch') === 'manual' &&
          !String(getValue('storeTown') || '').trim()
        ) {
          message = 'Enter the town or city for this store.';
        }

        if (
          id === 'storeAddress' &&
          getValue('branch') === 'manual' &&
          !String(getValue('storeAddress') || '').trim()
        ) {
          message = 'Enter the street address for this store.';
        }

        if (message) {
          valid = false;
          setFieldError(id, message);

          if (!firstInvalid) {
            firstInvalid = fields[id];
          }
        }
      });

      if (firstInvalid && typeof firstInvalid.focus === 'function') {
        firstInvalid.focus();
      }

      return valid;
    }

    function renderReview() {
      if (!review) return;

      VIP.clear(review);

      var list = createElement('dl', { class: 'review-list' });

      cfg.fields.forEach(function (field) {
        if (
          field.type === 'photos' ||
          field.id === 'reporter' ||
          field.id === 'notes'
        ) {
          return;
        }

        if (
          (field.id === 'storeTown' || field.id === 'storeAddress') &&
          getValue('branch') !== 'manual'
        ) {
          return;
        }

        var value = getValue(field.id);

        if (value === '' || value === null || value === undefined) {
          return;
        }

        var display = String(value);

        if (field.type === 'select' || field.type === 'choice') {
          var options = getDynamicOptions(field.id);

          var match = options.filter(function (option) {
            return option && String(option.value) === String(value);
          })[0];

          if (match) {
            display = match.label || String(match.value);
          }
        }

        if (field.type === 'price') {
          display = '$' + display;
        }

        list.appendChild(
          createElement(
            'div',
            { class: 'review-list__row' },
            [
              createElement('dt', {}, field.label || field.id),
              createElement('dd', {}, display)
            ]
          )
        );
      });

      if (getValue('notes')) {
        list.appendChild(
          createElement(
            'div',
            { class: 'review-list__row' },
            [
              createElement('dt', {}, 'Additional notes'),
              createElement('dd', {}, getValue('notes'))
            ]
          )
        );
      }

      var photosField = fields.photos;
      var photos = photosField && photosField.getPhotos
        ? photosField.getPhotos()
        : [];

      list.appendChild(
        createElement(
          'div',
          { class: 'review-list__row' },
          [
            createElement('dt', {}, 'Photos'),
            createElement(
              'dd',
              {},
              photos.length
                ? photos.length + ' photo(s) attached'
                : 'No photos attached'
            )
          ]
        )
      );

      review.appendChild(list);
    }

    function showStepError(message) {
      if (status) {
        status.textContent = message || 'Please check the highlighted fields.';
        status.hidden = false;
      }
    }

    function goBack() {
      if (state.step > 0) {
        state.step--;
        renderStep();
      }
    }

    function goForward() {
      if (state.step < cfg.steps.length) {
        if (!validateStep()) {
          showStepError('Please fix the highlighted fields before continuing.');
          return;
        }

        state.step++;
        renderStep();
        return;
      }

      send();
    }

    function send() {
      if (!VIP.submit || typeof VIP.submit.send !== 'function') {
        showStepError(
          'The report submission service is unavailable. Refresh the page and try again.'
        );
        return;
      }

      clearErrors();

      var result = V.validateAll(cfg, state.values);

      if (!result.ok) {
        var firstError = Object.keys(result.errors)[0];

        if (firstError) {
          var targetStep = cfg.steps.findIndex(function (step) {
            return step.fields.indexOf(firstError) !== -1;
          });

          if (targetStep !== -1) {
            state.step = targetStep;
            renderStep();
            setFieldError(firstError, result.errors[firstError]);
            showStepError('Please fix the highlighted fields before submitting.');
            return;
          }

          setFieldError(firstError, result.errors[firstError]);
          showStepError('Please fix the highlighted fields before submitting.');
          return;
        }
      }

      var photoField = fields.photos;
      var attachedPhotos = photoField && photoField.getPhotos
        ? photoField.getPhotos()
        : [];

      if (photoField && photoField.isBusy && photoField.isBusy()) {
        showStepError('Please wait for your photos to finish processing.');
        return;
      }

      if (continueButton) {
        continueButton.disabled = true;
        continueButton.textContent = 'Submitting…';
      }

      if (status) {
        status.hidden = false;
        status.textContent = 'Sending your report…';
      }

      VIP.submit
        .send({
          data: result.clean,
          photos: attachedPhotos.map(function (photo) {
            return photo.blob;
          }),
          elapsedMs: 0,
          website: ''
        })
        .then(function () {
          clearDraft();

          if (status) {
            status.textContent = 'Report submitted successfully!';
          }

          if (stepsContainer) {
            VIP.clear(stepsContainer);
            stepsContainer.appendChild(
              createElement(
                'div',
                { class: 'report-success' },
                [
                  createElement('h2', {}, 'Report submitted!'),
                  createElement(
                    'p',
                    {},
                    'Thanks for helping the Pokémon VIP community.'
                  )
                ]
              )
            );
          }

          if (typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(
              new CustomEvent('vip:report-submitted')
            );
          }
        })
        .catch(function (err) {
          console.error('Report submission failed:', err);

          showStepError(
            err && err.message
              ? err.message
              : 'The report could not be submitted. Please try again.'
          );

          if (continueButton) {
            continueButton.disabled = false;
            continueButton.textContent = 'Submit report';
          }
        });
    }

    buildFields();

    VIP.clear(root);

    var form = createElement(
      'form',
      {
        class: 'report-form',
        novalidate: true,
        onsubmit: function (event) {
          event.preventDefault();
          goForward();
        }
      },
      []
    );

    progress = createElement('nav', {
      class: 'progress',
      'aria-label': 'Report steps'
    });

    title = createElement('h1', {
      class: 'report-form__title'
    });

    blurb = createElement('p', {
      class: 'report-form__blurb'
    });

    body = createElement('div', {
      class: 'report-form__fields'
    });

    review = createElement('div', {
      class: 'report-form__review',
      hidden: true
    });

    status = createElement('p', {
      class: 'report-form__status',
      role: 'status',
      hidden: true
    });

    backButton = createElement(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost',
        onclick: goBack
      },
      'Back'
    );

    continueButton = createElement(
      'button',
      {
        type: 'submit',
        class: 'btn btn--primary'
      },
      'Continue'
    );

    var actions = createElement(
      'div',
      { class: 'report-form__actions' },
      [backButton, continueButton]
    );

    stepsContainer = createElement(
      'div',
      { class: 'report-form__steps' },
      [
        progress,
        title,
        blurb,
        body,
        review,
        status,
        actions
      ]
    );

    form.appendChild(stepsContainer);
    root.appendChild(form);

    renderStep();
  }

  VIP.form = VIP.form || {};
  VIP.form.init = init;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init();
    });
  } else {
    init();
  }
})();
