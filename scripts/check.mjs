// Static guards for the single-file game. Fails fast on anything that would
// break "zero dependency", the strict CSP, or the no-innerHTML XSS rule.
import { readSource, inlineBlocks } from './lib.mjs';

const html = readSource();
const script = inlineBlocks(html, 'script').join('\n');
const failures = [];
const rule = (ok, msg) => { if (!ok) failures.push(msg); };

const bytes = Buffer.byteLength(html);
rule(bytes < 160 * 1024, `index.html is ${bytes} bytes; budget is 160 KiB`);
rule(inlineBlocks(html, 'script').length === 1, 'exactly one inline <script> expected');
rule(inlineBlocks(html, 'style').length === 1, 'exactly one inline <style> expected');
rule(!/<script[^>]+src=/i.test(html), 'external <script src> is not allowed');
rule(!/<link[^>]+rel=["']?stylesheet/i.test(html), 'external stylesheets are not allowed');
rule(!/(src|href)=["']?(https?:)?\/\//i.test(html), 'no remote src/href (zero external dependencies)');
rule(!/@import|url\(\s*["']?(https?:)?\/\//i.test(html), 'no remote CSS imports/urls');
rule(!/\son[a-z]+\s*=/i.test(html.replace(script, '')), 'inline event handler attributes break CSP');
rule(!/\sstyle\s*=\s*["']/i.test(html.replace(script, '')), 'inline style="" attributes break CSP');
rule(!/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write/.test(script), 'HTML-string DOM sinks are banned (use textContent / h())');
rule(!/\beval\s*\(|new Function\s*\(/.test(script), 'eval/new Function are banned');
rule(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(script), 'network calls are banned (connect-src none)');
rule(!/\b(TODO|FIXME|XXX)\b/.test(html), 'no TODO/FIXME placeholders in the shipped file');
rule(/'use strict'/.test(script), "script must be 'use strict'");
rule(/pulse_breach_v1_/.test(script), 'storage keys must stay namespaced under pulse_breach_v1_');

if (failures.length) {
  console.error(`check failed:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`check ok (${(bytes / 1024).toFixed(1)} KiB, single file, zero external deps)`);
