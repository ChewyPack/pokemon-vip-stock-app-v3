const SOURCE = 'https://tcgcsv.com/tcgplayer';
const POKEMON_CATEGORY_ID = 3;
const USER_AGENT = 'PokePrizePoolMarket/1.0.0';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const DEFAULT_IMPORT_WRITE_BUDGET = 50000;
const MAX_IMPORT_WRITE_BUDGET = 1000000;

function importWriteBudget(env) {
  const requested = Number(env?.IMPORT_WRITE_BUDGET);
  if (!Number.isFinite(requested) || requested < 1) return DEFAULT_IMPORT_WRITE_BUDGET;
  return Math.min(MAX_IMPORT_WRITE_BUDGET, Math.floor(requested));
}

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
  await db.prepare("CREATE TABLE IF NOT EXISTS tcgcsv_sync_progress (" +
    "id INTEGER PRIMARY KEY CHECK (id = 1), run_token TEXT, source_timestamp TEXT, " +
    "group_ids_json TEXT, next_group_index INTEGER NOT NULL DEFAULT 0, " +
    "current_group_offset INTEGER NOT NULL DEFAULT 0, sync_day TEXT, " +
    "rows_written_today INTEGER NOT NULL DEFAULT 0)").run();
  await db.prepare("INSERT OR IGNORE INTO tcgcsv_sync_progress " +
    "(id, next_group_index, current_group_offset, rows_written_today) VALUES (1, 0, 0, 0)").run();
}

async function setError(db, error) {
  const message = String(error?.message || error).slice(0, 1000);
  await db.prepare("UPDATE tcgcsv_sync_state SET status='error', last_error=? WHERE id=1")
    .bind(message).run().catch(() => {});
}

async function beginSync(db) {
  await ensureProgressTable(db);
  await ensurePriceProgressTable(db);
  const activeCatalog = await db.prepare('SELECT run_token, source_timestamp FROM tcgcsv_sync_progress WHERE id=1').first();
  if (activeCatalog?.run_token) return { skipped: true, reason: 'catalog_sync_already_running', source_timestamp: activeCatalog.source_timestamp };
  const activePrice = await db.prepare('SELECT run_token FROM tcgcsv_price_sync_progress WHERE id=1').first();
  if (activePrice?.run_token) throw new Error('A price-only sync is already active; refusing to start a catalog import concurrently.');
  const sourceTimestamp = await getText('https://tcgcsv.com/last-updated.txt');
  if (!sourceTimestamp) throw new Error('TCGCSV last-updated.txt was empty.');
  const state = await db.prepare('SELECT source_timestamp, last_success_at FROM tcgcsv_sync_state WHERE id = 1').first();
  if (state?.source_timestamp === sourceTimestamp && state?.last_success_at) {
    // The older catalog sync may already have published this source marker before
    // snapshot history existed. Run a one-time price-only pass if any priced
    // product is still missing a snapshot for this marker.
    const missingSnapshot = await db.prepare(
      'SELECT 1 AS missing FROM tcgcsv_products p WHERE p.market_price IS NOT NULL ' +
      'AND NOT EXISTS (SELECT 1 FROM tcgcsv_market_price_snapshots s ' +
      'WHERE s.product_id=p.product_id AND s.source_timestamp=?) LIMIT 1'
    ).bind(sourceTimestamp).first();
    if (!missingSnapshot) {
      await db.prepare("UPDATE tcgcsv_sync_state SET status='up_to_date', last_error=NULL WHERE id=1").run();
      return { skipped: true, reason: 'source_unchanged', source_timestamp: sourceTimestamp };
    }
    console.log('Starting a price-only refresh because snapshot history is missing for the current source timestamp.');
  }
  await db.prepare("UPDATE tcgcsv_sync_state SET status='syncing', last_error=NULL WHERE id=1").run();
  try {
    const categoriesPayload = await getJson(SOURCE + '/categories');
    if (categoriesPayload?.success === false) throw new Error('TCGCSV categories response reported failure.');
    const pokemon = (categoriesPayload?.results || []).find(item =>
      Number(item.categoryId) === POKEMON_CATEGORY_ID || String(item.name || '').toLowerCase() === 'pokemon'
    );
    if (!pokemon) throw new Error('Could not find the Pokémon category in TCGCSV.');
    const groupsPayload = await getJson(SOURCE + '/' + POKEMON_CATEGORY_ID + '/groups');
    if (groupsPayload?.success === false || !Array.isArray(groupsPayload?.results)) {
      throw new Error('TCGCSV groups response was invalid.');
    }
    const groups = groupsPayload.results;
    if (!groups.length) throw new Error('TCGCSV returned zero Pokémon groups; refusing to start an empty sync.');

    await db.prepare("UPDATE tcgcsv_sync_progress SET run_token=NULL, source_timestamp=NULL, " +
      "group_ids_json='[]', next_group_index=0, current_group_offset=0 WHERE id=1").run();
    const groupStatements = groups.map(group => db.prepare(
      "INSERT INTO tcgcsv_groups(group_id, category_id, name, abbreviation, published_on, modified_on, last_seen_sync) " +
      "VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET " +
      "category_id=excluded.category_id, name=excluded.name, abbreviation=excluded.abbreviation, " +
      "published_on=excluded.published_on, modified_on=excluded.modified_on, last_seen_sync=excluded.last_seen_sync"
    ).bind(
      Number(group.groupId), Number(group.categoryId || POKEMON_CATEGORY_ID),
      String(group.name || 'Unknown set'), group.abbreviation || null,
      group.publishedOn || null, group.modifiedOn || null, sourceTimestamp
    ));
    await batches(db, groupStatements, 50);
    const token = crypto.randomUUID();
    const syncDay = new Date().toISOString().slice(0, 10);
    await db.prepare("UPDATE tcgcsv_sync_progress SET run_token=?, source_timestamp=?, " +
      "group_ids_json=?, next_group_index=0, current_group_offset=0, sync_day=?, rows_written_today=0 WHERE id=1"
    ).bind(token, sourceTimestamp, JSON.stringify(groups.map(group => Number(group.groupId))), syncDay).run();
    return { skipped: false, started: true, source_timestamp: sourceTimestamp,
      groups_total: groups.length, storage_mode: 'one_product_row_with_one_market_price' };
  } catch (error) {
    await setError(db, error);
    throw error;
  }
}


