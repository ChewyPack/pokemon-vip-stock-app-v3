/*
 * APP SHELL
 *
 * Handles routing, membership access, checkout return,
 * Discord connection status, paywall rendering
 * and successful report completion.
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
          { class: 'vip-plans' },

          h(
            'div',
            { class: 'vip-plan' },

            h(
              'div',
              { class: 'vip-plan__name' },
              'MONTHLY'
            ),

            h(
              'div',
              { class: 'vip-plan__price' },
              '$5'
            ),

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
            {
              class: 'vip-plan vip-plan--featured'
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
              { class: 'vip-plan__name' },
              'YEARLY'
            ),

            h(
              'div',
              { class: 'vip-plan__price' },
              '$50'
            ),

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
          {
            class: 'notice'
          },
          'After checkout, your VIP access will activate automatically.'
        )
      )
    );

    views.form.appendChild(panel);
    show('form');

    var title =
      views.form.querySelector('.panel__title');

    if (title) {
      title.focus({
        preventScroll: true
      });
    }
  }

  async function startCheckout(plan) {
    try {
      var response = await fetch(
        '/api/checkout',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            plan: plan
          })
        }
      );

      var data = await response.json();

      if (!response.ok || !data.ok || !data.url) {
        throw new Error(
          data.error || 'Unable to start checkout.'
        );
      }

      window.location.href = data.url;
    } catch (error) {
      console.error(
        'Checkout error:',
        error
      );

      alert(
        'Unable to start checkout right now. Please try again.'
      );
    }
  }

  async function checkMembership() {
    try {
      var response = await fetch(
        '/api/membership',
        {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store'
        }
      );

      if (!response.ok) {
        return false;
      }

      var data = await response.json();

      return !!(
        data &&
        data.ok &&
        data.active
      );
    } catch (error) {
      console.error(
        'Membership check error:',
        error
      );

      return false;
    }
  }

  async function getDiscordStatus() {
    try {
      var response = await fetch(
        '/api/discord/status',
        {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store'
        }
      );

      if (!response.ok) {
        return {
          ok: false,
          active: false,
          connected: false
        };
      }

      return await response.json();
    } catch (error) {
      console.error(
        'Discord status error:',
        error
      );

      return {
        ok: false,
        active: false,
        connected: false
      };
    }
  }

  function renderDiscordPanel(status) {
    var connected =
      status &&
      status.ok &&
      status.active &&
      status.connected;

    var username =
      status &&
      status.discord_username
        ? status.discord_username
        : '';

    var panel = h(
      'section',
      {
        class: 'panel discord-panel'
      },

      h(
        'div',
        {
          class: 'panel__head'
        },

        h(
          'h2',
          {
            class: 'panel__title'
          },
          connected
            ? 'Discord Connected ✓'
            : 'Connect Your Discord'
        ),

        h(
          'p',
          {
            class: 'panel__blurb'
          },
          connected
            ? 'Your Discord account is connected to your Pokémon VIP membership.'
            : 'Connect your Discord account to access the VIP community.'
        )
      ),

      h(
        'div',
        {
          class: 'panel__body'
        },

        connected
          ? h(
              'div',
              {
                class: 'notice'
              },
              'Connected as ',
              h(
                'strong',
                null,
                username || 'Discord User'
              )
            )
          : h(
              'div',
              {
                class: 'discord-connect'
              },

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

    return panel;
  }

  async function renderReport() {
    var active =
      await checkMembership();

    if (!active) {
      renderPaywall();
      return;
    }

    VIP.clear(views.form);

    var discordStatus =
      await getDiscordStatus();

    var discordPanel =
      renderDiscordPanel(
        discordStatus
      );

    views.form.appendChild(
      discordPanel
    );

    var reportContainer =
      h(
        'div',
        {
          class: 'report-flow'
        }
      );

    views.form.appendChild(
      reportContainer
    );

    if (!flow) {
      flow = VIP.flow(
        reportContainer,
        {
          onSuccess:
            handleSuccess
        }
      );
    }

    flow.open();

    show('form');
  }

  async function handleCheckoutReturn() {
    var params =
      new URLSearchParams(
        window.location.search
      );

    var checkout =
      params.get('checkout');

    var sessionId =
      params.get('session_id');

    if (
      checkout !== 'success' ||
      !sessionId
    ) {
      return false;
    }

    try {
      var response = await fetch(
        '/api/membership',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            session_id: sessionId
          })
        }
      );

      var data = await response.json();

      if (
        !response.ok ||
        !data.ok ||
        !data.active
      ) {
        console.error(
          'Membership activation failed:',
          data
        );

        return false;
      }

      window.history.replaceState(
        {},
        document.title,
        '/#report'
      );

      return true;
    } catch (error) {
      console.error(
        'Checkout return error:',
        error
      );

      return false;
    }
  }

  async function openReport() {
    var checkoutActivated =
      await handleCheckoutReturn();

    if (checkoutActivated) {
      await renderReport();
      return;
    }

    await renderReport();
  }

  function handleDiscordResult() {
    var hash =
      window.location.hash;

    if (hash === '#discord-connected') {
      window.history.replaceState(
        {},
        document.title,
        '/#report'
      );

      openReport();

      return true;
    }

    if (hash === '#discord-error') {
      window.history.replaceState(
        {},
        document.title,
        '/#report'
      );

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

    window.location.hash =
      '#done';
  }

  function renderDone(info) {
    VIP.clear(views.done);

    var report =
      info && info.report
        ? info.report
        : {};

    var title =
      h(
        'h2',
        {
          class: 'panel__title',
          tabindex: '-1'
        },
        'Report sent!'
      );

    var blurb =
      h(
        'p',
        {
          class: 'panel__blurb'
        },
        'Thanks for helping the Pokémon VIP community.'
      );

    var body =
      h(
        'div',
        {
          class: 'panel__body'
        },

        h(
          'div',
          {
            class: 'notice'
          },
          info && info.alerted
            ? 'Your report was submitted and the item is still there.'
            : 'Your stock report was submitted successfully.'
        ),

        h(
          'div',
          {
            class: 'done-actions'
          },

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

    var panel =
      h(
        'section',
        {
          class: 'panel'
        },

        h(
          'div',
          {
            class: 'panel__head'
          },
          title,
          blurb
        ),

        body
      );

    views.done.appendChild(
      panel
    );
  }

  function route() {
    var hash =
      location.hash;

    if (
      hash === '#discord-connected' ||
      hash === '#discord-error'
    ) {
      handleDiscordResult();
      return;
    }

    if (hash === '#report') {
      show('form');
      openReport();

    } else if (
      hash === '#done' &&
      lastSuccess
    ) {
      renderDone(
        lastSuccess
      );

      show('done');

      var title =
        document.getElementById(
          'done-title'
        );

      if (title) {
        title.focus({
          preventScroll: true
        });
      }

      VIP.effects.burst(
        views.done
      );

    } else {
      /*
       * Render the landing page before showing
       * the home view.
       */
      VIP.landing.render(views.home);

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
