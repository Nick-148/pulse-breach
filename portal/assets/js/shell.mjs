// Site chrome shared by every page: header wallet/streak, the profile & sign-in dialog, daily check-in toast.
import { GAMES } from '/shared/games.mjs';
import { ITEMS, itemById } from '/shared/catalog.mjs';
import { fmtInt } from '/shared/util.mjs';
import { Platform } from './platform.mjs';
import { errorMessage } from './api.mjs';
import { $, h, replace, toast, copyText } from './dom.mjs';

const TITLES = Object.fromEntries(GAMES.map((g) => [g.slug, g.title]));

function renderHeader(p) {
  const w = p.wallet();
  const credits = $('#wallet-credits');
  if (credits) credits.textContent = fmtInt(w.credits);
  const gemsWrap = $('#wallet-gems-wrap');
  if (gemsWrap) {
    gemsWrap.hidden = !w.gems;
    $('#wallet-gems').textContent = fmtInt(w.gems);
  }
  const streak = $('#streak-pill');
  if (streak) {
    const s = p.streak();
    streak.hidden = !s;
    streak.querySelector('b').textContent = String(s);
    streak.title = `${s}-day login streak`;
  }
  const btn = $('#profile-btn');
  if (btn) {
    btn.textContent = p.signedIn ? p.username : 'Sign in';
    btn.classList.toggle('vip', p.vip);
  }
  const offline = $('#offline-note');
  if (offline) offline.hidden = p.online !== false;
}

