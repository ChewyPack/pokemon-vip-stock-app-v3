/* APP — wires the views together. Routes: (none) landing, #report form, #done success. */
(function () {
  var VIP = window.VIP;
  var h = VIP.h;

  var views = {
    home: document.getElementById('view-home'),
    form: document.getElementById('view-form'),
    done: document.getElementById('view-done')
  };
  var lastSuccess = null;
  var current = null;
  var flow = null;

  VIP.landing.render(views.home);
  VIP.effects.tilt(views.home);

  flow = VIP.flow(views.form, {
    onSuccess: function (info) {
      lastSuccess = info;
      location.hash = '#done';
    }
  });

  function renderDone(info) {
    var cfg = VIP.siteConfig;
    VIP.clear(views.done);
    views.done.appendChild(
      h(
        'div',
        { class: 'wrap done' },
        h('div', { class: 'done__badge', 'aria-hidden': 'true' }, '✓'),
        h('h2', { class: 'done__title', tabindex: '-1', id: 'done-title' }, 'Report sent!'),
        h(
          'p',
          { class: 'done__text' },
          info.alerted ? "It's on its way to the VIP Discord. Thanks for helping the crew." : "Thanks for the update. Sold-out reports don't trigger a VIP alert."
        ),
        info.demo ? h('p', { class: 'notice notice--light' }, 'Preview mode: nothing was actually sent.') : null,
        h('p', { class: 'notice notice--light' }, cfg.notice),
        h(
          'div',
          { class: 'done__actions' },
          h('a', { class: 'btn btn--lg', href: '#report' }, 'Report another'),
          cfg.discordInviteUrl ? h('a', { class: 'btn btn--lg btn--discord', href: cfg.discordInviteUrl, target: '_blank', rel: 'noopener' }, 'Join the Discord') : null,
          h('a', { class: 'text-link', href: '#' }, 'Back to home')
        )
      )
    );
  }

  function show(name) {
    Object.keys(views).forEach(function (k) {
      views[k].hidden = k !== name;
    });
    if (name !== current) {
      window.scrollTo(0, 0);
      current = name;
    }
    document.body.setAttribute('data-view', name);
  }

  function route() {
    var hash = location.hash;
    if (hash === '#report') {
      show('form');
      flow.open();
    } else if (hash === '#done' && lastSuccess) {
      renderDone(lastSuccess);
      show('done');
      document.getElementById('done-title').focus({ preventScroll: true });
      VIP.effects.burst(views.done);
    } else {
      show('home');
      var target = hash.length > 1 ? document.getElementById(hash.slice(1)) : null;
      if (target) target.scrollIntoView({ behavior: VIP.reducedMotion() ? 'auto' : 'smooth' });
    }
  }

  window.addEventListener('hashchange', route);
  route();
})();
