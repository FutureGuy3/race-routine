// Race Routine サービスワーカー
// 方針：ネット優先・失敗時はキャッシュ
//  - 電波があるときは毎回最新を取得（更新は即反映）し、キャッシュも上書きする
//  - 電波がない／弱い（3秒応答なし）ときは前回の版で起動する
// アプリ本体を大きく作り替えたときは CACHE の名前を変えると古いキャッシュが消える
const CACHE = 'race-routine-cache-v1';
const CORE = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const TIMEOUT_MS = 3000;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 1つ欠けても全体を失敗させない
    await Promise.all(CORE.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts：キャッシュがあれば即使い、裏で更新
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (url.origin !== location.origin) return;

  e.respondWith(networkFirst(req, e));
});

async function networkFirst(req, e) {
  const c = await caches.open(CACHE);
  const net = fetch(req).then(res => {
    if (res && res.ok) c.put(req, res.clone());
    return res;
  });
  // タイムアウト後も取得は続け、成功すれば次回用にキャッシュを更新
  e.waitUntil(net.catch(() => {}));
  try {
    return await Promise.race([
      net,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS))
    ]);
  } catch (_) {
    const hit = await c.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' && (await c.match('./') || await c.match('index.html')));
    if (hit) return hit;
    return net; // キャッシュもない場合はネットの結果（エラー）をそのまま返す
  }
}

async function staleWhileRevalidate(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}
