const CACHE_NAME = "luminex-cache-v2";
const RESOURCE_CACHE = "luminex-resources-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(["/", "/index.html"]);
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => ![CACHE_NAME, RESOURCE_CACHE].includes(k))
          .map((k) => caches.delete(k))
      );
      self.clients.claim();
    })()
  );
});

// Cache-first for resources; network-first for others
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/resources/")) {
    // Only handle caching for GET requests; let other methods passthrough
    if (event.request.method === "GET") {
      event.respondWith(cacheFirst(event.request));
    }
    return;
  }

  // Default: try network then fallback to cache
  event.respondWith(networkThenCache(event.request));
});

async function cacheFirst(request) {
  // Safety: never try to cache non-GET
  if (request.method !== "GET") {
    return fetch(request);
  }
  const cache = await caches.open(RESOURCE_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    return cached || Response.error();
  }
}

async function networkThenCache(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    if (response && response.ok && request.method === "GET") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreVary: true });
    return cached || Response.error();
  }
}

// Message API to pre-cache resource URLs
self.addEventListener("message", async (event) => {
  const { type, payload } = event.data || {};
  if (
    type === "CACHE_RESOURCE_URLS" &&
    payload &&
    Array.isArray(payload.urls)
  ) {
    const cache = await caches.open(RESOURCE_CACHE);
    await Promise.all(
      payload.urls.map(async (u) => {
        try {
          const req = new Request(u, { mode: "same-origin" });
          const resp = await fetch(req);
          if (resp && resp.ok) {
            await cache.put(req, resp.clone());
          }
        } catch (_) {}
      })
    );
    return;
  }
  if (
    type === "DELETE_RESOURCE_URLS" &&
    payload &&
    Array.isArray(payload.urls)
  ) {
    const cache = await caches.open(RESOURCE_CACHE);
    await Promise.all(
      payload.urls.map(async (u) => {
        try {
          const req = new Request(u, { mode: "same-origin" });
          await cache.delete(req, { ignoreVary: true });
        } catch (_) {}
      })
    );
    return;
  }
});
