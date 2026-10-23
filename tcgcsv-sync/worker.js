const SOURCE = 'https://tcgcsv.com/tcgplayer';
const POKEMON_CATEGORY_ID = 3;
const USER_AGENT = 'PokePrizePoolMarket/1.0.0';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json,text/plain,*/*' }
  });
  await sleep(100);
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from ' + url);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain,*/*' }
  });
  await sleep(100);
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from ' + url);
  return (await response.text()).trim();
}

async function batches(db, statements, size = 50) {
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size));
  }
}

function extendedValue(items, ...names) {
  const wanted = new Set(names.map(name => name.toLowerCase()));
  const item = (Array.isArray(items) ? items : []).find(entry =>
    wanted.has(String(entry?.name || '').toLowerCase()) ||
    wanted.has(String(entry?.displayName || '').toLowerCase())
  );
  return item?.value == null ? '' : String(item.value);
}

function productType(product) {
  const ext = Array.isArray(product.extendedData) ? product.extendedData : [];
  const hasCardNumber = ext.some(item =>
    ['number', 'card number'].includes(String(item?.name || '').toLowerCase()) ||
    ['number', 'card number'].includes(String(item?.displayName || '').toLowerCase())
  );
  const hasRarity = ext.some(item =>
    String(item?.name || '').toLowerCase() === 'rarity' ||
    String(item?.displayName || '').toLowerCase() === 'rarity'
  );
  return hasCardNumber || hasRarity ? 'single' : 'sealed';
}

function safeJson(value) {
  try { return JSON.stringify(value ?? null); } catch { return 'null'; }
}

