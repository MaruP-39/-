// 오프라인 사용을 위한 서비스 워커.
// 항상 인터넷에서 최신 파일을 먼저 받고(network-first), 연결이 없을 때만 저장해 둔 파일을 씁니다.
// 그래서 사이트를 고쳐 올리면 다음 접속 때 바로 새 버전이 보입니다.
const CACHE = "two-row-karaoke-v1";
const APP_FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "karaoke-text.js",
  "waveform.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  // 같은 사이트의 GET 요청만 다룹니다. (자동 후리가나 같은 외부 요청은 그대로 통과)
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("index.html");
        return Response.error();
      }),
  );
});
