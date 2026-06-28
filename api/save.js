import { sql, ensure, requireAuth, readJson, upsertItem } from '../lib/db.js';

// One consolidated write endpoint (keeps us well under Vercel's function cap).
// action: upsert | upsertMany | delete | plogo | settings | clear
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  await ensure();
  const b = await readJson(req);
  try {
    switch (b.action) {
      case 'upsert':
        await upsertItem(b.item);
        return res.status(200).json({ ok: true });
      case 'upsertMany':
        for (const i of (b.items || [])) await upsertItem(i);
        return res.status(200).json({ ok: true, n: (b.items || []).length });
      case 'delete':
        await sql`DELETE FROM backorders WHERE id = ${b.id}`;
        return res.status(200).json({ ok: true });
      case 'plogo':
        if (b.logo)
          await sql`INSERT INTO bo_plogos (product, logo) VALUES (${b.product}, ${b.logo})
                    ON CONFLICT (product) DO UPDATE SET logo = ${b.logo}`;
        else
          await sql`DELETE FROM bo_plogos WHERE product = ${b.product}`;
        return res.status(200).json({ ok: true });
      case 'settings':
        await sql`INSERT INTO bo_settings (id, data) VALUES (1, ${JSON.stringify(b.settings || {})}::jsonb)
                  ON CONFLICT (id) DO UPDATE SET data = ${JSON.stringify(b.settings || {})}::jsonb`;
        return res.status(200).json({ ok: true });
      case 'clear':
        await sql`DELETE FROM backorders`;
        return res.status(200).json({ ok: true });
      default:
        return res.status(400).json({ error: 'unknown action' });
    }
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
