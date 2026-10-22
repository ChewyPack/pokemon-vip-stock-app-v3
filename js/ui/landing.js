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
            { title: 'Submit an Event', description: 'Send an event to PokePrizePool for review', href: '/submit-event.html' },
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
            { title: 'PokePrizePool Store', href: '/store.html', description: 'Shop cards and merchandise sold directly by PokePrizePool' },
            { title: 'Cards', description: 'Browse official PokePrizePool cards', children: [
              { title: 'Singles', href: '/store.html?category=Singles' },
              { title: 'Sealed', href: '/store.html?category=Sealed' },
              { title: 'Graded', href: '/store.html?category=Graded%20cards' }
            ]},
            { title: 'Merch', description: 'Shop official PokePrizePool merchandise', children: [
              { title: 'Clothing', href: '/store.html?category=Clothing' },
              { title: 'Plushies', href: '/store.html?category=Plushies' },
              { title: 'Accessories', href: '/store.html?category=Accessories' },
              { title: 'Other', href: '/store.html?category=Other' }
            ]},
            { title: 'Collector Marketplace', href: '/marketplace.html', description: 'Browse listings posted by member shops' },
            { title: 'Manage My Shop', href: '/collector.html#shop', description: 'Create or edit your member shop profile and listings' }
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
          }, 'Log In / Sign Up'),
          h('a', {
            class: 'site-nav__link site-nav__inbox-link',
            href: '/inbox.html',
            'aria-label': 'Offer inbox'
          },
            h('img', { src: '/inbox-icon.png', alt: '', class: 'site-nav__inbox-image' }),
            h('span', { class: 'site-nav__inbox-badge', hidden: true, 'aria-live': 'polite' })
          )
        )
      )
    );

    // Keep the offer inbox utility available on the homepage just like every other page.
    var inbox = nav.querySelector('.site-nav__inbox-link');
    var inboxBadge = nav.querySelector('.site-nav__inbox-badge');
    function refreshInboxBadge() {
      fetch('/api/collector/trades', { credentials: 'include', cache: 'no-store' })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (data) {
          if (!data || !data.ok || !inboxBadge || !inbox) return;
          var count = (data.offers || []).filter(function (offer) {
            return offer.direction === 'incoming' && !offer.recipient_read_at;
          }).length;
          inboxBadge.hidden = count < 1;
          inboxBadge.textContent = count > 99 ? '99+' : String(count);
          inboxBadge.setAttribute('aria-label', count + ' unread offer' + (count === 1 ? '' : 's'));
          inbox.setAttribute('aria-label', count + ' unread offer' + (count === 1 ? '' : 's'));
        })
        .catch(function () {});
    }
    refreshInboxBadge();
    window.setInterval(refreshInboxBadge, 60000);
    window.addEventListener('collector-offers-updated', refreshInboxBadge);

    var inboxStyle = document.createElement('style');
    inboxStyle.textContent =
      '.site-nav__inbox-link{position:relative;display:inline-flex;flex:0 0 108px;align-items:center;justify-content:center;gap:0;width:108px;min-width:108px;height:108px;min-height:108px;padding:0!important;margin:0 2px;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;outline-offset:3px;vertical-align:middle}' +
      '.site-nav__inbox-link:hover,.site-nav__inbox-link:focus-visible{border:0!important;background:transparent!important;box-shadow:none!important;transform:none!important}' +
      '.site-nav__inbox-image{width:108px;height:108px;object-fit:contain;display:block;border:0!important;outline:0;box-shadow:none}' +
      '.site-nav__inbox-badge:not([hidden]){position:absolute;top:auto;right:0;bottom:0;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:#ef233c;color:#fff;font-size:.7rem;font-weight:700;line-height:1;box-shadow:0 0 0 2px #06174a;z-index:2}' +
      '.site-nav__inbox-badge[hidden]{display:none!important}' +
      '@media(max-width:560px){.site-nav__inbox-link{flex:0 0 96px;width:96px;min-width:96px;height:96px;min-height:96px}.site-nav__inbox-image{width:96px;height:96px}}';
    document.head.appendChild(inboxStyle);

    fetch('/api/account/me', { credentials: 'include', cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        var accountLink = nav.querySelector('#account-nav-link');
        if (!accountLink || !data || !data.ok || !data.authenticated) return;
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
      style.textContent = '.poster--logo{display:grid;place-items:center;aspect-ratio:1;max-width:470px;width:100%;margin-inline:auto;background:transparent;border:0;box-shadow:none;transform:none;overflow:visible}.poster--logo img{width:min(100%,430px);aspect-ratio:1;object-fit:contain;border-radius:0;filter:drop-shadow(0 16px 30px rgba(0,0,0,.28))}.poster--logo::after{display:none}.ppp-home-previews{padding:42px 0 56px;background:linear-gradient(180deg,rgba(3,10,29,.2),rgba(3,10,29,.58))}.ppp-home-previews__intro{margin-bottom:22px}.ppp-home-previews__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.ppp-home-previews__panel{min-width:0;padding:18px;border:2px solid rgba(255,255,255,.15);border-radius:15px;background:rgba(6,18,48,.9);box-shadow:0 10px 30px rgba(0,0,0,.18)}.ppp-home-previews__panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.ppp-home-previews__panel h3{margin:0;color:#ffd21f;font-size:1.5rem;line-height:1.1}.ppp-home-previews__panel-head>a{font-size:.82rem;font-weight:900;white-space:nowrap}.ppp-home-previews__feed{display:grid;gap:10px}.ppp-home-previews__item{display:grid;grid-template-columns:76px minmax(0,1fr);gap:11px;align-items:center;padding:9px;border-radius:10px;color:#fff;text-decoration:none;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);min-width:0}.ppp-home-previews__item:hover{border-color:rgba(255,210,31,.6);background:rgba(255,255,255,.08)}.ppp-home-previews__thumb{display:block;width:76px;height:76px;object-fit:cover;border-radius:8px;background:#10244f}.ppp-home-previews__text{min-width:0}.ppp-home-previews__meta{display:block;color:#9fb5de;font-size:.72rem;font-weight:900;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}.ppp-home-previews__item strong{display:block;font-size:.95rem;line-height:1.3;overflow-wrap:anywhere}.ppp-home-previews__item p{font-size:.82rem;color:#cedaf1;line-height:1.45;margin:4px 0 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.ppp-home-previews__empty{padding:18px 10px;color:#a9b9d8;font-size:.88rem;line-height:1.5;text-align:center}.ppp-home-previews__empty a{font-weight:900}@media(max-width:650px){.ppp-home-previews{padding:28px 0 40px}.ppp-home-previews__grid{grid-template-columns:1fr}.ppp-home-previews__panel{padding:14px}.ppp-home-previews__item{grid-template-columns:64px minmax(0,1fr)}.ppp-home-previews__thumb{width:64px;height:64px}}';
      document.head.appendChild(style);
    }
    var section = document.createElement('section');
    section.className = 'ppp-home-previews';
    section.setAttribute('aria-labelledby','ppp-home-previews-title');
    var wrap = document.createElement('div'); wrap.className = 'wrap';
    var intro = document.createElement('div'); intro.className = 'ppp-home-previews__intro';
    var heading = document.createElement('h2'); heading.className = 'section__title'; heading.id = 'ppp-home-previews-title'; heading.textContent = 'Explore PokePrizePool';
    var subtitle = document.createElement('p'); subtitle.className = 'section__sub'; subtitle.textContent = 'The latest from the collector community — all in one place.';
    intro.append(heading,subtitle);
    var grid = document.createElement('div'); grid.className = 'ppp-home-previews__grid';
    wrap.append(intro,grid); section.appendChild(wrap);

    function node(tag,cls,text){var el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
    function shorten(value,max){var s=String(value||'').trim();return s.length>max?s.slice(0,max-1)+'…':s;}
    function panel(title,href,cta,emptyCopy){
      var card=node('article','ppp-home-previews__panel');
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
    var news = panel('Latest News','/news.html','All news ↗','News stories will appear here when published.');
    var markets = panel('Market Intelligence','/market-intelligence.html','Market info ↗','Market updates and analysis will appear here when published.');
    var giveaways = panel('Giveaways','/giveaways.html#gallery','All giveaways ↗','New giveaways will appear here when published.');
    var listings = panel('Collector Marketplace','/marketplace.html','Browse listings ↗','Member shop listings will appear here as members publish them.');

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

    return section;
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
            h('span', { class: 'wordmark__top' }, 'PokePrize'),
            h('span', { class: 'wordmark__bottom' }, 'Pool')
          ),
          h(
            'figure',
            { class: 'poster poster--logo' },
            h('img', {
              src: poster.src,
              alt: poster.alt,
              width: '512',
              height: '512',
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
      var homeAdTop = h('aside', {
        class: 'ppp-ad-slot ppp-ad-slot--top',
        'data-ad-slot': 'home-top',
        'aria-label': 'Advertisement placement: home top'
      }, 'Ad placement · home · top');
      root.appendChild(homeAdTop);
      root.appendChild(hero);
      root.appendChild(buildHomepagePreviews());
      root.appendChild(universes);
      root.appendChild(how);
      root.appendChild(cta);
      root.appendChild(footer);
    }
  };
})();

