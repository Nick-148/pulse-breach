// Store: cosmetics for credits/gems (server-priced) and optional real-money products via the
// PaymentProvider (Stripe Checkout when configured; "coming soon" otherwise). ADR 0011.
import { ITEMS } from '/shared/catalog.mjs';
import { fmtInt } from '/shared/util.mjs';
import { bootShell, openProfile, swatch } from './shell.mjs';
import { api, errorMessage } from './api.mjs';
import { $, h, replace, toast } from './dom.mjs';

const CURRENCY_ICON = { credits: '🪙', gems: '💎' };

function renderItems(p) {
  const grid = $('#item-grid');
  const owned = new Set(p.signedIn ? p.me.inventory : []);
  const equipped = p.signedIn ? p.me.player.equippedTrail : null;
  replace(grid, ITEMS.filter((i) => i.price && i.kind === 'trail').map((item) => {
    const have = owned.has(item.id);
    const btn = h('button', { class: `btn small ${have ? '' : 'primary'}`, type: 'button' });
    if (!p.signedIn) {
      btn.textContent = 'Sign in to buy';
      btn.addEventListener('click', () => openProfile(p));
    } else if (have) {
      const on = equipped === item.id;
      btn.textContent = on ? 'Equipped' : 'Equip';
      btn.disabled = on;
      btn.addEventListener('click', async () => {
        const r = await p.equip(item.id);
        toast(r.ok ? `${item.name} equipped in every game` : errorMessage(r.error));
      });
    } else {
      btn.textContent = `Buy ${CURRENCY_ICON[item.price.currency]} ${fmtInt(item.price.amount)}`;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const r = await p.spend(item.id, item.price.amount);
        toast(r.ok ? `${item.name} unlocked!` : errorMessage(r.reason));
        btn.disabled = false;
      });
    }
    return h('li', { class: 'card item' },
      swatch(item.colors),
      h('h3', { text: item.name }),
      h('p', { class: 'muted small', text: `${CURRENCY_ICON[item.price.currency]} ${fmtInt(item.price.amount)} ${item.price.currency}` }),
      btn);
  }));
}

async function renderProducts(p) {
  const grid = $('#product-grid');
  const status = $('#product-status');
  const r = await api('/api/store/catalog');
  if (!r.ok) {
    status.textContent = errorMessage(r.error);
    return;
  }
  const { payments, products } = r.data;
  status.textContent = payments.enabled
    ? payments.provider === 'simulated' ? 'Development mode: purchases are simulated and free.' : 'Secure checkout by Stripe. We never see your card.'
    : 'Purchases open soon. Everything in the arcade is free to play.';
  replace(grid, products.map((prod) => {
    const btn = h('button', { class: 'btn primary small', type: 'button', disabled: !payments.enabled, text: payments.enabled ? `Buy ${prod.price}` : 'Coming soon' });
    btn.addEventListener('click', async () => {
      if (!p.signedIn) { openProfile(p); return; }
      btn.disabled = true;
      const res = await api('/api/store/checkout', { method: 'POST', body: { sku: prod.sku } });
      btn.disabled = false;
      if (!res.ok) { toast(errorMessage(res.error)); return; }
      if (res.data.fulfilled) {
        await p.refreshMe();
        toast(`${prod.name}: unlocked!`);
        return;
      }
      if (typeof res.data.url === 'string' && res.data.url.startsWith('https://checkout.stripe.com/')) globalThis.location.assign(res.data.url);
      else toast(errorMessage('payment-provider-error'));
    });
    return h('li', { class: 'card product' }, h('h3', { text: prod.name }), h('p', { class: 'muted small', text: prod.detail }), h('p', { class: 'price', text: prod.price }), btn);
  }));
}

async function checkoutReturn(p) {
  const state = new URLSearchParams(globalThis.location.search).get('checkout');
  const note = $('#checkout-note');
  if (!note || !state) return;
  note.hidden = false;
  if (state === 'cancelled') {
    note.textContent = 'Checkout cancelled. Nothing was charged.';
    return;
  }
  note.textContent = 'Payment received. Unlocking your items…';
  // The webhook can land a moment after the redirect: poll briefly.
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    await p.refreshMe();
  }
  note.textContent = 'Thanks for supporting the arcade! Your items are in your profile.';
}

const platform = await bootShell();
renderItems(platform);
renderProducts(platform);
checkoutReturn(platform);
platform.subscribe(renderItems);
