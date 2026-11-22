// In-process API harness: real router + real SQL migrations on in-memory node:sqlite, a cookie-jar client,
// and a controllable clock (the API reads Date.now()).
import { createD1, applyMigrations } from '../../scripts/sqlite-d1.mjs';
import { handleApi } from '../../server/router.mjs';

export const ORIGIN = 'http://arcade.test';
export const START = Date.UTC(2026, 10, 21, 12, 0, 0);

export function makeApi(envOverrides = {}) {
  const DB = applyMigrations(createD1());
  const env = { DB, RUN_SECRET: 'test-secret-'.padEnd(48, 'x'), DEV: '1', PAYMENTS_SIMULATED: '1', ...envOverrides };
  const realNow = Date.now;
  let clock = START;
  Date.now = () => clock;
  let ipCounter = 0;

  class Client {
    constructor(ip = `10.0.0.${++ipCounter}`) {
      this.ip = ip;
      this.jar = new Map();
    }

    async req(method, path, body, headers = {}) {
      const h = { Origin: ORIGIN, 'CF-Connecting-IP': this.ip, ...headers };
      const hasBody = method !== 'GET' && method !== 'HEAD';
      if (hasBody && !('Content-Type' in h)) h['Content-Type'] = 'application/json';
      if (this.jar.size) h.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
      for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
      const init = { method, headers: h };
      if (hasBody) init.body = typeof body === 'string' ? body : JSON.stringify(body ?? {});
      const res = await handleApi(new Request(ORIGIN + path, init), env);
      for (const cookie of res.headers.getSetCookie()) {
        const [pair, ...attrs] = cookie.split(';').map((s) => s.trim());
        const i = pair.indexOf('=');
        const name = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (!value || attrs.includes('Max-Age=0')) this.jar.delete(name);
        else this.jar.set(name, value);
      }
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
    }

    get(path) { return this.req('GET', path); }
    post(path, body) { return this.req('POST', path, body); }
    put(path, body) { return this.req('PUT', path, body); }
    del(path, body) { return this.req('DELETE', path, body); }

    async register(username) {
      const r = await this.post('/api/auth/register', { username });
      if (r.status !== 201) throw new Error(`register ${username}: ${r.status} ${JSON.stringify(r.body)}`);
      this.key = r.body.key;
      return r.body;
    }

    /** Starts a run, advances the clock by the run length, and submits it. */
    async playRun({ game = 'pulse-breach', seed, score, survivalMs, ghost, meta, advanceMs }) {
      const t = await this.post('/api/runs', { game, seed });
      if (t.status !== 200) return t;
      advance(advanceMs ?? survivalMs + 500);
      return this.post('/api/scores', { token: t.body.token, score, survivalMs, ghost, meta });
    }
  }

  const advance = (ms) => { clock += ms; };
  return {
    env,
    DB,
    Client,
    advance,
    now: () => clock,
    setNow: (ms) => { clock = ms; },
    restore: () => { Date.now = realNow; DB.close(); },
  };
}
