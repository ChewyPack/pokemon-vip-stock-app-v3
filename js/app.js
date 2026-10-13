/*
 * APP SHELL
 *
 * Handles routing, membership access, checkout return,
 * Discord connection status, Discord membership recovery,
 * paywall rendering and successful report completion.
 */
(function () {
  var VIP = (window.VIP = window.VIP || {});
  var h = VIP.h;

  var views = {
    home: document.getElementById('view-home'),
    form: document.getElementById('view-form'),
    done: document.getElementById('view-done')
  };

  var flow = null;
  var lastSuccess = null;
  var checkoutReturnHandled = false;
  var checkoutReturnPromise = null;

  function show(name) {
    Object.keys(views).forEach(function (key) {
      if (!views[key]) return;
      views[key].hidden = key !== name;
    });
  }

  function renderPaywall() {
    VIP.clear(views.form);

    var panel = h(
      'section',
      { class: 'panel' },

      h(
        'div',
        { class: 'panel__head' },

        h(
          'h2',
          {
            class: 'panel__title',
            tabindex: '-1'
          },
          'Unlock Pokémon VIP'
        ),

        h(
          'p',
          { class: 'panel__blurb' },
          'A VIP membership is required to submit stock reports and access the VIP community.'
        )
      ),

      h(
        'div',
        { class: 'panel__body' },

        h(
          'div',
          { class: 'vip-reconnect' },

          h('h3', null, 'Already a VIP member?'),

          h(
            'p',
            null,
            'If you previously connected Discord to your VIP membership, you can reconnect it to restore your access.'
          ),

          h(
            'a',
            {
              class: 'btn btn--primary',
              href: '/api/discord/connect?recovery=1'
            },
            'Reconnect Discord'
          )
        ),

        h(
          'div',
          { class: 'vip-divider' },
          'OR'
        ),

        h(
          'div',
          { class: 'vip-plans' },

          h(
            'div',
            { class: 'vip-plan' },

            h('div', { class: 'vip-plan__name' }, 'MONTHLY'),
            h('div', { class: 'vip-plan__price' }, '$5'),

            h(
              'p',
              { class: 'vip-plan__text' },
              'VIP access billed monthly.'
            ),

            h(
              'button',
              {
                type: 'button',
                class: 'btn btn--primary',
                onclick: function () {
                  startCheckout('monthly');
                }
              },
              'Join Monthly'
            )
          ),

          h(
            'div',
            { class: 'vip-plan vip-plan--featured' },

            h('div', { class: 'vip-plan__badge' }, 'SAVE $10'),
            h('div', { class: 'vip-plan__name' }, 'YEARLY'),
            h('div', { class: 'vip-plan__price' }, '$50'),

            h(
              'p',
              { class: 'vip-plan__text' },
              'VIP access billed yearly.'
            ),

            h(
              'button',
              {
                type: 'button',
                class: 'btn btn--primary',
                onclick: function () {
                  startCheckout('yearly');
                }
              },
              'Join Yearly'
            )
          )
        ),

        h(
          'p',
          { class: 'notice' },
          'After checkout, your VIP access will activate automatically.'
        )
      )
    );

    views.form.appendChild(panel);
    show('form');

    var title = views.form.querySelector('.panel__title');

    if (title) {
      title.focus({ preventScroll: true });
    }
  }

  async function startCheckout(plan) {
    try {
      var response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ plan: plan })
      });

      var data = await response.json();

      if (!response.ok || !data.ok || !data.url) {
        throw new Error(data.error || 'Unable to start checkout.');
      }

      window.location.href = data.url;
    } catch (error) {
      console.error('Checkout error:', error);

      alert(
        'Unable to start checkout right now. Please try again.'
      );
    }
  }

  async function checkMembership() {
    try {
      var response = await fetch('/api/membership', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
      });

      if (!response.ok) return false;

      var data = await response.json();

      return !!(data && data.ok && data.active);
    } catch (error) {
      console.error('Membership check error:', error);
      return false;
    }
  }

  async function getDiscordStatus() {
    try {
      var response = await fetch('/api/discord/status', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
      });

      if (!response.ok) {
        return {
          ok: false,
          active: false,
          connected: false
        };
      }

      return await response.json();
    } catch (error) {
      console.error('Discord status error:', error);

      return {
        ok: false,
        active: false,
        connected: false
      };
    }
  }

  function renderDiscordPanel(status) {
    var connected = !!(
      status &&
      status.ok &&
      status.active &&
      status.connected
    );

    var username =
      status && status.discord_username
        ? status.discord_username
        : '';

    return h(
      'section',
      { class: 'panel discord-panel' },

      h(
        'div',
        { class: 'panel__head' },

        h(
          'h2',
          { class: 'panel__title' },
          connected
            ? 'Discord Connected ✓'
            : 'Connect Your Discord'
        ),

        h(
          'p',
          { class: 'panel__blurb' },
          connected
            ? 'Your Discord account is connected to your Pokémon VIP membership.'
            : 'Connect your Discord account to access the VIP community.'
        )
      ),

      h(
        'div',
        { class: 'panel__body' },

        connected
          ? h(
              'div',
              { class: 'notice' },
              'Connected as ',
              h('strong', null, username || 'Discord User')
            )
          : h(
              'div',
              { class: 'discord-connect' },

              h(
                'p',
                null,
                'Connect Discord to link your VIP membership with your Discord account and receive your VIP Member role.'
              ),

              h(
                'a',
                {
                  class: 'btn btn--primary',
                  href: '/api/discord/connect'
                },
                'Connect Discord'
              )
            )
      )
    );
  }

  async function renderReport() {
    var active = await checkMembership();

    if (!active) {
      renderPaywall();
      return;
    }

    VIP.clear(views.form);

    var discordStatus = await getDiscordStatus();
    views.form.appendChild(renderDiscordPanel(discordStatus));

    var reportContainer = h('div', { class: 'report-flow' });
    views.form.appendChild(reportContainer);

    if (!flow) {
      flow = VIP.flow(reportContainer, {
        onSuccess: handleSuccess
      });
    }

    flow.open();
    show('form');
  }

  function renderActivationError() {
    VIP.clear(views.form);

    var retryButton = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary',
        onclick: async function () {
          retryButton.disabled = true;
          retryButton.textContent = 'Retrying Activation...';

          try {
            checkoutReturnHandled = false;
            checkoutReturnPromise = null;

            var result = await handleCheckoutReturn();

            if (result === 'success') {
              checkoutReturnHandled = true;
              await renderReport();
              return;
            }

            renderActivationError();
          } finally {
            retryButton.disabled = false;
            retryButton.textContent = 'Retry Membership Activation';
          }
        }
      },
      'Retry Membership Activation'
    );

    var panel = h(
      'section',
      { class: 'panel' },

      h(
        'div',
        { class: 'panel__head' },

        h(
          'h2',
          {
            class: 'panel__title',
            tabindex: '-1'
          },
          'Membership Activation Needs Another Try'
        ),

        h(
          'p',
          { class: 'panel__blurb' },
          'We could not confirm your VIP membership yet. You do not need to purchase again. Please retry activation below.'
        )
      ),

      h(
        'div',
        { class: 'panel__body' },

        retryButton,

        h(
          'p',
          { class: 'notice' },
          'If activation still fails, contact support so we can check your membership record.'
        )
      )
    );

    views.form.appendChild(panel);
    show('form');
  }

  async function handleCheckoutReturn() {
    var params = new URLSearchParams(window.location.search);
    var checkout = params.get('checkout');
    var sessionId = params.get('session_id');

    if (checkout !== 'success') {
      return 'not_checkout';
    }

    if (!sessionId) {
      console.error('Checkout return is missing the Stripe session ID.');
      return 'failed';
    }

    var delays = [0, 1500, 2500, 4000, 5000];

    for (var attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) {
        await new Promise(function (resolve) {
          setTimeout(resolve, delays[attempt]);
        });
      }

      try {
        var response = await fetch('/api/membership', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          cache: 'no-store',
          body: JSON.stringify({
            session_id: sessionId
          })
        });

        var data = await response.json();

        if (response.ok && data.ok && data.active) {
          window.history.replaceState(
            {},
            document.title,
            '/#report'
          );

          return 'success';
        }

        console.warn(
          'Membership activation attempt ' + (attempt + 1) + ' failed:',
          data
        );

        if (
          data.error === 'invalid_checkout' ||
          data.error === 'membership_inactive' ||
          data.error === 'stripe_not_configured'
        ) {
          break;
        }
      } catch (error) {
        console.error(
          'Membership activation attempt ' + (attempt + 1) + ' failed:',
          error
        );
      }
    }

    return 'failed';
  }

  async function openReport() {
    if (!checkoutReturnHandled) {
      if (!checkoutReturnPromise) {
        checkoutReturnPromise = handleCheckoutReturn();
      }

      var checkoutResult = await checkoutReturnPromise;

      if (checkoutResult === 'failed') {
        renderActivationError();
        return;
      }

      if (checkoutResult === 'success') {
        checkoutReturnHandled = true;
      }
    }

    await renderReport();
  }

  function handleDiscordResult() {
    var hash = window.location.hash;

    if (
      hash === '#discord-recovered' ||
      hash === '#discord-connected'
    ) {
      window.history.replaceState({}, document.title, '/#report');
      openReport();
      return true;
    }

    if (hash === '#discord-recovery-error') {
      window.history.replaceState({}, document.title, '/#report');
      renderPaywall();

      setTimeout(function () {
        alert(
          'We could not find an active Pokémon VIP membership connected to that Discord account.'
        );
      }, 100);

      return true;
    }

    if (hash === '#discord-error') {
      window.history.replaceState({}, document.title, '/#report');
      openReport();

      setTimeout(function () {
        alert(
          'We could not connect your Discord account. Please try again.'
        );
      }, 100);

      return true;
    }

    return false;
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
        info && info.alerted
          ? 'Your report was submitted and the item is still there.'
          : 'Your stock report was submitted successfully.'
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

    /*
     * FIX:
     * Always process a successful Stripe checkout return,
     * even if the browser drops or omits the #report hash.
     * This ensures membership activation is not dependent
     * on the hash fragment being present.
     */
    if (params.get('checkout') === 'success') {
      show('form');
      openReport();
      return;
    }

    if (
      hash === '#discord-connected' ||
      hash === '#discord-error' ||
      hash === '#discord-recovered' ||
      hash === '#discord-recovery-error'
    ) {
      handleDiscordResult();
      return;
    }

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

