import type { Context, Next } from 'hono';
import type { Env } from './db';
import { productBySlug, productById } from './db';

// Legacy Egasa URLs used query-string product references:
//   ?p=<slug>  /  ?product=<slug>  /  ?id=<productId>
// Hash fragments like #product/<slug> cannot be seen server-side; the store
// client (UI agent) handles those with a small inline redirect script.
//
// Usage in index.tsx:  app.use('*', legacyEgasaRedirect);
// Passes through silently when no legacy parameter is present, so it is safe
// to register globally. API/admin/media paths are skipped to avoid touching
// authenticated or asset routes.
const SKIP_PREFIXES = ['/api/', '/admin', '/media/', '/favicon', '/robots.txt', '/sitemap.xml'];

export async function legacyEgasaRedirect(c: Context<{ Bindings: Env }>, next: Next) {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
  const path = new URL(c.req.url).pathname;
  if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return next();
  const q = c.req.query();
  const slugParam = q.p || q.product;
  const idParam = q.id;
  if (!slugParam && !idParam) return next();
  try {
    const product = slugParam
      ? await productBySlug(c.env.DB, String(slugParam).slice(0, 100))
      : await productById(c.env.DB, String(idParam).slice(0, 100));
    if (product) {
      // Strip the legacy query string entirely so the canonical URL is clean.
      return c.redirect('/products/' + encodeURIComponent(product.slug), 301);
    }
  } catch {
    // DB lookup failing must never break normal routing.
  }
  return next();
}
