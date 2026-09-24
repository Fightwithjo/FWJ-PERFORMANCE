/* Fight With Jo - Performance App
   Service Worker

   Strategi:
   - App shell (index.html, manifest, ikon) di-precache -> app bisa dibuka offline.
   - Halaman (navigasi): network-first dengan timeout, fallback ke cache.
   - Library CDN (Chart.js, Supabase JS) & file statis: stale-while-revalidate.
   - Supabase (API, auth, realtime, storage) TIDAK PERNAH di-cache. Semua request
     ke sana langsung ke jaringan, karena app sudah punya antrean offline sendiri
     (syncQueue) dan data lama tidak boleh tersaji sebagai data terbaru.

   Setiap kali mengubah index.html, naikkan CACHE_VERSION supaya user dapat versi baru. */

const CACHE_VERSION = "v1";
const CACHE_NAME = `fwj-app-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// Library dari CDN yang dipakai index.html (dicache supaya chart & login tetap jalan offline)
const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"
];

const CDN_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net"];
const NAVIGATION_TIMEOUT_MS = 4000;

/* ---------------- INSTALL ---------------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Satu file gagal (misal icon-512.png belum ada) tidak boleh menggagalkan seluruh install.
      await Promise.allSettled(
        APP_SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })))
      );

      // Skrip CDN diambil no-cors (sama seperti <script> tanpa crossorigin) -> response opaque.
      await Promise.allSettled(
        CDN_ASSETS.map(async (url) => {
          const res = await fetch(new Request(url, { mode: "no-cors" }));
          await cache.put(url, res);
        })
      );

      await self.skipWaiting();
    })()
  );
});

/* ---------------- ACTIVATE ---------------- */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("fwj-app-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* ---------------- FETCH ---------------- */
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Hanya tangani GET. POST/PATCH/DELETE (tulis data ke Supabase) lewat langsung.
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Supabase: jangan pernah dicache / dicegat (auth, REST, storage foto, realtime).
  if (url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.in")) return;

  // Navigasi halaman -> network-first, fallback ke cache.
  if (req.mode === "navigate") {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  // File statis satu origin + library CDN -> stale-while-revalidate.
  if (url.origin === self.location.origin || CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function networkFirstNavigation(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetchWithTimeout(req, NAVIGATION_TIMEOUT_MS);
    if (fresh && fresh.ok) {
      cache.put("./index.html", fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const cached =
      (await cache.match(req, { ignoreSearch: true })) ||
      (await cache.match("./index.html")) ||
      (await cache.match("./"));
    if (cached) return cached;
    return new Response(
      "<!DOCTYPE html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
        "<title>Offline</title><body style='font-family:sans-serif;text-align:center;padding:48px 16px'>" +
        "<h2>Kamu sedang offline</h2><p>Buka aplikasi sekali saat online agar bisa dipakai offline.</p></body>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  const network = fetch(req)
    .then((res) => {
      // Response opaque (status 0) berasal dari <script> lintas origin; tetap aman disimpan.
      if (res && (res.ok || res.type === "opaque")) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    // Perbarui cache di belakang layar tanpa menahan response.
    return cached;
  }
  const res = await network;
  return res || Response.error();
}

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(req).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/* ---------------- PESAN DARI HALAMAN ---------------- */
// Opsional: navigator.serviceWorker.controller.postMessage("SKIP_WAITING")
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
