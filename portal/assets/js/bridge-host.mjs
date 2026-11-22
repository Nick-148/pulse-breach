// Host side of the ArcadeSDK bridge (ADR 0007). Answers requests from exactly one game frame.
// Requests from any other window or origin are ignored; unknown methods and handler errors make the SDK
// resolve its documented fallback, so a broken handler can't hang or crash a game.

export const NS = 'arcade-sdk';

/**
 * @param {{frame: {contentWindow: Window}, origin: string, handlers: Record<string, Function>, win?: Window}} opts
 */
export function createHostBridge({ frame, origin, handlers, win = globalThis }) {
  const onMessage = async (e) => {
    if (e.origin !== origin || !frame.contentWindow || e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || m.ns !== NS || m.kind !== 'req' || !Number.isSafeInteger(m.id) || typeof m.method !== 'string') return;
    const handler = Object.hasOwn(handlers, m.method) ? handlers[m.method] : null;
    let reply;
    if (!handler) {
      reply = { ok: false, error: 'unknown-method' };
    } else {
      try {
        reply = { ok: true, result: await handler(m.params ?? null) };
      } catch (err) {
        console.warn('arcade-sdk handler failed', m.method, err);
        reply = { ok: false, error: 'handler-error' };
      }
    }
    try {
      e.source.postMessage({ ns: NS, kind: 'res', id: m.id, ...reply }, origin);
    } catch {
      // Result not cloneable or frame gone: the SDK's timeout fallback covers it.
    }
  };
  win.addEventListener('message', onMessage);
  return {
    emit(name, data = null) {
      try {
        frame.contentWindow?.postMessage({ ns: NS, kind: 'evt', name, data }, origin);
      } catch {
        // frame navigated away
      }
    },
    destroy() {
      win.removeEventListener('message', onMessage);
    },
  };
}
