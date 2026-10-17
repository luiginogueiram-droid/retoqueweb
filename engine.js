/* Retoque IA Web - motor de processamento (roda no navegador, sem servidor).
 * Funciona no celular e também no Node (para testes). */
(function (root) {
  'use strict';

  // ---- índices dos pontos do rosto (MediaPipe Face Mesh, 478 pontos) ----
  const IDX = {
    OVAL: [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109],
    EYE_L: [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466],
    EYE_R: [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],
    BROW_L: [276,283,282,295,285,300,293,334,296,336],
    BROW_R: [46,53,52,65,55,70,63,105,66,107],
    LIPS_OUT: [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185],
    LIPS_IN: [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191],
    IRIS_L: [473,474,475,476,477],
    IRIS_R: [468,469,470,471,472],
    SKIN_SAMPLE: [4,50,280,205,425,118,347],
    JAW_L: [[172,.6],[136,1],[150,1],[149,1],[176,.8],[148,.5]],
    JAW_R: [[397,.6],[365,1],[379,1],[378,1],[400,.8],[377,.5]],
    NOSE: [[129,1],[358,1],[98,.7],[327,.7],[49,.5],[279,.5]],
  };

  // ---------------------------------------------------------------- utilidades
  function P(lm, i, w, h) {
    const p = lm[i];
    const x = p.x !== undefined ? p.x : p[0];
    const y = p.y !== undefined ? p.y : p[1];
    return [x * w, y * h];
  }
  const pts = (lm, list, w, h) => list.map((i) => P(lm, i, w, h));
  const faceWidth = (lm, w, h) => {
    const a = P(lm, 234, w, h), b = P(lm, 454, w, h);
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  function hull(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    const up = [];
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }

  function bbox(points, w, h, pad) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    pad = pad || 0;
    return {
      x0: Math.max(0, Math.floor(x0 - pad)), y0: Math.max(0, Math.floor(y0 - pad)),
      x1: Math.min(w, Math.ceil(x1 + pad) + 1), y1: Math.min(h, Math.ceil(y1 + pad) + 1),
    };
  }

  // varredura de polígono (regra par-ímpar): chama cb(y, xa, xb) para cada trecho preenchido
  function scanPoly(poly, w, h, cb) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of poly) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY));
    const n = poly.length;
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5, xs = [];
      for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
        if (xb >= xa) cb(y, xa, xb);
      }
    }
  }
  function fillPoly(mask, w, h, poly, val) {
    scanPoly(poly, w, h, (y, xa, xb) => { mask.fill(val, y * w + xa, y * w + xb + 1); });
  }

  // ---------------------------------------------------------------- desfoque rápido
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), d = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const o = y * w; let acc = src[o] * (r + 1);
      for (let i = 0; i < r; i++) acc += src[o + Math.min(i, w - 1)];
      for (let x = 0; x < w; x++) {
        acc += src[o + Math.min(x + r, w - 1)] - src[o + Math.max(x - r - 1, 0)];
        tmp[o + x] = acc / d;
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = tmp[x] * (r + 1);
      for (let i = 0; i < r; i++) acc += tmp[Math.min(i, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        acc += tmp[Math.min(y + r, h - 1) * w + x] - tmp[Math.max(y - r - 1, 0) * w + x];
        out[y * w + x] = acc / d;
      }
    }
    return out;
  }
  function gauss(src, w, h, sigma) {
    const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
    let a = boxBlur(src, w, h, r);
    a = boxBlur(a, w, h, r);
    return boxBlur(a, w, h, r);
  }
  function cropPlane(arr, w, b) {
    const cw = b.x1 - b.x0, ch = b.y1 - b.y0, out = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) out.set(arr.subarray((b.y0 + y) * w + b.x0, (b.y0 + y) * w + b.x1), y * cw);
    return out;
  }
  function putPlane(arr, w, b, crop) {
    const cw = b.x1 - b.x0, ch = b.y1 - b.y0;
    for (let y = 0; y < ch; y++) arr.set(crop.subarray(y * cw, (y + 1) * cw), (b.y0 + y) * w + b.x0);
  }
  function gaussRegion(arr, w, h, b, sigma) {
    const pad = Math.ceil(sigma * 4) + 2;
    const bb = { x0: Math.max(0, b.x0 - pad), y0: Math.max(0, b.y0 - pad), x1: Math.min(w, b.x1 + pad), y1: Math.min(h, b.y1 + pad) };
    putPlane(arr, w, bb, gauss(cropPlane(arr, w, bb), bb.x1 - bb.x0, bb.y1 - bb.y0, sigma));
  }

  // filtro guiado: suaviza preservando bordas (como um "surface blur")
  function guided(Ip, I, mI, mII, w, h, r, eps) {
    const n = w * h, Ipr = new Float32Array(n);
    for (let i = 0; i < n; i++) Ipr[i] = I[i] * Ip[i];
    const mp = boxBlur(Ip, w, h, r), mIp = boxBlur(Ipr, w, h, r);
    const a = new Float32Array(n), b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = mII[i] - mI[i] * mI[i];
      const aa = (mIp[i] - mI[i] * mp[i]) / (v + eps);
      a[i] = aa; b[i] = mp[i] - aa * mI[i];
    }
    const ma = boxBlur(a, w, h, r), mb = boxBlur(b, w, h, r), q = new Float32Array(n);
    for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
    return q;
  }

  function resizeBilinear(src, sw, sh, dw, dh) {
    const out = new Float32Array(dw * dh), fx = sw / dw, fy = sh / dh;
    for (let y = 0; y < dh; y++) {
      const sy = clamp((y + 0.5) * fy - 0.5, 0, sh - 1), y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), ty = sy - y0;
      for (let x = 0; x < dw; x++) {
        const sx = clamp((x + 0.5) * fx - 0.5, 0, sw - 1), x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), tx = sx - x0;
        const a = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
        const b = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
        out[y * dw + x] = a * (1 - ty) + b * ty;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- cor (Lab)
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fInv = (t) => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
  function rgb2lab(r, g, b, o) {
    const R = lin[r], G = lin[g], B = lin[b];
    const fx = fLab((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
    const fy = fLab(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
    const fz = fLab((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
    o[0] = 116 * fy - 16; o[1] = 500 * (fx - fy); o[2] = 200 * (fy - fz);
  }
  function lab2rgb(L, a, b, o) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const X = fInv(fx) * 0.95047, Y = fInv(fy), Z = fInv(fz) * 1.08883;
    const enc = (c) => { c = clamp(c, 0, 1); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); };
    o[0] = enc(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z);
    o[1] = enc(-0.969266 * X + 1.8760108 * Y + 0.041556 * Z);
    o[2] = enc(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z);
  }
  function percentile(arr, p) {
    const s = Float32Array.from(arr).sort();
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  }

  // ---------------------------------------------------------------- máscaras
  function colorStats(d, w, h, poly) {
    let n = 0, sr = 0, sr2 = 0, sb = 0, sb2 = 0;
    scanPoly(poly, w, h, (y, xa, xb) => {
      for (let x = xa; x <= xb; x++) {
        const i = (y * w + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2], Y = 0.299 * R + 0.587 * G + 0.114 * B;
        const cr = (R - Y) * 0.713 + 128, cb = (B - Y) * 0.564 + 128;
        n++; sr += cr; sr2 += cr * cr; sb += cb; sb2 += cb * cb;
      }
    });
    if (n < 50) return { mr: 150, sr: 12, mb: 110, sb: 12 };
    const mr = sr / n, mb = sb / n;
    return { mr, sr: Math.max(3 * Math.sqrt(Math.max(0, sr2 / n - mr * mr)), 8), mb, sb: Math.max(3 * Math.sqrt(Math.max(0, sb2 / n - mb * mb)), 8) };
  }
  function skinGate(d, i4, st) {
    const R = d[i4], G = d[i4 + 1], B = d[i4 + 2], Y = 0.299 * R + 0.587 * G + 0.114 * B;
    const cr = (R - Y) * 0.713 + 128, cb = (B - Y) * 0.564 + 128;
    const dd = Math.max(Math.abs(cr - st.mr) / st.sr, Math.abs(cb - st.mb) / st.sb);
    return dd <= 1 ? 1 : dd >= 1.5 ? 0 : 1 - (dd - 1) / 0.5;
  }

  function skinMask(img, faces, body, person) {
    const { data: d, w, h } = img, total = new Float32Array(w * h);
    for (const lm of faces) {
      const oval = hull(pts(lm, IDX.OVAL, w, h)), fw = Math.max(faceWidth(lm, w, h), 1);
      const st = colorStats(d, w, h, hull(pts(lm, IDX.SKIN_SAMPLE, w, h)));
      const bb = bbox(oval, w, h, 0);
      const m = new Float32Array(w * h);
      fillPoly(m, w, h, oval, 1);
      for (const list of [IDX.EYE_L, IDX.EYE_R, IDX.BROW_L, IDX.BROW_R, IDX.LIPS_OUT.concat(IDX.LIPS_IN)]) fillPoly(m, w, h, hull(pts(lm, list, w, h)), 0);
      for (let y = bb.y0; y < bb.y1; y++) for (let x = bb.x0; x < bb.x1; x++) {
        const i = y * w + x;
        if (m[i] > 0) m[i] = skinGate(d, i * 4, st);
      }
      gaussRegion(m, w, h, bb, Math.max(2, fw / 60));
      for (let y = bb.y0; y < bb.y1; y++) for (let x = bb.x0; x < bb.x1; x++) { const i = y * w + x; if (m[i] > total[i]) total[i] = m[i]; }

      if (body) {
        const cx = (bb.x0 + bb.x1) / 2, chinY = lm[152].y !== undefined ? lm[152].y * h : lm[152][1] * h;
        const wx0 = Math.max(0, Math.floor(cx - 2.2 * fw)), wx1 = Math.min(w, Math.ceil(cx + 2.2 * fw));
        const wy0 = Math.max(0, Math.floor(chinY - 0.3 * fw)), wy1 = Math.min(h, Math.ceil(chinY + 3.8 * fw));
        const cw = wx1 - wx0, ch = wy1 - wy0;
        if (cw > 8 && ch > 8) {
          const s = Math.min(1, 320 / Math.max(cw, ch)), gw = Math.max(2, Math.ceil(cw * s)), gh = Math.max(2, Math.ceil(ch * s));
          const gate = new Uint8Array(gw * gh);
          for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
            const sx = Math.min(w - 1, wx0 + Math.floor(x / s)), sy = Math.min(h - 1, wy0 + Math.floor(y / s));
            gate[y * gw + x] = skinGate(d, (sy * w + sx) * 4, st) > 0.5 ? 1 : 0;
          }
          const ovalLow = new Float32Array(gw * gh);
          fillPoly(ovalLow, gw, gh, oval.map((p) => [(p[0] - wx0) * s, (p[1] - wy0) * s]), 1);
          const comp = new Uint8Array(gw * gh), queue = new Int32Array(gw * gh);
          let qh = 0, qt = 0;
          for (let i = 0; i < gw * gh; i++) if (ovalLow[i] > 0 && gate[i]) { comp[i] = 1; queue[qt++] = i; }
          while (qh < qt) {
            const i = queue[qh++], x = i % gw, y = (i / gw) | 0;
            if (x > 0 && gate[i - 1] && !comp[i - 1]) { comp[i - 1] = 1; queue[qt++] = i - 1; }
            if (x < gw - 1 && gate[i + 1] && !comp[i + 1]) { comp[i + 1] = 1; queue[qt++] = i + 1; }
            if (y > 0 && gate[i - gw] && !comp[i - gw]) { comp[i - gw] = 1; queue[qt++] = i - gw; }
            if (y < gh - 1 && gate[i + gw] && !comp[i + gw]) { comp[i + gw] = 1; queue[qt++] = i + gw; }
          }
          const lowF = new Float32Array(gw * gh);
          for (let i = 0; i < gw * gh; i++) lowF[i] = comp[i] && ovalLow[i] === 0 ? 1 : 0;
          const up = resizeBilinear(lowF, gw, gh, cw, ch);
          for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
            const X = wx0 + x, Y = wy0 + y;
            const sx = smoothstep((1.9 * fw - Math.abs(X - cx)) / (0.3 * fw) + 0.5), sy = smoothstep((Y - (chinY - 0.1 * fw)) / (0.3 * fw) + 0.5);
            up[y * cw + x] *= sx * sy;
          }
          const bw2 = { x0: 0, y0: 0, x1: cw, y1: ch };
          const sm = gauss(up, cw, ch, Math.max(2, fw / 40));
          for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
            const gi = (wy0 + y) * w + wx0 + x;
            let v = sm[y * cw + x];
            if (person) v *= person[gi];
            if (v > total[gi]) total[gi] = v;
          }
        }
      }
    }
    return total;
  }

  function teethMask(img, faces) {
    const { data: d, w, h } = img, total = new Float32Array(w * h), lab = [0, 0, 0];
    for (const lm of faces) {
      const poly = pts(lm, IDX.LIPS_IN, w, h), bb = bbox(poly, w, h, 0), bw = bb.x1 - bb.x0;
      const idxs = [], Ls = [], As = [];
      scanPoly(poly, w, h, (y, xa, xb) => { for (let x = xa; x <= xb; x++) { const i = y * w + x; rgb2lab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], lab); idxs.push(i); Ls.push(lab[0]); As.push(lab[1]); } });
      if (idxs.length < 30) continue;
      const pl = percentile(Ls, 40), pa = percentile(As, 60), m = new Float32Array(w * h);
      for (let k = 0; k < idxs.length; k++) if (Ls[k] >= pl && As[k] <= pa) m[idxs[k]] = 1;
      gaussRegion(m, w, h, bb, Math.max(1, bw / 60));
      for (let y = bb.y0; y < bb.y1; y++) for (let x = bb.x0; x < bb.x1; x++) { const i = y * w + x; if (m[i] > total[i]) total[i] = m[i]; }
    }
    return total;
  }

  function eyeMask(img, faces) {
    const { data: d, w, h } = img, total = new Float32Array(w * h), lab = [0, 0, 0];
    for (const lm of faces) for (const [eye, iris] of [[IDX.EYE_L, IDX.IRIS_L], [IDX.EYE_R, IDX.IRIS_R]]) {
      const eh = hull(pts(lm, eye, w, h)), bb = bbox(eh, w, h, 0), ew = bb.x1 - bb.x0;
      const m = new Float32Array(w * h);
      fillPoly(m, w, h, eh, 1);
      fillPoly(m, w, h, hull(pts(lm, iris, w, h)), 0);
      const idxs = [], Ls = [];
      for (let y = bb.y0; y < bb.y1; y++) for (let x = bb.x0; x < bb.x1; x++) { const i = y * w + x; if (m[i] > 0) { rgb2lab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], lab); idxs.push(i); Ls.push(lab[0]); } }
      if (idxs.length < 30) continue;
      const pl = percentile(Ls, 45);
      for (let k = 0; k < idxs.length; k++) if (Ls[k] < pl) m[idxs[k]] = 0;
      gaussRegion(m, w, h, bb, Math.max(1, ew / 25));
      for (let y = bb.y0; y < bb.y1; y++) for (let x = bb.x0; x < bb.x1; x++) { const i = y * w + x; if (m[i] > total[i]) total[i] = m[i]; }
    }
    return total;
  }

  // ---------------------------------------------------------------- efeitos
  function smoothSkin(img, mask, faces, smooth, texture) {
    if (smooth <= 0) return;
    const { data, w, h } = img;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] > 0.01) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return;
    const fw = Math.max(...faces.map((lm) => faceWidth(lm, w, h)));
    const sigma = Math.max(1.5, fw / 90), pad = Math.ceil(sigma * 6 + 8);
    const b = { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(w, x1 + pad + 1), y1: Math.min(h, y1 + pad + 1) };
    const cw = b.x1 - b.x0, ch = b.y1 - b.y0, n = cw * ch, t = texture / 100, k = smooth / 100;

    const planes = [], lows = [];
    for (let c = 0; c < 3; c++) {
      const p = new Float32Array(n);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) p[y * cw + x] = data[((b.y0 + y) * w + b.x0 + x) * 4 + c];
      planes.push(p); lows.push(gauss(p, cw, ch, sigma));
    }
    const G = new Float32Array(n), GG = new Float32Array(n);
    for (let i = 0; i < n; i++) { G[i] = 0.299 * lows[0][i] + 0.587 * lows[1][i] + 0.114 * lows[2][i]; GG[i] = G[i] * G[i]; }
    const r = Math.max(2, Math.round(sigma * 2)), eps = Math.pow(10 + 0.5 * smooth, 2);
    const mG = boxBlur(G, cw, ch, r), mGG = boxBlur(GG, cw, ch, r);

    for (let c = 0; c < 3; c++) {
      const p = planes[c], low = lows[c], high = new Float32Array(n);
      for (let i = 0; i < n; i++) high[i] = p[i] - low[i];
      const lowS = gauss(guided(low, G, mG, mGG, cw, ch, r, eps), cw, ch, sigma * (0.5 + k)), hs = gauss(high, cw, ch, Math.max(0.8, sigma / 2));
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const i = y * cw + x, m = mask[(b.y0 + y) * w + b.x0 + x] * k;
        if (m <= 0.001) continue;
        const res = lowS[i] + high[i] * t + hs[i] * (1 - t);
        data[((b.y0 + y) * w + b.x0 + x) * 4 + c] = p[i] * (1 - m) + res * m;
      }
    }
  }

  function applyLab(img, mask, dL, kb) {
    if (dL <= 0 && kb <= 0) return;
    const { data, w, h } = img, lab = [0, 0, 0], rgb = [0, 0, 0];
    for (let i = 0; i < w * h; i++) {
      const m = mask[i];
      if (m < 0.003) continue;
      rgb2lab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], lab);
      lab2rgb(lab[0] + m * dL, lab[1], lab[2] - m * lab[2] * kb, rgb);
      data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2];
    }
  }
  const scaleMask = (m, k) => { if (k === 1) return m; const o = new Float32Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] * k; return o; };

  // liquify: deformação local por landmarks. Retorna { data, alpha }
  function liquify(img, faces, slim, eyesBig, nose, alpha, pushes) {
    const { data, w, h } = img;
    const hasPush = !!(pushes && pushes.length), auto = Math.max(slim, eyesBig, nose) > 0 && faces.length > 0;
    if (!auto && !hasPush) return { data, alpha };
    const s = Math.min(1, 900 / Math.max(w, h)), gw = Math.max(2, Math.floor(w * s)), gh = Math.max(2, Math.floor(h * s));
    const dx = new Float32Array(gw * gh), dy = new Float32Array(gw * gh);
    const win = (cx, cy, r) => [Math.max(0, Math.floor(cx - 3 * r)), Math.min(gw, Math.floor(cx + 3 * r) + 1), Math.max(0, Math.floor(cy - 3 * r)), Math.min(gh, Math.floor(cy + 3 * r) + 1)];
    function push(p, vx, vy, r) {
      const [xa, xb, ya, yb] = win(p[0], p[1], r);
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
        const g = Math.exp(-((x - p[0]) ** 2 + (y - p[1]) ** 2) / (2 * r * r));
        dx[y * gw + x] -= vx * g; dy[y * gw + x] -= vy * g;
      }
    }
    function magnify(c, r, k) {
      const [xa, xb, ya, yb] = win(c[0], c[1], r / 3);
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
        const rr = Math.hypot(x - c[0], y - c[1]) / r, f = Math.pow(Math.max(0, 1 - rr * rr), 2);
        dx[y * gw + x] -= (x - c[0]) * k * f; dy[y * gw + x] -= (y - c[1]) * k * f;
      }
    }
    if (auto) for (const lm of faces) {
      const fw = faceWidth(lm, gw, gh), top = P(lm, 10, gw, gh), chin = P(lm, 152, gw, gh), cx = (top[0] + chin[0]) / 2;
      if (slim > 0) {
        const mag = (slim / 100) * 0.07 * fw;
        for (const side of [IDX.JAW_L, IDX.JAW_R]) for (const [i, wt] of side) {
          const p = P(lm, i, gw, gh); push(p, (cx > p[0] ? 1 : -1) * mag * wt, 0, 0.11 * fw);
        }
      }
      if (eyesBig > 0) for (const eye of [IDX.EYE_L, IDX.EYE_R]) {
        const ps = pts(lm, eye, gw, gh), c = [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
        const ew = Math.max(...ps.map((p) => p[0])) - Math.min(...ps.map((p) => p[0]));
        magnify(c, 1.3 * ew, (eyesBig / 100) * 0.25);
      }
      if (nose > 0) {
        const mag = (nose / 100) * 0.04 * fw;
        for (const [i, wt] of IDX.NOSE) { const p = P(lm, i, gw, gh); push(p, (cx > p[0] ? 1 : -1) * mag * wt, 0, 0.06 * fw); }
      }
    }
    if (hasPush) for (const op of pushes) {
      const k = 0.4 + 0.6 * (op.s || 0.5), r = Math.max(2, op.r * gw);
      for (const pt of op.pts) push([pt[0] * gw, pt[1] * gh], pt[2] * gw * k, pt[3] * gh * k, r);
    }
    // região afetada
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const i = y * gw + x; if (Math.abs(dx[i]) > 1e-3 || Math.abs(dy[i]) > 1e-3) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
    if (x1 < 0) return { data, alpha };
    const X0 = Math.max(0, Math.floor(x0 / s) - 2), X1 = Math.min(w, Math.ceil((x1 + 1) / s) + 2), Y0 = Math.max(0, Math.floor(y0 / s) - 2), Y1 = Math.min(h, Math.ceil((y1 + 1) / s) + 2);
    const out = new Uint8ClampedArray(data), aout = alpha ? new Float32Array(alpha) : null;
    const samp = (gx, gy, arr) => { // bilinear em grade
      gx = clamp(gx, 0, gw - 1); gy = clamp(gy, 0, gh - 1);
      const xa = Math.floor(gx), ya = Math.floor(gy), xb = Math.min(gw - 1, xa + 1), yb = Math.min(gh - 1, ya + 1), tx = gx - xa, ty = gy - ya;
      return (arr[ya * gw + xa] * (1 - tx) + arr[ya * gw + xb] * tx) * (1 - ty) + (arr[yb * gw + xa] * (1 - tx) + arr[yb * gw + xb] * tx) * ty;
    };
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      const gx = (x + 0.5) * s - 0.5, gy = (y + 0.5) * s - 0.5;
      const sx = clamp(x + samp(gx, gy, dx) / s, 0, w - 1), sy = clamp(y + samp(gx, gy, dy) / s, 0, h - 1);
      const xa = Math.floor(sx), ya = Math.floor(sy), xb = Math.min(w - 1, xa + 1), yb = Math.min(h - 1, ya + 1), tx = sx - xa, ty = sy - ya;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = data[(ya * w + xa) * 4 + c] * (1 - tx) + data[(ya * w + xb) * 4 + c] * tx;
        const b = data[(yb * w + xa) * 4 + c] * (1 - tx) + data[(yb * w + xb) * 4 + c] * tx;
        out[o + c] = a * (1 - ty) + b * ty;
      }
      if (aout) {
        const a = alpha[ya * w + xa] * (1 - tx) + alpha[ya * w + xb] * tx, b = alpha[yb * w + xa] * (1 - tx) + alpha[yb * w + xb] * tx;
        aout[y * w + x] = a * (1 - ty) + b * ty;
      }
    }
    return { data: out, alpha: aout };
  }

  // ---------------------------------------------------------------- fundo
  // refina a máscara grosseira da segmentação usando a própria foto como guia
  function refineAlpha(alpha, img) {
    const { data, w, h } = img, n = w * h, I = new Float32Array(n), p = new Float32Array(n);
    for (let i = 0; i < n; i++) { I[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; p[i] = alpha[i] * 255; }
    const r = Math.max(4, Math.round(Math.max(w, h) / 250)), eps = Math.pow(0.04 * 255, 2);
    const II = new Float32Array(n); for (let i = 0; i < n; i++) II[i] = I[i] * I[i];
    const q = guided(p, I, boxBlur(I, w, h, r), boxBlur(II, w, h, r), w, h, r, eps), out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = smoothstep((q[i] / 255 - 0.3) / 0.4);
    return out;
  }
  function hexToRgb(hex) {
    const c = (hex || '#FFFFFF').replace('#', '');
    return c.length === 6 ? [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)] : [255, 255, 255];
  }
  // amostragem bilinear de um plano de baixa resolução
  function bil(p, lw, lh, fx, fy) {
    fx = clamp(fx, 0, lw - 1); fy = clamp(fy, 0, lh - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(lw - 1, x0 + 1), y1 = Math.min(lh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    return (p[y0 * lw + x0] * (1 - tx) + p[y0 * lw + x1] * tx) * (1 - ty) + (p[y1 * lw + x0] * (1 - tx) + p[y1 * lw + x1] * tx) * ty;
  }
  // cor "de dentro" da pessoa, espalhada para as bordas (para tirar o halo do fundo antigo)
  function decontamField(L, aLo) {
    const { data: d, w, h } = L, n = w * h;
    let edgeCount = 0;
    for (let i = 0; i < n; i++) if (aLo[i] > 0.02 && aLo[i] < 0.97) edgeCount++;
    if (!edgeCount) return null;
    const core = new Float32Array(n);
    for (let i = 0; i < n; i++) core[i] = aLo[i] >= 0.97 ? 1 : 0;
    const sigma = Math.max(2, Math.max(w, h) / 500), gc = gauss(core, w, h, sigma), fc = [];
    for (let c = 0; c < 3; c++) {
      const p = new Float32Array(n);
      for (let i = 0; i < n; i++) p[i] = d[i * 4 + c] * core[i];
      const g = gauss(p, w, h, sigma);
      for (let i = 0; i < n; i++) g[i] = g[i] / (gc[i] + 1e-4);
      fc.push(g);
    }
    return { fc, gc };
  }
  function shadowPlane(aLo, lw, lh, strength) {
    const off = Math.max(lw, lh), dx = Math.round(off * 0.012), dy = Math.round(off * 0.03), sh = new Float32Array(lw * lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) { const sx = x - dx, sy = y - dy; if (sx >= 0 && sy >= 0 && sx < lw && sy < lh) sh[y * lw + x] = aLo[sy * lw + sx]; }
    const g = gauss(sh, lw, lh, Math.max(2, off * 0.018)), k = (strength / 100) * 0.55;
    for (let i = 0; i < g.length; i++) g[i] *= k;
    return g;
  }
  // aux (opcional): { work, alphaWork } = versão em baixa resolução da foto (usada na resolução total)
  function composeBackground(img, alpha, o, aux) {
    const { data: d, w, h } = img, mode = o.bg, edge = o.edge;
    const L = aux ? aux.work : img, lw = L.w, lh = L.h;
    const aF = edge > 0 ? chokeAlpha(alpha, edge) : alpha;
    const aLo = aux ? (edge > 0 ? chokeAlpha(aux.alphaWork, edge) : aux.alphaWork) : aF;
    const field = edge > 0 ? decontamField(L, aLo) : null;
    let bgPlanes = null, bgCol = null, shadow = null;
    if (mode === 'Desfocar') {
      const sigma = (Math.max(lw, lh) * Math.max(o.bgBlur, 1)) / 2500;
      bgPlanes = [0, 1, 2].map((c) => { const p = new Float32Array(lw * lh); for (let i = 0; i < p.length; i++) p[i] = L.data[i * 4 + c]; return gauss(p, lw, lh, sigma); });
    } else if (mode === 'Cor sólida' || mode === 'Sombra suave') {
      bgCol = hexToRgb(o.bgColor);
      if (mode === 'Sombra suave' && o.shadow > 0) shadow = shadowPlane(aLo, lw, lh, o.shadow);
    }
    const sx = lw / w, sy = lh / h, transparent = mode === 'Transparente', same = lw === w && lh === h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, a = aF[i], i4 = i * 4;
      const fx = same ? x : (x + 0.5) * sx - 0.5, fy = same ? y : (y + 0.5) * sy - 0.5;
      if (field && a < 0.97) {
        const g = bil(field.gc, lw, lh, fx, fy);
        if (g >= 0.02) {
          const mix = a < 0.5 ? 1 : clamp((0.97 - a) / 0.47, 0, 1);
          for (let c = 0; c < 3; c++) d[i4 + c] = d[i4 + c] * (1 - mix) + bil(field.fc[c], lw, lh, fx, fy) * mix;
        }
      }
      if (transparent) { d[i4 + 3] = clamp(a * 255, 0, 255); continue; }
      if (a >= 0.999) continue;
      const sh = shadow ? 1 - bil(shadow, lw, lh, fx, fy) : 1;
      for (let c = 0; c < 3; c++) {
        const b = (bgPlanes ? bil(bgPlanes[c], lw, lh, fx, fy) : bgCol[c]) * sh;
        d[i4 + c] = d[i4 + c] * a + b * (1 - a);
      }
    }
    return transparent;
  }

  // ---------------------------------------------------------------- remover manchas (cura por toque)
  // Copia textura limpa de uma área vizinha, ajustando a cor ao redor da mancha.
  function healSpots(img, spots) {
    if (!spots || !spots.length) return;
    const { data: d, w, h } = img;
    const px = (x, y, c) => d[(clamp(Math.round(y), 0, h - 1) * w + clamp(Math.round(x), 0, w - 1)) * 4 + c];
    const ring = (x, y, rr) => {
      const n = 16, m = [0, 0, 0], ys = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 2 * Math.PI, sx = x + Math.cos(a) * rr, sy = y + Math.sin(a) * rr;
        const r = px(sx, sy, 0), g = px(sx, sy, 1), b = px(sx, sy, 2);
        m[0] += r; m[1] += g; m[2] += b; ys.push(0.299 * r + 0.587 * g + 0.114 * b);
      }
      m[0] /= n; m[1] /= n; m[2] /= n;
      const my = ys.reduce((a, v) => a + v, 0) / n, vr = ys.reduce((a, v) => a + (v - my) * (v - my), 0) / n;
      return { m, vr };
    };
    for (const s of spots) {
      const cx = s.x * w, cy = s.y * h, r = Math.max(3, s.r * w), tgt = ring(cx, cy, r * 1.5);
      let best = null, bs = Infinity;
      for (const dist of [2.6, 3.6]) for (let k = 0; k < 12; k++) {
        const a = (k / 12) * 2 * Math.PI, sx = cx + Math.cos(a) * r * dist, sy = cy + Math.sin(a) * r * dist;
        if (sx - 1.6 * r < 0 || sy - 1.6 * r < 0 || sx + 1.6 * r >= w || sy + 1.6 * r >= h) continue;
        const sr = ring(sx, sy, r * 1.5), dm = Math.hypot(sr.m[0] - tgt.m[0], sr.m[1] - tgt.m[1], sr.m[2] - tgt.m[2]);
        const cc = [px(sx, sy, 0), px(sx, sy, 1), px(sx, sy, 2)], dc = Math.hypot(cc[0] - tgt.m[0], cc[1] - tgt.m[1], cc[2] - tgt.m[2]);
        const sc = dm + 0.8 * Math.sqrt(sr.vr) + 0.6 * dc;
        if (sc < bs) { bs = sc; best = { sx, sy, sr }; }
      }
      if (!best) continue;
      const ox = best.sx - cx, oy = best.sy - cy, shift = [0, 1, 2].map((c) => tgt.m[c] - best.sr.m[c]);
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dd = Math.hypot(x - cx, y - cy) / r;
        if (dd >= 1) continue;
        const t = smoothstep((1 - dd) / 0.4), o = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) d[o + c] = d[o + c] * (1 - t) + clamp(px(x + ox, y + oy, c) + shift[c], 0, 255) * t;
      }
    }
  }

  // ---------------------------------------------------------------- luz, cor e nitidez
  function tone(img, exposure, contrast, warmth) {
    if (!exposure && !contrast && !warmth) return;
    const gain = Math.pow(2, exposure / 100), k = (contrast / 100) * 0.6;
    const luts = [0, 1, 2].map((c) => {
      const lut = new Uint8ClampedArray(256), mult = c === 0 ? 1 + (warmth / 100) * 0.1 : c === 2 ? 1 - (warmth / 100) * 0.1 : 1;
      for (let i = 0; i < 256; i++) {
        let v = Math.pow(i / 255, 2.2) * gain;
        v = Math.pow(clamp(v, 0, 1), 1 / 2.2);
        v = clamp(0.5 + (v - 0.5) * (1 + k), 0, 1);
        lut[i] = Math.round(clamp(v * mult, 0, 1) * 255);
      }
      return lut;
    });
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = luts[0][d[i]]; d[i + 1] = luts[1][d[i + 1]]; d[i + 2] = luts[2][d[i + 2]]; }
  }
  function sharpenImg(img, amount) {
    if (amount <= 0) return;
    const { data: d, w, h } = img, sigma = Math.max(0.7, Math.max(w, h) / 2000), m = Math.ceil(sigma * 6) + 2, a = (amount / 100) * 1.2, strip = 256;
    for (let y0 = 0; y0 < h; y0 += strip) {
      const y1 = Math.min(h, y0 + strip), ya = Math.max(0, y0 - m), yb = Math.min(h, y1 + m), sh = yb - ya, Y = new Float32Array(w * sh);
      for (let y = 0; y < sh; y++) for (let x = 0; x < w; x++) { const i = ((ya + y) * w + x) * 4; Y[y * w + x] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }
      const bl = gauss(Y, w, sh, sigma);
      for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
        const k = (y - ya) * w + x, dl = clamp((Y[k] - bl[k]) * a, -40, 40), i = (y * w + x) * 4;
        d[i] += dl; d[i + 1] += dl; d[i + 2] += dl;
      }
    }
  }

  // ---------------------------------------------------------------- borda do recorte (tira o "halo")
  function chokeAlpha(alpha, edge) {
    const lo = clamp((edge / 100) * 0.3, 0, 0.45), span = 1 - 2 * lo, out = new Float32Array(alpha.length);
    for (let i = 0; i < alpha.length; i++) out[i] = smoothstep((alpha[i] - lo) / span);
    return out;
  }
  // nas bordas semitransparentes, troca a cor contaminada pelo fundo antigo pela cor de dentro da pessoa
  function decontaminate(img, alpha) {
    const { data: d, w, h } = img, n = w * h;
    let edgeCount = 0;
    for (let i = 0; i < n; i++) if (alpha[i] > 0.02 && alpha[i] < 0.97) edgeCount++;
    if (!edgeCount) return;
    const core = new Float32Array(n);
    for (let i = 0; i < n; i++) core[i] = alpha[i] >= 0.97 ? 1 : 0;
    const sigma = Math.max(2, Math.max(w, h) / 500), gc = gauss(core, w, h, sigma);
    for (let c = 0; c < 3; c++) {
      const p = new Float32Array(n);
      for (let i = 0; i < n; i++) p[i] = d[i * 4 + c] * core[i];
      const gp = gauss(p, w, h, sigma);
      for (let i = 0; i < n; i++) {
        const a = alpha[i];
        if (a >= 0.97 || gc[i] < 0.02) continue;
        const mix = a < 0.5 ? 1 : clamp((0.97 - a) / 0.47, 0, 1);
        d[i * 4 + c] = d[i * 4 + c] * (1 - mix) + (gp[i] / gc[i]) * mix;
      }
    }
  }

  // ---------------------------------------------------------------- foto de grupo (blocos + junção de rostos)
  function tileRects(w, h) {
    const tw = Math.round(w * 0.6), th = Math.round(h * 0.6);
    return [[0, 0], [w - tw, 0], [0, h - th], [w - tw, h - th]].map(([x, y]) => ({ x, y, w: tw, h: th }));
  }
  function faceBox(f) {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const p of f) {
      const x = p.x !== undefined ? p.x : p[0], y = p.y !== undefined ? p.y : p[1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  }
  function mergeFaces(list) {
    const items = list.map((f) => { const b = faceBox(f); return { f, b, a: (b.x1 - b.x0) * (b.y1 - b.y0) }; }).sort((u, v) => v.a - u.a), kept = [];
    for (const o of items) {
      const cx = (o.b.x0 + o.b.x1) / 2, cy = (o.b.y0 + o.b.y1) / 2, wd = o.b.x1 - o.b.x0;
      const dup = kept.some((k) => Math.hypot(cx - (k.b.x0 + k.b.x1) / 2, cy - (k.b.y0 + k.b.y1) / 2) < 0.45 * Math.max(wd, k.b.x1 - k.b.x0));
      if (!dup) kept.push(o);
    }
    return kept.map((o) => o.f);
  }

  // ---------------------------------------------------------------- pipeline
  // ---------------------------------------------------------------- igualar cor entre fotos (Reinhard em Lab)
  function labStats(img, step) {
    const { data: d, w, h } = img, lab = [0, 0, 0], sum = [0, 0, 0], sq = [0, 0, 0];
    step = Math.max(1, step || Math.round(Math.max(w, h) / 256));
    let n = 0;
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4; rgb2lab(d[i], d[i + 1], d[i + 2], lab);
      for (let c = 0; c < 3; c++) { sum[c] += lab[c]; sq[c] += lab[c] * lab[c]; } n++;
    }
    const mean = sum.map((v) => v / n), std = sq.map((v, c) => Math.sqrt(Math.max(1e-6, v / n - mean[c] * mean[c])));
    return { mean, std };
  }
  function colorMatch(img, ref, strength) {
    const cur = labStats(img), k = clamp(strength / 100, 0, 1), { data: d, w, h } = img, lab = [0, 0, 0], rgb = [0, 0, 0];
    const ratio = [0, 1, 2].map((c) => clamp(ref.std[c] / cur.std[c], 0.75, 1.33));
    for (let i = 0; i < w * h; i++) {
      rgb2lab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], lab);
      const o = [0, 1, 2].map((c) => { const t = ref.mean[c] + (lab[c] - cur.mean[c]) * ratio[c]; return lab[c] + (t - lab[c]) * k; });
      lab2rgb(o[0], o[1], o[2], rgb); d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2];
    }
  }
  // sugestão de exposição/contraste olhando o histograma (não depende do tom de pele)
  function autoTone(img) {
    const { data: d, w, h } = img, hist = new Uint32Array(256), step = Math.max(1, Math.round(Math.max(w, h) / 400));
    let n = 0;
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) { const i = (y * w + x) * 4; hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++; n++; }
    const pct = (p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= p * n) return v; } return 255; };
    const p99 = pct(0.99), p1 = pct(0.01);
    let clipped = 0; for (let v = 250; v < 256; v++) clipped += hist[v];
    let exposure = 0, contrast = 0;
    if (p99 < 225) exposure = Math.min(0.7, Math.log2(0.93 / Math.pow(Math.max(p99, 20) / 255, 2.2))) * 100;
    else if (clipped / n > 0.02) exposure = -Math.min(0.5, (clipped / n) * 10) * 100;
    const range = (p99 - p1) / 255;
    if (range < 0.75) contrast = Math.min(25, (0.75 - range) * 60);
    return { exposure: Math.round(exposure), contrast: Math.round(contrast) };
  }

  // ---------------------------------------------------------------- acabamento fino da pele
  function skinFinish(img, mask, faces, shine, even) {
    const { data, w, h } = img;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] > 0.01) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return;
    const fw = Math.max(...faces.map((lm) => faceWidth(lm, w, h))), pad = Math.ceil(fw / 6);
    const b = { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(w, x1 + pad + 1), y1: Math.min(h, y1 + pad + 1) };
    const cw = b.x1 - b.x0, ch = b.y1 - b.y0, n = cw * ch, Lp = new Float32Array(n), Ap = new Float32Array(n), Bp = new Float32Array(n), lab = [0, 0, 0];
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = ((b.y0 + y) * w + b.x0 + x) * 4; rgb2lab(data[i], data[i + 1], data[i + 2], lab); Lp[y * cw + x] = lab[0]; Ap[y * cw + x] = lab[1]; Bp[y * cw + x] = lab[2]; }
    const ke = (even / 100) * 0.8, ks = (shine / 100) * 0.9;
    const Ab = ke > 0 ? gauss(Ap, cw, ch, Math.max(2, fw / 25)) : null, Bb = ke > 0 ? gauss(Bp, cw, ch, Math.max(2, fw / 25)) : null, Lb = ks > 0 ? gauss(Lp, cw, ch, Math.max(2, fw / 14)) : null, rgb = [0, 0, 0];
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const k = y * cw + x, m = mask[(b.y0 + y) * w + b.x0 + x];
      if (m < 0.01) continue;
      let L = Lp[k], A = Ap[k], B = Bp[k];
      if (Ab) { A += (Ab[k] - A) * ke * m; B += (Bb[k] - B) * ke * m; }
      if (Lb) { const ex = Math.max(0, L - Lb[k] - 2); L -= ex * ks * m; }
      lab2rgb(L, A, B, rgb); const i = ((b.y0 + y) * w + b.x0 + x) * 4; data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2];
    }
  }
  const EYE_L_LOW = [263, 249, 390, 373, 374, 380, 381, 382, 362], EYE_R_LOW = [33, 7, 163, 144, 145, 153, 154, 155, 133];
  function underEye(img, faces, amount) {
    const { w, h } = img, total = new Float32Array(w * h);
    for (const lm of faces) for (const [low, eye] of [[EYE_L_LOW, IDX.EYE_L], [EYE_R_LOW, IDX.EYE_R]]) {
      const lo = pts(lm, low, w, h), eh = hull(pts(lm, eye, w, h)), bb = bbox(eh, w, h, 0), ew = bb.x1 - bb.x0, shift = 0.34 * ew;
      const poly = lo.concat(lo.slice().reverse().map((p) => [p[0], p[1] + shift]));
      const m = new Float32Array(w * h);
      fillPoly(m, w, h, poly, 1); fillPoly(m, w, h, eh, 0);
      const box = bbox(poly, w, h, 0); gaussRegion(m, w, h, box, Math.max(1, ew / 6));
      for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) { const i = y * w + x; if (m[i] > total[i]) total[i] = m[i]; }
    }
    applyLab(img, total, (amount / 100) * 6, 0);
  }

  // ---------------------------------------------------------------- pincel de luz e sombra
  function dodgeBurn(img, strokes) {
    if (!strokes || !strokes.length) return;
    const { data: d, w, h } = img;
    for (const st of strokes) {
      const sign = st.t === 'dodge' ? 1 : -1, rad = Math.max(3, st.r * w), str = (0.3 + 0.7 * (st.s || 0.5)) * 0.14;
      for (const pt of st.pts) {
        const cx = pt[0] * w, cy = pt[1] * h, x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(w - 1, Math.ceil(cx + rad)), y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(h - 1, Math.ceil(cy + rad));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const dd = Math.hypot(x - cx, y - cy) / rad;
          if (dd >= 1) continue;
          const f = 1 + sign * str * smoothstep(1 - dd), i = (y * w + x) * 4;
          d[i] *= f; d[i + 1] *= f; d[i + 2] *= f;
        }
      }
    }
  }

  // ---------------------------------------------------------------- recorte de produto (fundo liso)
  function productAlpha(img) {
    const { data: d, w, h } = img, s = Math.min(1, 512 / Math.max(w, h)), gw = Math.max(4, Math.round(w * s)), gh = Math.max(4, Math.round(h * s)), n = gw * gh;
    const lab = new Float32Array(n * 3), t = [0, 0, 0];
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const i = (Math.min(h - 1, Math.floor(y / s)) * w + Math.min(w - 1, Math.floor(x / s))) * 4; rgb2lab(d[i], d[i + 1], d[i + 2], t);
      lab.set(t, (y * gw + x) * 3);
    }
    const border = [];
    for (let x = 0; x < gw; x++) { border.push(x, (gh - 1) * gw + x); }
    for (let y = 0; y < gh; y++) { border.push(y * gw, y * gw + gw - 1); }
    const med = (c) => { const v = border.map((i) => lab[i * 3 + c]).sort((p, q) => p - q); return v[v.length >> 1]; };
    const bg = [med(0), med(1), med(2)], dist = new Float32Array(n);
    for (let i = 0; i < n; i++) dist[i] = Math.hypot(lab[i * 3] - bg[0], lab[i * 3 + 1] - bg[1], lab[i * 3 + 2] - bg[2]);
    const bd = border.map((i) => dist[i]).sort((p, q) => p - q), t0 = Math.max(5, bd[Math.floor(bd.length * 0.95)] * 1.5);
    const bgc = new Uint8Array(n), queue = new Int32Array(n);
    let qh = 0, qt = 0;
    for (const i of border) if (dist[i] < t0 && !bgc[i]) { bgc[i] = 1; queue[qt++] = i; }
    while (qh < qt) {
      const i = queue[qh++], x = i % gw, y = (i / gw) | 0;
      if (x > 0 && !bgc[i - 1] && dist[i - 1] < t0) { bgc[i - 1] = 1; queue[qt++] = i - 1; }
      if (x < gw - 1 && !bgc[i + 1] && dist[i + 1] < t0) { bgc[i + 1] = 1; queue[qt++] = i + 1; }
      if (y > 0 && !bgc[i - gw] && dist[i - gw] < t0) { bgc[i - gw] = 1; queue[qt++] = i - gw; }
      if (y < gh - 1 && !bgc[i + gw] && dist[i + gw] < t0) { bgc[i + gw] = 1; queue[qt++] = i + gw; }
    }
    const low = new Float32Array(n);
    for (let i = 0; i < n; i++) low[i] = bgc[i] ? smoothstep((dist[i] - 0.6 * t0) / (0.4 * t0)) : 1;
    return refineAlpha(resizeBilinear(low, gw, gh, w, h), img);
  }
  // segundo passe, mais fino, só na faixa de transição (fios de cabelo)
  function refineAlphaFine(alpha, img) {
    const { data, w, h } = img, n = w * h, I = new Float32Array(n), II = new Float32Array(n), p = new Float32Array(n);
    for (let i = 0; i < n; i++) { I[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; II[i] = I[i] * I[i]; p[i] = alpha[i] * 255; }
    const r = Math.max(2, Math.round(Math.max(w, h) / 700)), q = guided(p, I, boxBlur(I, w, h, r), boxBlur(II, w, h, r), w, h, r, Math.pow(0.015 * 255, 2)), out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = alpha[i], wt = 1 - Math.pow(Math.abs(2 * a - 1), 4); out[i] = clamp(a * (1 - wt) + clamp(q[i] / 255, 0, 1) * wt, 0, 1); }
    return out;
  }

  // ---------------------------------------------------------------- recorte (formato de redes sociais)
  function cropRect(w, h, aspect, fx, fy) {
    let cw = w, ch = h;
    if (w / h > aspect) cw = Math.round(h * aspect); else ch = Math.round(w / aspect);
    const x = clamp(Math.round((fx === undefined ? 0.5 : fx) * w - cw / 2), 0, w - cw), y = clamp(Math.round((fy === undefined ? 0.5 : fy) * h - ch / 2), 0, h - ch);
    return { x, y, w: cw, h: ch };
  }

  // ---------------------------------------------------------------- pipeline
  const DEFAULTS = { smooth: 50, texture: 70, body: false, even: 0, shine: 0, teeth: 40, eyes: 30, undereye: 0, slim: 0, eyesBig: 0, nose: 0, exposure: 0, contrast: 0, warmth: 0, sharpen: 0,
    matchStrength: 60, ref: null, cutout: 'Pessoa', hair: false, bg: 'Manter', bgColor: '#FFFFFF', bgBlur: 35, shadow: 40, edge: 30, ops: [] };
  const HI_PIXELS = 4.5e6, WORK_MAX = 2048;

  // passos que são "suaves" (podem ser feitos em tamanho reduzido e transferidos como diferença)
  function core(work, faces, alpha, o) {
    const ops = o.ops || [];
    if (o.ref && o.matchStrength > 0) colorMatch(work, o.ref, o.matchStrength);
    if (faces.length) {
      const base = { data: new Uint8ClampedArray(work.data), w: work.w, h: work.h };
      const sm = skinMask(base, faces, o.body, alpha);
      smoothSkin(work, sm, faces, o.smooth, o.texture);
      if (o.even > 0 || o.shine > 0) skinFinish(work, sm, faces, o.shine, o.even);
      if (o.teeth > 0) applyLab(work, teethMask(base, faces), (o.teeth / 100) * 5.5, (o.teeth / 100) * 0.7);
      if (o.eyes > 0) applyLab(work, eyeMask(base, faces), (o.eyes / 100) * 3.9, (o.eyes / 100) * 0.4);
      if (o.undereye > 0) underEye(work, faces, o.undereye);
    }
    dodgeBurn(work, ops.filter((p) => p.t === 'dodge' || p.t === 'burn'));
  }
  const spotsOf = (o) => (o.ops || []).filter((p) => p.t === 'spot'), pushesOf = (o) => (o.ops || []).filter((p) => p.t === 'push');

  function retouch(img, faces, person, opts) {
    const o = Object.assign({}, DEFAULTS, opts), w = img.w, h = img.h;
    let out = { data: new Uint8ClampedArray(img.data), w, h }, alpha = person || null;
    healSpots(out, spotsOf(o));
    core(out, faces, alpha, o);
    const l = liquify(out, faces, o.slim, o.eyesBig, o.nose, alpha, pushesOf(o));
    out = { data: l.data, w, h }; alpha = l.alpha;
    tone(out, o.exposure, o.contrast, o.warmth);
    sharpenImg(out, o.sharpen);
    let hasAlpha = false;
    if (o.bg !== 'Manter' && alpha) hasAlpha = composeBackground(out, alpha, o, null);
    return { img: out, hasAlpha, faceCount: faces.length };
  }

  // área média (caixa) + bilinear: reduz a foto grande para o tamanho de trabalho
  function downscale(img, tw, th) {
    let { data, w, h } = img;
    const k = Math.max(1, Math.floor(Math.min(w / tw, h / th)));
    if (k > 1) {
      const sw = Math.floor(w / k), sh = Math.floor(h / k), out = new Uint8ClampedArray(sw * sh * 4), inv = 1 / (k * k);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) for (let c = 0; c < 4; c++) {
        let acc = 0; for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) acc += data[((y * k + j) * w + x * k + i) * 4 + c];
        out[(y * sw + x) * 4 + c] = acc * inv;
      }
      data = out; w = sw; h = sh;
    }
    const out = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) {
      const fy = clamp((y + 0.5) * (h / th) - 0.5, 0, h - 1), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < tw; x++) {
        const fx = clamp((x + 0.5) * (w / tw) - 0.5, 0, w - 1), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
        for (let c = 0; c < 4; c++) {
          const a = data[(y0 * w + x0) * 4 + c] * (1 - tx) + data[(y0 * w + x1) * 4 + c] * tx, b = data[(y1 * w + x0) * 4 + c] * (1 - tx) + data[(y1 * w + x1) * 4 + c] * tx;
          out[(y * tw + x) * 4 + c] = a * (1 - ty) + b * ty;
        }
      }
    }
    return { data: out, w: tw, h: th };
  }
  // soma, na foto grande, a diferença (editada - original) calculada em tamanho reduzido
  function addUpsampledDiff(img, edited, orig, ww, wh) {
    const { data: d, w, h } = img, diff = new Int16Array(ww * wh * 3);
    for (let i = 0; i < ww * wh; i++) for (let c = 0; c < 3; c++) diff[i * 3 + c] = edited[i * 4 + c] - orig[i * 4 + c];
    const sx = ww / w, sy = wh / h, xi0 = new Int32Array(w), xi1 = new Int32Array(w), xt = new Float32Array(w);
    for (let x = 0; x < w; x++) { const fx = clamp((x + 0.5) * sx - 0.5, 0, ww - 1); xi0[x] = Math.floor(fx); xi1[x] = Math.min(ww - 1, xi0[x] + 1); xt[x] = fx - xi0[x]; }
    for (let y = 0; y < h; y++) {
      const fy = clamp((y + 0.5) * sy - 0.5, 0, wh - 1), y0 = Math.floor(fy), y1 = Math.min(wh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const t = xt[x], i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const a = diff[(y0 * ww + xi0[x]) * 3 + c] * (1 - t) + diff[(y0 * ww + xi1[x]) * 3 + c] * t, b = diff[(y1 * ww + xi0[x]) * 3 + c] * (1 - t) + diff[(y1 * ww + xi1[x]) * 3 + c] * t;
          d[i + c] += a * (1 - ty) + b * ty;
        }
      }
    }
  }
  function alphaFrom(o, seg, img, faceless) {
    if (o.cutout === 'Produto') return o.bg !== 'Manter' ? productAlpha(img) : null;
    if (!seg) return null;
    const a = refineAlpha(resizeBilinear(seg.data, seg.w, seg.h, img.w, img.h), img);
    return o.hair ? refineAlphaFine(a, img) : a;
  }
  // foto grande: edita em tamanho de trabalho e transfere; geometria, luz, nitidez e fundo na foto grande
  function retouchHi(img, faces, seg, o) {
    const w = img.w, h = img.h, s = Math.min(1, WORK_MAX / Math.max(w, h)), ww = Math.round(w * s), wh = Math.round(h * s);
    healSpots(img, spotsOf(o));
    const work = downscale(img, ww, wh), orig = new Uint8ClampedArray(work.data), aw = alphaFrom(o, seg, work);
    core(work, faces, aw, o);
    addUpsampledDiff(img, work.data, orig, ww, wh);
    let alpha = aw ? resizeBilinear(aw, ww, wh, w, h) : null;
    const l = liquify(img, faces, o.slim, o.eyesBig, o.nose, alpha, pushesOf(o));
    const out = { data: l.data, w, h }; alpha = l.alpha;
    tone(out, o.exposure, o.contrast, o.warmth);
    sharpenImg(out, o.sharpen);
    let hasAlpha = false;
    if (o.bg !== 'Manter' && alpha) hasAlpha = composeBackground(out, alpha, o, { work, alphaWork: aw });
    return { img: out, hasAlpha, faceCount: faces.length };
  }
  // ponto de entrada: escolhe sozinho entre o caminho normal e o de foto grande
  function processImage(img, faces, seg, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    if (img.w * img.h > HI_PIXELS) return retouchHi(img, faces, seg, o);
    return retouch(img, faces, alphaFrom(o, seg, img), o);
  }

  const E = { IDX, DEFAULTS, processImage, retouchHi, labStats, colorMatch, autoTone, skinFinish, underEye, dodgeBurn, productAlpha, refineAlphaFine, cropRect, downscale, composeBackground, faceBox, retouch, skinMask, smoothSkin, liquify, refineAlpha, resizeBilinear, gauss, boxBlur, healSpots, tone, sharpenImg, chokeAlpha, decontaminate, tileRects, mergeFaces };
  if (typeof module !== 'undefined' && module.exports) module.exports = E; else root.RetoqueEngine = E;
})(typeof self !== 'undefined' ? self : globalThis);
