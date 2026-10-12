// Only build assets and public static files are ever cached. API responses
// and HTML navigations can carry authenticated data, so they are strictly
// network-only (see the fetch handler below).
const BUILD_CACHE = "alapar-build-v5";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Purge every cache that isn't the current build cache — including older
  // caches (alapar-api-*, alapar-html-*) that may hold authenticated data.
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== BUILD_CACHE)
          .map((n) => caches.delete(n)),
      )
    ).then(() => self.clients.claim()),
  );
});

/**
 * A styled fallback shown when both the network and cache are unavailable.
 * Replaces the bare "Offline" string so users see a sensible screen instead of
 * raw text if the app ever goes unreachable (dev timeout, prod outage, etc.).
 */
function offlineResponse(request) {
  const isHtml = (request.headers.get("Accept") ?? "").includes("text/html");
  const body = isHtml
    ? '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>Sin conexión — A la Par</title><style>" +
      ":root{color-scheme:dark}" +
      "body{display:flex;align-items:center;justify-content:center;" +
      "min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;" +
      "font-family:system-ui,-apple-system,sans-serif;text-align:center}" +
      ".card{max-width:24rem;padding:2rem}" +
      "h1{font-size:1.25rem;margin:0 0 .5rem}" +
      "p{color:#94a3b8;margin:0 0 1.5rem;line-height:1.5}" +
      "button{background:#3b82f6;color:#fff;border:0;border-radius:.5rem;" +
      "padding:.6rem 1.25rem;font-size:1rem;cursor:pointer}" +
      '</style></head><body><div class="card">' +
      "<h1>No hay conexión</h1>" +
      "<p>No se pudo cargar esta página. Revisa tu conexión a internet e " +
      "inténtalo de nuevo.</p>" +
      '<button onclick="location.reload()">Reintentar</button>' +
      "</div></body></html>"
    : "";
  return new Response(body, {
    status: 503,
    statusText: "Service Unavailable",
    headers: isHtml
      ? { "Content-Type": "text/html; charset=utf-8" }
      : { "Content-Type": "text/plain; charset=utf-8" },
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (!sameOrigin) return;

  if (event.request.method !== "GET") return;

  // Cache-first only for immutable, non-sensitive assets: content-hashed
  // build output under /assets/ and public static files.
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Everything else — /api/* and HTML navigations (including /dashboard) —
  // is network-only and never written to the cache. Authenticated responses
  // must not be replayed to anyone with physical access to the device. On
  // network failure the generic offline shell is shown instead.
  event.respondWith(networkOnly(event.request));
});

function isStaticAsset(pathname) {
  return pathname.startsWith("/assets/") ||
    pathname === "/logo.svg" ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.json" ||
    pathname === "/sw-register.js";
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(BUILD_CACHE);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return offlineResponse(request);
  }
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineResponse(request);
  }
}

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title ?? "A la Par";
  const options = {
    body: data.body ?? "Tienes una nueva notificación",
    icon: "/logo.svg",
    badge: "/logo.svg",
    data: {
      registryId: data.registryId ?? "",
      url: data.url ?? "/dashboard",
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      (clients) => {
        for (const client of clients) {
          if (client.url.includes("/dashboard") && "focus" in client) {
            client.postMessage({ type: "navigate", url: targetUrl });
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      },
    ),
  );
});

self.addEventListener("message", (event) => {
  // Sent by the logout flow: drop every cached response so nothing
  // authenticated survives on a shared device.
  if (event.data?.type === "CLEAR_CACHES") {
    event.waitUntil(
      caches.keys().then((names) =>
        Promise.all(names.map((n) => caches.delete(n)))
      ),
    );
  }
});
