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
  function liquify(img, faces, slim, eyesBig, nose, alpha) {
    const { data, w, h } = img;
    if (Math.max(slim, eyesBig, nose) <= 0 || !faces.length) return { data, alpha };
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
    for (const lm of faces) {
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
  function applyBackground(img, alpha, mode, hex, blur) {
    const { data, w, h } = img, n = w * h;
    if (mode === 'Transparente') { for (let i = 0; i < n; i++) data[i * 4 + 3] = clamp(alpha[i] * 255, 0, 255); return true; }
    let bg = null;
    if (mode === 'Desfocar') {
      const sigma = (Math.max(w, h) * Math.max(blur, 1)) / 2500;
      bg = [0, 1, 2].map((c) => { const p = new Float32Array(n); for (let i = 0; i < n; i++) p[i] = data[i * 4 + c]; return gauss(p, w, h, sigma); });
    }
    const col = hexToRgb(hex);
    for (let i = 0; i < n; i++) {
      const a = alpha[i];
      for (let c = 0; c < 3; c++) data[i * 4 + c] = data[i * 4 + c] * a + (bg ? bg[c][i] : col[c]) * (1 - a);
    }
    return false;
  }

  // ---------------------------------------------------------------- pipeline
  const DEFAULTS = { smooth: 50, texture: 70, body: false, teeth: 40, eyes: 30, slim: 0, eyesBig: 0, nose: 0, bg: 'Manter', bgColor: '#FFFFFF', bgBlur: 35 };

  // img: {data: Uint8ClampedArray RGBA, w, h}; faces: landmarks por rosto; person: Float32Array(w*h) ou null
  function retouch(img, faces, person, opts) {
    const o = Object.assign({}, DEFAULTS, opts), w = img.w, h = img.h;
    let out = { data: new Uint8ClampedArray(img.data), w, h }, alpha = person || null;
    if (faces.length) {
      const sm = skinMask(img, faces, o.body, alpha);
      smoothSkin(out, sm, faces, o.smooth, o.texture);
      if (o.teeth > 0) applyLab(out, scaleMask(teethMask(img, faces), 1), (o.teeth / 100) * 5.5, (o.teeth / 100) * 0.7);
      if (o.eyes > 0) applyLab(out, eyeMask(img, faces), (o.eyes / 100) * 3.9, (o.eyes / 100) * 0.4);
      const l = liquify(out, faces, o.slim, o.eyesBig, o.nose, alpha);
      out = { data: l.data, w, h }; alpha = l.alpha;
    }
    let hasAlpha = false;
    if (o.bg !== 'Manter' && alpha) hasAlpha = applyBackground(out, alpha, o.bg, o.bgColor, o.bgBlur);
    return { img: out, hasAlpha, faceCount: faces.length };
  }

  const E = { IDX, DEFAULTS, retouch, skinMask, smoothSkin, liquify, refineAlpha, resizeBilinear, gauss, boxBlur };
  if (typeof module !== 'undefined' && module.exports) module.exports = E; else root.RetoqueEngine = E;
})(typeof self !== 'undefined' ? self : globalThis);
