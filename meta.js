/* Retoque IA Web - metadados JPEG (EXIF / perfil de cor) e ZIP simples. Funciona no navegador e no Node. */
(function (root) {
  'use strict';

  // lê os blocos EXIF (APP1) e de perfil de cor (APP2 ICC) de um JPEG
  function readJpegMeta(buf) {
    const u = new Uint8Array(buf), meta = { exif: null, icc: [] };
    if (u.length < 4 || u[0] !== 0xff || u[1] !== 0xd8) return meta;
    let p = 2;
    while (p + 4 <= u.length && u[p] === 0xff) {
      const mk = u[p + 1];
      if (mk === 0xda || mk === 0xd9) break;                       // início da imagem
      const len = (u[p + 2] << 8) | u[p + 3], end = p + 2 + len;
      if (len < 2 || end > u.length) break;
      const seg = u.slice(p, end), head = String.fromCharCode(...u.slice(p + 4, p + 4 + 5));
      if (mk === 0xe1 && head.startsWith('Exif') && !meta.exif) meta.exif = seg;
      if (mk === 0xe2 && String.fromCharCode(...u.slice(p + 4, p + 4 + 11)) === 'ICC_PROFILE') meta.icc.push(seg);
      p = end;
    }
    return meta;
  }

  // a foto já sai girada certa, então a orientação do EXIF precisa virar 1 (normal)
  function exifWithOrientation1(seg) {
    const out = seg.slice(), t = 10;                                // início do TIFF dentro do segmento
    const le = out[t] === 0x49;                                      // "II" = little endian
    const r16 = (o) => (le ? out[o] | (out[o + 1] << 8) : (out[o] << 8) | out[o + 1]);
    const r32 = (o) => (le ? (out[o] | (out[o + 1] << 8) | (out[o + 2] << 16) | (out[o + 3] << 24)) >>> 0 : ((out[o] << 24) | (out[o + 1] << 16) | (out[o + 2] << 8) | out[o + 3]) >>> 0);
    const ifd = t + r32(t + 4);
    if (ifd + 2 > out.length) return out;
    const n = r16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > out.length) break;
      if (r16(e) === 0x0112) { if (le) { out[e + 8] = 1; out[e + 9] = 0; } else { out[e + 8] = 0; out[e + 9] = 1; } }
    }
    return out;
  }

  // coloca EXIF e perfil de cor no JPEG gerado pelo navegador
  function injectJpegMeta(jpegBuf, meta) {
    const u = new Uint8Array(jpegBuf);
    if (!meta || (!meta.exif && !meta.icc.length) || u[0] !== 0xff || u[1] !== 0xd8) return u;
    let at = 2;                                                      // depois do SOI...
    if (u[2] === 0xff && u[3] === 0xe0) at = 4 + ((u[4] << 8) | u[5]); // ...e depois do JFIF, se houver
    const parts = [];
    if (meta.exif) parts.push(exifWithOrientation1(meta.exif));
    for (const s of meta.icc) parts.push(s);
    const extra = parts.reduce((a, s) => a + s.length, 0), out = new Uint8Array(u.length + extra);
    out.set(u.subarray(0, at), 0);
    let o = at; for (const s of parts) { out.set(s, o); o += s.length; }
    out.set(u.subarray(at), o);
    return out;
  }

  // ---------------------------------------------------------------- ZIP (sem compressão)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  // entries: [{name:'a.jpg', data:Uint8Array}]
  function makeZip(entries) {
    const enc = new TextEncoder(), chunks = [], central = [];
    let offset = 0;
    const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const w16 = (v, x) => v.push(x & 255, (x >> 8) & 255), w32 = (v, x) => v.push(x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255);
    for (const e of entries) {
      const name = enc.encode(e.name), crc = crc32(e.data), size = e.data.length, h = [];
      w32(h, 0x04034b50); w16(h, 20); w16(h, 0x0800); w16(h, 0); w16(h, dosTime); w16(h, dosDate); w32(h, crc); w32(h, size); w32(h, size); w16(h, name.length); w16(h, 0);
      chunks.push(Uint8Array.from(h), name, e.data);
      const c = [];
      w32(c, 0x02014b50); w16(c, 20); w16(c, 20); w16(c, 0x0800); w16(c, 0); w16(c, dosTime); w16(c, dosDate); w32(c, crc); w32(c, size); w32(c, size); w16(c, name.length); w16(c, 0); w16(c, 0); w16(c, 0); w16(c, 0); w32(c, 0); w32(c, offset);
      central.push(Uint8Array.from(c), name);
      offset += h.length + name.length + size;
    }
    const cdSize = central.reduce((a, x) => a + x.length, 0), end = [];
    w32(end, 0x06054b50); w16(end, 0); w16(end, 0); w16(end, entries.length); w16(end, entries.length); w32(end, cdSize); w32(end, offset); w16(end, 0);
    const all = chunks.concat(central, [Uint8Array.from(end)]), out = new Uint8Array(all.reduce((a, x) => a + x.length, 0));
    let o = 0; for (const x of all) { out.set(x, o); o += x.length; }
    return out;
  }

  const M = { readJpegMeta, injectJpegMeta, exifWithOrientation1, makeZip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = M; else root.RetoqueMeta = M;
})(typeof self !== 'undefined' ? self : globalThis);
