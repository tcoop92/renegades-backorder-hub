# Renegades Back Order Hub

Internal tool to manage Renegades Sportswear back orders: pulls flagged orders from
Shopify, tracks them through ordering / embroidery / ready, and notifies the customer
when their order is in. Same stack as cc-hub (static `index.html` + Vercel serverless
`/api/*` + Neon Postgres + shared-password login).

## Going live — one-time setup

### 1. Shopify dev app (on the **Renegades Sportswear** store)
1. Shopify admin → **Settings → Apps and sales channels → Develop apps** → *Allow custom app development* (first time only).
2. **Create an app** → name it `Back Order Hub`.
3. **Configuration → Admin API access scopes** → enable: `read_orders`, `read_customers`.
4. **Install app**.
5. Open the app → **API credentials** → copy the **Client ID** and **Client secret**
   (this app type uses client-credentials, not a static token).
6. Note the store domain: `renegades-sportswear.myshopify.com` (or whatever the admin URL shows).

### 2. Repo + hosting (same as cc-hub)
1. Create a **GitHub repo** (e.g. `renegades-backorder-hub`) and upload everything in this folder
   (drag the whole folder in GitHub's *Add file → Upload files* — keeps `api/` and `lib/`).
2. **Vercel → Add New → Project → Import** the repo. Framework preset: **Other**. Deploy.
3. **Vercel → Storage → Create → Neon** (Postgres), connect it to the project.
   Set the **Custom env var prefix = `DATABASE`** so it injects `DATABASE_URL`.

### 3. Environment variables (Vercel → Project → Settings → Environment Variables)
| Name | Value |
|------|-------|
| `APP_PASSWORD` | the shared shop password staff will type to sign in |
| `SHOPIFY_STORE` | `renegades-sportswear.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | from the dev app |
| `SHOPIFY_CLIENT_SECRET` | from the dev app |

**After adding env vars or connecting Neon, you must REDEPLOY** (env changes don't apply to
the existing build). Test on the main production domain, not a per-deployment URL.

### 4. Verify
- Open the site → sign in with `APP_PASSWORD`.
- **Import tab → Sync from Shopify now** → flagged `b/o` orders appear on the board.

## How back orders get flagged
Put **`b/o`** in the Shopify order **note** (plus the contact preference, e.g. `b/o text`,
`b/o email`, `b/o call`). The sync pulls every order whose note contains `b/o`, with the
customer's name / phone / email from their profile, and reads the channel from the note.

## Later phases (not wired yet)
- **Email** notifications via Resend (verify a sending domain → add `RESEND_API_KEY`).
- **Text** notifications via Twilio (buy a number + A2P 10DLC registration → add `TWILIO_*`).
- Today the Notify button logs the notification and marks the order done; actual sending
  turns on when those keys are added.

## Files
- `index.html` — the whole app (vanilla JS, polls `/api/state` every 5s for live sync).
- `api/state.js` — returns all back orders + settings + product→logo memory.
- `api/save.js` — one write endpoint (upsert / delete / settings / plogo / clear).
- `api/shopify.js` — pulls `b/o` orders from Shopify.
- `api/login.js` — shared-password sign-in.
- `lib/db.js` — Neon connection, auth, schema (`ensure()` auto-migrates on each request).
