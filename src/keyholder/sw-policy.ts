/**
 * What the keyholder's service worker will and will not handle.
 *
 * Kept apart from the worker itself so the rules are testable without a
 * service worker environment, and so they can be read on their own. A service
 * worker on this origin is persistent code sitting in front of a page that
 * holds a door key; the narrower its remit, the better.
 */

/** Everything the keyholder needs in order to run. Nothing else is cached. */
export const PRECACHE_PATHS = ["index.html", "keyholder.js"] as const;

export type CachedPath = (typeof PRECACHE_PATHS)[number];

export interface RequestFacts {
  url: string;
  method: string;
  /** The request's mode; `"navigate"` for a page load. */
  mode: string;
}

/**
 * Decides which precached file answers a request, if any.
 *
 * Returning `undefined` means the worker stays out of the way and the request
 * goes to the network as it normally would. That is the answer for anything
 * cross-origin, anything outside the worker's scope, anything that is not a
 * plain GET, and anything not in {@link PRECACHE_PATHS}: the worker is a cache
 * for two files, not a proxy.
 */
export function cachedPathFor(
  request: RequestFacts,
  scope: string,
): CachedPath | undefined {
  if (request.method !== "GET") return undefined;

  let url: URL;
  let base: URL;
  try {
    url = new URL(request.url);
    base = new URL(scope);
  } catch {
    return undefined;
  }
  if (url.origin !== base.origin) return undefined;
  if (!url.pathname.startsWith(base.pathname)) return undefined;

  // A page load is answered with the page, whatever path spelling was used.
  if (request.mode === "navigate") return "index.html";

  const relative = url.pathname.slice(base.pathname.length);
  if (relative === "" || relative === "index.html") return "index.html";
  if (relative === "keyholder.js") return "keyholder.js";
  return undefined;
}

/** Cache name for a build. Changing the build changes the name. */
export function cacheName(version: string): string {
  return `sesame-keyholder-${version}`;
}

/** Caches from other builds, which activation removes. */
export function staleCaches(
  existing: readonly string[],
  current: string,
): string[] {
  return existing.filter(
    (name) => name.startsWith("sesame-keyholder-") && name !== current,
  );
}
