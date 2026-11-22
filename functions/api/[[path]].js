// Cloudflare Pages Function: every /api/* request goes to the portable API router (ADR 0008).
// Static pages are served without invoking Functions, so they don't count against the free quota.
import { handleApi } from '../../server/router.mjs';

export const onRequest = (context) => handleApi(context.request, context.env, (p) => context.waitUntil(p));
