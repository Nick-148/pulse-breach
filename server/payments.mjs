// PaymentProvider interface + Stripe Checkout (ADR 0011). No SDK: Stripe's REST API via fetch, webhook
// signatures verified with Web Crypto. Fulfilment happens only from a verified webhook (or the dev-only
// simulated provider), never from a client redirect.
import { PRODUCTS, productBySku, itemById, SKU_RE, formatPrice } from '../shared/catalog.mjs';
import { HttpError, json, readJson } from './http.mjs';
import { hmacVerifyHex, randomHex } from './crypto.mjs';
import { exec, first, grant, stmt } from './db.mjs';

const STRIPE_API = 'https://api.stripe.com/v1';
const SIGNATURE_TOLERANCE_S = 300;
const DAY_MS = 86_400_000;

function form(params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.append(k, String(v));
  return body;
}

/** Parses `Stripe-Signature: t=...,v1=...,v1=...` and verifies any v1 against HMAC(secret, `${t}.${payload}`). */
export async function verifyStripeSignature(payload, header, secret, nowMs) {
  if (typeof header !== 'string' || !secret) return false;
  let t = null;
  const sigs = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k === 't' && /^\d{1,12}$/.test(v || '')) t = Number(v);
    else if (k === 'v1' && v) sigs.push(v);
  }
  if (t === null || !sigs.length) return false;
  if (Math.abs(nowMs / 1000 - t) > SIGNATURE_TOLERANCE_S) return false;
  for (const sig of sigs) {
    if (await hmacVerifyHex(secret, `${t}.${payload}`, sig)) return true;
  }
  return false;
}

export function stripeProvider(env) {
  return {
    id: 'stripe',
    enabled: true,
    async createCheckout({ product, playerId, orderId, siteUrl }) {
      const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': orderId,
        },
        body: form({
          mode: 'payment',
          'line_items[0][quantity]': 1,
          'line_items[0][price_data][currency]': product.currency,
          'line_items[0][price_data][unit_amount]': product.amountCents,
          'line_items[0][price_data][product_data][name]': product.name,
          'line_items[0][price_data][product_data][description]': product.detail,
          client_reference_id: playerId,
          'metadata[sku]': product.sku,
          'metadata[player]': playerId,
          'metadata[order]': orderId,
          success_url: `${siteUrl}/store/?checkout=success`,
          cancel_url: `${siteUrl}/store/?checkout=cancelled`,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data.id !== 'string' || typeof data.url !== 'string') throw new HttpError(502, 'payment-provider-error');
      if (!data.url.startsWith('https://checkout.stripe.com/')) throw new HttpError(502, 'payment-provider-error');
      return { sessionId: data.id, url: data.url };
    },
    /** → {type, sessionId, playerId, sku, paid, eventId} or null when the signature is invalid. */
    async parseWebhook(request, nowMs) {
      const payload = await request.text();
      if (payload.length > 256 * 1024) return null;
      const ok = await verifyStripeSignature(payload, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET, nowMs);
      if (!ok) return null;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        return null;
      }
      const obj = event?.data?.object || {};
      return {
        eventId: String(event.id || ''),
        type: String(event.type || ''),
        sessionId: String(obj.id || ''),
        orderId: String(obj.metadata?.order || ''),
        playerId: String(obj.metadata?.player || obj.client_reference_id || ''),
        sku: String(obj.metadata?.sku || ''),
        paid: obj.payment_status === 'paid',
      };
    },
  };
}

/** Selects the provider at runtime, like the AdManager adapters: real when configured, otherwise inert. */
export function paymentProvider(env) {
  if (env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) return stripeProvider(env);
  if (env.DEV === '1' && env.PAYMENTS_SIMULATED === '1') return { id: 'simulated', enabled: true };
  return { id: 'disabled', enabled: false };
}

