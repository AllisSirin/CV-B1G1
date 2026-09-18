/**
 * 홈 화면에서 열었을 때 곧바로 뜨게, 전파가 없어도 지난 목록은 보이게.
 * 화면 파일을 고치면 VERSION 을 올린다(옛 캐시는 activate 에서 지운다).
 */
const VERSION = "konbini-v4";
const SHELL = ["./", "./index.html", "./app.js", "./period.mjs", "./favorites.mjs", "./style.css", "./icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

/** 목록은 늘 새것을 먼저 — 못 받으면 지난 것을 보여 준다. 나머지(화면 파일·그림)는 캐시 먼저 */
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  const fresh = url.pathname.endsWith("data/deals.json") || url.pathname.startsWith("/api/");
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (fresh) {
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        return (await cache.match(e.request, { ignoreSearch: true })) || Response.error();
      }
    }
    const hit = await cache.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(e.request);
    if (res.ok) cache.put(e.request, res.clone());
    return res;
  })());
});
