// Username rules. Names are shown on public leaderboards to an audience that includes kids, so the filter
// errs on the side of rejecting (ADR 0009). It is a starter list, not moderation: abusive names that slip
// through still need a removal path (PLAN.md).

export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

// Stored reversed so the source doesn't read as a list of slurs; reversed once at load.
const rev = (csv) => csv.split(',').map((w) => [...w].reverse().join(''));
// Long/unambiguous terms: rejected anywhere inside the name.
const SUBSTRINGS = rev('kcuf,tihs,tnuc,hctib,reggin,aggin,toggaf,drater,erohw,tuls,reltih,yssup,sinep,anigav,nrop,elohssa,dratsab,ynnart,zzij,tawt,knaw,flesruoyllik,tselom');
// Short terms that are also parts of innocent words ("grape", "spicy", "torpedo"): rejected as whole words.
const WORDS = new Set(rev('gaf,epar,izan,kcid,kcoc,xes,ekik,cips,knihc,ekyd,muc,syk,odep'));
const RESERVED = new Set(['admin', 'administrator', 'mod', 'moderator', 'staff', 'support', 'system', 'official', 'seedfall', 'guest', 'null', 'undefined', 'root', 'you']);

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' };

function normalize(name) {
  return name.toLowerCase().replace(/[0-9]/g, (d) => LEET[d] || '');
}

/** → {ok: true, name} | {ok: false, reason}. `name` keeps the player's capitalisation. */
export function validateUsername(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'username-invalid' };
  const name = raw.trim();
  if (!USERNAME_RE.test(name)) return { ok: false, reason: 'username-invalid' };
  if (!/[A-Za-z]/.test(name)) return { ok: false, reason: 'username-invalid' };
  const flat = normalize(name).replace(/_/g, '');
  const words = normalize(name).split(/_+/).filter(Boolean);
  if (RESERVED.has(flat) || words.some((w) => RESERVED.has(w))) return { ok: false, reason: 'username-reserved' };
  if (SUBSTRINGS.some((w) => flat.includes(w)) || words.some((w) => WORDS.has(w)) || WORDS.has(flat)) {
    return { ok: false, reason: 'username-blocked' };
  }
  return { ok: true, name };
}
