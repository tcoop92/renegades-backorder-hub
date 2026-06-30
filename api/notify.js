import { requireAuth, readJson } from '../lib/db.js';

// Send a back-order "ready" notification. Email via Resend (live);
// SMS via Twilio (added once 10DLC clears — returns "not configured" until then).
// Body: { order, channels:['email','sms'], email, phone, subject, message }
const FROM = process.env.NOTIFY_FROM || 'Renegades Sportswear <orders@renegadesfl.com>';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const b = await readJson(req);
  const channels = b.channels || [];
  const results = {};

  // ---- EMAIL (Resend) ----
  if (channels.includes('email')) {
    const key = process.env.RESEND_API_KEY;
    if (!b.email) results.email = { ok: false, error: 'no email address on file' };
    else if (!key) results.email = { ok: false, error: 'RESEND_API_KEY not set in Vercel' };
    else {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM,
            to: [b.email],
            subject: b.subject || 'Your order is ready',
            text: b.message || ''
          })
        });
        const d = await r.json().catch(() => ({}));
        results.email = r.ok ? { ok: true, id: d.id } : { ok: false, error: d.message || ('HTTP ' + r.status) };
      } catch (e) { results.email = { ok: false, error: String((e && e.message) || e) }; }
    }
  }

  // ---- SMS (Twilio) ----
  if (channels.includes('sms')) {
    const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
    if (!b.phone) results.sms = { ok: false, error: 'no phone number on file' };
    else if (!sid || !tok || !from) results.sms = { ok: false, error: 'Texting not set up yet (Twilio pending)' };
    else {
      try {
        const to = b.phone.replace(/[^\d]/g, '');
        const e164 = to.length === 10 ? '+1' + to : (to.startsWith('1') ? '+' + to : '+' + to);
        const body = new URLSearchParams({ To: e164, From: from, Body: b.message || '' });
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + tok).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
          body
        });
        const d = await r.json().catch(() => ({}));
        results.sms = r.ok ? { ok: true, id: d.sid } : { ok: false, error: d.message || ('HTTP ' + r.status) };
      } catch (e) { results.sms = { ok: false, error: String((e && e.message) || e) }; }
    }
  }

  const anyOk = Object.values(results).some(x => x.ok);
  res.status(anyOk ? 200 : 502).json({ ok: anyOk, results });
}
