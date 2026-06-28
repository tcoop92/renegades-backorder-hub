import { sql, ensure, requireAuth, rowToItem } from '../lib/db.js';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  await ensure();
  const rows = await sql`SELECT * FROM backorders ORDER BY created_at`;
  const items = rows.map(rowToItem);
  const plRows = await sql`SELECT product, logo FROM bo_plogos`;
  const plogos = {};
  for (const r of plRows) plogos[r.product] = r.logo;
  const setRow = await sql`SELECT data FROM bo_settings WHERE id = 1`;
  const settings = setRow.length ? setRow[0].data : {};
  res.status(200).json({ items, plogos, settings });
}
