/* LANDING PAGE — PokePrizePool navigation and homepage. */
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

  function makeLink(label, href, className) {
    return h('a', {
      class: className || '',
      href: href
    }, label);
  }

  function buildNavigation() {
    var links = [
      ['Home', '#home'],
      ['Poke Report', '#poke-report'],
      ['Shop', '#shop'],
      ['Giveaways', '#giveaways'],
      ['Community', '#community']
    ];

    var navLinks = links.map(function (item) {
      return makeLink(item[0], item[1], 'main-nav__link');
    });

    return h(
      'div',
      { class: 'site-header' },
      h(
        'div',
        { class: 'wrap site-header__inner' },
        makeLink(
          'POKEPRIZEPOOL',
          '#home',
          'site-logo'
        ),
        h(
          'nav',
          { class: 'main-nav', 'aria-label': 'Main navigation' },
          navLinks
        ),
        makeLink('VIP Report', '#report', 'btn btn--sm site-header__cta')
      )
    );
  }

  function buildFeatureCard(icon, title, description, href, action) {
    return h(
      'article',
      { class: 'feature-card' },
      h('span', { class: 'feature-card__icon', 'aria-hidden': 'true' }, icon),
      h('h3', { class: 'feature-card__title' }, title),
      h('p', { class: 'feature-card__text' }, description),
      makeLink(action || 'Explore', href, 'text-link')
    );
  }

  function buildSection(id, eyebrow, title, description, cards) {
    return h(
      'section',
      {
        class: 'section portal-section',
        id: id,
        'aria-labelledby': id + '-title'
      },
      h(
        'div',
        { class: 'wrap' },
        h('p', { class: 'section__eyebrow' }, eyebrow),
        h('h2', { class: 'section__title', id: id + '-title' }, title),
        h('p', { class: 'section__sub' }, description),
        h('div', { class: 'feature-grid' }, cards)
      )
    );
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
          live ? makeLink(u.cta || 'Report a sighting', '#report', 'btn btn--sm') : null
        ),
        h('span', { class: 'card__holo', 'aria-hidden': 'true' })
      )
    );
  }

  VIP.landing = {
    render: function (root) {
      var cfg = VIP.siteConfig;
      var poster = VIP.assets.heroPoster;

      var header = buildNavigation();

      var hero = h(
        'header',
        { class: 'hero', id: 'home' },
        h(
          'div',
          { class: 'wrap hero__grid' },
          h(
            'h1',
            { class: 'wordmark' },
            h('span', { class: 'wordmark__top' }, 'POKE'),
            h('span', { class: 'wordmark__bottom' }, 'PRIZEPOOL')
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
            h('p', { class: 'hero__lead' }, 'The Pokémon community hub built by collectors, for collectors.'),
            h('p', { class: 'hero__description' }, 'Real-time store reports, market intelligence, giveaways, events, vendors, and a community that shares the hunt.'),
            h(
              'div',
              { class: 'hero__actions' },
              makeLink('Report a sighting', '#report', 'btn btn--lg'),
              makeLink('Explore the hub', '#poke-report', 'text-link')
            )
          )
        ),
        bolt()
      );

      var quickLinks = h(
        'section',
        { class: 'section quick-links-section' },
        h(
          'div',
          { class: 'wrap' },
          h('p', { class: 'section__eyebrow' }, 'YOUR COLLECTOR HQ'),
          h('h2', { class: 'section__title' }, 'Everything Pokémon. In one place.'),
          h('p', { class: 'section__sub' }, 'Find the latest intel, track what is happening in the hobby, and connect with other collectors.'),
          h(
            'div',
            { class: 'feature-grid feature-grid--four' },
            buildFeatureCard('📡', 'Poke Report', 'Stock sightings, hobby news, market updates, and exclusive reports.', '#poke-report', 'Explore reports'),
            buildFeatureCard('🛍️', 'Shop', 'A home for sealed products, singles, graded cards, and branded merch.', '#shop', 'Explore shop'),
            buildFeatureCard('🎁', 'Giveaways', 'Discover giveaway details, entry information, rules, and live draws.', '#giveaways', 'View giveaways'),
            buildFeatureCard('🤝', 'Community', 'Connect with collectors, find events, and access member resources.', '#community', 'Meet the community')
          )
        )
      );

      var pokeReport = buildSection(
        'poke-report',
        'KNOW BEFORE YOU GO',
        'Poke Report',
        'The information collectors need, gathered in one place.',
        [
          buildFeatureCard('🚨', 'Live Stock Reports', 'Community sightings with store details, quantities, photos, and availability updates.', '#report', 'Submit a sighting'),
          buildFeatureCard('📰', 'News & Exclusives', 'Pokémon news, releases, hobby discussion, and community stories.', '#poke-report', 'Coming to the hub'),
          buildFeatureCard('📈', 'Market Intelligence', 'Track market conversations, product trends, and notable price movements.', '#poke-report', 'Coming to the hub'),
          buildFeatureCard('📅', 'Events Calendar', 'Keep up with card shows, trade nights, releases, and player events.', '#poke-report', 'Coming to the hub'),
          buildFeatureCard('🏪', 'Vendor Directory', 'Find vendors and discover what they specialize in buying and selling.', '#poke-report', 'Coming to the hub')
        ]
      );

      var shop = buildSection(
        'shop',
        'COLLECTOR MARKETPLACE',
        'The Shop',
        'A planned home for Pokémon products and PokePrizePool merchandise.',
        [
          buildFeatureCard('📦', 'Sealed Products', 'Explore sealed Pokémon products and collector favorites.', '#shop', 'Coming soon'),
          buildFeatureCard('🃏', 'Raw Singles', 'Discover individual cards for collections and decks.', '#shop', 'Coming soon'),
          buildFeatureCard('💎', 'Graded Cards', 'A dedicated section for slabbed and graded collectibles.', '#shop', 'Coming soon'),
          buildFeatureCard('👕', 'PokePrizePool Merch', 'Show your support with branded collector gear.', '#shop', 'Coming soon')
        ]
      );

      var giveaways = buildSection(
        'giveaways',
        'GOOD LUCK, COLLECTORS',
        'Giveaways',
        'A dedicated home for prizes, entry details, and giveaway announcements.',
        [
          buildFeatureCard('🎟️', 'Your Entries', 'A future member view for tracking eligible giveaway entries.', '#giveaways', 'Coming soon'),
          buildFeatureCard('📜', 'Rules & Details', 'Find eligibility requirements, entry methods, and official rules.', '#giveaways', 'Coming soon'),
          buildFeatureCard('🎥', 'Live Draws', 'A home for giveaway videos and winner announcements.', '#giveaways', 'Coming soon')
        ]
      );

      var community = buildSection(
        'community',
        'COLLECTORS HELP COLLECTORS',
        'The Community',
        'More than a stock alert. Build connections, share knowledge, and celebrate the hobby.',
        [
          buildFeatureCard('💬', 'Discord Community', 'Join the community conversation and share sightings with fellow collectors.', '#community', 'Community hub'),
          buildFeatureCard('🧭', 'Collector Resources', 'A future home for drop-day routes, guides, and useful collector links.', '#community', 'Coming soon'),
          buildFeatureCard('🏅', 'VIP Badge Collection', 'Earn original PokePrizePool digital milestones, with physical badge rewards planned.', '#community', 'Badge collection planned')
        ]
      );

      var how = h(
        'section',
        { class: 'section', id: 'how', 'aria-labelledby': 'how-title' },
        h(
          'div',
          { class: 'wrap' },
          h('h2', { class: 'section__title', id: 'how-title' }, 'How stock reporting works'),
          h(
            'ol',
            { class: 'steps' },
            cfg.howItWorks.map(function (s, i) {
              return h(
                'li',
                { class: 'step-card' },
                h('span', { class: 'step-card__num', 'aria-hidden': 'true' }, String(i + 1)),
                h('span', { class: 'step-card__icon', 'aria-hidden': 'true' }, s.icon),
                h('h3', { class: 'step-card__title' }, s.title),
                h('p', { class: 'step-card__text' }, s.text)
              );
            })
          )
        )
      );

      var cta = h(
        'section',
        { class: 'cta-band' },
        h(
          'div',
          { class: 'wrap cta-band__inner' },
          h('h2', { class: 'cta-band__title' }, 'Spotted something? Help the crew.'),
          makeLink('Report a sighting', '#report', 'btn btn--lg'),
          h('p', { class: 'notice notice--light' }, cfg.notice)
        )
      );

      var footer = h(
        'footer',
        { class: 'footer' },
        h(
          'div',
          { class: 'wrap' },
          h('p', null, 'PokePrizePool — built by collectors, for collectors.'),
          h('p', null, cfg.legal),
          h('p', null, 'Pokémon and related names are trademarks of their respective owners. PokePrizePool is an independent community project.')
        )
      );

      VIP.clear(root);
      root.appendChild(header);
      root.appendChild(hero);
      root.appendChild(quickLinks);
      root.appendChild(pokeReport);
      root.appendChild(shop);
      root.appendChild(giveaways);
      root.appendChild(community);
      root.appendChild(how);
      root.appendChild(cta);
      root.appendChild(footer);
    }
  };
})();
