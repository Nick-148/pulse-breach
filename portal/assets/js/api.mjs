// fetch wrapper for /api: same-origin, JSON, timeout, and it never throws. Callers branch on {ok, status, error}.
// status 0 means "network/offline" so the portal can fall back to guest mode instead of breaking.

export async function api(path, { method = 'GET', body, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const init = { method, credentials: 'same-origin', signal: ctrl.signal, headers: {} };
    if (method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body ?? {});
    }
    const res = await fetch(path, init);
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data && data.error) || `http-${res.status}` };
  } catch {
    return { ok: false, status: 0, data: null, error: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** Human-readable messages for API error codes shown to players. */
const MESSAGES = {
  network: 'You seem to be offline. Your progress is saved on this device.',
  'backend-offline': 'Online features are taking a break. Your progress is saved on this device.',
  'leaderboards-offline': 'Leaderboards are offline right now.',
  'rate-limited': 'Slow down a little and try again in a minute.',
  'username-taken': 'That username is taken.',
  'username-invalid': 'Usernames are 3–16 letters, numbers or underscores.',
  'username-reserved': 'That username is reserved.',
  'username-blocked': 'Please pick a different username.',
  'bad-credentials': 'Username or Arcade Key is incorrect.',
  'sign-in-required': 'Sign in to do that.',
  'insufficient-funds': 'Not enough credits yet.',
  'already-owned': 'You already own that.',
  'payments-not-configured': 'The store opens soon. Nothing was charged.',
  'friend-not-found': 'No player has that friend code.',
  'cannot-friend-self': "That's your own friend code.",
  'quest-not-complete': 'Finish the quest first.',
  'quest-already-claimed': 'Already claimed.',
  'confirm-username': 'Type your username exactly to confirm.',
};

export const errorMessage = (code) => MESSAGES[code] || 'Something went wrong. Please try again.';
