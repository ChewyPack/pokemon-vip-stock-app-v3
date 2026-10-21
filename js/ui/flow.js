
/*
 * REPORT FLOW
 * Steps come from VIP.formConfig.
 * Handles dependent location dropdowns, conditional manual address fields,
 * navigation, validation, review, drafts and submission.
 */
(function () {
  var VIP = (window.VIP = window.VIP || {});
  var h = VIP.h;

  VIP.flow = function mount(root, hooks) {
    var cfg = VIP.formConfig;
    var V = VIP.validate;
    hooks = hooks || {};

    var state = {
      step: 0,
      values: {},
      startedAt: Date.now(),
      sending: false,
      dir: 1
    };

    var fields = {};

    /* ---------- state + fields ---------- */
    var ctx = {
      limits: cfg.limits,

      get: function (id) {
        return state.values[id];
      },

      set: function (id, value) {
        var changed = state.values[id] !== value;
        state.values[id] = value;

        if (fields[id]) {
          fields[id].setError('');
        }

        /*
         * Changing the state or retailer invalidates the old branch.
         * Clear manual address fields too, so an address from another store
         * cannot accidentally be submitted.
         */
        if (changed && (id === 'state' || id === 'retailer')) {
          state.values.branch = '';
          state.values.storeTown = '';
          state.values.storeAddress = '';

          ['branch', 'storeTown', 'storeAddress'].forEach(function (fieldId) {
            if (fields[fieldId]) {
              fields[fieldId].setError('');
            }
          });

          if (fields.branch && fields.branch.refreshOptions) {
            fields.branch.refreshOptions();
          }

          if (fields.branch && fields.branch.sync) {
            fields.branch.sync();
          }
        }

        hideBanner();

        if (VIP.draft && typeof VIP.draft.save === 'function') {
          VIP.draft.save(state.values);
        }
      }
    };

    function buildFields() {
      if (fields.photos && fields.photos.reset) {
        fields.photos.reset();
      }

      state.values =
        VIP.draft && typeof VIP.draft.load === 'function'
          ? Object.assign({}, VIP.draft.load())
          : {};

      if (
        !state.values.reporter &&
        VIP.draft &&
        typeof VIP.draft.loadReporter === 'function'
      ) {
        state.values.reporter = VIP.draft.loadReporter();
      }

      state.values.seenAt = new Date().toISOString();
      state.startedAt = Date.now();
      state.step = 0;
      state.dir = 1;
      fields = {};

      cfg.fields.forEach(function (field) {
        fields[field.id] = VIP.fields.create(field, ctx);
      });
    }

    function activeSteps() {
      if (state.values.reportType === 'line') {
        return [cfg.steps[0]].concat(cfg.lineSteps || []);
      }
      return cfg.steps;
    }

    /* ---------- chrome ---------- */
    var title = h('h2', {
      class: 'panel__title',
      tabindex: '-1'
    });

    var blurb = h('p', {
      class: 'panel__blurb'
    });

    var body = h('div', {
      class: 'panel__body'
    });

    var honeypot = h('input', {
      type: 'text',
      name: 'website',
      class: 'hp',
      tabindex: '-1',
      autocomplete: 'off',
      'aria-hidden': 'true'
    });

    var form = h(
      'form',
      {
        class: 'panel',
        novalidate: true,
        onsubmit: function (event) {
          event.preventDefault();
          next();
        }
      },
      h(
        'div',
        {
          class: 'panel__head'
        },
        title,
        blurb
      ),
      body,
      honeypot
    );

    var banner = h('div', {
      class: 'banner',
      role: 'alert',
      hidden: true
    });

    var progress = h('div', {
      class: 'progress',
      role: 'group',
      'aria-label': 'Report progress'
    });

    var backBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost',
        onclick: back
      },
      'Back'
    );

    var nextBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary',
        onclick: next
      },
      'Continue'
    );

    var nav = h(
      'div',
      {
        class: 'nav'
      },
      backBtn,
      nextBtn
    );

    root.appendChild(
      h(
        'header',
        {
          class: 'apply-head wrap wrap--form'
        },
        h(
          'a',
          {
            class: 'apply-head__home',
            href: '#'
          },
          'Pokémon VIP'
        ),
        progress
      )
    );

    root.appendChild(
      h(
        'div',
        {
          class: 'wrap wrap--form'
        },
        banner,
        form,
        nav
      )
    );

    function showBanner(message) {
      banner.textContent = message;
      banner.hidden = false;
    }

    function hideBanner() {
      if (banner) {
        banner.hidden = true;
      }
    }

    function renderProgress() {
      var steps = activeSteps();
      var total = steps.length + 1;

      var labels = steps
        .map(function (step) {
          return step.label;
        })
        .concat(['Review']);

      VIP.clear(progress);

      progress.appendChild(
        h(
          'ol',
          {
            class: 'progress__bars'
          },
          labels.map(function (label, i) {
            return h(
              'li',
              {
                class:
                  'pip' +
                  (i < state.step ? ' is-done' : '') +
                  (i === state.step ? ' is-current' : ''),
                'aria-current': i === state.step ? 'step' : null
              },
              h(
                'span',
                {
                  class: 'sr-only'
                },
                label
              )
            );
          })
        )
      );

      progress.appendChild(
        h(
          'p',
          {
            class: 'progress__text'
          },
          h(
            'strong',
            null,
            'Step ' + (state.step + 1) + ' of ' + total
          ),
          h(
            'span',
            null,
            labels[state.step]
          )
        )
      );
    }

    /* ---------- conditional fields ---------- */
    function isManualBranch() {
      return state.values.branch === 'manual';
    }

    function updateConditionalFields() {
      ['storeTown', 'storeAddress'].forEach(function (id) {
        if (!fields[id]) {
          return;
        }

        fields[id].el.hidden = !isManualBranch();

        if (!isManualBranch()) {
          fields[id].setError('');
        }
      });
    }

    function validateManualAddress() {
      if (!isManualBranch()) {
        return null;
      }

      var town = String(state.values.storeTown || '').trim();
      var address = String(state.values.storeAddress || '').trim();

      if (town.length < 2) {
        return {
          id: 'storeTown',
          message: 'Enter the town or city for this store.'
        };
      }

      if (address.length < 3) {
        return {
          id: 'storeAddress',
          message: 'Enter the street address for this store.'
        };
      }

      return null;
    }

    /* ---------- review ---------- */
    function muted(text) {
      return h(
        'span',
        {
          class: 'muted'
        },
        text
      );
    }

    function displayValue(field) {
      var value = state.values[field.id];

      if (
        (field.id === 'storeTown' || field.id === 'storeAddress') &&
        !isManualBranch()
      ) {
        return muted('Not needed for selected branch');
      }

      if (field.type === 'photos') {
        var photoItems = fields.photos.getPhotos();

        if (!photoItems.length) {
          return muted('No photos');
        }

        return h(
          'ul',
          {
            class: 'thumbs thumbs--sm'
          },
          photoItems.map(function (photo) {
            return h(
              'li',
              {
                class: 'thumb'
              },
              h('img', {
                src: photo.url,
                alt: ''
              })
            );
          })
        );
      }

      if (
        value === undefined ||
        value === null ||
        String(value).trim() === ''
      ) {
        return muted('Not provided');
      }

      if (field.type === 'price') {
        return '$' + V.normalizePrice(value);
      }

      if (field.type === 'datetime') {
        return new Date(value).toLocaleString([], {
          dateStyle: 'medium',
          timeStyle: 'short'
        });
      }

      if (field.type === 'textarea') {
        return h(
          'span',
          {
            class: 'prewrap'
          },
          String(value)
        );
      }

      /*
       * Show the human-readable branch label in review rather than its ID.
       */
      if (field.id === 'branch' && value !== 'manual') {
        var branchOption = cfg.getOption(
          'branch',
          value,
          ctx
        );

        if (branchOption) {
          return branchOption.label;
        }
      }

      if (field.id === 'state') {
        var stateOption = cfg.getOption(
          'state',
          value,
          ctx
        );

        if (stateOption) {
          return stateOption.label;
        }
      }

      if (field.id === 'retailer') {
        var retailerOption = cfg.getOption(
          'retailer',
          value,
          ctx
        );

        if (retailerOption) {
          return retailerOption.label;
        }
      }

      if (field.type === 'choice' || field.type === 'select') {
        var selectedOption = cfg.getOption(field.id, value, ctx);
        if (selectedOption) return selectedOption.label;
      }

      return String(value);
    }

    function reviewNode() {
      var review = h('div', {
        class: 'review'
      });

      activeSteps().forEach(function (step, stepIndex) {
        var dl = h('dl', {
          class: 'review__list'
        });

        step.fields.forEach(function (id) {
          var field = cfg.getField(id);

          dl.appendChild(
            h(
              'div',
              {
                class: 'review__row'
              },
              h('dt', null, field.label),
              h('dd', null, displayValue(field))
            )
          );
        });

        review.appendChild(
          h(
            'section',
            {
              class: 'review__group'
            },
            h(
              'div',
              {
                class: 'review__head'
              },
              h(
                'h3',
                null,
                step.label
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'link-btn',
                  onclick: function () {
                    goTo(stepIndex);
                  }
                },
                'Edit'
              )
            ),
            dl
          )
        );
      });

      review.appendChild(
        h(
          'p',
          {
            class: 'notice'
          },
          VIP.siteConfig.notice
        )
      );

      return review;
    }

    /* ---------- step rendering ---------- */
    function renderStep(focusTitle) {
      var steps = activeSteps();
      var isReview = state.step === steps.length;

      VIP.clear(body);

      if (!isReview) {
        var step = steps[state.step];

        title.textContent = step.title;
        blurb.textContent = step.blurb;

        step.fields.forEach(function (id) {
          if (fields[id].sync) {
            fields[id].sync();
          }

          body.appendChild(fields[id].el);
        });

        updateConditionalFields();
      } else {
        title.textContent = 'Check your report';
        blurb.textContent = 'Tap Edit on anything that needs fixing.';
        body.appendChild(reviewNode());
      }

      backBtn.hidden = state.step === 0;
      nextBtn.textContent = isReview ? 'Send report' : 'Continue';
      nextBtn.classList.toggle('btn--send', isReview);

      renderProgress();
      hideBanner();

      body.classList.remove('slide-fwd', 'slide-back');
      void body.offsetWidth;

      body.classList.add(
        state.dir > 0 ? 'slide-fwd' : 'slide-back'
      );

      if (focusTitle) {
        window.scrollTo({
          top: 0,
          behavior: VIP.reducedMotion() ? 'auto' : 'smooth'
        });

        title.focus({
          preventScroll: true
        });
      }
    }

    function goTo(index) {
      state.dir = index >= state.step ? 1 : -1;
      state.step = index;
      renderStep(true);
    }

    function validateStep(index) {
      var first = null;
      var step = activeSteps()[index];

      step.fields.forEach(function (id) {
        var field = cfg.getField(id);

        if (
          (id === 'storeTown' || id === 'storeAddress') &&
          !isManualBranch()
        ) {
          fields[id].setError('');
          return;
        }

        /*
         * IMPORTANT:
         * Dynamic select/choice fields, such as store branches, must be
         * validated against the currently available options for the
         * selected state and retailer.
         */
        var options = [];

        if (
          (field.type === 'select' || field.type === 'choice') &&
          typeof cfg.getOptions === 'function'
        ) {
          options = cfg.getOptions(field.id, ctx) || [];
        }

        var message = V.validateField(
          field,
          state.values[id],
          {
            options: options
          }
        );

        if (isManualBranch() && id === 'storeTown') {
          if (String(state.values.storeTown || '').trim().length < 2) {
            message = 'Enter the town or city for this store.';
          }
        }

        if (isManualBranch() && id === 'storeAddress') {
          if (String(state.values.storeAddress || '').trim().length < 3) {
            message = 'Enter the street address for this store.';
          }
        }

        fields[id].setError(message);

        if (message && !first) {
          first = id;
        }
      });

      if (first) {
        fields[first].el.scrollIntoView({
          block: 'center',
          behavior: VIP.reducedMotion() ? 'auto' : 'smooth'
        });

        fields[first].focus();
        return false;
      }

      return true;
    }

    function back() {
      if (state.sending || state.step === 0) {
        return;
      }

      goTo(state.step - 1);
    }

    function next() {
      if (state.sending) {
        return;
      }

      if (state.step < activeSteps().length) {
        if (validateStep(state.step)) {
          goTo(state.step + 1);
        }
      } else {
        send();
      }
    }

    /* ---------- submit ---------- */
    function setBusy(busy) {
      state.sending = busy;
      nextBtn.disabled = busy;
      backBtn.disabled = busy;
      nextBtn.classList.toggle('is-busy', busy);
      nextBtn.textContent = busy ? 'Sending…' : 'Send report';
    }

    function stepOfField(id) {
      var steps = activeSteps();
      for (var i = 0; i < steps.length; i++) {
        if (steps[i].fields.indexOf(id) !== -1) {
          return i;
        }
      }

      return 0;
    }

    async function send() {
      var manualAddressError = validateManualAddress();

      if (manualAddressError) {
        goTo(stepOfField(manualAddressError.id));

        fields[manualAddressError.id].setError(
          manualAddressError.message
        );

        fields[manualAddressError.id].focus();

        showBanner(
          'Please complete the store address before sending.'
        );

        return;
      }

      var result;
      if (state.values.reportType === 'line') {
        var lineErrors = {};
        ['lineCount', 'lineSeenAt', 'stockedBy'].forEach(function (id) {
          var field = cfg.getField(id);
          var options = cfg.getOptions(id, ctx) || [];
          var message = V.validateField(field, state.values[id], {
            options: options,
            futureToleranceMs: 15 * 60 * 1000
          });
          if (message) lineErrors[id] = message;
        });
        if (Object.keys(lineErrors).length) {
          var firstLineId = Object.keys(lineErrors)[0];
          goTo(stepOfField(firstLineId));
          Object.keys(lineErrors).forEach(function (id) {
            fields[id].setError(lineErrors[id]);
          });
          fields[firstLineId].focus();
          showBanner('A few answers need fixing before you can send.');
          return;
        }
        result = {
          ok: true,
          errors: {},
          clean: {
            reportType: 'line',
            state: state.values.state,
            retailer: state.values.retailer,
            branch: state.values.branch,
            storeTown: state.values.storeTown || '',
            storeAddress: state.values.storeAddress || '',
            lineCount: state.values.lineCount,
            lineSeenAt: state.values.lineSeenAt,
            stockedBy: state.values.stockedBy,
            lineNotes: state.values.lineNotes || ''
          }
        };
      } else {
        result = V.validateAll(cfg, state.values);
      }

      if (!result.ok) {
        var firstId = Object.keys(result.errors)[0];

        goTo(stepOfField(firstId));

        Object.keys(result.errors).forEach(function (id) {
          if (fields[id]) {
            fields[id].setError(result.errors[id]);
          }
        });

        if (fields[firstId]) {
          fields[firstId].focus();
        }

        showBanner(
          'A few answers need fixing before you can send.'
        );

        return;
      }

      setBusy(true);

      try {
        if (fields.photos.isBusy()) {
          showBanner('Getting your photos ready…');
          await fields.photos.whenReady();
          hideBanner();
        }

        var out = await VIP.submit.send(
          result.clean,
          fields.photos.getPhotos(),
          {
            elapsedMs: Date.now() - state.startedAt,
            honeypot: honeypot.value
          }
        );

        if (VIP.draft && typeof VIP.draft.clear === 'function') {
          VIP.draft.clear();
        }

        if (
          VIP.draft &&
          typeof VIP.draft.saveReporter === 'function'
        ) {
          VIP.draft.saveReporter(result.clean.reporter);
        }

        var info = {
          report: result.clean,
          demo: !!out.demo,
          alerted: !!out.alerted
        };

        setBusy(false);
        reset();

        if (typeof hooks.onSuccess === 'function') {
          hooks.onSuccess(info);
        }
      } catch (err) {
        setBusy(false);

        if (err.code === 'invalid' && err.fieldErrors) {
          var ids = Object.keys(err.fieldErrors);

          goTo(stepOfField(ids[0]));

          ids.forEach(function (id) {
            if (fields[id]) {
              fields[id].setError(err.fieldErrors[id]);
            }
          });
        }

        showBanner(
          err.message || 'Something went wrong. Try again.'
        );
      }
    }

    /* ---------- lifecycle ---------- */
    function reset() {
      buildFields();
      renderStep(false);
    }

    buildFields();
    renderStep(false);

    return {
      open: function () {
        renderStep(true);
      },
      reset: reset
    };
  };
})();
