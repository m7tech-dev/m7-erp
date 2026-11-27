const CACHE_NAME = "m7-controle-v48";
const APP_ASSETS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./stock-ledger.js", "./purchases.js", "./payables.js", "./purchase-returns.js"];
const SUPABASE_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
const APP_ASSET_PATHS = new Set(APP_ASSETS.map(asset => new URL(asset, self.location.href).pathname));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_ASSETS).then(
    // Biblioteca Supabase: melhor esforço; falha de rede não impede a instalação do app.
    () => fetch(SUPABASE_LIB, { mode: "cors" }).then(r => { if (r.ok) return cache.put(SUPABASE_LIB, r); }).catch(() => {})
  )));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names
        .filter(name => name.startsWith("m7-controle-") && name !== CACHE_NAME)
        .map(name => caches.delete(name))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  // supabase-js: versão fixada (2.45.4); rede primeiro, cache como fallback offline.
  if (request.url === SUPABASE_LIB) {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(SUPABASE_LIB, copy));
        }
        return response;
      }).catch(() => caches.match(SUPABASE_LIB).then(cached => cached || Response.error()))
    );
    return;
  }

  const url = new URL(request.url);
  // Never intercept cross-origin requests (Supabase, auth, APIs, CDNs).
  if (url.origin !== self.location.origin) return;
  // Cache only the explicit static app shell; never cache dynamic same-origin API routes.
  if (!APP_ASSET_PATHS.has(url.pathname)) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => request.mode === "navigate"
        ? caches.match(new URL("./index.html", self.location.href).toString())
        : Response.error());
    })
  );
});
