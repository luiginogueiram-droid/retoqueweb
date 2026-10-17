// Deixa o app funcionar sem internet depois da primeira abertura
const CACHE = 'retoque-v4';
const CORE = ['./', 'index.html', 'app.js', 'engine.js', 'meta.js', 'worker.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const LIBS = [
  'lib/face_mesh/face_mesh.js', 'lib/face_mesh/face_mesh.binarypb', 'lib/face_mesh/face_mesh_solution_packed_assets.data',
  'lib/face_mesh/face_mesh_solution_packed_assets_loader.js', 'lib/face_mesh/face_mesh_solution_simd_wasm_bin.js',
  'lib/face_mesh/face_mesh_solution_simd_wasm_bin.wasm', 'lib/face_mesh/face_mesh_solution_simd_wasm_bin.data', 'lib/face_mesh/face_mesh_solution_wasm_bin.js', 'lib/face_mesh/face_mesh_solution_wasm_bin.wasm',
  'lib/selfie_segmentation/selfie_segmentation.js', 'lib/selfie_segmentation/selfie_segmentation.binarypb', 'lib/selfie_segmentation/selfie_segmentation.tflite',
  'lib/selfie_segmentation/selfie_segmentation_landscape.tflite', 'lib/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.js',
  'lib/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.wasm', 'lib/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.data', 'lib/selfie_segmentation/selfie_segmentation_solution_wasm_bin.js',
  'lib/selfie_segmentation/selfie_segmentation_solution_wasm_bin.wasm',
];
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    // bibliotecas grandes: baixa em segundo plano, sem travar a instalação
    LIBS.forEach((u) => c.add(u).catch(() => {}));
  })());
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok && new URL(e.request.url).origin === location.origin) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  })));
});
