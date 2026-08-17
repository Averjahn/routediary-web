const CACHE_NAME = 'avtopuls-v40';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/state.js',
  './js/paywall.js',
  './js/subscription.js',
  './js/db.js',
  './js/theme.js',
  './js/i18n.js',
  './js/format.js',
  './js/geo.js',
  './js/tracking.js',
  './js/ui.js',
  './js/installBanner.js',
  './js/mapLayers.js',
  './js/icons.js',
  './js/carArt.js',
  './js/vehicleCatalog.js',
  './js/vehicleClass.js',
  './js/vehicleData.js',
  './js/referral.js',
  './js/crypto.js',
  './js/sync.js',
  './js/syncClient.js',
  './js/qr.js',
  './js/hud.js',
  './js/stops.js',
  './js/roadRules.js',
  './js/roadData.js',
  './js/signalTiming.js',
  './js/signalPoolClient.js',
  './js/screens/signals.js',
  './js/documents.js',
  './js/exportData.js',
  './js/parts.js',
  './js/photos.js',
  './js/guides.js',
  './js/guideArt.js',
  './js/screens/guide.js',
  './js/telegram.js',
  './js/usage.js',
  './js/tonPay.js',
  './js/cardPay.js',
  './js/quickAccount.js',
  './js/features.js',
  './js/screens/map.js',
  './js/screens/trips.js',
  './js/screens/car.js',
  './js/screens/settings.js',
  './js/screens/stats.js',
  './fonts/inter.css',
  './fonts/inter-400-cyrillic-ext.woff2',
  './fonts/inter-400-cyrillic.woff2',
  './fonts/inter-400-latin-ext.woff2',
  './fonts/inter-400-latin.woff2',
  './fonts/inter-500-cyrillic-ext.woff2',
  './fonts/inter-500-cyrillic.woff2',
  './fonts/inter-500-latin-ext.woff2',
  './fonts/inter-500-latin.woff2',
  './fonts/inter-600-cyrillic-ext.woff2',
  './fonts/inter-600-cyrillic.woff2',
  './fonts/inter-600-latin-ext.woff2',
  './fonts/inter-600-latin.woff2',
  './fonts/inter-700-cyrillic-ext.woff2',
  './fonts/inter-700-cyrillic.woff2',
  './fonts/inter-700-latin-ext.woff2',
  './fonts/inter-700-latin.woff2',
  './fonts/inter-800-cyrillic-ext.woff2',
  './fonts/inter-800-cyrillic.woff2',
  './fonts/inter-800-latin-ext.woff2',
  './fonts/inter-800-latin.woff2',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-shadow.png',
  './icons/icon.svg',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Обмен с сервером синхронизации мимо кэша — всегда и с любого источника.
  // Иначе офлайн отдался бы сохранённый «список изменений», клиент принял бы
  // его за свежий и сдвинул номер ревизии, после чего пропустил бы настоящие
  // правки с других устройств. Отсутствие сети движок обрабатывает сам.
  if (url.pathname.startsWith('/api/')) return;

  // Тайлы карт и внешние CDN — сеть, затем кэш как fallback (не блокируем офлайн-старт).
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).then((resp) => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        return resp;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
  // Статика приложения — network-first: свежий деплой виден сразу,
  // кэш подстраховывает только офлайн (cache-first раньше показывал
  // старую версию сколько угодно долго без ручного bump CACHE_NAME).
  event.respondWith(
    fetch(event.request).then((resp) => {
      const clone = resp.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
      return resp;
    }).catch(() => caches.match(event.request))
  );
});
