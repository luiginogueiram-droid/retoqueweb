// Processamento pesado em segundo plano (a tela não trava)
importScripts('engine.js');
const E = self.RetoqueEngine;
onmessage = (e) => {
  const { id, w, h, buffer, faces, seg, opts, ping } = e.data;
  if (ping) return postMessage({ id, ok: true, ping: true, engine: !!E });
  try {
    const img = { data: new Uint8ClampedArray(buffer), w, h };
    const r = E.processImage(img, faces, seg, opts);
    postMessage({ id, ok: true, w, h, buffer: r.img.data.buffer, hasAlpha: r.hasAlpha, faceCount: r.faceCount }, [r.img.data.buffer]);
  } catch (err) {
    postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
