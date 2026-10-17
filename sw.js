/* ============================================================================
 * FightWithJo Performance App — Service Worker
 * Tujuan: membuat app installable & punya app-shell offline minimal.
 * TIDAK pernah menyentuh (selalu network passthrough, tanpa cache) untuk:
 *   - request ke Supabase (API, Auth, Storage)
 *   - request cross-origin ke CDN (Chart.js, @supabase/supabase-js, font, dll)
 *   - request non-GET (POST/PUT/PATCH/DELETE) apa pun
 * Supaya data atlet, autentikasi, dan penyimpanan TIDAK PERNAH basi/ter-cache
 * secara tidak sengaja.
 *
 * CATATAN UPDATE: setiap kali deploy fitur/perubahan baru ke index.html, NAIKKAN
 * SW_VERSION di bawah ini (misal fwj-v2 -> fwj-v3). Tanpa ini, browser lama bisa
 * tetap memegang app-shell versi lama karena strategi cache-first pada aset shell.
 * ========================================================================== */

const SW_VERSION = "fwj-v2";
const CACHE_NAME = `fightwithjo-shell-${SW_VERSION}`;

// Hanya app-shell statis milik origin sendiri yang di-cache.
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-192-maskable.png",
  "./icon-512-maskable.png"
];

// --- INSTALL: precache app shell (best-effort, tidak boleh gagal total kalau 1 aset hilang) ---
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch(() => {
            /* aset opsional (misal ikon belum ada) — jangan gagalkan install */
          })
        )
      );
      // Tidak skipWaiting() otomatis di sini — biarkan index.html yang memutuskan
      // kapan versi baru diaktifkan (lewat pesan SKIP_WAITING), supaya reload
      // terkoordinasi dan tidak mengganggu user di tengah sesi input data.
    })()
  );
});

// --- ACTIVATE: bersihkan cache versi lama ---
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("fightwithjo-shell-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// --- FETCH: strategi per jenis request ---
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 1) Jangan pernah campur tangan request non-GET (insert/update/delete Supabase, dll).
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  // 2) Jangan pernah cache/intercept apa pun yang bukan origin sendiri
  //    (Supabase REST/Auth/Storage, CDN Chart.js, CDN supabase-js, Google Fonts, dll).
  //    Biarkan 100% lewat langsung ke network, apa adanya.
  if (!isSameOrigin) return;

  // 3) Untuk origin sendiri: jangan cache endpoint apa pun yang mengandung "supabase"
  //    (jaga-jaga kalau suatu saat ada reverse-proxy same-origin ke Supabase).
  if (url.pathname.toLowerCase().includes("supabase")) return;

  // 4) Navigasi (buka app / reload) → network-first, fallback ke index.html di cache
  //    supaya app tetap bisa dibuka saat offline, tapi selalu pakai versi terbaru saat online.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", fresh.clone()).catch(() => {});
          return fresh;
        } catch (err) {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match("./index.html");
          if (cached) return cached;
          throw err;
        }
      })()
    );
    return;
  }

  // 5) Aset statis app-shell same-origin lain (manifest, ikon) → cache-first,
  //    lalu update cache diam-diam di background (stale-while-revalidate).
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((resp) => {
          if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
          return resp;
        })
        .catch(() => null);

      if (cached) {
        // Jangan tunggu network — balas cache dulu, update cache di belakang.
        networkFetch.catch(() => {});
        return cached;
      }
      const net = await networkFetch;
      if (net) return net;
      // Tidak ada di cache & network gagal → biarkan error normal terjadi.
      return fetch(req);
    })()
  );
});

// --- Terima pesan manual dari app, misal untuk skip-waiting saat update tersedia ---
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
