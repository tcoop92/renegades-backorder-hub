import { sql, ensure, requireAuth } from '../lib/db.js';

// Pull orders flagged as back orders (note contains "b/o") from the Renegades
// Sportswear store, with each customer's contact info, and insert any new line
// items (dedup by Shopify order+line id). Mirrors cc-hub's auth flow.
//
// New Shopify "Dev Dashboard" apps give a Client ID + Secret which we exchange
// for a short-lived token (client_credentials).
// Env vars: SHOPIFY_STORE (e.g. renegades-sportswear.myshopify.com),
//           SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET.
const API_VERSION = '2025-01';
const SIZE = /\b(youth|adult|toddler|infant|yxs|ys|ym|yl|yxl|xs|xxs|small|medium|large|x-?large|xl|2xl|3xl|one size)\b/i;
const BO = /b\s*\/\s*o|back\s*order/i;

function splitVariant(vt) {
  if (!vt || /^default title$/i.test(vt)) return { size: '', color: '' };
  const parts = vt.split('/').map(s => s.trim()).filter(Boolean);
  let size = '', color = '';
  for (const p of parts) { if (SIZE.test(p) && !size) size = p; else color = p; }
  if (!size && parts.length) size = parts[0];
  return { size, color };
}
function channelFromNote(note) {
  const n = (note || '').toLowerCase();
  const sms = /\b(text|sms|txt)\b/.test(n), email = /\bemail\b/.test(n), call = /\b(call|phone)\b/.test(n);
  if (sms && email) return 'both';
  if (sms) return 'sms';
  if (email) return 'email';
  if (call) return 'call';
  return '';
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  await ensure();
  const storeRaw = process.env.SHOPIFY_STORE;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const staticToken = process.env.SHOPIFY_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN;
  if (!storeRaw || (!staticToken && (!clientId || !clientSecret)))
    return res.status(500).json({ error: 'not configured', detail: 'Add SHOPIFY_STORE plus either SHOPIFY_TOKEN (in-admin custom app) or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET in Vercel, then redeploy.' });
  const store = storeRaw.includes('.') ? storeRaw : storeRaw + '.myshopify.com';

  // 1. get an access token. Prefer a static Admin API token (simplest — from an
  //    in-admin "Develop apps" custom app). Otherwise exchange client id/secret.
  let token = staticToken;
  if (!token) {
    try {
      const tr = await fetch(`https://${store}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
      });
      const raw = await tr.text();
      let td = {}; try { td = JSON.parse(raw); } catch { /* non-JSON */ }
      if (!tr.ok || !td.access_token)
        return res.status(502).json({ error: 'auth failed', detail: 'Token exchange HTTP ' + tr.status + ' — ' + (raw || '(empty)').slice(0, 300) + ' — make sure the app is INSTALLED and read_orders + read_customers scopes are released.' });
      token = td.access_token;
    } catch (e) { return res.status(502).json({ error: 'auth error', detail: String((e && e.message) || e) }); }
  }

  // 2. pull recent orders (we filter to back orders by note below)
  let data;
  try {
    const r = await fetch(`https://${store}/admin/api/${API_VERSION}/orders.json?status=any&limit=250`,
      { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } });
    if (!r.ok) { const t = await r.text().catch(() => ''); return res.status(502).json({ error: 'shopify error', detail: 'HTTP ' + r.status + ' ' + t.slice(0, 200) }); }
    data = await r.json();
  } catch (e) { return res.status(502).json({ error: 'shopify fetch failed', detail: String((e && e.message) || e) }); }

  // 3. keep only orders whose note flags a back order, insert new line items
  const orders = (data.orders || []).filter(o => BO.test(o.note || ''));
  let added = 0, skipped = 0;
  for (const o of orders) {
    const ordn = (o.name || ('#' + o.order_number)).replace('#', '');
    const c = o.customer;
    const customer = (c && ((c.first_name || '') + ' ' + (c.last_name || '')).trim()) || '';
    const phoneRaw = (c && c.phone) || o.phone || (o.shipping_address && o.shipping_address.phone) || '';
    const phone = phoneRaw.replace(/[^\d]/g, '');
    const email = (c && c.email) || o.email || '';
    const pref = channelFromNote(o.note);
    const added_at = (o.created_at || '').slice(0, 10);
    for (const li of (o.line_items || [])) {
      if (li.quantity <= 0) continue;
      const { size, color } = splitVariant(li.variant_title);
      const id = 'SH-' + o.id + '-' + li.id;
      const ins = await sql`INSERT INTO backorders
        (id, ordn, customer, email, phone, pref, fulfill, product, part_no, color, size, qty, status, logo, po, notes, added_at, notify_log, source)
        VALUES (${id}, ${ordn}, ${customer}, ${email}, ${phone}, ${pref}, 'pickup',
          ${li.title}, ${li.sku || ''}, ${color}, ${size}, ${li.quantity}, 'new', '', '', ${o.note || ''}, ${added_at}, '[]'::jsonb, 'shopify')
        ON CONFLICT (id) DO NOTHING RETURNING id`;
      if (ins.length) added++; else skipped++;
    }
  }
  res.status(200).json({ ok: true, added, skipped, orders: orders.length });
}
