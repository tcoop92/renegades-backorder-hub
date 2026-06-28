import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

// Neon connection string is injected by the Vercel ↔ Neon integration.
const CONN = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED;
export const sql = neon(CONN);

// Shared shop password. SET THIS in Vercel → Project → Settings → Environment Variables (APP_PASSWORD).
const PW = process.env.APP_PASSWORD || 'changeme';
export const AUTH = crypto.createHash('sha256').update('bo::' + PW).digest('hex');

export function authed(req) {
  const c = req.headers.cookie || '';
  return c.split(';').some(p => p.trim() === 'bo_auth=' + AUTH);
}
export function requireAuth(req, res) {
  if (!authed(req)) { res.status(401).json({ error: 'auth' }); return false; }
  return true;
}
export async function readJson(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  let d = ''; for await (const c of req) d += c; return d ? JSON.parse(d) : {};
}

let ready = false;
export async function ensure() {
  if (ready) return;
  // one row per back-ordered line item. "ordn" = order number (ORDER is a SQL keyword).
  await sql`CREATE TABLE IF NOT EXISTS backorders (
    id text PRIMARY KEY,
    ordn text DEFAULT '',
    customer text DEFAULT '',
    email text DEFAULT '',
    phone text DEFAULT '',
    pref text DEFAULT '',
    fulfill text DEFAULT 'pickup',
    product text DEFAULT '',
    part_no text DEFAULT '',
    color text DEFAULT '',
    size text DEFAULT '',
    qty int DEFAULT 1,
    status text DEFAULT 'new',
    logo text DEFAULT '',
    po text DEFAULT '',
    notes text DEFAULT '',
    added_at text DEFAULT '',
    notify_log jsonb DEFAULT '[]'::jsonb,
    source text DEFAULT 'manual',
    created_at timestamptz DEFAULT now()
  )`;
  // product -> logo memory (the app learns which logo each product gets)
  await sql`CREATE TABLE IF NOT EXISTS bo_plogos (
    product text PRIMARY KEY,
    logo text DEFAULT ''
  )`;
  // single-row settings (shop name, message templates, etc.)
  await sql`CREATE TABLE IF NOT EXISTS bo_settings (
    id int PRIMARY KEY,
    data jsonb DEFAULT '{}'::jsonb
  )`;
  ready = true;
}

// map a DB row to the client item shape
export function rowToItem(r) {
  return {
    id: r.id, order: r.ordn, customer: r.customer, email: r.email, phone: r.phone,
    pref: r.pref, fulfill: r.fulfill, product: r.product, partNo: r.part_no,
    color: r.color, size: r.size, qty: r.qty, status: r.status, logo: r.logo,
    po: r.po, notes: r.notes, addedAt: r.added_at, notifyLog: r.notify_log || [], source: r.source
  };
}

export async function upsertItem(i) {
  await sql`INSERT INTO backorders
    (id, ordn, customer, email, phone, pref, fulfill, product, part_no, color, size, qty, status, logo, po, notes, added_at, notify_log, source)
    VALUES (${i.id}, ${i.order || ''}, ${i.customer || ''}, ${i.email || ''}, ${i.phone || ''}, ${i.pref || ''}, ${i.fulfill || 'pickup'},
      ${i.product || ''}, ${i.partNo || ''}, ${i.color || ''}, ${i.size || ''}, ${i.qty || 1}, ${i.status || 'new'}, ${i.logo || ''},
      ${i.po || ''}, ${i.notes || ''}, ${i.addedAt || ''}, ${JSON.stringify(i.notifyLog || [])}::jsonb, ${i.source || 'manual'})
    ON CONFLICT (id) DO UPDATE SET
      ordn=EXCLUDED.ordn, customer=EXCLUDED.customer, email=EXCLUDED.email, phone=EXCLUDED.phone, pref=EXCLUDED.pref,
      fulfill=EXCLUDED.fulfill, product=EXCLUDED.product, part_no=EXCLUDED.part_no, color=EXCLUDED.color, size=EXCLUDED.size,
      qty=EXCLUDED.qty, status=EXCLUDED.status, logo=EXCLUDED.logo, po=EXCLUDED.po, notes=EXCLUDED.notes,
      added_at=EXCLUDED.added_at, notify_log=EXCLUDED.notify_log, source=EXCLUDED.source`;
}
