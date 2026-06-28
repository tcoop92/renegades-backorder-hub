import { AUTH, readJson } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = await readJson(req);
  const PW = process.env.APP_PASSWORD || 'changeme';
  if ((body.password || '') !== PW) return res.status(401).json({ ok: false });
  res.setHeader('Set-Cookie',
    `bo_auth=${AUTH}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
  res.status(200).json({ ok: true });
}
