import { json, wrap, requireAdmin, HttpError } from '../../../_lib/store.js';

const API = 'https://api.printify.com/v1/';
async function printify(env, path) {
  const token = String(env.PRINTIFY_API_TOKEN || '').trim();
  if (!token) throw new HttpError(503, 'Printify API token is not configured for this environment');
  const response = await fetch(API + path, {
    headers: {
      Authorization: 'Bearer ' + token,
      'User-Agent': 'PokePrizePool Store Integration',
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    // Do not expose response bodies or credentials in the browser.
    console.error('Printify API request failed', response.status, path);
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, 'Printify rejected the token. Check that it is valid and has shops.read and products.read permissions.');
    }
    throw new HttpError(502, 'Printify could not complete the request. Please try again later.');
  }
  return response.json();
}

// Admin-only, read-only connection check.
// GET /api/store/admin/printify                 -> list shops
// GET /api/store/admin/printify?shop_id=123     -> preview products from that shop
export const onRequestGet = wrap(async (ctx) => {
  await requireAdmin(ctx);
  const { request, env } = ctx;
  const url = new URL(request.url);
  const shopId = (url.searchParams.get('shop_id') || '').trim();

  if (!env.PRINTIFY_API_TOKEN) {
    throw new HttpError(503, 'Printify API token is not configured for this environment');
  }

  if (!shopId) {
    const shops = await printify(env, 'shops.json');
    if (!Array.isArray(shops)) throw new HttpError(502, 'Unexpected response from Printify shops API');
    return json({
      connected: true,
      shops: shops.map((s) => ({
        id: String(s.id),
        title: String(s.title || 'Untitled shop').slice(0, 160),
        salesChannel: String(s.sales_channel || 'disconnected').slice(0, 80),
      })),
    });
  }

  if (!/^\d{1,20}$/.test(shopId)) throw new HttpError(400, 'Invalid shop ID');
  const page = Math.max(1, Math.min(1000, Number(url.searchParams.get('page') || 1) || 1));
  const result = await printify(env, `shops/${shopId}/products.json?page=${page}`);
  const products = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : null;
  if (!products) throw new HttpError(502, 'Unexpected response from Printify products API');
  return json({
    connected: true,
    shopId,
    page,
    currentPage: result.current_page || page,
    total: result.total || null,
    products: products.slice(0, 100).map((p) => ({
      id: String(p.id),
      title: String(p.title || 'Untitled product').slice(0, 200),
      description: String(p.description || '').slice(0, 3000),
      visible: !!p.visible,
      variants: Array.isArray(p.variants) ? p.variants.filter((v) => v.is_enabled).map((v) => ({
        id: Number(v.id),
        title: String(v.title || '').slice(0, 160),
        sku: String(v.sku || '').slice(0, 100),
        price: Number(v.price || 0),
        isAvailable: !!v.is_available,
      })) : [],
      images: Array.isArray(p.images) ? p.images.filter((i) => i && i.src).slice(0, 6).map((i) => String(i.src)) : [],
    })),
  });
});
