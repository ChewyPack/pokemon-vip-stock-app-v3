/*
 * APP
 *
 * Routes:
 *   (none)  -> landing
 *   #report -> VIP membership gate / report form
 *   #done   -> success
 */

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

  async function startCheckout(plan) {
    try {
      var res = await fetch(
        '/api/checkout',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            plan: plan
          })
        }
      );

      var body = null;

      try {
        body = await res.json();
      } catch (e) {}

      if (
        res.ok &&
        body &&
        body.ok &&
        body.url
      ) {
        window.location.href = body.url;
        return;
      }

      alert(
        'We could not start checkout. Please try again.'
      );
    } catch (e) {
      alert(
        'We could not reach checkout. Please check your connection and try again.'
      );
    }
  }

  function renderPaywall() {
    var cfg = VIP.siteConfig;
    var vip = cfg.vip || {};

    VIP.clear(views.form);

    views.form.appendChild(
      h(
        'div',
        { class: 'wrap' },

        h(
          'div',
          { class: 'form-shell' },

          h(
            'div',
            { class: 'form-head' },

            h(
              'div',
              {
                class: 'eyebrow'
              },
              'VIP MEMBERSHIP'
            ),

            h(
              'h2',
              {
                class: 'form-title'
              },
              'Unlock Pokémon VIP'
            ),

            h(
              'p',
              {
                class: 'form-subtitle'
              },
              'VIP membership is required to submit stock reports and access the VIP community.'
            )
          ),

          h(
            'div',
            {
              class: 'vip-plans'
            },

            h(
              'div',
              {
                class: 'vip-plan'
              },

              h(
                'div',
                {
                  class: 'vip-plan__name'
                },
                'MONTHLY'
              ),

              h(
                'div',
                {
                  class: 'vip-plan__price'
                },
                '$' +
                  String(
                    vip.monthlyPrice || 5
                  ) +
                  '/month'
              ),

              h(
                'p',
                {
                  class: 'vip-plan__text'
                },
                'Full VIP access. Cancel anytime.'
              ),

              h(
                'button',
                {
                  class: 'btn btn--lg',
                  type: 'button',
                  onclick: function () {
                    startCheckout(
                      'monthly'
                    );
                  }
                },
                'Join Monthly'
              )
            ),

            h(
              'div',
              {
                class:
                  'vip-plan vip-plan--featured'
              },

              h(
                'div',
                {
                  class: 'vip-plan__badge'
                },
                'SAVE $10'
              ),

              h(
                'div',
                {
                  class: 'vip-plan__name'
                },
                'YEARLY'
              ),

              h(
                'div',
                {
                  class: 'vip-plan__price'
                },
                '$' +
                  String(
                    vip.yearlyPrice || 50
                  ) +
                  '/year'
              ),

              h(
                'p',
                {
                  class: 'vip-plan__text'
                },
                'Full VIP access for the year.'
              ),

              h(
                'button',
                {
                  class: 'btn btn--lg',
                  type: 'button',
                  onclick: function () {
                    startCheckout(
                      'yearly'
                    );
                  }
                },
                'Join Yearly'
              )
            )
          ),

          h(
            'p',
            {
              class: 'notice notice--light'
            },
            'After checkout, you will return here and your VIP report access will be unlocked.'
          ),

          h(
            'div',
            {
              class: 'done__actions'
            },

            h(
              'a',
              {
                class: 'text-link',
                href: '#'
              },
              'Back to home'
            )
          )
        )
      )
    );
  }

  async function checkMembership() {
    try {
      var res =
        await fetch(
          '/api/membership',
          {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store'
          }
        );

      var body = null;

      try {
        body = await res.json();
      } catch (e) {}

      return !!(
        res.ok &&
        body &&
        body.ok &&
        body.active
      );
    } catch (e) {
      return false;
    }
  }

  async function handleCheckoutReturn() {
    var params =
      new URLSearchParams(
        window.location.search
      );

    var sessionId =
      params.get('session_id');

    if (!sessionId) {
      return false;
    }

    try {
      var res =
        await fetch(
          '/api/membership',
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type':
                'application/json'
            },
            body: JSON.stringify({
              session_id:
                sessionId
            })
          }
        );

      var body = null;

      try {
        body = await res.json();
      } catch (e) {}

      if (
        res.ok &&
        body &&
        body.ok &&
        body.active
      ) {
        window.history.replaceState(
          {},
          document.title,
          '/#report'
        );

        return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  async function openReport() {
    VIP.clear(views.form);

    var checkoutActivated =
      await handleCheckoutReturn();

    if (checkoutActivated) {
      flow.open();
      return;
    }

    var active =
      await checkMembership();

    if (active) {
      flow.open();
    } else {
      renderPaywall();
    }
  }

  function renderDone(info) {
    var cfg = VIP.siteConfig;

    VIP.clear(views.done);

    views.done.appendChild(
      h(
        'div',
        {
          class: 'wrap done'
        },

        h(
          'div',
          {
            class: 'done__badge',
            'aria-hidden': 'true'
          },
          '✓'
        ),

        h(
          'h2',
          {
            class: 'done__title',
            tabindex: '-1',
            id: 'done-title'
          },
          'Report sent!'
        ),

        h(
          'p',
          {
            class: 'done__text'
          },
          info.alerted
            ? "It's on its way to the VIP Discord. Thanks for helping the crew."
            : "Thanks for the update. Sold-out reports don't trigger a VIP alert."
        ),

        info.demo
          ? h(
              'p',
              {
                class:
                  'notice notice--light'
              },
              'Preview mode: nothing was actually sent.'
            )
          : null,

        h(
          'p',
          {
            class:
              'notice notice--light'
          },
          cfg.notice
        ),

        h(
          'div',
          {
            class: 'done__actions'
          },

          h(
            'a',
            {
              class: 'btn btn--lg',
              href: '#report'
            },
            'Report another'
          ),

          cfg.discordInviteUrl
            ? h(
                'a',
                {
                  class:
                    'btn btn--lg btn--discord',
                  href:
                    cfg.discordInviteUrl,
                  target: '_blank',
                  rel: 'noopener'
                },
                'Join the Discord'
              )
            : null,

          h(
            'a',
            {
              class: 'text-link',
              href: '#'
            },
            'Back to home'
          )
        )
      )
    );
  }

  function show(name) {
    Object.keys(views).forEach(
      function (k) {
        views[k].hidden =
          k !== name;
      }
    );

    if (name !== current) {
      window.scrollTo(0, 0);
      current = name;
    }

    document.body.setAttribute(
      'data-view',
      name
    );
  }

  function route() {
    var hash =
      location.hash;

    if (hash === '#report') {
      show('form');
      openReport();
    } else if (
      hash === '#done' &&
      lastSuccess
    ) {
      renderDone(lastSuccess);
      show('done');

      document
        .getElementById('done-title')
        .focus({
          preventScroll: true
        });

      VIP.effects.burst(
        views.done
      );
    } else {
      show('home');

      var target =
        hash.length > 1
          ? document.getElementById(
              hash.slice(1)
            )
          : null;

      if (target) {
        target.scrollIntoView({
          behavior:
            VIP.reducedMotion()
              ? 'auto'
              : 'smooth'
        });
      }
    }
  }

  window.addEventListener(
    'hashchange',
    route
  );

  route();
})();
