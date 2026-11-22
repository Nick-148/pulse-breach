// Host-side AdManager (ADR 0003 pattern, now owned by the portal): one interface, swappable providers.
// Simulated: a 5 s countdown dialog. SDK: Poki → CrazyGames → Google H5 adBreak → stub. VIP: instant grant,
// no banners. showRewarded() always resolves {granted, reason} and never rejects.
import { h, replace } from './dom.mjs';

const PLACEMENT_LABELS = {
  revive: 'Second chance revive',
  double_scrap: '2x run payout',
  scrap_topup: 'Bonus scrap',
  arcade_credits: '+25 Arcade Credits',
};
const SIMULATED_SECONDS = 5;
const SDK_TIMEOUT_MS = 45_000;

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ granted: false, reason: 'timeout' }), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v && typeof v.granted === 'boolean' ? v : { granted: false, reason: 'bad-result' }); },
      () => { clearTimeout(timer); resolve({ granted: false, reason: 'error' }); },
    );
  });
}

function runAdBreak(adBreakFn, placement) {
  return new Promise((resolve) => {
    let viewed = false;
    adBreakFn({
      type: 'reward',
      name: placement,
      beforeAd() {},
      afterAd() {},
      beforeReward(show) { show(); },
      adDismissed() {},
      adViewed() { viewed = true; },
      adBreakDone(info) { resolve({ granted: viewed, reason: info?.breakStatus || 'done' }); },
    });
  });
}

function sdkAdapters(stubAdBreak) {
  const w = globalThis;
  return [
    { id: 'poki', detect: () => typeof w.PokiSDK?.rewardedBreak === 'function', rewarded: async () => ({ granted: Boolean(await w.PokiSDK.rewardedBreak()), reason: 'poki' }) },
    {
      id: 'crazygames',
      detect: () => typeof w.CrazyGames?.SDK?.ad?.requestAd === 'function',
      rewarded: () => new Promise((resolve) => {
        w.CrazyGames.SDK.ad.requestAd('rewarded', {
          adStarted() {},
          adFinished: () => resolve({ granted: true, reason: 'crazygames' }),
          adError: (e) => resolve({ granted: false, reason: String(e?.code || 'error') }),
        });
      }),
    },
    { id: 'h5', detect: () => typeof w.adBreak === 'function', rewarded: (p) => runAdBreak(w.adBreak, p) },
    { id: 'stub', detect: () => true, rewarded: (p) => runAdBreak(stubAdBreak, p) },
  ];
}

export class HostAds {
  constructor({ platform, onBusy = () => {} }) {
    this.platform = platform;
    this.onBusy = onBusy;
    this.busy = false;
    const param = new URLSearchParams(globalThis.location.search).get('ads');
    this.mode = param === 'sdk' ? 'sdk' : 'simulated'; // SDK hooks are a dev/portal-build switch, not a player toggle
    this.adapters = sdkAdapters((opts) => this.stubAdBreak(opts));
  }

  get adFree() { return this.platform.vip; }

  async showRewarded(placement) {
    if (typeof placement !== 'string' || placement.length > 40) return { granted: false, reason: 'unknown-placement' };
    if (this.adFree) return { granted: true, reason: 'vip' };
    if (this.busy) return { granted: false, reason: 'busy' };
    this.busy = true;
    this.onBusy(true);
    try {
      if (this.mode === 'simulated') return await this.countdown(placement, SIMULATED_SECONDS, 'Sponsored · Simulated');
      const adapter = this.adapters.find((a) => a.detect());
      return await withTimeout(Promise.resolve().then(() => adapter.rewarded(placement)), SDK_TIMEOUT_MS);
    } catch {
      return { granted: false, reason: 'error' };
    } finally {
      this.busy = false;
      this.onBusy(false);
    }
  }

  stubAdBreak(opts) {
    opts.beforeReward(() => {
      this.countdown(opts.name, 2, 'SDK hooks · adBreak() stub').then((r) => {
        if (r.granted) opts.adViewed(); else opts.adDismissed();
        opts.adBreakDone({ breakStatus: r.granted ? 'viewed' : 'dismissed' });
      });
    });
  }

  countdown(placement, seconds, kicker) {
    return new Promise((resolve) => {
      const count = h('span', { class: 'ad-count', text: seconds });
      const bar = h('i');
      const close = h('button', { class: 'btn ghost', type: 'button', text: 'Close (no reward)' });
      const dialog = h('dialog', { class: 'ad-dialog', 'aria-labelledby': 'ad-dialog-title' },
        h('p', { class: 'kicker', text: kicker }),
        h('h2', { id: 'ad-dialog-title' }, 'Rewarded ad playing… ', count, 's'),
        h('div', { class: 'meter' }, bar),
        h('p', { class: 'muted' }, 'Reward: ', PLACEMENT_LABELS[placement] || placement),
        close);
      document.body.append(dialog);
      const start = performance.now();
      let done = false;
      let timer = 0;
      const finish = (granted, reason) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        dialog.close();
        dialog.remove();
        resolve({ granted, reason });
      };
      close.addEventListener('click', () => finish(false, 'dismissed'));
      dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(false, 'dismissed'); });
      dialog.showModal();
      const tick = () => {
        const elapsed = (performance.now() - start) / 1000;
        count.textContent = String(Math.max(0, Math.ceil(seconds - elapsed)));
        bar.style.width = `${Math.min(100, (elapsed / seconds) * 100)}%`;
        if (elapsed >= seconds) finish(true, 'viewed');
      };
      tick();
      timer = setInterval(tick, 100);
    });
  }

  /** Fills every .ad-slot outside the playfield; VIP players get no banners at all. */
  renderBanners() {
    for (const slot of document.querySelectorAll('.ad-slot')) {
      const wrap = slot.closest('.ad-wrap') || slot;
      wrap.hidden = this.adFree;
      if (this.adFree) continue;
      replace(slot, h('span', { class: 'muted', text: `Advertisement · ${slot.dataset.size || ''} slot` }));
    }
  }
}