/** Applies a product's grants exactly once per order (purchases row + ledger refs make retries no-ops). */
export async function fulfil(db, { orderId, playerId, sku, now }) {
  const product = productBySku(sku);
  if (!product) return false;
  const player = await first(db, 'SELECT id, vip_until FROM players WHERE id = ?', playerId);
  if (!player) return false;
  const claim = await stmt(
    db,
    "UPDATE purchases SET status = 'fulfilled', fulfilled_at = ? WHERE id = ? AND player_id = ? AND sku = ? AND status = 'pending' RETURNING id",
    now, orderId, playerId, sku,
  ).all();
  if (!claim.results || !claim.results.length) return false; // unknown order or already fulfilled
  const day = new Date(now).toISOString().slice(0, 10);
  const g = product.grants;
  const statements = [];
  if (g.credits) statements.push(grant(db, { playerId, currency: 'credits', amount: g.credits, reason: 'purchase', ref: `${orderId}:credits`, day, now }));
  if (g.gems) statements.push(grant(db, { playerId, currency: 'gems', amount: g.gems, reason: 'purchase', ref: `${orderId}:gems`, day, now }));
  for (const itemId of g.items || []) {
    if (itemById(itemId)) statements.push(stmt(db, "INSERT OR IGNORE INTO inventory (player_id, item_id, source, acquired_at) VALUES (?, ?, 'purchase', ?)", playerId, itemId, now));
  }
  if (g.vipDays) {
    // Extends from the later of now and the current expiry, so stacking passes never loses days.
    statements.push(stmt(db, 'UPDATE players SET vip_until = MAX(vip_until, ?) + ? WHERE id = ?', now, g.vipDays * DAY_MS, playerId));
  }
  if (statements.length) await db.batch(statements);
  return true;
}

/** GET /api/store/catalog */
export async function catalog(ctx) {
  const provider = paymentProvider(ctx.env);
  return json({
    payments: { provider: provider.id, enabled: provider.enabled },
    products: PRODUCTS.map((p) => ({ sku: p.sku, name: p.name, detail: p.detail, price: formatPrice(p.amountCents, p.currency) })),
  });
}

/** POST /api/store/checkout {sku} → {url} to redirect to (or {fulfilled} with the simulated provider). */
export async function checkout(ctx) {
  const player = await ctx.requirePlayer();
  const body = await readJson(ctx.request, 512);
  const product = typeof body.sku === 'string' && SKU_RE.test(body.sku) ? productBySku(body.sku) : null;
  if (!product) throw new HttpError(404, 'unknown-product');
  const provider = paymentProvider(ctx.env);
  if (!provider.enabled) throw new HttpError(503, 'payments-not-configured');
  await ctx.limit(`checkout:${player.id}`, 10, 3600_000);
  const orderId = `ord_${randomHex(16)}`;
  if (provider.id === 'simulated') {
    await exec(ctx.db, "INSERT INTO purchases (id, player_id, sku, provider, status, created_at) VALUES (?, ?, ?, 'simulated', 'pending', ?)", orderId, player.id, product.sku, ctx.now);
    await fulfil(ctx.db, { orderId, playerId: player.id, sku: product.sku, now: ctx.now });
    return json({ fulfilled: true, orderId });
  }
  const siteUrl = (ctx.env.SITE_URL || ctx.url.origin).replace(/\/+$/, '');
  // The order row exists before Stripe does anything, so a paid webhook can never find an unknown order.
  await exec(ctx.db, "INSERT INTO purchases (id, player_id, sku, provider, status, created_at) VALUES (?, ?, ?, 'stripe', 'pending', ?)", orderId, player.id, product.sku, ctx.now);
  const session = await provider.createCheckout({ product, playerId: player.id, orderId, siteUrl });
  await exec(ctx.db, 'UPDATE purchases SET provider_ref = ? WHERE id = ?', session.sessionId, orderId);
  return json({ url: session.url });
}

/** POST /api/store/webhook (Stripe → us). Authenticated by signature, not by cookie/origin. */
export async function webhook(ctx) {
  const provider = paymentProvider(ctx.env);
  if (provider.id !== 'stripe') throw new HttpError(404, 'not-found');
  const evt = await provider.parseWebhook(ctx.request, ctx.now);
  if (!evt) throw new HttpError(400, 'bad-signature');
  const paidEvent = evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded';
  let fulfilled = false;
  if (paidEvent && evt.paid) {
    // fulfil() is idempotent, so Stripe retries are safe. If it throws we return 500 and Stripe retries later.
    fulfilled = await fulfil(ctx.db, { orderId: evt.orderId, playerId: evt.playerId, sku: evt.sku, now: ctx.now });
  }
  if (evt.eventId) await exec(ctx.db, 'INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)', evt.eventId, ctx.now);
  return json({ received: true, fulfilled });
}
