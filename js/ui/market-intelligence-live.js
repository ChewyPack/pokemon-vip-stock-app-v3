(function () {
  'use strict';
  var apiUrl = '/api/market-movers';
  var money = function (value) {
    return Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  };
  var pct = function (value) {
    return (value > 0 ? '+' : '') + Number(value).toFixed(2) + '%';
  };
  var escapeHtml = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  };
  var dateLabel = function (value) {
    if (!value) return 'Not available';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-US', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York'
    }) + ' ET';
  };
  var changeMarkup = function (item, key) {
    var change = item[key];
    if (!change) return '<span class="mi-product">Not enough history yet</span>';
    var cls = change.percent_change >= 0 ? '' : ' down';
    return '<span class="mi-change' + cls + '">' + escapeHtml(pct(change.percent_change)) +
      '</span><div class="mi-product">' + escapeHtml((change.dollar_change > 0 ? '+' : '') + money(change.dollar_change)) +
      ' vs ' + escapeHtml(money(change.previous_price)) + '</div>';
  };
  var moverCard = function (item, index, windowKey) {
    var set = item.set_name ? ' · ' + item.set_name : '';
    var number = item.card_number ? ' · ' + item.card_number : '';
    var link = item.product_url && /^https:\/\//i.test(item.product_url)
      ? '<a href="' + escapeHtml(item.product_url) + '" target="_blank" rel="noopener noreferrer" style="color:#a5f3e6">Product ↗</a>'
      : '<a href="https://www.tcgplayer.com/" target="_blank" rel="noopener noreferrer" style="color:#a5f3e6">TCGplayer ↗</a>';
    return '<div class="mi-mover"><span class="mi-rank">' + String(index + 1).padStart(2, '0') +
      '</span><div><div class="mi-name">' + escapeHtml(item.name) + '</div><div class="mi-product">' +
      escapeHtml(set + number + (item.subtype_name ? ' · ' + item.subtype_name : '')) +
      '</div><div class="mi-product">' + link + '</div></div><div class="mi-price">' +
      escapeHtml(money(item.current_price)) + changeMarkup(item, windowKey) + '</div></div>';
  };
  var panel = function (title, subtitle, rows, windowKey, empty) {
    return '<article class="mi-panel"><h3>' + title + '</h3><p class="mi-subtitle">' +
      escapeHtml(subtitle) + '</p>' + (rows && rows.length
        ? rows.map(function (item, index) { return moverCard(item, index, windowKey); }).join('')
        : '<div class="mi-empty">' + escapeHtml(empty) + '</div>') + '</article>';
  };
  var showCategory = function (section, data, categoryName) {
    if (!section || !data) return;
    section.innerHTML =
      panel('Biggest gainers', 'Top 15 products · 24-hour price change', data.gainers, 'day',
        'No comparable daily price history yet. The system needs a previous dated snapshot before it can rank this category.') +
      panel('Biggest decliners', 'Top 15 products · 24-hour price change', data.decliners, 'day',
        'No comparable daily price history yet. Rankings will appear automatically after comparable snapshots are available.') +
      panel('Weekly gainers', 'Top 15 products · 7-day price change', data.weekly_gainers, 'week',
        'Seven days of comparable price history are needed before weekly rankings can appear.') +
      panel('Weekly decliners', 'Top 15 products · 7-day price change', data.weekly_decliners, 'week',
        'Seven days of comparable price history are needed before weekly rankings can appear.');
  };
  var showSealed = function (heading, section, data) {
    if (heading) {
      var p = heading.querySelector('p');
      if (p) p.textContent = 'Live TCGCSV market prices · daily gainers and decliners · sealed products only.';
    }
    showCategory(section, data, 'sealed');
  };
  var setStatus = function (text) {
    var top = document.querySelector('.mi-topline');
    if (!top) return;
    var live = top.querySelector('.mi-live');
    if (live) live.innerHTML = '<span class="mi-dot"></span>' + escapeHtml(text);
  };
  var render = function (data) {
    if (!data || !data.ok) {
      setStatus('Market feed unavailable');
      var msg = 'The live market feed could not be loaded. Please try refreshing later.';
      var singles = document.getElementById('singles');
      var sealedHeading = document.getElementById('sealed');
      if (singles) singles.innerHTML = '<div class="mi-empty">' + msg + '</div>';
      if (sealedHeading && sealedHeading.nextElementSibling) sealedHeading.nextElementSibling.innerHTML = '<div class="mi-empty">' + msg + '</div>';
      return;
    }
    setStatus(data.ready ? 'TCGCSV · daily feed' : 'Building price history');
    var topDesc = document.querySelector('.mi-section-heading p');
    if (topDesc) topDesc.textContent = 'TCGCSV source date: ' + dateLabel(data.source_timestamp) +
      ' · Last completed sync: ' + dateLabel(data.last_sync_success_at);
    var stats = document.querySelectorAll('.mi-stats .mi-stat');
    if (stats.length >= 3) {
      stats[0].querySelector('strong').textContent = String((data.singles.tracked_with_history || 0) + (data.sealed.tracked_with_history || 0));
      stats[0].querySelector('small').textContent = 'Products with at least one saved market-price observation. Only comparable products are ranked.';
      stats[1].querySelector('strong').textContent = '24 hours / 7 days';
      stats[1].querySelector('small').textContent = 'Daily and weekly price movement against the latest available historical observation at or before each cutoff.';
      stats[2].querySelector('strong').textContent = data.ready ? (data.sync_status === 'success' ? 'History recording' : 'Sync ' + data.sync_status) : 'Collecting baseline';
      stats[2].querySelector('small').textContent = data.ready ? 'Source: TCGCSV · Last completed sync: ' + dateLabel(data.last_sync_success_at) : (data.message || 'Daily price history will populate after the next successful refresh.');
    }
    var history = document.getElementById('snapshot-history');
    if (history) {
      history.innerHTML = '<h3>Automated price history &amp; momentum baseline</h3><p class="mi-subtitle">Latest saved source snapshot: ' +
        escapeHtml(dateLabel(data.source_timestamp)) + '</p><p>Daily and weekly rankings are calculated from dated TCGCSV market-price observations for the same product and price subtype. New products are excluded from rankings until a comparable prior price exists. A failed or incomplete sync should not be interpreted as a market move.</p><p class="mi-artist-footnote">' +
        escapeHtml(data.history_note || 'Historical observations accumulate automatically after each successful daily refresh.') + '</p>';
    }
    var singles = document.getElementById('singles');
    if (singles) showCategory(singles, data.singles, 'singles');
    var singlesHeading = singles && singles.previousElementSibling && singles.previousElementSibling.previousElementSibling;
    if (singlesHeading) {
      var p = singlesHeading.querySelector('p');
      if (p) p.textContent = 'Live TCGCSV market prices · daily gainers and decliners · singles only.';
    }
    var sealedHeading = document.getElementById('sealed');
    showSealed(sealedHeading, sealedHeading && sealedHeading.nextElementSibling, data.sealed);
    var slabsHeading = document.getElementById('slabs');
    var slabsSection = slabsHeading && slabsHeading.nextElementSibling;
    if (slabsSection) {
      slabsSection.innerHTML = '<article class="mi-note" style="grid-column:1/-1"><h3>Graded-card market data is a separate integration</h3><p>TCGCSV raw-card prices are not graded-slab prices. We are keeping this section separate until a reliable source can provide matching grading company, grade, and slab-price observations. No raw-card movement will be presented as a PSA, BGS, or CGC market move.</p></article>';
    }
  };
  fetch(apiUrl, { credentials: 'same-origin', cache: 'no-store' })
    .then(function (response) { if (!response.ok) throw new Error('Market feed request failed'); return response.json(); })
    .then(render)
    .catch(function () { render({ ok: false }); });
})();
