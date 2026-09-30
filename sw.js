// Service worker mínimo: caché de la app shell. Los archivos del usuario
// (ISO/ELF) NO se cachean: se leen en streaming desde el selector de archivos.
const CACHE = "playps2-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./vendor/Play.js",
  "./vendor/Play.wasm",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // nada externo
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
