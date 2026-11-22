// The only source of prices (ADR 0011). Clients send an id/SKU; the server looks the price up here.
import { deepFreeze } from './util.mjs';

/** Cross-game cosmetics bought with Arcade Credits or Gems. Games read `colors` for the equipped trail. */
export const ITEMS = deepFreeze([
  { id: 'trail-aurora', kind: 'trail', name: 'Aurora Trail', price: { currency: 'credits', amount: 800 },
    colors: { primary: '#7dffb2', secondary: '#29f3ff', trail: '#b6ffd9' } },
  { id: 'trail-ember', kind: 'trail', name: 'Ember Trail', price: { currency: 'credits', amount: 800 },
    colors: { primary: '#ff8a3d', secondary: '#ffd23f', trail: '#ffb36b' } },
  { id: 'trail-void', kind: 'trail', name: 'Void Trail', price: { currency: 'credits', amount: 2000 },
    colors: { primary: '#b388ff', secondary: '#3d5afe', trail: '#d1b8ff' } },
  { id: 'trail-prism', kind: 'trail', name: 'Prism Trail', price: { currency: 'gems', amount: 120 },
    colors: { primary: '#f4f7ff', secondary: '#ff2bd6', trail: '#ffffff' } },
  { id: 'trail-founder', kind: 'trail', name: 'Founder Gold Trail', price: null,
    colors: { primary: '#ffd54a', secondary: '#ff7a1a', trail: '#ffe9a3' } },
  { id: 'badge-founder', kind: 'badge', name: 'Founder Badge', price: null },
]);

/** Real-money products (Stripe Checkout). `grants` is applied by the webhook only. */
export const PRODUCTS = deepFreeze([
  { sku: 'vip_30d', name: 'Ad-Free + 2x Daily Streak Pass', detail: '30 days: no ads, rewarded bonuses granted instantly, double daily streak credits.',
    amountCents: 299, currency: 'usd', grants: { vipDays: 30 } },
  { sku: 'founder_bundle', name: 'Founder Cosmetic Bundle', detail: 'Founder Gold Trail, Founder Badge and 200 Gems.',
    amountCents: 499, currency: 'usd', grants: { items: ['trail-founder', 'badge-founder'], gems: 200 } },
  { sku: 'credits_1k', name: '1,000 Arcade Credits', detail: 'Spend on trails in any game.',
    amountCents: 99, currency: 'usd', grants: { credits: 1000 } },
  { sku: 'gems_120', name: '120 Gems', detail: 'Premium currency for Prism-tier cosmetics.',
    amountCents: 99, currency: 'usd', grants: { gems: 120 } },
  { sku: 'gems_700', name: '700 Gems', detail: 'Best value gem pack.',
    amountCents: 499, currency: 'usd', grants: { gems: 700 } },
]);

export const itemById = (id) => ITEMS.find((i) => i.id === id) || null;
export const productBySku = (sku) => PRODUCTS.find((p) => p.sku === sku) || null;
export const ITEM_ID_RE = /^[a-z0-9-]{1,40}$/;
export const SKU_RE = /^[a-z0-9_]{1,40}$/;

export function formatPrice(cents, currency = 'usd') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}
