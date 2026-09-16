/**
 * The keyholder's service worker.
 *
 * It exists for one reason: a Bluetooth session cannot start until the
 * keyholder page has loaded, so a host that is down, slow, or unreachable
 * becomes a lock you cannot open. Once this worker has cached the page, it
 * loads from disk and the network stops being a precondition. Bluetooth itself
 * never needed it.
 *
 * It caches exactly two files and passes everything else through. See
 * sw-policy.ts for the rules and docs/keyholder-hosting.md for the header this
 * script needs, which differs from the rest of the origin.
 */

import {
  cachedPathFor,
  cacheName,
  PRECACHE_PATHS,
  staleCaches,
} from "./sw-policy.js";

// Replaced at build time with a digest of the files being cached, so that any
// change to them is a new worker with a new cache.
declare const __KEYHOLDER_VERSION__: string;

const CACHE = cacheName(__KEYHOLDER_VERSION__);

interface ServiceWorkerScope {
  addEventListener(type: string, listener: (event: never) => void): void;
  registration: { scope: string };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
}

interface InstallEvent {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends InstallEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}

const worker = self as unknown as ServiceWorkerScope;

worker.addEventListener("install", ((event: InstallEvent) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `reload` so installation never copies a stale entry out of the HTTP
      // cache, which would pin an old build for as long as the worker lives.
      await cache.addAll(
        PRECACHE_PATHS.map((path) => new Request(path, { cache: "reload" })),
      );
      // Taking over immediately is safe: a page already running keeps the code
      // it loaded, so no session can be swapped underneath itself.
      await worker.skipWaiting();
    })(),
  );
}) as (event: never) => void);

worker.addEventListener("activate", ((event: InstallEvent) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        staleCaches(names, CACHE).map((name) => caches.delete(name)),
      );
      await worker.clients.claim();
    })(),
  );
}) as (event: never) => void);

worker.addEventListener("fetch", ((event: FetchEvent) => {
  const path = cachedPathFor(
    {
      url: event.request.url,
      method: event.request.method,
      mode: event.request.mode,
    },
    worker.registration.scope,
  );
  if (path === undefined) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(path);
      if (cached !== undefined) return cached;
      // Not cached yet, or the cache was evicted. Fall back to the network and
      // fill the gap, so the next load is offline-capable again.
      const response = await fetch(path, { cache: "reload" });
      if (response.ok) await cache.put(path, response.clone());
      return response;
    })(),
  );
}) as (event: never) => void);
