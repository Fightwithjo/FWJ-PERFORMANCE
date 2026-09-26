/* ============================================================================
   FIGHT WITH JO — Service Worker
   Strategi:
   - App shell (index.html, manifest.json, icon) di-cache pakai cache-first
     supaya app bisa dibuka cepat / tetap bisa dibuka saat offline.
   - Semua request lain (Supabase API/Auth/Storage, CDN Chart.js & Supabase
     JS) selalu lewat network-first, TIDAK di-cache, karena data atlet harus
     selalu yang terbaru dan real-time — cache di sini hanya untuk shell UI,
     bukan untuk data.
   - Naikkan CACHE_VERSION setiap kali index.html diubah supaya user lama
     otomatis dapat versi baru.
============================================================================ */

const CACHE_VERSION = "fwj-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // addAll akan gagal total kalau salah satu file tidak ada,
      // jadi ditambahkan satu-satu supaya file yang hilang (mis. icon-512.png
      // belum diupload) tidak menggagalkan seluruh instalasi.
      return Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn("[sw] gagal cache:", url, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function isAppShellRequest(url) {
  // Hanya request same-origin (file HTML/manifest/icon aplikasi sendiri)
  // yang dianggap app shell. Semua request ke domain lain (Supabase, CDN)
  // dibiarkan lewat network langsung.
  return url.origin === self.location.origin;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Hanya tangani GET; biarkan POST/PUT/PATCH/DELETE (dipakai Supabase)
  // langsung ke network tanpa campur tangan service worker.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (!isAppShellRequest(url)) {
    // Supabase API/Auth/Storage, Chart.js CDN, Supabase JS CDN, dll:
    // selalu network, tanpa fallback cache (data harus fresh).
    return;
  }

  // App shell: cache-first, lalu update cache di background (stale-while-revalidate).
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
