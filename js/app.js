/*
 * APP SHELL
 *
 * Handles report routing and successful report completion.
 * Discord webhook notifications are sent by the report API; no Discord account linking is used here.
 */
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
        .catch(function (error) { console.warn('PokePrizePool offline support could not be registered:', error); });
    });
  }
  var VIP = (window.VIP = window.VIP || {});
  var h = VIP.h;

  var views = {
    home: document.getElementById('view-home'),
    form: document.getElementById('view-form'),
    done: document.getElementById('view-done')
  };

  var flow = null;
  var lastSuccess = null;

  function show(name) {
    Object.keys(views).forEach(function (key) {
      if (!views[key]) return;
      views[key].hidden = key !== name;
    });
  }

  function renderReport() {
    VIP.clear(views.form);

    var reportContainer = h('div', { class: 'report-flow' });
    views.form.appendChild(reportContainer);

    flow = VIP.flow(reportContainer, {
      onSuccess: handleSuccess
    });

    flow.open();
    show('form');
  }

  function renderReportAccessRequired(message) {
    VIP.clear(views.form);

    var title = h('h2', { class: 'panel__title', tabindex: '-1' }, 'Paid Membership Required');
    var blurb = h('p', { class: 'panel__blurb' }, message);
    var actions = h('div', { class: 'done-actions' },
      h('a', { class: 'btn btn--primary', href: '/account.html' }, 'Sign In / Manage Membership'),
      h('a', { class: 'btn btn--ghost', href: '/' }, 'Back Home')
    );
    views.form.appendChild(h('section', { class: 'panel' },
      h('div', { class: 'panel__head' }, title, blurb),
      h('div', { class: 'panel__body' }, actions)
    ));
    show('form');
  }

  async function openReport() {
    show('form');
    VIP.clear(views.form);
    views.form.appendChild(h('section', { class: 'panel' },
      h('div', { class: 'panel__body' }, h('p', { class: 'panel__blurb' }, 'Checking membership…'))
    ));

    try {
      var response = await fetch('/api/account/me', {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) {
        renderReportAccessRequired('Please sign in and make sure your PokePrizePool paid membership is active to submit stock or line reports.');
        return;
      }

      var data = await response.json();
      var membership = data && data.membership ? data.membership : {};
      var isAdmin = Boolean(data && data.account && data.account.is_admin);
      var tier = String(membership.entitlement_tier || membership.tier || '').toLowerCase();
      var paidTier = ['collector_plus', 'vendor', 'organizer'].indexOf(tier) !== -1;
      var active = isAdmin || (data && data.ok && data.authenticated &&
        membership.status === 'active' && paidTier);

      if (!active) {
        renderReportAccessRequired(
          data && data.authenticated
            ? 'Submitting stock and line reports is a benefit for members with an active paid membership. Upgrade your membership to continue.'
            : 'Please sign in to your PokePrizePool account and have an active paid membership to submit stock or line reports.'
        );
        return;
      }

      renderReport();
    } catch (error) {
      renderReportAccessRequired('We could not verify your membership right now. Please try again after signing in to your account.');
    }
  }

  function handleSuccess(info) {
    lastSuccess = info;
    window.location.hash = '#done';
  }

  function renderDone(info) {
    VIP.clear(views.done);

    var title = h(
      'h2',
      {
        class: 'panel__title',
        tabindex: '-1'
      },
      'Report sent!'
    );

    var blurb = h(
      'p',
      { class: 'panel__blurb' },
      'Thanks for helping the Pokémon VIP community.'
    );

    var body = h(
      'div',
      { class: 'panel__body' },

      h(
        'div',
        { class: 'notice' },
        info && info.report && info.report.reportType === 'line'
          ? (info.alerted
            ? 'Your line report was submitted and sent to the Stock Intelligence alert channel.'
            : 'Your line report was saved, but the alert could not be delivered.')
          : (info && info.alerted
            ? 'Your report was submitted and the item is still there.'
            : 'Your stock report was submitted successfully.')
      ),

      h(
        'div',
        { class: 'done-actions' },

        h(
          'a',
          {
            class: 'btn btn--primary',
            href: '#report'
          },
          'Submit Another Report'
        ),

        h(
          'a',
          {
            class: 'btn btn--ghost',
            href: '#'
          },
          'Back Home'
        )
      )
    );

    var panel = h(
      'section',
      { class: 'panel' },

      h(
        'div',
        { class: 'panel__head' },
        title,
        blurb
      ),

      body
    );

    views.done.appendChild(panel);
  }

  function route() {
    var hash = location.hash;
    var params = new URLSearchParams(window.location.search);

    if (hash === '#report') {
      show('form');
      openReport();
    } else if (hash === '#done' && lastSuccess) {
      renderDone(lastSuccess);
      show('done');

      var title = document.getElementById('done-title');

      if (title) {
        title.focus({ preventScroll: true });
      }

      VIP.effects.burst(views.done);
    } else {
      VIP.landing.render(views.home);
      show('home');

      var target =
        hash.length > 1
          ? document.getElementById(hash.slice(1))
          : null;

      if (target) {
        target.scrollIntoView({
          behavior: VIP.reducedMotion() ? 'auto' : 'smooth'
        });
      }
    }
  }

  window.addEventListener('hashchange', route);
  route();
})();

