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
          navLink('PokePrizePool', '/'),
          dropdown('Explore', [
            { title: 'News & Updates', description: 'Pokémon news, hobby coverage, and announcements', href: '/news.html' },
            { title: 'Market Intelligence', description: 'Market trends and product insights', href: '/market-intelligence.html' },
            { title: 'Events', description: 'Shows, trade nights, and releases', href: '/events.html' },
            { title: 'Submit an Event', href: '/submit-event.html' },
            { title: 'Giveaways', description: 'See current prizes and ways to enter', href: '/giveaways.html' },
            { title: 'Ripz', description: 'Watch and share live collector streams', href: '/ripz.html' }
          ]),
          dropdown('Alerts', [
            { title: 'Live Stock', description: 'Community-reported in-store sightings', href: '/alerts.html' },
            { title: 'Target', href: '/alerts.html?retailer=target' },
            { title: 'Walmart', href: '/alerts.html?retailer=walmart' },
            { title: 'Best Buy', href: '/alerts.html?retailer=bestbuy' }
          ]),
          dropdown('Marketplace', [
            { title: 'PokePrizePool Store', description: 'Official cards, sealed products, and merchandise', href: '/store.html' },
            { title: 'Collector Marketplace', description: 'Browse listings from member shops', href: '/marketplace.html' },
            { title: 'Manage My Shop', description: 'Create or edit your member shop', href: '/collector.html#shop' },
            { title: 'Instant Cashout', description: 'Explore collection cash-out options', href: '/instant-buyout.html' },
            { title: 'Line Services', description: 'Get help securing products in person', href: '/line-services.html' }
          ]),
          dropdown('Community', [
            { title: 'Collector Chat', description: 'Talk with other collectors', href: '/chat.html' },
            { title: 'News Feed', description: 'See posts and updates from collectors', href: '/newsfeed' }
          ]),
          dropdown('Resources', [
            { title: 'Securing Product', href: '/resources/securing-product.html' },
            { title: 'Spotting Fakes', href: '/resources/spotting-fakes.html' },
            { title: 'Pricing Cards', href: '/resources/pricing-cards.html' },
            { title: 'Advertise with PokePrizePool', href: '/advertise.html' }
          ]),
          h('a', {
            class: 'site-nav__link site-nav__login-link',
            href: '/account.html?mode=login',
            id: 'account-nav-link'
          }, 'Log in'),
          h('a', {
            class: 'site-nav__link account-nav-link',
            href: '/account.html?mode=register'
          }, 'Create free account'),
          h('div', { class: 'site-nav__inbox-wrap' },
            h('button', {
              class: 'site-nav__link site-nav__inbox-link',
              type: 'button',
              'aria-label': 'Open Notifications or Inbox',
              'aria-expanded': 'false',
              'aria-controls': 'site-nav-inbox-menu'
            },
              h('img', { src: '/inbox-icon.png', alt: '', class: 'site-nav__inbox-image' }),
              h('span', { class: 'site-nav__inbox-badge', hidden: true, 'aria-live': 'polite' })
            ),
            h('div', { class: 'site-nav__inbox-menu', id: 'site-nav-inbox-menu', hidden: true },
              h('a', { class: 'site-nav__inbox-menu-link', href: '/notifications.html' },
                h('span', { class: 'site-nav__inbox-menu-label' }, 'Notifications'),
                h('span', { class: 'site-nav__menu-count site-nav__notification-count', hidden: true, 'aria-label': '0 unread notifications' })
              ),
              h('a', { class: 'site-nav__inbox-menu-link', href: '/inbox.html' },
                h('span', { class: 'site-nav__inbox-menu-label' }, 'Inbox'),
                h('span', { class: 'site-nav__menu-count site-nav__inbox-count', hidden: true, 'aria-label': '0 unread Inbox items' })
              )
            )
          )
        )
      )
    );

    // Keep the offer inbox utility available on the homepage just like every other page.
    var inbox = nav.querySelector('.site-nav__inbox-link');
    var inboxMenu = nav.querySelector('.site-nav__inbox-menu');
    var inboxWrap = nav.querySelector('.site-nav__inbox-wrap');
    var inboxBadge = nav.querySelector('.site-nav__inbox-badge');
    var notificationMenuBadge = nav.querySelector('.site-nav__notification-count');
    var inboxMenuBadge = nav.querySelector('.site-nav__inbox-count');
    inbox.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = inboxMenu.hidden;
      inboxMenu.hidden = !open;
      inbox.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (event) {
      if (!inboxWrap.contains(event.target)) {
        inboxMenu.hidden = true;
        inbox.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        inboxMenu.hidden = true;
        inbox.setAttribute('aria-expanded', 'false');
      }
    });
    function refreshInboxBadge() {
      Promise.all([
        fetch('/api/collector/trades', { credentials: 'include', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
        fetch('/api/notifications', { credentials: 'include', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
        fetch('/api/collector/direct-messages', { credentials: 'include', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      ]).then(function (results) {
        var offers = results[0] && results[0].ok ? (results[0].offers || []).filter(function (offer) {
          return offer.direction === 'incoming' && !offer.recipient_read_at && offer.status === 'pending';
        }).length : 0;
        var notifications = results[1] && results[1].ok ? (results[1].notifications || []).filter(function (item) {
          return !item.read_at && item.notification_type !== 'direct_message';
        }).length : 0;
        var messages = results[2] && results[2].ok ? (results[2].conversations || []).reduce(function (sum, item) {
          return sum + Number(item.unread_count || 0);
        }, 0) : 0;
        var inboxCount = offers + messages;
        var count = inboxCount + notifications;
        function setMenuCount(badge, value, label) {
          badge.hidden = value < 1;
          badge.textContent = value > 99 ? '99+' : String(value);
          badge.setAttribute('aria-label', value + ' unread ' + label);
        }
        setMenuCount(notificationMenuBadge, notifications, 'notifications');
        setMenuCount(inboxMenuBadge, inboxCount, 'Inbox items');
        inboxBadge.hidden = count < 1;
        inboxBadge.textContent = count > 99 ? '99+' : String(count);
        inboxBadge.setAttribute('aria-label', count + ' unread items in Notifications and Inbox');
        inbox.setAttribute('aria-label', 'Open Notifications or Inbox' + (count ? ' (' + count + ' unread)' : ''));
      });
    }
    refreshInboxBadge();
    window.setInterval(refreshInboxBadge, 60000);
    window.addEventListener('collector-offers-updated', refreshInboxBadge);

    var inboxStyle = document.createElement('style');
    inboxStyle.textContent =
      '.site-nav__inbox-link{position:relative;display:inline-flex;flex:0 0 48px;align-items:center;justify-content:center;gap:0;width:48px;min-width:48px;height:48px;min-height:48px;padding:0!important;margin:0 2px;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;outline-offset:3px;vertical-align:middle}' +
      '.site-nav__inbox-link:hover,.site-nav__inbox-link:focus-visible{border:0!important;background:transparent!important;box-shadow:none!important;transform:none!important}' +
      '.site-nav__inbox-image{width:48px;height:48px;object-fit:contain;display:block;border:0!important;outline:0;box-shadow:none}' +
      '.site-nav__inbox-badge:not([hidden]){position:absolute;top:auto;right:0;bottom:0;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:#ef233c;color:#fff;font-size:.7rem;font-weight:700;line-height:1;box-shadow:0 0 0 2px #06174a;z-index:2}' +
      '.site-nav__inbox-badge[hidden]{display:none!important}' +
      '@media(max-width:560px){.site-nav__inbox-link{flex:0 0 96px;width:96px;min-width:96px;height:96px;min-height:96px}.site-nav__inbox-image{width:96px;height:96px}}';
    inboxStyle.textContent +=
      '.site-nav__inbox-wrap{position:relative;display:inline-flex;align-items:center;flex:0 0 auto}' +
      '.site-nav .site-nav__inbox-wrap .site-nav__inbox-link{font:inherit;color:inherit;cursor:pointer;flex:0 0 48px;width:48px;min-width:48px;height:48px;min-height:48px}' +
      '.site-nav__inbox-menu{position:absolute;z-index:1100;right:0;top:calc(100% + 6px);min-width:170px;padding:6px;background:#fff;border:1px solid #d5e0f2;border-radius:10px;box-shadow:0 8px 24px #07194d22}' +
      '.site-nav__inbox-menu[hidden]{display:none!important}' +
      '.site-nav__inbox-menu-link{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:10px;border-radius:7px;color:#17386c!important;text-decoration:none;font:900 .9rem Nunito,system-ui,sans-serif;white-space:nowrap}' +
      '.site-nav__inbox-menu-link:hover,.site-nav__inbox-menu-link:focus-visible{background:#f3f7ff}' +
      '.site-nav__menu-count:not([hidden]){display:inline-flex;align-items:center;justify-content:center;min-width:21px;height:21px;padding:0 6px;border-radius:999px;background:#ef233c;color:#fff;font:900 .72rem/1 Nunito,system-ui,sans-serif;box-shadow:0 1px 3px #07194d22}' +
      '.site-nav__menu-count[hidden]{display:none!important}' +
      '@media(max-width:560px){.site-nav .site-nav__inbox-wrap .site-nav__inbox-link{flex:0 0 96px;width:96px;min-width:96px;height:96px;min-height:96px}.site-nav__inbox-menu{min-width:160px}}';
    document.head.appendChild(inboxStyle);

    fetch('/api/account/me', { credentials: 'include', cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        var accountLink = nav.querySelector('#account-nav-link');
        if (!accountLink || !data || !data.ok || !data.authenticated) return;
        var loginLink = nav.querySelector('.site-nav__login-link');
        if (loginLink) loginLink.hidden = true;
        accountLink.href = '/collector.html';
        accountLink.textContent = 'Profile';
        accountLink.setAttribute('aria-label', 'Open your collector profile');

        var profileWrap = h('div', { class: 'site-nav__profile-wrap' });
        var trigger = h('button', {
          class: 'site-nav__profile-menu-trigger',
          type: 'button',
          'aria-label': 'Profile menu',
          'aria-expanded': 'false'
        }, '▾');
        var menu = h('div', { class: 'site-nav__profile-menu', hidden: true });
        var settings = h('a', {
          class: 'site-nav__profile-menu-settings',
          href: '/account.html#nearby-collector-settings'
        }, 'Settings');
        var logout = h('button', { type: 'button' }, 'Log Out');

        logout.addEventListener('click', function () {
          logout.disabled = true;
          logout.textContent = 'Logging out…';
          fetch('/api/account/logout', { method: 'POST', credentials: 'include' })
            .then(function (response) {
              if (!response.ok) throw new Error('Logout failed');
              window.location.href = '/account.html';
            })
            .catch(function () {
              logout.disabled = false;
              logout.textContent = 'Log Out';
            });
        });

        trigger.addEventListener('click', function () {
          var open = menu.hidden;
          menu.hidden = !open;
          trigger.setAttribute('aria-expanded', String(open));
        });

        var newsFeed = h('a', {
          class: 'site-nav__profile-menu-settings site-nav__profile-menu-newsfeed',
          href: '/newsfeed'
        }, 'News Feed');
        menu.appendChild(newsFeed);
        menu.appendChild(settings);
        menu.appendChild(logout);
        var accountParent = accountLink.parentNode;
        accountParent.insertBefore(profileWrap, accountLink);
        profileWrap.appendChild(accountLink);
        profileWrap.appendChild(trigger);
        profileWrap.appendChild(menu);

        var profileStyle = h('style', {});
        profileStyle.textContent =
          '.site-nav__profile-wrap{position:relative;display:inline-flex;align-items:center;gap:4px}' +
          '.site-nav__profile-menu-trigger{min-height:40px;border:1px solid #b9c9e6;border-radius:8px;background:#f3f7ff;color:#17386c;font:900 1rem Nunito,system-ui,sans-serif;cursor:pointer}' +
          '.site-nav__profile-menu{position:absolute;z-index:1000;right:0;top:calc(100% + 6px);min-width:130px;padding:5px;background:#fff;border:1px solid #d5e0f2;border-radius:9px;box-shadow:0 8px 22px #07194d22}' +
          '.site-nav__profile-menu[hidden]{display:none!important}' +
          '.site-nav__profile-menu button,.site-nav__profile-menu-settings{box-sizing:border-box;display:block;width:100%;padding:10px;border:0;border-radius:6px;background:#fff;color:#17386c;text-align:left;text-decoration:none;font:900 .9rem Nunito,system-ui,sans-serif;cursor:pointer}' +
          '.site-nav__profile-menu-settings{border-bottom:1px solid #e2e9f5;border-radius:6px 6px 0 0}' +
          '.site-nav__profile-menu button{color:#a32222}';
        nav.prepend(profileStyle);
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


  function buildHomepagePreviews() {
    var styleId = 'ppp-home-previews-style';
    if (!document.getElementById(styleId)) {
      var style = document.createElement('style');
      style.id = styleId;
      style.textContent = '.poster--logo{display:grid;place-items:center;aspect-ratio:1;max-width:470px;width:100%;margin-inline:auto;background:transparent;border:0;box-shadow:none;transform:none;overflow:visible}.poster--logo img{width:min(100%,430px);aspect-ratio:1;object-fit:contain;border-radius:0;filter:drop-shadow(0 16px 30px rgba(0,0,0,.28))}.poster--logo::after{display:none}.ppp-home-previews{padding:42px 0 56px;background:linear-gradient(180deg,rgba(3,10,29,.2),rgba(3,10,29,.58))}.ppp-home-previews__intro{margin-bottom:22px}.ppp-home-previews__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.ppp-home-previews__panel{min-width:0;padding:18px;border:2px solid rgba(255,255,255,.15);border-radius:15px;background:rgba(6,18,48,.9);box-shadow:0 10px 30px rgba(0,0,0,.18)}.ppp-home-previews__panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.ppp-home-previews__panel h3{margin:0;color:#ffd21f;font-size:1.5rem;line-height:1.1}.ppp-home-previews__panel-head>a{font-size:.82rem;font-weight:900;white-space:nowrap}.ppp-home-previews__feed{display:grid;gap:10px}.ppp-home-previews__item{display:grid;grid-template-columns:76px minmax(0,1fr);gap:11px;align-items:center;padding:9px;border-radius:10px;color:#fff;text-decoration:none;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);min-width:0}.ppp-home-previews__item:hover{border-color:rgba(255,210,31,.6);background:rgba(255,255,255,.08)}.ppp-home-previews__thumb{display:block;width:76px;height:76px;object-fit:cover;border-radius:8px;background:#10244f}.ppp-home-previews__text{min-width:0}.ppp-home-previews__meta{display:block;color:#9fb5de;font-size:.72rem;font-weight:900;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}.ppp-home-previews__item strong{display:block;font-size:.95rem;line-height:1.3;overflow-wrap:anywhere}.ppp-home-previews__item p{font-size:.82rem;color:#cedaf1;line-height:1.45;margin:4px 0 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.ppp-home-previews__empty{padding:18px 10px;color:#a9b9d8;font-size:.88rem;line-height:1.5;text-align:center}.ppp-home-previews__empty a{font-weight:900}.ppp-home-previews__panel--social{grid-column:1/-1}.ppp-home-previews__panel--social .ppp-home-previews__feed{grid-template-columns:repeat(2,minmax(0,1fr))}.ppp-home-previews__panel--social .ppp-home-previews__item{height:100%;align-content:start}.ppp-home-previews__panel--social .ppp-home-previews__item .ppp-home-previews__thumb{width:88px;height:88px}@media(max-width:650px){.ppp-home-previews{padding:28px 0 40px}.ppp-home-previews__grid{grid-template-columns:1fr}.ppp-home-previews__panel{padding:14px}.ppp-home-previews__item{grid-template-columns:64px minmax(0,1fr)}.ppp-home-previews__thumb{width:64px;height:64px}.ppp-home-previews__panel--social .ppp-home-previews__feed{grid-template-columns:1fr}.ppp-home-previews__panel--social .ppp-home-previews__item .ppp-home-previews__thumb{width:64px;height:64px}}';
      document.head.appendChild(style);
    }
    var section = document.createElement('section');
    section.className = 'ppp-home-previews';
    section.setAttribute('aria-labelledby','ppp-home-previews-title');
    var wrap = document.createElement('div'); wrap.className = 'wrap';
    var intro = document.createElement('div'); intro.className = 'ppp-home-previews__intro';
    var heading = document.createElement('h2'); heading.className = 'section__title'; heading.id = 'ppp-home-previews-title'; heading.textContent = 'Explore PokePrizePool';
    var subtitle = document.createElement('p'); subtitle.className = 'section__sub'; subtitle.textContent = 'Browse published coverage, member research, community-reported stock sightings, and collector-powered features. Online retailer monitoring is a separate feature and is not yet live.';
    intro.append(heading,subtitle);
    var grid = document.createElement('div'); grid.className = 'ppp-home-previews__grid';
    wrap.append(intro,grid); section.appendChild(wrap);

    function node(tag,cls,text){var el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
    function shorten(value,max){var s=String(value||'').trim();return s.length>max?s.slice(0,max-1)+'…':s;}
    function panel(title,href,cta,emptyCopy,panelClass){
      var card=node('article','ppp-home-previews__panel'+(panelClass?' '+panelClass:''));
      var head=node('div','ppp-home-previews__panel-head');
      head.appendChild(node('h3','',title));
      var more=node('a','',cta);more.href=href;head.appendChild(more);
      var feed=node('div','ppp-home-previews__feed');
      card.append(head,feed);grid.appendChild(card);
      return {feed:feed,href:href,emptyCopy:emptyCopy};
    }
    function empty(target,message){
      target.feed.replaceChildren();
      target.feed.appendChild(node('p','ppp-home-previews__empty',message));
    }
    function dateLabel(value){
      if(!value)return '';
      var date=new Date(String(value).replace(' ','T'));
      return Number.isNaN(date.getTime())?'':date.toLocaleDateString(undefined,{month:'short',day:'numeric'});
    }
    var socialPostTypeLabels={status:'Collector update',pull:'Card pull',collection:'Collection update',trade:'Trade interest',question:'Question',event:'Event',restock:'Restock sighting'};
    function addItem(target,opts){
      var link=node('a','ppp-home-previews__item');link.href=opts.href||target.href;
      if(opts.image){
        var img=node('img','ppp-home-previews__thumb');img.src=opts.image;img.alt='';img.loading='lazy';img.onerror=function(){img.remove();};
        link.appendChild(img);
      }else{
        var mark=node('span','ppp-home-previews__thumb','✦');mark.setAttribute('aria-hidden','true');
        mark.style.display='grid';mark.style.placeItems='center';mark.style.color='#ffd21f';mark.style.fontSize='1.6rem';link.appendChild(mark);
      }
      var copy=node('div','ppp-home-previews__text');
      if(opts.meta)copy.appendChild(node('span','ppp-home-previews__meta',opts.meta));
      copy.appendChild(node('strong','',opts.title||'PokePrizePool update'));
      if(opts.copy)copy.appendChild(node('p','',shorten(opts.copy,140)));
      link.appendChild(copy);target.feed.appendChild(link);
    }
    var news = panel('Latest News','/news.html','All news ↗','No news stories to preview right now. Open the News page for published Pokémon TCG coverage.');
    var markets = panel('Market Intelligence','/market-intelligence.html','Market info ↗','Member-only research with dated market snapshots, sourced price movers, and collector tools.');
    var giveaways = panel('Giveaways','/giveaways.html#gallery','All giveaways ↗','Visit the giveaways page for published prize details, entry rules, and community milestone goals.');
    var listings = panel('Collector Marketplace','/marketplace.html','Browse listings ↗','Member shops post listings as items become available. Browse the marketplace for current offers.');
    var social = panel('News Feed','/newsfeed','View feed ↗','No community posts to preview yet. Open the feed to join the conversation.','ppp-home-previews__panel--social');
    var featuredEvents = panel('Featured Events','/events.html','All events ↗','Featured events are boosted by organizers. Browse the calendar for upcoming shows, trade nights, and releases.');

    fetch('/api/collector/posts?feed=latest&limit=2',{credentials:'same-origin',cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('community feed unavailable');return r.json();}).then(function(data){
      var rows=Array.isArray(data.posts)?data.posts.slice(0,2):[];
      if(!rows.length){empty(social,social.emptyCopy);return;}
      social.feed.replaceChildren();
      rows.forEach(function(post){
        var author=post.display_name||post.username||'Collector';
        var postCopy=String(post.body||'').trim()||'Shared a photo with the community.';
        var meta=[socialPostTypeLabels[post.post_type]||'Community post',dateLabel(post.created_at)].filter(Boolean).join(' · ');
        addItem(social,{title:author,copy:postCopy,meta:meta,image:post.image_url||post.avatar_url,href:'/newsfeed'});
      });
    }).catch(function(){empty(social,'The News Feed could not load right now.');});

    fetch('/api/news?category=News',{credentials:'same-origin',cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('news unavailable');return r.json();}).then(function(data){
      var rows=Array.isArray(data.stories)?data.stories.slice(0,2):[];
      if(!rows.length){empty(news,news.emptyCopy);return;}
      news.feed.replaceChildren();
      rows.forEach(function(story){addItem(news,{title:story.title,copy:story.excerpt,meta:[story.category,dateLabel(story.published_at)].filter(Boolean).join(' · '),image:story.image_url,href:'/news.html?story='+encodeURIComponent(story.slug)});});
    }).catch(function(){empty(news,'Latest news could not load right now.');});

    fetch('/api/news?category=Market%20Intelligence',{credentials:'same-origin',cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('market intelligence unavailable');return r.json();}).then(function(data){
      var rows=Array.isArray(data.stories)?data.stories.slice(0,2):[];
      if(!rows.length){empty(markets,markets.emptyCopy);return;}
      markets.feed.replaceChildren();
      rows.forEach(function(story){addItem(markets,{title:story.title,copy:story.excerpt,meta:[story.category,dateLabel(story.published_at)].filter(Boolean).join(' · '),image:story.image_url,href:'/news.html?story='+encodeURIComponent(story.slug)});});
    }).catch(function(){empty(markets,'Market intelligence could not load right now.');});

    fetch('/api/giveaways',{credentials:'same-origin',cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('giveaways unavailable');return r.json();}).then(function(data){
      var rows=Array.isArray(data.giveaways)?data.giveaways.slice(0,2):[];
      if(!rows.length){empty(giveaways,giveaways.emptyCopy);return;}
      giveaways.feed.replaceChildren();
      rows.forEach(function(g){addItem(giveaways,{title:g.title,copy:g.description,meta:g.prize_value!=null?'Prize value · $'+Number(g.prize_value).toLocaleString('en-US'):'Giveaway',image:g.image_url,href:'/giveaways.html#gallery'});});
    }).catch(function(){empty(giveaways,'Giveaways could not load right now.');});

    fetch('/api/marketplace?limit=4',{credentials:'same-origin',cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('marketplace unavailable');return r.json();}).then(function(data){
      var rows=Array.isArray(data.listings)?data.listings.slice(0,2):[];
      if(!rows.length){empty(listings,listings.emptyCopy);return;}
      listings.feed.replaceChildren();
      rows.forEach(function(listing){var price=listing.price_cents==null?'Contact for price':'$'+(Number(listing.price_cents)/100).toFixed(2);addItem(listings,{title:listing.item_name,copy:[listing.shop_name||listing.username,price].filter(Boolean).join(' · '),meta:listing.category||'Member listing',image:listing.image_url,href:listing.shop_url||'/marketplace.html'});});
    }).catch(function(){empty(listings,'Marketplace listings could not load right now.');});

    fetch('/api/events?featured=1',{credentials:'same-origin',cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('featured events unavailable');return r.json();}).then(function(data){
      var rows=Array.isArray(data.events)?data.events.slice(0,2):[];
      if(!rows.length){empty(featuredEvents,featuredEvents.emptyCopy);return;}
      featuredEvents.feed.replaceChildren();
      rows.forEach(function(event){
        var location=[event.city,event.state_name||event.state].filter(Boolean).join(', ');
        var copy=[dateLabel(event.event_date),event.venue,location].filter(Boolean).join(' · ');
        addItem(featuredEvents,{title:event.title,copy:copy,meta:'Featured · Boosted event',image:event.image_url,href:event.slug?'/'+encodeURIComponent(event.slug):'/event.html?id='+encodeURIComponent(event.id)});
      });
    }).catch(function(){empty(featuredEvents,'Featured events could not load right now.');});

    return section;
  }


  function buildHomeGiveawayMeter() {
    var styleId = 'ppp-home-giveaway-meter-style';
    if (!document.getElementById(styleId)) {
      var style = document.createElement('style');
      style.id = styleId;
      style.textContent = '.ppp-home-gm{padding:40px 0 54px;background:linear-gradient(180deg,rgba(4,13,37,.15),rgba(4,13,37,.72))}.ppp-home-gm__card{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(270px,.9fr);gap:25px;padding:clamp(19px,3vw,30px);border:2px solid rgba(255,210,31,.26);border-radius:18px;background:linear-gradient(130deg,rgba(6,23,65,.97),rgba(7,18,49,.97));box-shadow:0 14px 36px rgba(0,0,0,.2);color:#fff}.ppp-home-gm__eyebrow{margin:0 0 7px;color:#ffd21f;font-size:.76rem;font-weight:900;letter-spacing:.15em;text-transform:uppercase}.ppp-home-gm__title{margin:0 0 10px;color:#fff;font:400 clamp(1.9rem,4vw,2.65rem)/1.06 Bangers,cursive}.ppp-home-gm__copy{max-width:60ch;color:#d6e2fa;font-size:.94rem;line-height:1.6}.ppp-home-gm__count-row{display:grid;grid-template-columns:132px minmax(0,1fr);gap:13px;align-items:center;margin:18px 0 14px}.ppp-home-gm__count{display:grid;gap:4px;padding:12px;border:1px solid #8db9ff50;border-radius:12px;background:#ffffff08}.ppp-home-gm__count strong{font:400 2.4rem/1 Bangers,cursive;color:#ffd21f}.ppp-home-gm__count span,.ppp-home-gm__kicker{font-size:.66rem;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#abc2e9}.ppp-home-gm__next{display:grid;gap:5px;min-width:0}.ppp-home-gm__next strong{font-size:1.05rem;line-height:1.3;overflow-wrap:anywhere}.ppp-home-gm__next small{color:#abc2e9;font-size:.8rem;line-height:1.4}.ppp-home-gm__track{height:13px;overflow:hidden;border:1px solid #ffffff22;border-radius:99px;background:#ffffff16}.ppp-home-gm__fill{display:block;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,#2da8ff,#9b5cff,#ffd21f);transition:width .6s ease}.ppp-home-gm__progress-row{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:7px;color:#abc2e9;font-size:.77rem}.ppp-home-gm__progress-row strong{color:#fff}.ppp-home-gm__status{min-height:1.3em;margin:10px 0 0;color:#abc2e9;font-size:.74rem;line-height:1.45}.ppp-home-gm__cta{margin-top:14px}.ppp-home-gm__tiers{display:grid;gap:9px;align-content:center}.ppp-home-gm__tier{display:grid;grid-template-columns:61px minmax(0,1fr);gap:11px;align-items:center;padding:11px;border:1px solid #ffffff20;border-radius:12px;background:#ffffff05;min-width:0}.ppp-home-gm__threshold{display:grid;place-items:center;min-height:54px;border-radius:9px;background:#ffffff0d;color:#fff;font:400 1.7rem/1 Bangers,cursive}.ppp-home-gm__tier-copy{display:grid;gap:3px;min-width:0}.ppp-home-gm__tier-copy strong{font-size:.84rem;line-height:1.3}.ppp-home-gm__tier-copy small{color:#abc2e9;font-size:.72rem;line-height:1.35}.ppp-home-gm__tier-state{color:#abc2e9;font-size:.59rem;font-weight:900;letter-spacing:.13em;text-transform:uppercase}.ppp-home-gm__tier.is-next{border-color:#ffd21f99;box-shadow:inset 3px 0 #ffd21f;background:#ffd21f0b}.ppp-home-gm__tier.is-next .ppp-home-gm__tier-state{color:#ffd21f}.ppp-home-gm__tier.is-unlocked{border-color:#3ddc9770;background:#3ddc970b}.ppp-home-gm__tier.is-unlocked .ppp-home-gm__tier-state{color:#3ddc97}.ppp-home-gm__footnote{grid-column:1/-1;margin:0;padding-top:12px;border-top:1px solid #ffffff1f;color:#abc2e9;font-size:.72rem;line-height:1.5}@media(max-width:780px){.ppp-home-gm{padding:28px 0 40px}.ppp-home-gm__card{grid-template-columns:1fr}.ppp-home-gm__tiers{grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch}.ppp-home-gm__tier{grid-template-columns:1fr;align-content:start;gap:7px}.ppp-home-gm__threshold{min-height:44px}.ppp-home-gm__footnote{grid-column:1/-1}}@media(max-width:540px){.ppp-home-gm__count-row{grid-template-columns:1fr}.ppp-home-gm__count{grid-template-columns:auto 1fr;align-items:center;gap:10px}.ppp-home-gm__tiers{grid-template-columns:1fr}.ppp-home-gm__tier{grid-template-columns:61px minmax(0,1fr)}.ppp-home-gm__threshold{min-height:54px}}@media(prefers-reduced-motion:reduce){.ppp-home-gm__fill{transition:none}}';
      document.head.appendChild(style);
    }

    var milestones = [
      { count: 50, title: '30th Anniversary ETB Giveaway', prize: 'First community prize milestone' },
      { count: 100, title: 'ETB + bonus collector prizes', prize: 'A bigger prize mix for the community' },
      { count: 500, title: '$1,500 cash + prizes', prize: 'The major community unlock' }
    ];
    var section = h('section', { class: 'ppp-home-gm', id: 'home-giveaway-meter', 'aria-labelledby': 'ppp-home-gm-title' });
    var wrap = h('div', { class: 'wrap' });
    var card = h('div', { class: 'ppp-home-gm__card' });
    var main = h('div', { class: 'ppp-home-gm__main' });
    main.append(
      h('p', { class: 'ppp-home-gm__eyebrow' }, 'Community giveaway'),
      h('h2', { class: 'ppp-home-gm__title', id: 'ppp-home-gm-title' }, 'The next giveaway grows with us'),
      h('p', { class: 'ppp-home-gm__copy' }, 'As our active VIP community grows, so does the next giveaway. Follow the meter to see which prize tier we’re working toward together.'),
      h('div', { class: 'ppp-home-gm__count-row' },
        h('div', { class: 'ppp-home-gm__count' },
          h('strong', { id: 'ppp-home-gm-count' }, '—'),
          h('span', null, 'Active VIP subs')
        ),
        h('div', { class: 'ppp-home-gm__next' },
          h('span', { class: 'ppp-home-gm__kicker' }, 'Next unlock'),
          h('strong', { id: 'ppp-home-gm-next-title' }, 'Checking the community total…'),
          h('small', { id: 'ppp-home-gm-next-copy' }, 'Milestone progress is loading.')
        )
      ),
      h('div', { class: 'ppp-home-gm__track', id: 'ppp-home-gm-track', role: 'progressbar', 'aria-label': 'Progress toward the next giveaway milestone', 'aria-valuemin': '0', 'aria-valuemax': '50', 'aria-valuenow': '0', 'aria-valuetext': 'Loading subscriber progress' },
        h('span', { class: 'ppp-home-gm__fill', id: 'ppp-home-gm-fill' })
      ),
      h('div', { class: 'ppp-home-gm__progress-row' },
        h('span', { id: 'ppp-home-gm-progress' }, 'Loading progress…'),
        h('strong', { id: 'ppp-home-gm-percent' }, '—')
      ),
      h('p', { class: 'ppp-home-gm__status', id: 'ppp-home-gm-status', role: 'status', 'aria-live': 'polite' }, 'Subscriber total refreshes periodically.'),
      h('div', { class: 'ppp-home-gm__cta' },
        h('a', { class: 'btn btn--lg', href: '/giveaways.html#giveaway-meter' }, 'Explore Giveaways'),
        h('a', { class: 'btn btn--lg', href: '/account.html' }, 'Subscribe to VIP')
      )
    );

    var tiers = h('div', { class: 'ppp-home-gm__tiers', 'aria-label': 'Giveaway prize milestones' });
    milestones.forEach(function (milestone) {
      var tile = h('article', { class: 'ppp-home-gm__tier', 'data-home-gm-milestone': String(milestone.count) },
        h('span', { class: 'ppp-home-gm__threshold' }, String(milestone.count)),
        h('div', { class: 'ppp-home-gm__tier-copy' },
          h('span', { class: 'ppp-home-gm__tier-state' }, 'Milestone'),
          h('strong', null, milestone.title),
          h('small', null, milestone.prize)
        )
      );
      tiers.appendChild(tile);
    });

    card.append(main, tiers,
      h('p', { class: 'ppp-home-gm__footnote' }, 'Subscriber milestones determine the announced prize tier, not anyone’s odds of winning. Each giveaway’s eligibility, entry methods, and official rules apply separately.')
    );
    wrap.appendChild(card);
    section.appendChild(wrap);

    async function refresh() {
      try {
        var response = await fetch('/api/giveaway-meter', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Subscriber count unavailable.');
        var data = await response.json();
        var raw = Number(data && data.active_subscribers);
        if (!data || !data.ok || !Number.isFinite(raw) || raw < 0) throw new Error('Invalid subscriber count.');
        var count = Math.floor(raw);
        var next = milestones.find(function (milestone) { return count < milestone.count; }) || null;
        var target = next ? next.count : milestones[milestones.length - 1].count;
        var percent = next ? Math.min(100, Math.round(count / target * 100)) : 100;

        section.querySelector('#ppp-home-gm-count').textContent = count.toLocaleString();
        section.querySelector('#ppp-home-gm-next-title').textContent = next ? next.title : 'All announced milestones unlocked!';
        section.querySelector('#ppp-home-gm-next-copy').textContent = next ? 'Unlocks at ' + next.count.toLocaleString() + ' active VIP subscribers.' : 'The community has reached the current top tier.';
        section.querySelector('#ppp-home-gm-progress').textContent = next
          ? count.toLocaleString() + ' / ' + next.count.toLocaleString() + ' active subs · ' + (next.count - count).toLocaleString() + ' to go'
          : count.toLocaleString() + ' active subs · top tier reached';
        section.querySelector('#ppp-home-gm-percent').textContent = percent + '%';
        var track = section.querySelector('#ppp-home-gm-track');
        track.setAttribute('aria-valuemax', String(target));
        track.setAttribute('aria-valuenow', String(Math.min(count, target)));
        track.setAttribute('aria-valuetext', next
          ? count.toLocaleString() + ' of ' + target.toLocaleString() + ' active VIP subscribers toward ' + next.title
          : 'All announced giveaway milestones unlocked');
        section.querySelector('#ppp-home-gm-fill').style.width = percent + '%';
        section.querySelectorAll('[data-home-gm-milestone]').forEach(function (tile) {
          var threshold = Number(tile.getAttribute('data-home-gm-milestone'));
          var unlocked = count >= threshold;
          var isNext = !!next && next.count === threshold;
          tile.classList.toggle('is-unlocked', unlocked);
          tile.classList.toggle('is-next', isNext);
          var stateLabel = tile.querySelector('.ppp-home-gm__tier-state');
          stateLabel.textContent = unlocked ? 'Unlocked' : isNext ? 'Next goal' : 'Coming up';
        });
        section.querySelector('#ppp-home-gm-status').textContent = 'Active monthly/yearly VIP subscriptions · count refreshes about once per minute.';
      } catch (error) {
        section.querySelector('#ppp-home-gm-count').textContent = '—';
        section.querySelector('#ppp-home-gm-next-title').textContent = 'Community milestone meter';
        section.querySelector('#ppp-home-gm-next-copy').textContent = 'The current subscriber count is temporarily unavailable.';
        section.querySelector('#ppp-home-gm-progress').textContent = 'Progress will appear once the count loads.';
        section.querySelector('#ppp-home-gm-percent').textContent = '—';
        section.querySelector('#ppp-home-gm-status').textContent = 'Could not load the subscriber total. Please refresh to try again.';
      }
    }

    refresh();
    window.setInterval(refresh, 60000);
    return section;
  }

  VIP.landing = {
    render: function (root) {
      var cfg = VIP.siteConfig;
      var poster = VIP.assets.heroPoster;

      var navigation = buildNavigation();

      // Self-hosted GLB viewer: no third-party iframe UI or hover overlays.
      function initPokeBallViewer() {
        var host = document.getElementById('ppp-pokeball-viewer');
        if (!host || host.dataset.initialized === 'true') return;
        host.dataset.initialized = 'true';
        var moduleScript = document.createElement('script');
        moduleScript.type = 'module';
        moduleScript.textContent = [
          "import * as THREE from 'https://esm.sh/three@0.169.0';",
          "import { GLTFLoader } from 'https://esm.sh/three@0.169.0/examples/jsm/loaders/GLTFLoader.js';",
          "const host = document.getElementById('ppp-pokeball-viewer');",
          "if (host) {",
          "  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;",
          "  const scene = new THREE.Scene();",
          "  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);",
          "  camera.position.set(0, 0, 4.1);",
          "  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });",
          "  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));",
          "  renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));",
          "  renderer.outputColorSpace = THREE.SRGBColorSpace;",
          "  renderer.setClearColor(0x000000, 0);",
          "  host.replaceChildren(renderer.domElement);",
          "  const ambient = new THREE.HemisphereLight(0xffffff, 0x526080, 2.0);",
          "  scene.add(ambient);",
          "  const key = new THREE.DirectionalLight(0xffffff, 2.8); key.position.set(3, 4, 5); scene.add(key);",
          "  const fill = new THREE.DirectionalLight(0xffffff, 1.2); fill.position.set(-4, 1, -3); scene.add(fill);",
          "  let ball = null;",
          "  const loader = new GLTFLoader();",
          "  loader.load('/assets/poke-ball.glb', (gltf) => {",
          "    ball = gltf.scene;",
          "    const box = new THREE.Box3().setFromObject(ball);",
          "    const size = box.getSize(new THREE.Vector3());",
          "    const center = box.getCenter(new THREE.Vector3());",
          "    ball.position.sub(center);",
          "    const maxDim = Math.max(size.x, size.y, size.z) || 1;",
          "    ball.scale.setScalar(2.15 / maxDim);",
          "    scene.add(ball);",
          "    const loading = host.querySelector('.cubone-hero__loading'); if (loading) loading.remove();",
          "  }, undefined, (error) => {",
          "    console.error('PokePrizePool 3D model failed to load:', error);",
          "    host.textContent = '3D model is temporarily unavailable.';",
          "  });",
          "  const resize = () => { const w = Math.max(1, host.clientWidth); const h = Math.max(1, host.clientHeight); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); };",
          "  const observer = new ResizeObserver(resize); observer.observe(host);",
          "  const clock = new THREE.Clock();",
          "  renderer.setAnimationLoop(() => { if (ball && !reduceMotion) ball.rotation.y += Math.min(clock.getDelta(), 0.05) * 0.42; else clock.getDelta(); renderer.render(scene, camera); });",
          "}"
        ].join('\n');
        document.body.appendChild(moduleScript);
      }

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
            h('span', { class: 'wordmark__top' }, 'PokePrize'),
            h('span', { class: 'wordmark__bottom' }, 'Pool')
          ),
          h(
            'figure',
            { class: 'poster poster--logo cubone-hero', 'aria-label': 'Rotating 3D Poké Ball model' },
            h('div', {
              class: 'cubone-hero__viewer',
              id: 'ppp-pokeball-viewer',
              role: 'img',
              'aria-label': 'A Poké Ball rotating in 3D'
            },
              h('div', { class: 'cubone-hero__loading', 'aria-hidden': 'true' }, 'Loading 3D model…')
            ),
            // Keep the original caption element in the layout so the 3D viewer keeps its working dimensions.
            h('figcaption', { class: 'cubone-hero__credit' },
              '3D model: ',
              h('a', {
                href: 'https://sketchfab.com/3d-models/poke-ball-pokemon-pokeball-c266163bd310411bac727783e4c79c4a',
                target: '_blank',
                rel: 'noopener noreferrer'
              }, 'Poké Ball by Jesús Orgaz'),
              ' · ',
              h('a', {
                href: 'https://creativecommons.org/licenses/by/4.0/',
                target: '_blank',
                rel: 'noopener noreferrer'
              }, 'CC BY 4.0')
            ),
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
          h('p', null, cfg.legal),
          h('p', { class: 'asset-credit' },
            '3D asset credit: ',
            h('a', { href: 'https://sketchfab.com/3d-models/poke-ball-pokemon-pokeball-c266163bd310411bac727783e4c79c4a', target: '_blank', rel: 'noopener noreferrer' }, 'Poké Ball by Jesús Orgaz'),
            ' · ',
            h('a', { href: 'https://creativecommons.org/licenses/by/4.0/', target: '_blank', rel: 'noopener noreferrer' }, 'CC BY 4.0')
          )
        )
      );

      VIP.clear(root);
      root.appendChild(navigation);
      var homeAdTop = h('aside', {
        class: 'ppp-ad-slot ppp-ad-slot--top',
        'data-ad-slot': 'home-top',
        'aria-label': 'Advertisement placement: home top'
      }, 'Ad placement · home · top');
      root.appendChild(homeAdTop);
      root.appendChild(hero);
      initPokeBallViewer();
      root.appendChild(buildHomeGiveawayMeter());
      root.appendChild(buildHomepagePreviews());
      root.appendChild(universes);
      root.appendChild(how);
      root.appendChild(cta);
      root.appendChild(footer);
    }
  };
})();

