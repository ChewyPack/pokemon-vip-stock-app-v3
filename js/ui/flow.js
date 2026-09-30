/*
 * REPORT FLOW
 * Steps come from VIP.formConfig. This file knows how to show steps, move between them,
 * validate, review and submit. It does not know any question by name (except the photo
 * field, which has its own component API).
 */
(function () {
  var VIP = (window.VIP = window.VIP || {});
  var h = VIP.h;

  VIP.flow = function mount(root, hooks) {
    var cfg = VIP.formConfig;
    var V = VIP.validate;
    var state = { step: 0, values: {}, startedAt: Date.now(), sending: false, dir: 1 };
    var fields = {};

    /* ---------- state + fields ---------- */
    var ctx = {
      limits: cfg.limits,
      get: function (id) {
        return state.values[id];
      },
      set: function (id, value) {
        state.values[id] = value;
        if (fields[id]) fields[id].setError('');
        hideBanner();
        VIP.draft.save(state.values);
      }
    };

    function buildFields() {
      if (fields.photos && fields.photos.reset) fields.photos.reset();
      state.values = Object.assign({}, VIP.draft.load());
      if (!state.values.reporter) state.values.reporter = VIP.draft.loadReporter();
      state.values.seenAt = new Date().toISOString();
      state.startedAt = Date.now();
      state.step = 0;
      state.dir = 1;
      fields = {};
      cfg.fields.forEach(function (f) {
        fields[f.id] = VIP.fields.create(f, ctx);
      });
    }

    /* ---------- chrome ---------- */
    var title = h('h2', { class: 'panel__title', tabindex: '-1' });
    var blurb = h('p', { class: 'panel__blurb' });
    var body = h('div', { class: 'panel__body' });
    var honeypot = h('input', { type: 'text', name: 'website', class: 'hp', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    var form = h(
      'form',
      {
        class: 'panel',
        novalidate: true,
        onsubmit: function (e) {
          e.preventDefault();
          next();
        }
      },
      h('div', { class: 'panel__head' }, title, blurb),
      body,
      honeypot
    );
    var banner = h('div', { class: 'banner', role: 'alert', hidden: true });
    var progress = h('div', { class: 'progress', role: 'group', 'aria-label': 'Report progress' });
    var backBtn = h('button', { type: 'button', class: 'btn btn--ghost', onclick: back }, 'Back');
    var nextBtn = h('button', { type: 'button', class: 'btn btn--primary', onclick: next }, 'Continue');
    var nav = h('div', { class: 'nav' }, backBtn, nextBtn);

    root.appendChild(h('header', { class: 'apply-head wrap wrap--form' }, h('a', { class: 'apply-head__home', href: '#' }, 'Pokémon VIP'), progress));
    root.appendChild(h('div', { class: 'wrap wrap--form' }, banner, form, nav));

    function showBanner(text) {
      banner.textContent = text;
      banner.hidden = false;
    }
    function hideBanner() {
      banner.hidden = true;
    }

    function renderProgress() {
      var total = cfg.steps.length + 1;
      var labels = cfg.steps.map(function (s) {
        return s.label;
      }).concat(['Review']);
      VIP.clear(progress);
      progress.appendChild(
        h(
          'ol',
          { class: 'progress__bars' },
          labels.map(function (label, i) {
            return h('li', { class: 'pip' + (i < state.step ? ' is-done' : '') + (i === state.step ? ' is-current' : ''), 'aria-current': i === state.step ? 'step' : null }, h('span', { class: 'sr-only' }, label));
          })
        )
      );
      progress.appendChild(h('p', { class: 'progress__text' }, h('strong', null, 'Step ' + (state.step + 1) + ' of ' + total), h('span', null, labels[state.step])));
    }

    /* ---------- review ---------- */
    function muted(text) {
      return h('span', { class: 'muted' }, text);
    }

    function displayValue(f) {
      var v = state.values[f.id];
      if (f.type === 'photos') {
        var ps = fields.photos.getPhotos();
        if (!ps.length) return muted('No photos');
        return h(
          'ul',
          { class: 'thumbs thumbs--sm' },
          ps.map(function (p) {
            return h('li', { class: 'thumb' }, h('img', { src: p.url, alt: '' }));
          })
        );
      }
      if (v === undefined || v === null || String(v).trim() === '') return muted('Not provided');
      if (f.type === 'price') return '$' + V.normalizePrice(v);
      if (f.type === 'datetime') return new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      if (f.type === 'textarea') return h('span', { class: 'prewrap' }, String(v));
      return String(v);
    }

    function reviewNode() {
      var wrap = h('div', { class: 'review' });
      cfg.steps.forEach(function (step, si) {
        var dl = h('dl', { class: 'review__list' });
        step.fields.forEach(function (id) {
          var f = cfg.getField(id);
          dl.appendChild(h('div', { class: 'review__row' }, h('dt', null, f.label), h('dd', null, displayValue(f))));
        });
        wrap.appendChild(
          h(
            'section',
            { class: 'review__group' },
            h('div', { class: 'review__head' }, h('h3', null, step.label), h('button', { type: 'button', class: 'link-btn', onclick: function () {
              goTo(si);
            } }, 'Edit')),
            dl
          )
        );
      });
      wrap.appendChild(h('p', { class: 'notice' }, VIP.siteConfig.notice));
      return wrap;
    }

    /* ---------- step rendering ---------- */
    function renderStep(focusTitle) {
      var isReview = state.step === cfg.steps.length;
      VIP.clear(body);
      if (!isReview) {
        var step = cfg.steps[state.step];
        title.textContent = step.title;
        blurb.textContent = step.blurb;
        step.fields.forEach(function (id) {
          if (fields[id].sync) fields[id].sync();
          body.appendChild(fields[id].el);
        });
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
      body.classList.add(state.dir > 0 ? 'slide-fwd' : 'slide-back');

      if (focusTitle) {
        window.scrollTo({ top: 0, behavior: VIP.reducedMotion() ? 'auto' : 'smooth' });
        title.focus({ preventScroll: true });
      }
    }

    function goTo(i) {
      state.dir = i >= state.step ? 1 : -1;
      state.step = i;
      renderStep(true);
    }

    function validateStep(i) {
      var first = null;
      cfg.steps[i].fields.forEach(function (id) {
        var msg = V.validateField(cfg.getField(id), state.values[id]);
        fields[id].setError(msg);
        if (msg && !first) first = id;
      });
      if (first) {
        fields[first].el.scrollIntoView({ block: 'center', behavior: VIP.reducedMotion() ? 'auto' : 'smooth' });
        fields[first].focus();
        return false;
      }
      return true;
    }

    function back() {
      if (state.sending || state.step === 0) return;
      goTo(state.step - 1);
    }

    function next() {
      if (state.sending) return;
      if (state.step < cfg.steps.length) {
        if (validateStep(state.step)) goTo(state.step + 1);
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
      for (var i = 0; i < cfg.steps.length; i++) {
        if (cfg.steps[i].fields.indexOf(id) !== -1) return i;
      }
      return 0;
    }

    async function send() {
      var result = V.validateAll(cfg, state.values);
      if (!result.ok) {
        var firstId = Object.keys(result.errors)[0];
        goTo(stepOfField(firstId));
        Object.keys(result.errors).forEach(function (id) {
          fields[id].setError(result.errors[id]);
        });
        fields[firstId].focus();
        showBanner('A few answers need fixing before you can send.');
        return;
      }

      setBusy(true);
      try {
        if (fields.photos.isBusy()) {
          showBanner('Getting your photos ready…');
          await fields.photos.whenReady();
          hideBanner();
        }
        var out = await VIP.submit.send(result.clean, fields.photos.getPhotos(), {
          elapsedMs: Date.now() - state.startedAt,
          honeypot: honeypot.value
        });
        VIP.draft.clear();
        VIP.draft.saveReporter(result.clean.reporter);
        var info = { report: result.clean, demo: !!out.demo, alerted: result.clean.stillThere === 'Yes' };
        setBusy(false);
        reset();
        hooks.onSuccess(info);
      } catch (err) {
        setBusy(false);
        if (err.code === 'invalid' && err.fieldErrors) {
          var ids = Object.keys(err.fieldErrors);
          goTo(stepOfField(ids[0]));
          ids.forEach(function (id) {
            if (fields[id]) fields[id].setError(err.fieldErrors[id]);
          });
        }
        showBanner(err.message || 'Something went wrong. Try again.');
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