function field(label, input, hint) {
  const id = `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id, text: label }), input, hint ? h('p', { class: 'muted small', text: hint }) : null);
}

function swatch(c) {
  const s = h('span', { class: 'swatch', 'aria-hidden': 'true' });
  s.style.background = `linear-gradient(135deg, ${c.primary}, ${c.secondary})`;
  return s;
}

function errorLine() {
  return h('p', { class: 'form-error', role: 'alert' });
}

/* ------------------------------- guest view ------------------------------ */
function guestView(p, close) {
  const w = p.wallet();
  const body = h('div', { class: 'stack' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('div', { class: 'stack' });

  const showKey = (key, merged) => {
    const copyBtn = h('button', { class: 'btn primary', type: 'button', text: 'Copy key' });
    copyBtn.addEventListener('click', async () => toast((await copyText(key)) ? 'Key copied' : 'Copy failed: select the key and copy it'));
    const done = h('button', { class: 'btn', type: 'button', text: "I've saved my key", disabled: true });
    const check = h('input', { type: 'checkbox', id: 'saved-key' });
    check.addEventListener('change', () => { done.disabled = !check.checked; });
    done.addEventListener('click', () => render());
    replace(body,
      h('h3', { text: 'Save your Arcade Key' }),
      h('p', { text: "It's your password, shown only this once. You need it to sign in on another device. Store it in your password manager." }),
      h('code', { class: 'arcade-key', text: key }),
      merged?.credits ? h('p', { class: 'ok', text: `Moved ${fmtInt(merged.credits)} guest credits into your account.` }) : null,
      h('div', { class: 'row' }, copyBtn),
      h('label', { class: 'check', for: 'saved-key' }, check, ' I saved my Arcade Key somewhere safe'),
      h('div', { class: 'row' }, done));
  };

  const createForm = () => {
    const name = h('input', { name: 'username', autocomplete: 'username', minlength: 3, maxlength: 16, required: true, pattern: '[A-Za-z0-9_]{3,16}', spellcheck: 'false' });
    const err = errorLine();
    const submit = h('button', { class: 'btn primary', type: 'submit', text: 'Create account' });
    const form = h('form', { class: 'stack', novalidate: true },
      h('p', { text: 'Claim your leaderboard spot and sync credits across devices. No email needed.' }),
      field('Username', name, '3–16 letters, numbers or underscores. Shown on public leaderboards: no real names.'),
      err, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      err.textContent = '';
      const r = await p.register(name.value.trim());
      submit.disabled = false;
      if (!r.ok) { err.textContent = errorMessage(r.error); return; }
      showKey(r.key, r.merged);
    });
    return form;
  };

  const loginForm = () => {
    const name = h('input', { name: 'username', autocomplete: 'username', required: true, maxlength: 16, spellcheck: 'false' });
    const key = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: 40, spellcheck: 'false' });
    const err = errorLine();
    const submit = h('button', { class: 'btn primary', type: 'submit', text: 'Sign in' });
    const form = h('form', { class: 'stack' }, field('Username', name), field('Arcade Key', key, 'Format: XXXXX-XXXXX-XXXXX-XXXXX'), err, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      err.textContent = '';
      const r = await p.login(name.value.trim(), key.value);
      submit.disabled = false;
      if (!r.ok) { err.textContent = errorMessage(r.error); return; }
      const bits = [];
      if (r.merged?.credits) bits.push(`+${fmtInt(r.merged.credits)} guest credits`);
      if (r.merged?.runs) bits.push(`${r.merged.runs} run(s) claimed`);
      toast(`Signed in${bits.length ? ` · ${bits.join(' · ')}` : ''}`);
      close();
    });
    return form;
  };

  const select = (which) => {
    for (const t of tabs.children) t.setAttribute('aria-selected', String(t.dataset.tab === which));
    replace(panel, which === 'create' ? createForm() : loginForm());
  };
  for (const [id, label] of [['create', 'Create account'], ['login', 'Sign in']]) {
    tabs.append(h('button', { class: 'tab', type: 'button', role: 'tab', dataset: { tab: id }, text: label, onclick: () => select(id) }));
  }

  const others = (p.config?.auth || []).filter((a) => a.id !== 'username');
  const render = () => {
    if (p.signedIn) { close(); return; }
    replace(body,
      h('p', { text: `Playing as a guest · ${fmtInt(w.credits)} credits saved on this device.` }),
      p.online ? null : h('p', { class: 'warn', text: errorMessage('network') }),
      tabs, panel,
      others.length ? h('div', { class: 'row' }, others.map((a) => h('button', { class: 'btn ghost small', type: 'button', disabled: !a.enabled, title: a.enabled ? '' : 'Coming soon', text: `${a.label}${a.enabled ? '' : ' (soon)'}` }))) : null);
    select('create');
  };
  render();
  return body;
}

/* ----------------------------- signed-in view ---------------------------- */
function playerView(p, close) {
  const me = p.me;
  const player = me.player;
  const friendsList = h('ul', { class: 'list' });
  const friendErr = errorLine();

  const loadFriends = async () => {
    const r = await p.friends();
    if (!r.ok) { replace(friendsList, h('li', { class: 'muted', text: errorMessage(r.error) })); return; }
    if (!r.data.friends.length) { replace(friendsList, h('li', { class: 'muted', text: 'No friends yet. Share your code!' })); return; }
    replace(friendsList, r.data.friends.map((f) => h('li', {},
      h('span', { text: f.name }),
      h('button', { class: 'btn ghost small', type: 'button', text: 'Remove', 'aria-label': `Remove ${f.name}`, onclick: async () => { await p.removeFriend(f.code); loadFriends(); } }))));
  };

  const codeInput = h('input', { name: 'friend', maxlength: 9, placeholder: 'ABCD2345', autocomplete: 'off', spellcheck: 'false' });
  const addForm = h('form', { class: 'row' }, codeInput, h('button', { class: 'btn small', type: 'submit', text: 'Add friend' }));
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    friendErr.textContent = '';
    const r = await p.addFriend(codeInput.value);
    if (!r.ok) { friendErr.textContent = errorMessage(r.error); return; }
    codeInput.value = '';
    toast(`Added ${r.data.friend.name}`);
    loadFriends();
  });

  const trails = me.inventory.map(itemById).filter((i) => i && i.kind === 'trail');
  const trailList = trails.length
    ? h('ul', { class: 'list' }, trails.map((t) => {
      const on = player.equippedTrail === t.id;
      return h('li', {},
        swatch(t.colors), h('span', { text: t.name }),
        h('button', { class: `btn small ${on ? '' : 'primary'}`, type: 'button', text: on ? 'Unequip' : 'Equip', onclick: async () => {
          const r = await p.equip(on ? null : t.id);
          toast(r.ok ? (on ? 'Trail removed' : `${t.name} equipped in every game`) : errorMessage(r.error));
          close();
        } }));
    }))
    : h('p', { class: 'muted' }, 'No trails yet. ', h('a', { href: '/store/', text: 'Visit the store' }), ` (${ITEMS.filter((i) => i.price).length} available).`);

  const bests = GAMES.map((g) => {
    const d = me.bests.find((b) => b.game === g.slug && b.board === 'daily');
    const a = me.bests.find((b) => b.game === g.slug && b.board === 'alltime');
    return h('tr', {}, h('th', { scope: 'row', text: g.title }), h('td', { text: d ? fmtInt(d.score) : '—' }), h('td', { text: a ? fmtInt(a.score) : '—' }));
  });

  const confirm = h('input', { name: 'confirm', autocomplete: 'off', spellcheck: 'false' });
  const delErr = errorLine();
  const delForm = h('form', { class: 'stack' },
    h('p', { class: 'muted small', text: 'Deletes your account, scores, credits and purchases from our servers. This cannot be undone.' }),
    field(`Type ${player.username} to confirm`, confirm), delErr,
    h('button', { class: 'btn danger small', type: 'submit', text: 'Delete my account' }));
  delForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await p.deleteAccount(confirm.value.trim());
    if (!r.ok) { delErr.textContent = errorMessage(r.error); return; }
    toast('Account deleted');
    close();
  });

  const copyCode = h('button', { class: 'btn ghost small', type: 'button', text: 'Copy', onclick: async () => toast((await copyText(player.friendCode)) ? 'Friend code copied' : 'Copy failed') });
  const vipLine = player.vip ? `VIP until ${new Date(player.vipUntil).toLocaleDateString()}` : 'Free player';
  const body = h('div', { class: 'stack' },
    h('p', { class: 'muted', text: vipLine }),
    h('dl', { class: 'stats' },
      h('div', {}, h('dt', { text: 'Arcade Credits' }), h('dd', { text: fmtInt(me.wallet.credits) })),
      h('div', {}, h('dt', { text: 'Gems' }), h('dd', { text: fmtInt(me.wallet.gems) })),
      h('div', {}, h('dt', { text: 'Login streak' }), h('dd', { text: `${player.streak} day${player.streak === 1 ? '' : 's'}` }))),
    h('h3', { text: 'Personal bests' }),
    h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Game' }), h('th', { scope: 'col', text: 'Today' }), h('th', { scope: 'col', text: 'All-time' }))), h('tbody', {}, bests)),
    h('h3', { text: 'Trails' }), trailList,
    h('h3', { text: 'Friends' }),
    h('p', {}, 'Your friend code: ', h('code', { text: player.friendCode }), ' ', copyCode),
    addForm, friendErr, friendsList,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Sign out', onclick: async () => { await p.logout(); toast('Signed out'); close(); } })),
    h('details', { class: 'danger-zone' }, h('summary', { text: 'Delete account' }), delForm));
  loadFriends();
  return body;
}

/* --------------------------------- shell --------------------------------- */
export function openProfile(p, hooks = {}) {
  const content = h('div');
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', text: '✕' });
  const title = h('h2', { id: 'profile-title', text: p.signedIn ? p.username : 'Your profile' });
  const dialog = h('dialog', { class: 'sheet', 'aria-labelledby': 'profile-title' }, h('div', { class: 'sheet-head' }, title, closeBtn), content);
  const close = () => dialog.close();
  closeBtn.addEventListener('click', close);
  dialog.addEventListener('close', () => { dialog.remove(); hooks.onClose?.(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  const render = () => {
    title.textContent = p.signedIn ? p.username : 'Your profile';
    replace(content, p.signedIn ? playerView(p, close) : guestView(p, close));
  };
  render();
  document.body.append(dialog);
  dialog.showModal();
  hooks.onOpen?.();
}

/**
 * Creates the platform and wires the header immediately; `ready` resolves after config/session load.
 * The theater needs the platform object before `ready` so its SDK bridge can answer a game that boots fast.
 */
export function startShell(hooks = {}) {
  const p = new Platform();
  globalThis.__arcade = p; // handy in devtools; holds no secrets (the session cookie is HttpOnly)
  renderHeader(p);
  p.subscribe(renderHeader);
  $('#profile-btn')?.addEventListener('click', () => openProfile(p, hooks));
  const ready = p.boot().then(({ checkin }) => {
    if (checkin) toast(`Day ${checkin.streak} login streak · +${fmtInt(checkin.reward)} credits`);
    return p;
  });
  return { platform: p, ready };
}

export async function bootShell(hooks = {}) {
  return startShell(hooks).ready;
}

export { TITLES, swatch };