async function ensurePriceProgressTable(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS tcgcsv_price_sync_progress (" +
    "id INTEGER PRIMARY KEY CHECK (id = 1), run_token TEXT, source_timestamp TEXT, " +
    "group_ids_json TEXT, next_group_index INTEGER NOT NULL DEFAULT 0, " +
    "current_group_offset INTEGER NOT NULL DEFAULT 0, sync_day TEXT, rows_written_today INTEGER NOT NULL DEFAULT 0)").run();
  await db.prepare("INSERT OR IGNORE INTO tcgcsv_price_sync_progress " +
    "(id, next_group_index, current_group_offset, rows_written_today) VALUES (1, 0, 0, 0)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS tcgcsv_market_price_snapshots (" +
    "product_id INTEGER NOT NULL, subtype_name TEXT NOT NULL DEFAULT 'Normal', " +
    "source_timestamp TEXT NOT NULL, market_price REAL NOT NULL, recorded_at TEXT NOT NULL, " +
    "PRIMARY KEY (product_id, subtype_name, source_timestamp))").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_tcgcsv_market_snapshots_time " +
    "ON tcgcsv_market_price_snapshots(source_timestamp, product_id)").run();
}

async function beginPriceSync(db) {
  await ensurePriceProgressTable(db);
  const activeCatalog = await db.prepare('SELECT run_token FROM tcgcsv_sync_progress WHERE id=1').first().catch(() => null);
  if (activeCatalog?.run_token) throw new Error('A catalog import is already active; refusing to start a price-only sync concurrently.');
  const activePrice = await db.prepare('SELECT run_token, source_timestamp FROM tcgcsv_price_sync_progress WHERE id=1').first();
  if (activePrice?.run_token) return { skipped: true, reason: 'price_sync_already_running', source_timestamp: activePrice.source_timestamp };
  const sourceTimestamp = await getText('https://tcgcsv.com/last-updated.txt');
  if (!sourceTimestamp) throw new Error('TCGCSV last-updated.txt was empty.');
  const state = await db.prepare('SELECT source_timestamp, last_success_at FROM tcgcsv_sync_state WHERE id=1').first();
  if (state?.source_timestamp === sourceTimestamp && state?.last_success_at) {
    await db.prepare("UPDATE tcgcsv_sync_state SET status='up_to_date', last_error=NULL WHERE id=1").run();
    return { skipped: true, reason: 'source_unchanged', source_timestamp: sourceTimestamp };
  }
  const groups = await db.prepare('SELECT group_id FROM tcgcsv_groups ORDER BY group_id').all();
  const groupIds = (groups?.results || []).map(row => Number(row.group_id)).filter(Number.isFinite);
  if (!groupIds.length) throw new Error('No existing TCGCSV groups found; refusing to run a price-only sync without a catalog.');
  const token = crypto.randomUUID();
  const syncDay = new Date().toISOString().slice(0, 10);
  await db.batch([
    db.prepare("UPDATE tcgcsv_sync_state SET status='syncing', last_error=NULL WHERE id=1"),
    db.prepare("UPDATE tcgcsv_price_sync_progress SET run_token=?, source_timestamp=?, group_ids_json=?, " +
      "next_group_index=0, current_group_offset=0, sync_day=?, rows_written_today=0 WHERE id=1")
      .bind(token, sourceTimestamp, JSON.stringify(groupIds), syncDay)
  ]);
  return { skipped: false, started: true, mode: 'price_only', source_timestamp: sourceTimestamp, groups_total: groupIds.length };
}

