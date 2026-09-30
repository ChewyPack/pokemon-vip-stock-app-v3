/* LANDING PAGE — built from siteConfig + assets so copy and artwork live in config, not here. */
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

  function universeCard(u) {
    var art = (VIP.assets.universeArt || {})[u.id] || {};
    var live = u.status === 'live';
    var style = {};
    if (art.src) {
      style.backgroundImage = 'url("' + art.src + '")';
      style.backgroundSize = art.size || 'cover';
      style.backgroundPosition = art.position || '50% 50%';
    }
    var el = h(
      'article',
      { class: 'card ' + (live ? 'card--live' : 'card--soon') },
      h(
        'div',
        { class: 'card__frame' },
        h('div', { class: 'card__art' + (art.src ? '' : ' card__art--back'), style: style }),
        h('span', { class: 'card__rarity' }, live ? 'Live now' : 'Coming soon'),
        h(
          'div',
          { class: 'card__plate' },
          h('h3', { class: 'card__name' }, u.name),
          h('p', { class: 'card__blurb' }, u.blurb),
          live ? h('a', { class: 'btn btn--sm', href: '#report' }, u.cta || 'Report a sighting') : null
        ),
        h('span', { class: 'card__holo', 'aria-hidden': 'true' })
      )
    );
    return el;
  }

  VIP.landing = {
    render: function (root) {
      var cfg = VIP.siteConfig;
      var poster = VIP.assets.heroPoster;

      var hero = h(
        'header',
        { class: 'hero' },
        h(
          'div',
          { class: 'wrap hero__grid' },
          h('h1', { class: 'wordmark' }, h('span', { class: 'wordmark__top' }, 'Pokémon'), h('span', { class: 'wordmark__bottom' }, 'VIP')),
          h('figure', { class: 'poster' }, h('img', { src: poster.src, alt: poster.alt, width: '1376', height: '768', fetchpriority: 'high' })),
          h(
            'div',
            { class: 'hero__copy' },
            h('p', { class: 'hero__lead' }, cfg.brand.lead),
            h('div', { class: 'hero__actions' }, h('a', { class: 'btn btn--lg', href: '#report' }, 'Report a sighting'), h('a', { class: 'text-link', href: '#how' }, 'See how it works'))
          )
        ),
        bolt()
      );

      var universes = h(
        'section',
        { class: 'section', id: 'universes', 'aria-labelledby': 'uni-title' },
        h(
          'div',
          { class: 'wrap' },
          h('h2', { class: 'section__title', id: 'uni-title' }, 'Where the crew hunts'),
          h('p', { class: 'section__sub' }, 'Pokémon is live. More universes are on the way.')
        ),
        h('div', { class: 'binder' }, h('div', { class: 'binder__row' }, cfg.universes.map(universeCard)))
      );

      var how = h(
        'section',
        { class: 'section', id: 'how', 'aria-labelledby': 'how-title' },
        h(
          'div',
          { class: 'wrap' },
          h('h2', { class: 'section__title', id: 'how-title' }, 'How it works'),
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
          h('h2', { class: 'cta-band__title' }, 'Spotted something?'),
          h('a', { class: 'btn btn--lg', href: '#report' }, 'Report a sighting'),
          h('p', { class: 'notice notice--light' }, cfg.notice)
        )
      );

      var footer = h('footer', { class: 'footer' }, h('div', { class: 'wrap' }, h('p', null, cfg.legal)));

      VIP.clear(root);
      root.appendChild(hero);
      root.appendChild(universes);
      root.appendChild(how);
      root.appendChild(cta);
      root.appendChild(footer);
    }
  };
})();
