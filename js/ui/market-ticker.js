/* PokePrizePool market movers ticker.
 * Reads only from our own /api/market-movers endpoint; never invents prices.
 * Expected response: { ok: true, movers: [{ name, price, changePct, updatedAt }] }
 */
(function () {
  'use strict';

  // This ticker belongs only on the Market Intelligence page, not the site-wide header.
  var currentPath = window.location.pathname || '/';
  while (currentPath.length > 1 && currentPath.endsWith('/')) currentPath = currentPath.slice(0, -1);
  if (currentPath !== '/market-intelligence' && currentPath !== '/market-intelligence.html') return;

  if (document.getElementById('pp-market-ticker')) return;

  var style = document.createElement('style');
  style.textContent = `
    #pp-market-ticker{position:relative;z-index:50;width:100%;overflow:hidden;background:#07101e;color:#eaf2ff;border-top:1px solid rgba(103,155,220,.24);border-bottom:1px solid rgba(103,155,220,.3);font-family:Arial,sans-serif}
    #pp-market-ticker *{box-sizing:border-box}
    #pp-market-ticker .pp-ticker-head{display:flex;align-items:center;gap:9px;flex-shrink:0;padding:0 15px;min-height:42px;background:#0c1b2d;border-right:1px solid rgba(103,155,220,.25)}
    #pp-market-ticker .pp-ticker-live{width:7px;height:7px;flex-shrink:0;border-radius:50%;background:#f5bf42;box-shadow:0 0 10px rgba(245,191,66,.45)}
    #pp-market-ticker[data-state="live"] .pp-ticker-live{background:#37e08b;box-shadow:0 0 10px rgba(55,224,139,.55)}
    #pp-market-ticker .pp-ticker-label{font-size:11px;font-weight:800;letter-spacing:.12em;white-space:nowrap}
    #pp-market-ticker .pp-ticker-caption{color:#8da4c1;font-size:9px;letter-spacing:.1em;white-space:nowrap}
    #pp-market-ticker .pp-ticker-window{min-width:0;flex:1;overflow:hidden}
    #pp-market-ticker .pp-ticker-track{display:flex;width:max-content;min-height:42px;align-items:stretch;animation:pp-ticker-scroll 42s linear infinite}
    #pp-market-ticker .pp-ticker-group{display:flex;align-items:stretch;flex-shrink:0}
    #pp-market-ticker .pp-ticker-item{display:flex;align-items:center;gap:9px;padding:0 19px;border-right:1px solid rgba(103,155,220,.16);white-space:nowrap}
    #pp-market-ticker .pp-ticker-name{max-width:230px;overflow:hidden;text-overflow:ellipsis;color:#e5edf9;font-size:12px;font-weight:700}
    #pp-market-ticker .pp-ticker-price{color:#fff;font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}
    #pp-market-ticker .pp-ticker-change{font-size:11px;font-weight:800;font-variant-numeric:tabular-nums}
    #pp-market-ticker .pp-up{color:#38e28d}#pp-market-ticker .pp-down{color:#ff6b77}#pp-market-ticker .pp-flat{color:#9db1ca}
    #pp-market-ticker .pp-ticker-status{padding:0 18px;color:#9db1ca;font-size:11px;white-space:nowrap}
    #pp-market-ticker .pp-ticker-updated{flex-shrink:0;display:flex;align-items:center;padding:0 13px;color:#7f96b4;font-size:9px;letter-spacing:.04em;border-left:1px solid rgba(103,155,220,.18);white-space:nowrap}
    #pp-market-ticker:hover .pp-ticker-track,#pp-market-ticker:focus-within .pp-ticker-track{animation-play-state:paused}
    @keyframes pp-ticker-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
    @media(max-width:640px){#pp-market-ticker .pp-ticker-head{gap:7px;padding:0 10px}#pp-market-ticker .pp-ticker-caption{display:none}#pp-market-ticker .pp-ticker-name{max-width:155px}#pp-market-ticker .pp-ticker-item{padding:0 12px}#pp-market-ticker .pp-ticker-updated{display:none}#pp-market-ticker .pp-ticker-track{animation-duration:32s}}
    @media(prefers-reduced-motion:reduce){#pp-market-ticker .pp-ticker-track{animation:none;width:auto}#pp-market-ticker .pp-ticker-group[aria-hidden="true"]{display:none}}
  `;
  document.head.appendChild(style);

  var bar = document.createElement('section');
  bar.id = 'pp-market-ticker';
  bar.setAttribute('aria-label', 'Pokémon market movers');
  bar.setAttribute('data-state', 'loading');
  bar.innerHTML = '<div class="pp-ticker-head"><span class="pp-ticker-live" aria-hidden="true"></span><div><div class="pp-ticker-label">MARKET MOVERS</div><div class="pp-ticker-caption">POKÉMON MARKET WATCH</div></div></div><div class="pp-ticker-window"><div class="pp-ticker-status" role="status" aria-live="polite">Connecting market feed…</div></div><div class="pp-ticker-updated">DATA-DRIVEN · NO ESTIMATES</div>';
  document.body.insertBefore(bar, document.body.firstChild);

  var money = function (value) {
    var n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }) : '—';
  };
  var safeText = function (value) { return String(value == null ? '' : value); };

  function render(movers, updatedAt) {
    var windowEl = bar.querySelector('.pp-ticker-window');
    if (!Array.isArray(movers) || !movers.length) {
      bar.setAttribute('data-state', 'pending');
      windowEl.innerHTML = '<div class="pp-ticker-status" role="status">Live market data will appear here once the price feed is connected.</div>';
      return;
    }

    var valid = movers.filter(function (item) {
      return item && typeof item.name === 'string' && item.name.trim() &&
        Number.isFinite(Number(item.changePct));
    }).slice(0, 30);

    if (!valid.length) {
      bar.setAttribute('data-state', 'pending');
      windowEl.innerHTML = '<div class="pp-ticker-status" role="status">Waiting for verified market-price data.</div>';
      return;
    }

    function makeGroup(duplicate) {
      var group = document.createElement('div');
      group.className = 'pp-ticker-group';
      if (duplicate) group.setAttribute('aria-hidden', 'true');
      valid.forEach(function (item) {
        var change = Number(item.changePct);
        var trend = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
        var arrow = change > 0 ? '▲' : change < 0 ? '▼' : '•';
        var tile = document.createElement('div');
        tile.className = 'pp-ticker-item';
        var name = document.createElement('span');
        name.className = 'pp-ticker-name';
        name.textContent = safeText(item.name);
        var price = document.createElement('span');
        price.className = 'pp-ticker-price';
        price.textContent = item.price == null ? '—' : money(item.price);
        var delta = document.createElement('span');
        delta.className = 'pp-ticker-change pp-' + trend;
        delta.textContent = arrow + ' ' + (change > 0 ? '+' : '') + change.toFixed(2) + '%';
        tile.append(name, price, delta);
        group.appendChild(tile);
      });
      return group;
    }

    var track = document.createElement('div');
    track.className = 'pp-ticker-track';
    track.appendChild(makeGroup(false));
    track.appendChild(makeGroup(true));
    windowEl.replaceChildren(track);
    bar.setAttribute('data-state', 'live');

    var updated = bar.querySelector('.pp-ticker-updated');
    if (updated) {
      var date = updatedAt ? new Date(updatedAt) : null;
      updated.textContent = date && Number.isFinite(date.getTime())
        ? 'UPDATED ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'MARKET DATA';
    }
  }

  async function load() {
    try {
      var response = await fetch('/api/market-movers', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('market feed unavailable');
      var data = await response.json();
      if (!data || data.ok !== true) throw new Error('market feed not ready');
      render(data.movers, data.updatedAt);
    } catch (error) {
      bar.setAttribute('data-state', 'pending');
      var status = bar.querySelector('.pp-ticker-status');
      if (status) status.textContent = 'Market data feed is being connected — live prices will show here when verified.';
    }
  }

  load();
  window.setInterval(load, 5 * 60 * 1000);
})();