async function publishPrices(db, token) {
  const progress = await db.prepare('SELECT run_token, source_timestamp, group_ids_json FROM tcgcsv_price_sync_progress WHERE id=1').first();
  if (!progress || progress.run_token !== token) return { ignored: true, reason: 'run_token_mismatch' };
  const groupCount = JSON.parse(progress.group_ids_json || '[]').length;
  const commitAt = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE tcgcsv_sync_state SET source_timestamp=?, last_success_at=?, status='success', last_error=NULL WHERE id=1")
      .bind(progress.source_timestamp, commitAt),
    db.prepare("UPDATE tcgcsv_price_sync_progress SET run_token=NULL, source_timestamp=NULL, group_ids_json='[]', " +
      "next_group_index=0, current_group_offset=0 WHERE id=1 AND run_token=?").bind(token)
  ]);
  return { complete: true, mode: 'price_only', groups_processed: groupCount,
    source_timestamp: progress.source_timestamp, completed_at: commitAt };
}

async function processOnePriceGroup(db, token, dailyWriteBudget = DEFAULT_IMPORT_WRITE_BUDGET) {
  const progress = await db.prepare("SELECT run_token, source_timestamp, group_ids_json, next_group_index, current_group_offset, sync_day, rows_written_today " +
    "FROM tcgcsv_price_sync_progress WHERE id=1").first();
  if (!progress || progress.run_token !== token) return { ignored: true, reason: 'run_token_mismatch' };
  const state = await db.prepare('SELECT status FROM tcgcsv_sync_state WHERE id=1').first();
  if (state?.status !== 'syncing') return { ignored: true, reason: 'sync_not_active' };
  const groupIds = JSON.parse(progress.group_ids_json || '[]');
  const index = Number(progress.next_group_index || 0);
  if (index >= groupIds.length) return publishPrices(db, token);
  const today = new Date().toISOString().slice(0, 10);
  let rowsWrittenToday = progress.sync_day === today ? Number(progress.rows_written_today || 0) : 0;
  let offset = Number(progress.current_group_offset || 0);
  if (progress.sync_day !== today) {
    await db.prepare("UPDATE tcgcsv_price_sync_progress SET sync_day=?, rows_written_today=0 WHERE id=1 AND run_token=?")
      .bind(today, token).run();
  }
  if (rowsWrittenToday >= dailyWriteBudget) {
    return { paused_for_daily_write_budget: true, rows_written_today: rowsWrittenToday, resumes_after_utc_midnight: true, mode: 'price_only' };
  }

  try {
    const groupId = Number(groupIds[index]);
    const group = await db.prepare('SELECT category_id FROM tcgcsv_groups WHERE group_id=?').bind(groupId).first();
    if (!group) throw new Error('Production group row not found for price sync: ' + groupId);
    // Keep the catalog visibility marker aligned with the new price source timestamp.
    // This updates only set freshness, not set names or other metadata.
    await db.prepare('UPDATE tcgcsv_groups SET last_seen_sync=? WHERE group_id=?')
      .bind(progress.source_timestamp, groupId).run();
    const categoryId = Number(group.category_id || POKEMON_CATEGORY_ID);
    console.log('Refreshing TCGCSV prices for group', index + 1, 'of', groupIds.length, 'groupId', groupId);
    const pricePayload = await getJson(SOURCE + '/' + categoryId + '/' + groupId + '/prices');
    if (pricePayload?.success === false || !Array.isArray(pricePayload?.results)) throw new Error('Invalid prices response for group ' + groupId + '.');
    const pricesByProduct = new Map();
    for (const price of pricePayload.results) {
      const key = String(price.productId);
      if (!pricesByProduct.has(key)) pricesByProduct.set(key, []);
      pricesByProduct.get(key).push(price);
    }
    const existing = await db.prepare('SELECT product_id FROM tcgcsv_products WHERE group_id=? ORDER BY product_id').bind(groupId).all();
    const productIds = (existing?.results || []).map(row => Number(row.product_id));
    const priceFor = variants => {
      const valid = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
      const rank = value => {
        const type = String(value || '').trim().toLowerCase();
        if (type === 'normal') return 0;
        if (type === 'holofoil') return 1;
        if (type === 'reverse holofoil') return 2;
        return 3;
      };
      const sorted = (variants || []).slice().sort((a, b) => {
        if (valid(a.marketPrice) !== valid(b.marketPrice)) return valid(a.marketPrice) ? -1 : 1;
        return rank(a.subTypeName) - rank(b.subTypeName);
      });
      const preferred = sorted[0];
      const marketPrice = valid(preferred?.marketPrice) ? Number(preferred.marketPrice) : null;
      return { marketPrice, subtype: marketPrice === null ? null : String(preferred?.subTypeName || 'Normal') };
    };
    while (offset < productIds.length) {
      // Each product uses one current-price update plus one dated history write.
      // Budget two row writes per product conservatively; a NULL price may skip history.
      const remainingBudget = dailyWriteBudget - rowsWrittenToday;
      const productsThisBatch = Math.floor(remainingBudget / 2);
      if (productsThisBatch < 1) {
        await db.prepare("UPDATE tcgcsv_price_sync_progress SET current_group_offset=?, rows_written_today=?, sync_day=? WHERE id=1 AND run_token=?")
          .bind(offset, rowsWrittenToday, today, token).run();
        return { paused_for_daily_write_budget: true, mode: 'price_only', current_group: groupId,
          products_processed_in_group: offset, products_in_group: productIds.length,
          rows_written_today: rowsWrittenToday, resumes_after_utc_midnight: true };
      }
      const batchIds = productIds.slice(offset, offset + Math.min(20, productsThisBatch));
      const statements = [];
      for (const productId of batchIds) {
        const price = priceFor(pricesByProduct.get(String(productId)) || []);
        statements.push(db.prepare('UPDATE tcgcsv_products SET market_price=?, market_price_subtype=?, last_seen_sync=? WHERE product_id=?')
          .bind(price.marketPrice, price.subtype, progress.source_timestamp, productId));
        if (price.marketPrice !== null) {
          statements.push(db.prepare(
            'INSERT INTO tcgcsv_market_price_snapshots ' +
            '(product_id, subtype_name, source_timestamp, market_price, recorded_at) ' +
            'SELECT product_id, ?, ?, market_price, ? FROM tcgcsv_products ' +
            'WHERE product_id=? AND market_price IS NOT NULL ' +
            'ON CONFLICT(product_id, subtype_name, source_timestamp) DO UPDATE SET ' +
            'market_price=excluded.market_price, recorded_at=excluded.recorded_at'
          ).bind(price.subtype || 'Normal', progress.source_timestamp, new Date().toISOString(), productId));
        }
      }
      await db.batch(statements);
      offset += batchIds.length;
      rowsWrittenToday += batchIds.length * 2;
      await db.prepare("UPDATE tcgcsv_price_sync_progress SET current_group_offset=?, rows_written_today=?, sync_day=? WHERE id=1 AND run_token=?")
        .bind(offset, rowsWrittenToday, today, token).run();
    }
    const nextIndex = index + 1;
    await db.prepare('UPDATE tcgcsv_price_sync_progress SET next_group_index=?, current_group_offset=0 WHERE id=1 AND run_token=?')
      .bind(nextIndex, token).run();
    if (nextIndex >= groupIds.length) {
      const published = await publishPrices(db, token);
      return { ...published, groups_processed: nextIndex, groups_total: groupIds.length, products_price_refreshed: productIds.length };
    }
    return { processed_group: groupId, groups_processed: nextIndex, groups_total: groupIds.length,
      products_price_refreshed: productIds.length, rows_written_today: rowsWrittenToday, mode: 'price_only', continuing: true };
  } catch (error) {
    await setError(db, error);
    throw error;
  }
}

