// EuroHelm Service Worker
// App-Dateien: zuerst Netz (damit neue Versionen sofort ankommen), offline aus dem Cache.
// Kartenkacheln: zuerst Cache (sparsam mit Datenvolumen an Bord), begrenzt auf MAX_TILES.
// Wird beim Bauen aus package.json gesetzt (scripts/build.mjs); so verwirft jede neue Version den alten Cache
const VERSION = "eurohelm-v0.6.1";
const SHELL = ["./", "./index.html", "./app.js", "./styles.css", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
const TILE_HOSTS = ["tile.openstreetmap.org", "tiles.openseamap.org", "ows.emodnet-bathymetry.eu"];
const TILE_CACHE = "eurohelm-tiles";
const MAX_TILES = 4000;
const NET_TIMEOUT_MS = 4000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NET_TIMEOUT_MS)),
    ]);
    if (res.ok) cache.put(req, res.clone()).catch(() => undefined);
    return res;
  } catch {
    const hit = (await cache.match(req)) || (req.mode === "navigate" ? await cache.match("./index.html") : undefined);
    if (hit) return hit;
    throw new Error("offline und nicht im Cache");
  }
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        // nur echte Kacheln speichern: undurchsichtige Antworten können Fehlerseiten sein und
        // belegen im Browser je mehrere MB Kontingent
        if (res.ok) { cache.put(e.request, res.clone()).then(trimTiles).catch(() => undefined); }
        return res;
      }),
    );
    return;
  }
  if (url.origin === location.origin) e.respondWith(networkFirst(e.request));
});