async function ensureProgressTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS tcgcsv_sync_progress (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    run_token TEXT,
    source_timestamp TEXT,
    group_ids_json TEXT,
    next_group_index INTEGER NOT NULL DEFAULT 0
  )`).run();
  await db.prepare(`INSERT OR IGNORE INTO tcgcsv_sync_progress
    (id, next_group_index) VALUES (1, 0)`).run();
}

async function setError(db, error) {
  const message = String(error?.message || error).slice(0, 1000);
  await db.prepare("UPDATE tcgcsv_sync_state SET status='error', last_error=? WHERE id=1")
    .bind(message).run().catch(() => {});
}

async function beginSync(db) {
  await ensureProgressTable(db);
  const sourceTimestamp = await getText('https://tcgcsv.com/last-updated.txt');
  if (!sourceTimestamp) throw new Error('TCGCSV last-updated.txt was empty.');

  const state = await db.prepare(
    'SELECT source_timestamp, last_success_at FROM tcgcsv_sync_state WHERE id = 1'
  ).first();

  if (state?.source_timestamp === sourceTimestamp && state?.last_success_at) {
    await db.prepare("UPDATE tcgcsv_sync_state SET status='up_to_date', last_error=NULL WHERE id=1").run();
    return { skipped: true, reason: 'source_unchanged', source_timestamp: sourceTimestamp };
  }

  await db.prepare("UPDATE tcgcsv_sync_state SET status='syncing', last_error=NULL WHERE id=1").run();

  try {
    const categoriesPayload = await getJson(SOURCE + '/categories');
    if (categoriesPayload?.success === false) throw new Error('TCGCSV categories response reported failure.');
    const pokemon = (categoriesPayload?.results || []).find(item =>
      Number(item.categoryId) === POKEMON_CATEGORY_ID ||
      String(item.name || '').toLowerCase() === 'pokemon'
    );
    if (!pokemon) throw new Error('Could not find the Pokémon category in TCGCSV.');

    const groupsPayload = await getJson(SOURCE + '/' + POKEMON_CATEGORY_ID + '/groups');
    if (groupsPayload?.success === false || !Array.isArray(groupsPayload?.results)) {
      throw new Error('TCGCSV groups response was invalid.');
    }
    const groups = groupsPayload.results;
    if (!groups.length) throw new Error('TCGCSV returned zero Pokémon groups; refusing to clear existing data.');

    // Clear any stale resume cursor before touching staging rows. This prevents
    // a failed start from accidentally publishing an older run's cursor.
    await db.prepare(`UPDATE tcgcsv_sync_progress
      SET run_token=NULL, source_timestamp=NULL, group_ids_json='[]', next_group_index=0
      WHERE id=1`).run();

    await db.batch([
      db.prepare('DELETE FROM tcgcsv_groups_staging'),
      db.prepare('DELETE FROM tcgcsv_products_staging'),
      db.prepare('DELETE FROM tcgcsv_prices_staging')
    ]);

    const groupStatements = groups.map(group => db.prepare(`
      INSERT INTO tcgcsv_groups_staging(group_id, category_id, name, abbreviation, published_on, modified_on, last_seen_sync)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_id) DO UPDATE SET
        category_id=excluded.category_id, name=excluded.name, abbreviation=excluded.abbreviation,
        published_on=excluded.published_on, modified_on=excluded.modified_on,
        last_seen_sync=excluded.last_seen_sync
    `).bind(
      Number(group.groupId), Number(group.categoryId || POKEMON_CATEGORY_ID),
      String(group.name || 'Unknown set'), group.abbreviation || null,
      group.publishedOn || null, group.modifiedOn || null, sourceTimestamp
    ));
    await batches(db, groupStatements, 50);

    const token = crypto.randomUUID();
    await db.prepare(`UPDATE tcgcsv_sync_progress
      SET run_token=?, source_timestamp=?, group_ids_json=?, next_group_index=0
      WHERE id=1`).bind(token, sourceTimestamp, JSON.stringify(groups.map(group => Number(group.groupId)))).run();

    return { skipped: false, started: true, source_timestamp: sourceTimestamp, groups_total: groups.length };
  } catch (error) {
    await setError(db, error);
    throw error;
  }
}

async function publishCatalog(db, token) {
  const progress = await db.prepare(
    'SELECT run_token, source_timestamp FROM tcgcsv_sync_progress WHERE id=1'
  ).first();
  if (!progress || progress.run_token !== token) return { ignored: true, reason: 'run_token_mismatch' };

  const commitAt = new Date().toISOString();
  const sourceTimestamp = progress.source_timestamp;
  await db.batch([
    db.prepare(`INSERT INTO tcgcsv_groups(group_id, category_id, name, abbreviation, published_on, modified_on, last_seen_sync)
      SELECT group_id, category_id, name, abbreviation, published_on, modified_on, last_seen_sync FROM tcgcsv_groups_staging WHERE 1
      ON CONFLICT(group_id) DO UPDATE SET category_id=excluded.category_id, name=excluded.name,
        abbreviation=excluded.abbreviation, published_on=excluded.published_on,
        modified_on=excluded.modified_on, last_seen_sync=excluded.last_seen_sync`),
    db.prepare(`INSERT INTO tcgcsv_products(product_id, category_id, group_id, name, clean_name, image_url, product_url, product_type, card_number, rarity, extended_data_json, last_seen_sync)
      SELECT product_id, category_id, group_id, name, clean_name, image_url, product_url, product_type, card_number, rarity, extended_data_json, last_seen_sync FROM tcgcsv_products_staging WHERE 1
      ON CONFLICT(product_id) DO UPDATE SET category_id=excluded.category_id, group_id=excluded.group_id,
        name=excluded.name, clean_name=excluded.clean_name, image_url=excluded.image_url,
        product_url=excluded.product_url, product_type=excluded.product_type, card_number=excluded.card_number,
        rarity=excluded.rarity, extended_data_json=excluded.extended_data_json, last_seen_sync=excluded.last_seen_sync`),
    db.prepare(`INSERT INTO tcgcsv_prices(product_id, subtype_name, low_price, mid_price, high_price, market_price, direct_low_price, last_seen_sync)
      SELECT product_id, subtype_name, low_price, mid_price, high_price, market_price, direct_low_price, last_seen_sync FROM tcgcsv_prices_staging WHERE 1
      ON CONFLICT(product_id, subtype_name) DO UPDATE SET low_price=excluded.low_price, mid_price=excluded.mid_price,
        high_price=excluded.high_price, market_price=excluded.market_price, direct_low_price=excluded.direct_low_price,
        last_seen_sync=excluded.last_seen_sync`),
    db.prepare('DELETE FROM tcgcsv_prices WHERE NOT EXISTS (SELECT 1 FROM tcgcsv_prices_staging s WHERE s.product_id = tcgcsv_prices.product_id AND s.subtype_name = tcgcsv_prices.subtype_name)'),
    db.prepare('DELETE FROM tcgcsv_groups WHERE category_id = ? AND NOT EXISTS (SELECT 1 FROM tcgcsv_groups_staging s WHERE s.group_id = tcgcsv_groups.group_id)').bind(POKEMON_CATEGORY_ID),
    db.prepare(`INSERT OR IGNORE INTO tcgcsv_price_history(product_id, subtype_name, source_timestamp, low_price, mid_price, high_price, market_price, direct_low_price, recorded_at)
      SELECT p.product_id, p.subtype_name, ?, p.low_price, p.mid_price, p.high_price, p.market_price, p.direct_low_price, ?
      FROM tcgcsv_prices_staging p JOIN tcgcsv_products_staging product ON product.product_id=p.product_id`).bind(sourceTimestamp, commitAt),
    db.prepare("UPDATE tcgcsv_sync_state SET source_timestamp=?, last_success_at=?, status='success', last_error=NULL WHERE id=1").bind(sourceTimestamp, commitAt),
    db.prepare('DELETE FROM tcgcsv_groups_staging'),
    db.prepare('DELETE FROM tcgcsv_products_staging'),
    db.prepare('DELETE FROM tcgcsv_prices_staging')
  ]);

  return { complete: true, source_timestamp: sourceTimestamp, completed_at: commitAt };
}

async function processOneGroup(db, token) {
  const progress = await db.prepare(`SELECT run_token, source_timestamp, group_ids_json, next_group_index
    FROM tcgcsv_sync_progress WHERE id=1`).first();
  if (!progress || progress.run_token !== token) return { ignored: true, reason: 'run_token_mismatch' };

  const state = await db.prepare('SELECT status FROM tcgcsv_sync_state WHERE id=1').first();
  if (state?.status !== 'syncing') return { ignored: true, reason: 'sync_not_active' };

  const groupIds = JSON.parse(progress.group_ids_json || '[]');
  const index = Number(progress.next_group_index || 0);
  if (index >= groupIds.length) return publishCatalog(db, token);

  try {
    const groupId = Number(groupIds[index]);
    console.log('Processing TCGCSV group', index + 1, 'of', groupIds.length, 'groupId', groupId);
    const group = await db.prepare('SELECT group_id, category_id FROM tcgcsv_groups_staging WHERE group_id=?')
      .bind(groupId).first();
    if (!group) throw new Error('Staging group not found: ' + groupId);

    const categoryId = Number(group.category_id || POKEMON_CATEGORY_ID);
    const productsPayload = await getJson(SOURCE + '/' + categoryId + '/' + groupId + '/products');
    if (productsPayload?.success === false || !Array.isArray(productsPayload?.results)) {
      throw new Error('Invalid products response for group ' + groupId + '.');
    }
    const pricePayload = await getJson(SOURCE + '/' + categoryId + '/' + groupId + '/prices');
    if (pricePayload?.success === false || !Array.isArray(pricePayload?.results)) {
      throw new Error('Invalid prices response for group ' + groupId + '.');
    }

    const sourceTimestamp = progress.source_timestamp;
    const productStatements = productsPayload.results.map(product => {
      const ext = Array.isArray(product.extendedData) ? product.extendedData : [];
      return db.prepare(`
        INSERT INTO tcgcsv_products_staging(
          product_id, category_id, group_id, name, clean_name, image_url, product_url,
          product_type, card_number, rarity, extended_data_json, last_seen_sync
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_id) DO UPDATE SET
          category_id=excluded.category_id, group_id=excluded.group_id, name=excluded.name,
          clean_name=excluded.clean_name, image_url=excluded.image_url, product_url=excluded.product_url,
          product_type=excluded.product_type, card_number=excluded.card_number, rarity=excluded.rarity,
          extended_data_json=excluded.extended_data_json, last_seen_sync=excluded.last_seen_sync
      `).bind(
        Number(product.productId), Number(product.categoryId || categoryId), Number(product.groupId || groupId),
        String(product.name || 'Unknown product'), product.cleanName || null,
        product.imageUrl || null, product.url || null, productType(product),
        extendedValue(ext, 'Number', 'Card Number') || null,
        extendedValue(ext, 'Rarity') || null, safeJson(ext), sourceTimestamp
      );
    });
    await batches(db, productStatements, 40);

    const priceStatements = pricePayload.results.map(price => db.prepare(`
      INSERT INTO tcgcsv_prices_staging(
        product_id, subtype_name, low_price, mid_price, high_price,
        market_price, direct_low_price, last_seen_sync
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_id, subtype_name) DO UPDATE SET
        low_price=excluded.low_price, mid_price=excluded.mid_price, high_price=excluded.high_price,
        market_price=excluded.market_price, direct_low_price=excluded.direct_low_price,
        last_seen_sync=excluded.last_seen_sync
    `).bind(
      Number(price.productId), String(price.subTypeName || 'Normal'),
      price.lowPrice ?? null, price.midPrice ?? null, price.highPrice ?? null,
      price.marketPrice ?? null, price.directLowPrice ?? null, sourceTimestamp
    ));
    await batches(db, priceStatements, 75);

    const nextIndex = index + 1;
    await db.prepare('UPDATE tcgcsv_sync_progress SET next_group_index=? WHERE id=1 AND run_token=?')
      .bind(nextIndex, token).run();

    if (nextIndex >= groupIds.length) {
      await publishCatalog(db, token);
      return { complete: true, groups_processed: nextIndex, groups_total: groupIds.length };
    }

    return { processed_group: groupId, groups_processed: nextIndex, groups_total: groupIds.length, continuing: true };
  } catch (error) {
    await setError(db, error);
    throw error;
  }
}

export default {
  async scheduled(event, env, ctx) {
    const cron = String(event?.cron || '');
    const isDailySourceCheck = cron === '0 21 * * *';
    console.log('TCGCSV scheduled trigger fired', { cron, isDailySourceCheck });

    ctx.waitUntil((async () => {
      const state = await env.DB.prepare(
        'SELECT status FROM tcgcsv_sync_state WHERE id = 1'
      ).first();
      const progress = await env.DB.prepare(
        'SELECT run_token, source_timestamp, group_ids_json, next_group_index FROM tcgcsv_sync_progress WHERE id = 1'
      ).first().catch(() => null);

      let groupCount = 0;
      try {
        const ids = JSON.parse(progress?.group_ids_json || '[]');
        if (Array.isArray(ids)) groupCount = ids.length;
      } catch {
        groupCount = 0;
      }
      const nextIndex = Number(progress?.next_group_index || 0);
      const hasSavedRun = Boolean(progress?.run_token && progress?.source_timestamp && groupCount > 0);
      const needsResume = hasSavedRun && (
        nextIndex < groupCount ||
        (nextIndex >= groupCount && ['syncing', 'error'].includes(String(state?.status || '')))
      );

      if (needsResume) {
        if (state?.status !== 'syncing') {
          console.log('Resuming saved TCGCSV batch progress; previous status:', state?.status);
          await env.DB.prepare(
            "UPDATE tcgcsv_sync_state SET status='syncing', last_error=NULL WHERE id=1"
          ).run();
        }
        console.log('Processing saved TCGCSV group batch', nextIndex + 1, 'of', groupCount);
        await processOneGroup(env.DB, progress.run_token).catch(error => {
          console.error('TCGCSV group batch failed:', error);
          return setError(env.DB, error);
        });
        return;
      }

      // The minute trigger only advances a previously-started import. TCGCSV
      // recommends checking its source marker once per day, not once per minute.
      if (!isDailySourceCheck) {
        console.log('No active TCGCSV import; skipping source check until the daily trigger.');
        return;
      }

      console.log('Daily TCGCSV source check; starting sync only if the source changed.');
      await beginSync(env.DB).catch(error => {
        console.error('TCGCSV scheduled sync failed:', error);
        return setError(env.DB, error);
      });
    })());
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
      const state = await env.DB.prepare(
        'SELECT source_timestamp, last_success_at, status, last_error FROM tcgcsv_sync_state WHERE id=1'
      ).first().catch(() => null);
      const progress = await env.DB.prepare(
        'SELECT source_timestamp, next_group_index, group_ids_json FROM tcgcsv_sync_progress WHERE id=1'
      ).first().catch(() => null);
      let progressInfo = null;
      if (progress) {
        let total = null;
        try { total = JSON.parse(progress.group_ids_json || '[]').length; } catch {}
        progressInfo = {
          source_timestamp: progress.source_timestamp,
          groups_processed: Number(progress.next_group_index || 0),
          groups_total: total
        };
      }
      return json({ ok: true, service: 'PokePrizePool TCGCSV sync', state: state || null, progress: progressInfo });
    }

    if (url.pathname === '/sync' && request.method === 'POST') {
      const expected = env.SYNC_SECRET;
      const auth = request.headers.get('Authorization') || '';
      if (!expected || auth !== 'Bearer ' + expected) return json({ ok: false, error: 'unauthorized' }, 401);
      if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
      try {
        const result = await beginSync(env.DB);
        return json({ ok: true, result, note: result.skipped ? 'No import was needed.' : 'Import is running in resumable per-group batches. Check /health for progress.' }, result.skipped ? 200 : 202);
      } catch (error) {
        console.error('TCGCSV sync start failed:', error);
        return json({ ok: false, error: 'sync_start_failed', message: String(error?.message || error).slice(0, 500) }, 500);
      }
    }

    return json({ ok: false, error: 'not_found' }, 404);
  }
};