async function publishCatalog(db, token) {
  const progress = await db.prepare('SELECT run_token, source_timestamp FROM tcgcsv_sync_progress WHERE id=1').first();
  if (!progress || progress.run_token !== token) return { ignored: true, reason: 'run_token_mismatch' };
  const commitAt = new Date().toISOString();
  const sourceTimestamp = progress.source_timestamp;
  await db.batch([
    db.prepare("UPDATE tcgcsv_sync_state SET source_timestamp=?, last_success_at=?, status='success', last_error=NULL WHERE id=1")
      .bind(sourceTimestamp, commitAt),
    db.prepare("UPDATE tcgcsv_sync_progress SET run_token=NULL, source_timestamp=NULL, group_ids_json='[]', " +
      "next_group_index=0, current_group_offset=0 WHERE id=1 AND run_token=?").bind(token)
  ]);
  return { complete: true, source_timestamp: sourceTimestamp, completed_at: commitAt };
}

async function processOneGroup(db, token, dailyWriteBudget = DEFAULT_IMPORT_WRITE_BUDGET) {
  const progress = await db.prepare("SELECT run_token, source_timestamp, group_ids_json, next_group_index, " +
    "current_group_offset, sync_day, rows_written_today FROM tcgcsv_sync_progress WHERE id=1").first();
  if (!progress || progress.run_token !== token) return { ignored: true, reason: 'run_token_mismatch' };
  const state = await db.prepare('SELECT status FROM tcgcsv_sync_state WHERE id=1').first();
  if (state?.status !== 'syncing') return { ignored: true, reason: 'sync_not_active' };
  const groupIds = JSON.parse(progress.group_ids_json || '[]');
  const index = Number(progress.next_group_index || 0);
  if (index >= groupIds.length) return publishCatalog(db, token);

  const today = new Date().toISOString().slice(0, 10);
  let rowsWrittenToday = progress.sync_day === today ? Number(progress.rows_written_today || 0) : 0;
  let offset = Number(progress.current_group_offset || 0);
  if (progress.sync_day !== today) {
    await db.prepare("UPDATE tcgcsv_sync_progress SET sync_day=?, rows_written_today=0 WHERE id=1 AND run_token=?")
      .bind(today, token).run();
  }
  if (rowsWrittenToday >= dailyWriteBudget) {
    return { paused_for_daily_write_budget: true, rows_written_today: rowsWrittenToday, resumes_after_utc_midnight: true };
  }

  try {
    const groupId = Number(groupIds[index]);
    console.log('Processing compact TCGCSV group', index + 1, 'of', groupIds.length, 'groupId', groupId);
    const group = await db.prepare('SELECT group_id, category_id FROM tcgcsv_groups WHERE group_id=?').bind(groupId).first();
    if (!group) throw new Error('Production group row not found: ' + groupId);
    const categoryId = Number(group.category_id || POKEMON_CATEGORY_ID);
    const productsPayload = await getJson(SOURCE + '/' + categoryId + '/' + groupId + '/products');
    if (productsPayload?.success === false || !Array.isArray(productsPayload?.results)) throw new Error('Invalid products response for group ' + groupId + '.');
    const pricePayload = await getJson(SOURCE + '/' + categoryId + '/' + groupId + '/prices');
    if (pricePayload?.success === false || !Array.isArray(pricePayload?.results)) throw new Error('Invalid prices response for group ' + groupId + '.');

    const pricesByProduct = new Map();
    for (const price of pricePayload.results) {
      const key = String(price.productId);
      if (!pricesByProduct.has(key)) pricesByProduct.set(key, []);
      pricesByProduct.get(key).push(price);
    }
    const productStatements = productsPayload.results.map(product => {
      const ext = Array.isArray(product.extendedData) ? product.extendedData : [];
      const variants = (pricesByProduct.get(String(product.productId)) || []).slice();
      const hasPrice = value => value !== null && value !== undefined && value !== '' &&
        Number.isFinite(Number(value)) && Number(value) >= 0;
      const rank = value => {
        const type = String(value || '').trim().toLowerCase();
        if (type === 'normal') return 0;
        if (type === 'holofoil') return 1;
        if (type === 'reverse holofoil') return 2;
        return 3;
      };
      variants.sort((a, b) => {
        if (hasPrice(a.marketPrice) !== hasPrice(b.marketPrice)) return hasPrice(a.marketPrice) ? -1 : 1;
        return rank(a.subTypeName) - rank(b.subTypeName);
      });
      const preferred = variants[0] || null;
      const marketPrice = hasPrice(preferred?.marketPrice) ? Number(preferred.marketPrice) : null;
      const marketSubtype = marketPrice === null ? null : String(preferred?.subTypeName || 'Normal');
      return db.prepare("INSERT INTO tcgcsv_products(" +
        "product_id, category_id, group_id, name, clean_name, image_url, product_url, product_type, " +
        "card_number, rarity, extended_data_json, last_seen_sync, market_price, market_price_subtype" +
        ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(product_id) DO UPDATE SET last_seen_sync=excluded.last_seen_sync, " +
        "market_price=excluded.market_price, market_price_subtype=excluded.market_price_subtype"
      ).bind(
        Number(product.productId), Number(product.categoryId || categoryId), Number(product.groupId || groupId),
        String(product.name || 'Unknown product'), product.cleanName || null, product.imageUrl || null,
        product.url || null, productType(product), extendedValue(ext, 'Number', 'Card Number') || null,
        extendedValue(ext, 'Rarity') || null, safeJson(ext), progress.source_timestamp, marketPrice, marketSubtype
      );
    });

    while (offset < productStatements.length) {
      if (rowsWrittenToday >= dailyWriteBudget) {
        await db.prepare("UPDATE tcgcsv_sync_progress SET current_group_offset=?, rows_written_today=?, sync_day=? WHERE id=1 AND run_token=?")
          .bind(offset, rowsWrittenToday, today, token).run();
        return { paused_for_daily_write_budget: true, rows_written_today: rowsWrittenToday,
          current_group: groupId, products_in_group: productStatements.length,
          products_processed_in_group: offset, resumes_after_utc_midnight: true };
      }
      const batchStatements = productStatements.slice(offset, offset + 40);
      const result = await db.batch(batchStatements);
      let measuredWrites = 0, hasWriteMeta = false;
      for (const item of (result || [])) {
        if (Number.isFinite(Number(item?.meta?.rows_written))) {
          measuredWrites += Number(item.meta.rows_written);
          hasWriteMeta = true;
        }
      }
      if (!hasWriteMeta) measuredWrites = batchStatements.length * 5;
      offset += batchStatements.length;
      rowsWrittenToday += measuredWrites + 2;
      await db.prepare("UPDATE tcgcsv_sync_progress SET current_group_offset=?, rows_written_today=?, sync_day=? WHERE id=1 AND run_token=?")
        .bind(offset, rowsWrittenToday, today, token).run();
      if (rowsWrittenToday >= dailyWriteBudget && offset < productStatements.length) {
        return { paused_for_daily_write_budget: true, rows_written_today: rowsWrittenToday,
          current_group: groupId, products_in_group: productStatements.length,
          products_processed_in_group: offset, resumes_after_utc_midnight: true };
      }
    }

    const nextIndex = index + 1;
    await db.prepare('UPDATE tcgcsv_sync_progress SET next_group_index=?, current_group_offset=0 WHERE id=1 AND run_token=?')
      .bind(nextIndex, token).run();
    if (nextIndex >= groupIds.length) {
      await publishCatalog(db, token);
      return { complete: true, groups_processed: nextIndex, groups_total: groupIds.length,
        products_imported: productsPayload.results.length, write_mode: 'single_market_price_per_product' };
    }
    return { processed_group: groupId, groups_processed: nextIndex, groups_total: groupIds.length,
      products_imported: productsPayload.results.length, rows_written_today: rowsWrittenToday, continuing: true };
  } catch (error) {
    await setError(db, error);
    throw error;
  }
}

