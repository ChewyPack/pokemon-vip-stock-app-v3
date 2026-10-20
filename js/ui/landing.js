/* LANDING PAGE — original Pokémon VIP landing page with dropdown navigation. */
(function () {
  var VIP = (window.VIP = window.VIP || {});
  var h = VIP.h;

  function bolt() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'bolt');
    svg.setAttribute('viewBox', '0 0 1200 60');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');

    var poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute(
      'points',
      '0,30 90,18 150,38 260,14 330,40 450,16 520,42 640,12 720,40 850,18 930,44 1050,16 1120,38 1200,20 1200,34 1120,52 1050,30 930,58 850,32 720,54 640,26 520,56 450,30 330,54 260,28 150,52 90,32 0,44'
    );
    svg.appendChild(poly);
    return svg;
  }

  function navLink(label, href) {
    return h('a', {
      class: 'site-nav__link',
      href: href
    }, label);
  }

  function closeMenus(nav, keepMenu) {
    nav.querySelectorAll('.site-nav__menu').forEach(function (menu) {
      var shouldKeep = keepMenu && (menu === keepMenu || menu.contains(keepMenu));
      menu.hidden = !shouldKeep;
    });
    nav.querySelectorAll('.site-nav__toggle').forEach(function (button) {
      var controlled = nav.querySelector('#' + button.getAttribute('aria-controls'));
      button.setAttribute('aria-expanded', String(!!controlled && !controlled.hidden));
    });
  }

  function makeMenuItem(item, nav) {
    if (item.children && item.children.length) {
      var submenuId = 'nav-sub-' + item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      var toggle = h('button', {
        class: 'site-nav__item site-nav__submenu-toggle',
        type: 'button',
        'aria-expanded': 'false',
        'aria-controls': submenuId
      },
        h('span', { class: 'site-nav__item-title' }, item.title),
        h('span', { class: 'site-nav__submenu-arrow', 'aria-hidden': 'true' }, '›')
      );
      var submenu = h('div', {
        class: 'site-nav__menu site-nav__submenu',
        id: submenuId,
        hidden: true
      }, item.children.map(function (child) { return makeMenuItem(child, nav); }));
      var wrapper = h('div', { class: 'site-nav__nested-dropdown' }, toggle, submenu);

      toggle.addEventListener('click', function (event) {
        event.stopPropagation();
        var currentNav = wrapper.closest('.site-nav');
        var wasOpen = toggle.getAttribute('aria-expanded') === 'true';
        currentNav.querySelectorAll('.site-nav__submenu-toggle').forEach(function (other) {
          other.setAttribute('aria-expanded', 'false');
        });
        currentNav.querySelectorAll('.site-nav__submenu').forEach(function (other) {
          other.hidden = true;
        });
        if (!wasOpen) {
          toggle.setAttribute('aria-expanded', 'true');
          submenu.hidden = false;
        }
      });
      return wrapper;
    }

    return h('a', {
      class: 'site-nav__item',
      href: item.href
    },
      h('span', { class: 'site-nav__item-title' }, item.title),
      item.description ? h('span', { class: 'site-nav__item-description' }, item.description) : null
    );
  }

  function dropdown(label, items) {
    var menuId = 'nav-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    var button = h('button', {
      class: 'site-nav__toggle',
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': menuId
    }, label + ' ▾');
    var menu = h('div', {
      class: 'site-nav__menu',
      id: menuId,
      hidden: true
    }, items.map(function (item) { return makeMenuItem(item); }));
    var wrapper = h('div', { class: 'site-nav__dropdown' }, button, menu);

    button.addEventListener('click', function () {
      var isOpen = button.getAttribute('aria-expanded') === 'true';
      var nav = wrapper.closest('.site-nav');
      nav.querySelectorAll('.site-nav__toggle').forEach(function (otherButton) {
        otherButton.setAttribute('aria-expanded', 'false');
      });
      nav.querySelectorAll('.site-nav__menu').forEach(function (otherMenu) {
        otherMenu.hidden = true;
      });
      nav.querySelectorAll('.site-nav__submenu-toggle').forEach(function (otherButton) {
        otherButton.setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        button.setAttribute('aria-expanded', 'true');
        menu.hidden = false;
      }
    });

    return wrapper;
  }

  function buildNavigation() {
    var nav = h(
      'header',
      { class: 'site-nav-header' },
      h(
        'div',
        { class: 'wrap site-nav-header__inner' },
        h(
          'nav',
          {
            class: 'site-nav',
            'aria-label': 'Main navigation'
          },
          navLink('Home', '/'),
          dropdown('Poke Report', [
            { title: 'News', description: 'Pokémon news and hobby coverage', href: '/news.html' },
            { title: 'Updates', description: 'Platform updates and announcements', href: '/updates.html' },
            { title: 'Market Intelligence', description: 'Market trends and product insights', href: '/market-intelligence.html' },
            { title: 'Events', description: 'Shows, trade nights, and releases', href: '/events.html' },
            { title: 'Instant Cashout', description: 'Explore collection cash-out options', href: '/instant-buyout.html' }
          ]),
          dropdown('Alerts', [
            { title: 'Live Stock', description: 'View live stock alerts', href: '/alerts.html' },
            { title: 'Target', description: 'Target stock alerts', href: '/alerts.html?retailer=target' },
            { title: 'Walmart', description: 'Walmart stock alerts', href: '/alerts.html?retailer=walmart' },
            { title: 'BestBuy', description: 'Best Buy stock alerts', href: '/alerts.html?retailer=bestbuy' }
          ]),
          navLink('Line Services', '/line-services.html'),
          dropdown('Shop', [
            {
              title: 'Cards',
              children: [
                { title: 'Sealed', href: '/shop.html?category=sealed' },
                { title: 'Slabs', href: '/shop.html?category=slabs' },
                { title: 'Singles', href: '/shop.html?category=singles' }
              ]
            },
            {
              title: 'Merch',
              children: [
                { title: 'Clothing', href: '/shop.html?category=clothing' },
                { title: 'Plushies', href: '/shop.html?category=plushies' },
                { title: 'Other', href: '/shop.html?category=other' }
              ]
            }
          ]),
          navLink('Giveaways', '/giveaways.html'),
          navLink('Chat', '/chat.html'),
          dropdown('Resources', [
            { title: 'Securing Product', href: '/resources/securing-product.html' },
            { title: 'Spotting Fakes', href: '/resources/spotting-fakes.html' },
            { title: 'Pricing Cards', href: '/resources/pricing-cards.html' }
          ]),
          h('a', {
            class: 'site-nav__link account-nav-link',
            href: '/account.html',
            id: 'account-nav-link'
          }, 'Sign up / Log in')
        )
      )
    );

    fetch('/api/account/me', { credentials: 'include', cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        var accountLink = nav.querySelector('#account-nav-link');
        if (!accountLink || !data || !data.ok || !data.authenticated) return;
        accountLink.href = '/collector.html';
        accountLink.textContent = 'Profile';
        accountLink.setAttribute('aria-label', 'Open your collector profile');
      })
      .catch(function (error) {
        console.warn('Could not refresh account navigation:', error);
      });

    document.addEventListener('click', function (event) {
      if (!nav.contains(event.target)) {
        nav.querySelectorAll('.site-nav__toggle, .site-nav__submenu-toggle').forEach(function (button) {
          button.setAttribute('aria-expanded', 'false');
        });
        nav.querySelectorAll('.site-nav__menu').forEach(function (menu) { menu.hidden = true; });
      }
    });

    nav.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        nav.querySelectorAll('.site-nav__toggle, .site-nav__submenu-toggle').forEach(function (button) {
          button.setAttribute('aria-expanded', 'false');
        });
        nav.querySelectorAll('.site-nav__menu').forEach(function (menu) { menu.hidden = true; });
      }
    });

    return nav;
  }

  function universeCard(u) {
    var art = (VIP.assets.universeArt || {})[u.id] || {};
    var live = u.status === 'live';
    var style = {};

    if (art.src) {
      style.backgroundImage = 'url("' + art.src + '")';
      style.backgroundSize = art.size || 'cover';
      style.backgroundPosition = art.position || '50% 50%';
    }

    return h(
      'article',
      { class: 'card ' + (live ? 'card--live' : 'card--soon') },
      h(
        'div',
        { class: 'card__frame' },
        h('div', {
          class: 'card__art' + (art.src ? '' : ' card__art--back'),
          style: style
        }),
        h('span', { class: 'card__rarity' }, live ? 'Live now' : 'Coming soon'),
        h(
          'div',
          { class: 'card__plate' },
          h('h3', { class: 'card__name' }, u.name),
          h('p', { class: 'card__blurb' }, u.blurb),
          live ? h('a', {
            class: 'btn btn--sm',
            href: '#report'
          }, u.cta || 'Report a sighting') : null
        ),
        h('span', { class: 'card__holo', 'aria-hidden': 'true' })
      )
    );
  }

  VIP.landing = {
    render: function (root) {
      var cfg = VIP.siteConfig;
      var poster = VIP.assets.heroPoster;

      var navigation = buildNavigation();

      /* Original hero — preserved. */
      var hero = h(
        'header',
        { class: 'hero', id: 'home' },
        h(
          'div',
          { class: 'wrap hero__grid' },
          h(
            'h1',
            { class: 'wordmark' },
            h('span', { class: 'wordmark__top' }, 'Pokémon'),
            h('span', { class: 'wordmark__bottom' }, 'VIP')
          ),
          h(
            'figure',
            { class: 'poster' },
            h('img', {
              src: poster.src,
              alt: poster.alt,
              width: '1376',
              height: '768',
              fetchpriority: 'high'
            })
          ),
          h(
            'div',
            { class: 'hero__copy' },
            h('p', { class: 'hero__lead' }, cfg.brand.lead),
            h(
              'div',
              { class: 'hero__actions' },
              h('a', {
                class: 'btn btn--lg',
                href: '#report'
              }, 'Report a sighting'),
              h('a', {
                class: 'text-link',
                href: '#how'
              }, 'See how it works')
            )
          )
        ),
        bolt()
      );

      /* Original universe cards — preserved. */
      var universes = h(
        'section',
        {
          class: 'section',
          id: 'universes',
          'aria-labelledby': 'uni-title'
        },
        h(
          'div',
          { class: 'wrap' },
          h('h2', {
            class: 'section__title',
            id: 'uni-title'
          }, 'Where the crew hunts'),
          h('p', {
            class: 'section__sub'
          }, 'Pokémon is live. More universes are on the way.')
        ),
        h(
          'div',
          { class: 'binder' },
          h('div', {
            class: 'binder__row'
          }, cfg.universes.map(universeCard))
        )
      );

      /* Original how-it-works section — preserved. */
      var how = h(
        'section',
        {
          class: 'section',
          id: 'how',
          'aria-labelledby': 'how-title'
        },
        h(
          'div',
          { class: 'wrap' },
          h('h2', {
            class: 'section__title',
            id: 'how-title'
          }, 'How it works'),
          h(
            'ol',
            { class: 'steps' },
            cfg.howItWorks.map(function (s, i) {
              return h(
                'li',
                { class: 'step-card' },
                h('span', {
                  class: 'step-card__num',
                  'aria-hidden': 'true'
                }, String(i + 1)),
                h('span', {
                  class: 'step-card__icon',
                  'aria-hidden': 'true'
                }, s.icon),
                h('h3', {
                  class: 'step-card__title'
                }, s.title),
                h('p', {
                  class: 'step-card__text'
                }, s.text)
              );
            })
          )
        )
      );

      /* Original call-to-action — preserved. */
      var cta = h(
        'section',
        { class: 'cta-band' },
        h(
          'div',
          { class: 'wrap cta-band__inner' },
          h('h2', {
            class: 'cta-band__title'
          }, 'Spotted something?'),
          h('a', {
            class: 'btn btn--lg',
            href: '#report'
          }, 'Report a sighting'),
          h('p', {
            class: 'notice notice--light'
          }, cfg.notice)
        )
      );

      /* Original footer — preserved. */
      var footer = h(
        'footer',
        { class: 'footer' },
        h(
          'div',
          { class: 'wrap' },
          h('p', null, cfg.legal)
        )
      );

      VIP.clear(root);
      root.appendChild(navigation);
      root.appendChild(hero);
      root.appendChild(universes);
      root.appendChild(how);
      root.appendChild(cta);
      root.appendChild(footer);
    }
  };
})();

