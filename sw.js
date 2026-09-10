// sw.js — Service Worker untuk Fight With Jo - Performance App

const CACHE_NAME = "fwj-cache-v2"; // dinaikkan dari v1 -> v2 karena index.html diupdate
const OFFLINE_URL = "./index.html";

// File inti yang di-cache saat instalasi (app shell)
const CORE_ASSETS = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// Install: cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: bersihkan cache lama (v1, dsb)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: strategi berbeda tergantung jenis request
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Hanya tangani GET request
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Request ke Supabase (API/data) -> selalu network, jangan di-cache
  if (url.hostname.includes("supabase.co") || url.hostname.includes("supabase.in")) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(JSON.stringify({ error: "offline" }), {
          headers: { "Content-Type": "application/json" },
          status: 503
        })
      )
    );
    return;
  }

  // Navigasi halaman (buka app) -> network-first, fallback ke cache/offline
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // Aset lain (CSS/JS CDN, gambar, dsb) -> cache-first, fallback network, lalu update cache
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Hanya cache respons valid
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