export default {
  async scheduled(event, env, ctx) {
    const cron = String(event?.cron || '');
    const scheduledTime = Number(event?.scheduledTime);
    const scheduledAt = Number.isFinite(scheduledTime) && scheduledTime > 0
      ? new Date(scheduledTime) : new Date();
    const easternHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23'
    }).format(scheduledAt));
    // Cloudflare Cron uses UTC. Two daily cron entries cover EST/EDT;
    // only the invocation that lands at 5 PM Eastern checks the source marker.
    const isDailyCheckCron = cron === '0 21 * * *' || cron === '0 22 * * *';
    const isDailySourceCheck = isDailyCheckCron && easternHour === 17;
    console.log('TCGCSV scheduled trigger fired', { cron, isDailySourceCheck, easternHour });

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
      } catch { groupCount = 0; }
      const nextIndex = Number(progress?.next_group_index || 0);
      const hasSavedCatalogRun = Boolean(progress?.run_token && progress?.source_timestamp && groupCount > 0);
      const needsCatalogResume = hasSavedCatalogRun && (
        nextIndex < groupCount ||
        (nextIndex >= groupCount && ['syncing', 'error'].includes(String(state?.status || '')))
      );
      if (needsCatalogResume) {
        if (state?.status !== 'syncing') {
          console.log('Resuming saved TCGCSV catalog import; previous status:', state?.status);
          await env.DB.prepare("UPDATE tcgcsv_sync_state SET status='syncing', last_error=NULL WHERE id=1").run();
        }
        console.log('Processing saved TCGCSV catalog batch', Math.min(nextIndex + 1, groupCount), 'of', groupCount);
        await processOneGroup(env.DB, progress.run_token, importWriteBudget(env)).catch(error => {
          console.error('TCGCSV catalog batch failed:', error);
          return setError(env.DB, error);
        });
        return;
      }

      await ensurePriceProgressTable(env.DB);
      const priceProgress = await env.DB.prepare(
        'SELECT run_token, source_timestamp, group_ids_json, next_group_index, current_group_offset FROM tcgcsv_price_sync_progress WHERE id=1'
      ).first().catch(() => null);
      let priceGroupCount = 0;
      try {
        const ids = JSON.parse(priceProgress?.group_ids_json || '[]');
        if (Array.isArray(ids)) priceGroupCount = ids.length;
      } catch { priceGroupCount = 0; }
      const priceNextIndex = Number(priceProgress?.next_group_index || 0);
      const hasSavedPriceRun = Boolean(priceProgress?.run_token && priceProgress?.source_timestamp && priceGroupCount > 0);
      const needsPriceResume = hasSavedPriceRun && (
        priceNextIndex < priceGroupCount ||
        (priceNextIndex >= priceGroupCount && ['syncing', 'error'].includes(String(state?.status || '')))
      );
      if (needsPriceResume) {
        if (state?.status !== 'syncing') {
          console.log('Resuming saved TCGCSV price refresh; previous status:', state?.status);
          await env.DB.prepare("UPDATE tcgcsv_sync_state SET status='syncing', last_error=NULL WHERE id=1").run();
        }
        console.log('Processing saved TCGCSV price group', Math.min(priceNextIndex + 1, priceGroupCount), 'of', priceGroupCount);
        await processOnePriceGroup(env.DB, priceProgress.run_token, importWriteBudget(env)).catch(error => {
          console.error('TCGCSV price refresh failed:', error);
          return setError(env.DB, error);
        });
        return;
      }

      if (!isDailySourceCheck) {
        console.log('No active TCGCSV import; skipping source check until the daily trigger.');
        return;
      }
      console.log('Daily TCGCSV source check; starting a price-only refresh with historical snapshots if the source changed.');
      await beginPriceSync(env.DB).catch(error => {
        console.error('TCGCSV scheduled price refresh failed:', error);
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
        'SELECT source_timestamp, next_group_index, group_ids_json, current_group_offset, sync_day, rows_written_today ' +
        'FROM tcgcsv_sync_progress WHERE id=1'
      ).first().catch(() => null);
      let progressInfo = null;
      if (progress) {
        let total = null;
        try { total = JSON.parse(progress.group_ids_json || '[]').length; } catch {}
        progressInfo = {
          source_timestamp: progress.source_timestamp,
          groups_processed: Number(progress.next_group_index || 0),
          groups_total: total,
          products_processed_in_current_group: Number(progress.current_group_offset || 0),
          sync_day_utc: progress.sync_day || null,
          importer_rows_written_today: Number(progress.rows_written_today || 0),
          importer_daily_write_budget: importWriteBudget(env)
        };
      }
      await ensurePriceProgressTable(env.DB);
      const priceProgress = await env.DB.prepare(
        'SELECT source_timestamp, next_group_index, group_ids_json, current_group_offset, sync_day, rows_written_today FROM tcgcsv_price_sync_progress WHERE id=1'
      ).first().catch(() => null);
      let priceProgressInfo = null;
      if (priceProgress) {
        let total = null;
        try { total = JSON.parse(priceProgress.group_ids_json || '[]').length; } catch {}
        priceProgressInfo = {
          source_timestamp: priceProgress.source_timestamp,
          groups_processed: Number(priceProgress.next_group_index || 0),
          groups_total: total,
          products_processed_in_current_group: Number(priceProgress.current_group_offset || 0),
          sync_day_utc: priceProgress.sync_day || null,
          rows_updated_today: Number(priceProgress.rows_written_today || 0),
          daily_write_budget: importWriteBudget(env)
        };
      }
      return json({ ok: true, service: 'PokePrizePool TCGCSV sync', state: state || null, progress: progressInfo, price_progress: priceProgressInfo });
    }

    if ((url.pathname === '/sync' || url.pathname === '/catalog-sync') && request.method === 'POST') {
      const expected = env.SYNC_SECRET;
      const auth = request.headers.get('Authorization') || '';
      if (!expected || auth !== 'Bearer ' + expected) return json({ ok: false, error: 'unauthorized' }, 401);
      if (!env.DB) return json({ ok: false, error: 'database_not_configured' }, 500);
      try {
        const result = url.pathname === '/catalog-sync' ? await beginSync(env.DB) : await beginPriceSync(env.DB);
        return json({ ok: true, result, note: result.skipped ? 'No sync was needed.' : (result.mode === 'price_only' ? 'Price-only refresh is running in resumable per-group batches. Check /health for progress.' : 'Catalog import is running in resumable per-group batches. Check /health for progress.') }, result.skipped ? 200 : 202);
      } catch (error) {
        console.error('TCGCSV sync start failed:', error);
        return json({ ok: false, error: 'sync_start_failed', message: String(error?.message || error).slice(0, 500) }, 500);
      }
    }

    return json({ ok: false, error: 'not_found' }, 404);
  }
};
