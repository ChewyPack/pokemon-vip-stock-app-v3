const VENDOR_TIER = 'vendor';

export async function ensureVendorEventSalesVerificationSchema(env) {
  if (!env.DB) throw new Error('database_not_configured');
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS vendor_event_sales_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      id_front_key TEXT,
      id_front_type TEXT,
      id_back_key TEXT,
      id_back_type TEXT,
      selfie_key TEXT,
      selfie_type TEXT,
      review_note TEXT NOT NULL DEFAULT '',
      submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      reviewed_by_account_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_vendor_event_sales_verifications_status ON vendor_event_sales_verifications(status,submitted_at DESC)').run();
}

export async function getVendorEventSalesPermission(env, accountId) {
  await ensureVendorEventSalesVerificationSchema(env);
  const id = Number(accountId || 0);
  if (!Number.isSafeInteger(id) || id < 1) {
    return { is_vendor_plus: false, verification_status: 'not_submitted', can_sell: false, reason: 'login_required', review_note: '' };
  }
  const account = await env.DB.prepare(
    'SELECT id,is_admin,membership_status,membership_tier,membership_entitlement_tier FROM accounts WHERE id=? LIMIT 1'
  ).bind(id).first();
  const tier = String(account?.membership_entitlement_tier || '').toLowerCase();
  const billingTier = String(account?.membership_tier || '').toLowerCase();
  const isAdmin = !!account && Number(account.is_admin || 0) === 1;
  const isVendorPlus = !!account &&
    String(account.membership_status || '').toLowerCase() === 'active' &&
    (tier === VENDOR_TIER || billingTier === VENDOR_TIER);
  const verification = await env.DB.prepare(
    'SELECT status,review_note,submitted_at,reviewed_at FROM vendor_event_sales_verifications WHERE account_id=? LIMIT 1'
  ).bind(id).first();
  const status = String(verification?.status || 'not_submitted');
  const canSell = isAdmin || (isVendorPlus && status === 'approved');
  let reason = '';
  if (isAdmin) reason = '';
  else if (!isVendorPlus) reason = 'vendor_plus_required';
  else if (status === 'not_submitted') reason = 'verification_required';
  else if (status === 'pending') reason = 'verification_pending';
  else if (status === 'rejected') reason = 'verification_rejected';
  return {
    is_vendor_plus: isVendorPlus,
    verification_status: status,
    can_sell: canSell,
    reason: canSell ? '' : reason,
    review_note: String(verification?.review_note || ''),
    submitted_at: verification?.submitted_at || null,
    reviewed_at: verification?.reviewed_at || null
  };
}
