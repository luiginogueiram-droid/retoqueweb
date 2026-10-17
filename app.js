/* Retoque IA Web - interface. Tudo roda no aparelho; nenhuma foto é enviada a servidor. */
'use strict';
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- diagnóstico
const logLines = [];
function log(msg) {
  const line = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
  logLines.push(line); if (logLines.length > 300) logLines.shift();
  const el = $('#log'); if (el) { el.textContent = logLines.join('\n'); el.scrollTop = el.scrollHeight; }
}
window.addEventListener('error', (e) => log(`ERRO JS: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => log(`PROMESSA REJEITADA: ${(e.reason && e.reason.message) || e.reason}`));
const status = (t) => { const el = $('#status'); if (el) el.textContent = t; };
function fail(stage, err) {
  const msg = (err && err.message) || String(err);
  log(`FALHA em "${stage}": ${msg}${err && err.stack ? '\n' + err.stack.split('\n').slice(0, 4).join('\n') : ''}`);
  status(`Erro em "${stage}": ${msg}. Abra "Diagnóstico" no fim da página e copie o relatório.`);
  const d = $('#diag'); if (d) d.open = true;
}

// ---------------------------------------------------------------- worker
let worker = null, jobId = 0;
const pending = new Map();
try {
  worker = new Worker('worker.js');
  worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); clearTimeout(p.timer); e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error)); } };
  worker.onerror = (e) => { log('Erro no worker: ' + (e.message || '?')); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(e.message || 'Erro no processamento')); } pending.clear(); };
} catch (e) { log('Não foi possível iniciar o worker: ' + e.message); }
const callWorker = (msg, transfer, timeout = 150000) => new Promise((resolve, reject) => {
  if (!worker) return reject(new Error('Processador indisponível neste navegador.'));
  const id = ++jobId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('Tempo esgotado. Tente reduzir o "Tamanho máximo da foto" em Qualidade.')); }, timeout);
  pending.set(id, { resolve, reject, timer });
  worker.postMessage({ id, ...msg }, transfer || []);
});

// ---------------------------------------------------------------- controles
const GROUPS = [
  { title: 'Pele', open: true, items: [
    { k: 'smooth', t: 'range', label: 'Suavização da pele', min: 0, max: 100, v: 50 },
    { k: 'texture', t: 'range', label: 'Textura mantida', min: 0, max: 100, v: 70 },
    { k: 'even', t: 'range', label: 'Uniformizar manchas de tom', min: 0, max: 100, v: 0 },
    { k: 'shine', t: 'range', label: 'Reduzir brilho oleoso', min: 0, max: 100, v: 0 },
    { k: 'body', t: 'check', label: 'Incluir pescoço, ombros e braços', v: false } ] },
  { title: 'Dentes e olhos', open: true, items: [
    { k: 'teeth', t: 'range', label: 'Clareamento dos dentes', min: 0, max: 100, v: 40 },
    { k: 'eyes', t: 'range', label: 'Brilho nos olhos', min: 0, max: 100, v: 30 },
    { k: 'undereye', t: 'range', label: 'Reduzir olheiras', min: 0, max: 100, v: 0 } ] },
  { title: 'Formato (liquify)', open: false, items: [
    { k: 'slim', t: 'range', label: 'Afinar rosto', min: 0, max: 100, v: 0 },
    { k: 'eyesBig', t: 'range', label: 'Aumentar olhos', min: 0, max: 100, v: 0 },
    { k: 'nose', t: 'range', label: 'Afinar nariz', min: 0, max: 100, v: 0 } ] },
  { title: 'Luz e cor', open: false, items: [
    { t: 'auto' },
    { k: 'exposure', t: 'range', label: 'Exposição', min: -100, max: 100, v: 0 },
    { k: 'contrast', t: 'range', label: 'Contraste', min: -100, max: 100, v: 0 },
    { k: 'warmth', t: 'range', label: 'Temperatura (frio ↔ quente)', min: -100, max: 100, v: 0 },
    { k: 'sharpen', t: 'range', label: 'Nitidez', min: 0, max: 100, v: 0 } ] },
  { title: 'Igualar cor da sessão', open: false, items: [
    { t: 'ref' },
    { k: 'matchStrength', t: 'range', label: 'Intensidade', min: 0, max: 100, v: 60 } ] },
  { title: 'Fundo', open: false, items: [
    { k: 'cutout', t: 'select', label: 'Recorte', options: ['Pessoa', 'Produto'], v: 'Pessoa' },
    { k: 'bg', t: 'select', label: 'Fundo', options: ['Manter', 'Transparente', 'Cor sólida', 'Desfocar', 'Sombra suave'], v: 'Manter' },
    { k: 'bgColor', t: 'color', label: 'Cor (sólida e sombra suave)', v: '#FFFFFF' },
    { k: 'bgBlur', t: 'range', label: 'Intensidade do desfoque', min: 1, max: 100, v: 35 },
    { k: 'shadow', t: 'range', label: 'Sombra suave: intensidade', min: 0, max: 100, v: 40 },
    { k: 'edge', t: 'range', label: 'Limpar borda do recorte (tira o contorno claro)', min: 0, max: 100, v: 30 },
    { k: 'hair', t: 'check', label: 'Refino de cabelo (experimental)', v: false } ] },
  { title: 'Pincéis (use os botões abaixo da foto)', open: false, items: [
    { k: 'spotSize', t: 'range', label: 'Tamanho', min: 1, max: 100, v: 25 },
    { k: 'brushStrength', t: 'range', label: 'Força (luz, sombra e empurrar)', min: 1, max: 100, v: 50 } ] },
  { title: 'Detecção', open: false, items: [
    { k: 'group', t: 'check', label: 'Foto de grupo (procura rostos pequenos; mais lento)', v: false } ] },
  { title: 'Marca d\'água', open: false, items: [
    { k: 'wmType', t: 'select', label: 'Tipo', options: ['Texto', 'Logo'], v: 'Texto' },
    { k: 'wmText', t: 'text', label: 'Texto (vazio = sem marca d\'água)', v: '' },
    { t: 'logo' },
    { k: 'wmPos', t: 'select', label: 'Posição do logo', options: ['Canto inferior direito', 'Canto inferior esquerdo', 'Centro', 'Repetido'], v: 'Canto inferior direito' },
    { k: 'wmSize', t: 'range', label: 'Tamanho do logo (% da largura)', min: 5, max: 70, v: 22 },
    { k: 'wmOpacity', t: 'range', label: 'Opacidade', min: 5, max: 100, v: 40 } ] },
  { title: 'Saída', open: false, items: [
    { k: 'maxSide', t: 'select', label: 'Tamanho da versão final. "12 MP" e "24 MP" usam a foto quase original; 24 MP pode travar.', options: ['1600', '2048', '3072', '4096', '12 MP', '24 MP'], v: '2048' },
    { k: 'exportSize', t: 'select', label: 'Formato para redes (recorta centrando nos rostos)', options: ['Original', 'Feed 4:5 (1080×1350)', 'Stories/Reels 9:16 (1080×1920)', 'Quadrado 1:1 (1080×1080)', 'Capa 16:9 (1920×1080)'], v: 'Original' },
    { k: 'keepExif', t: 'check', label: 'Manter dados da câmera (EXIF) e perfil de cor — inclui localização, se a foto tiver', v: true } ] },
];
const BUILTIN_PRESETS = {
  'Natural': { smooth: 30, texture: 85, teeth: 20, eyes: 15, slim: 0, eyesBig: 0, nose: 0, sharpen: 10 },
  'Casamento': { smooth: 45, texture: 75, body: true, teeth: 35, eyes: 30, undereye: 20, sharpen: 20, warmth: 8 },
  'Família / gestante': { smooth: 55, texture: 70, body: true, even: 25, teeth: 25, eyes: 20, warmth: 5 },
  'Retrato marcante': { smooth: 65, texture: 60, shine: 30, teeth: 40, eyes: 35, undereye: 25, sharpen: 25, contrast: 12 },
  'Produto (e-commerce)': { cutout: 'Produto', bg: 'Sombra suave', bgColor: '#FFFFFF', shadow: 40, smooth: 0, teeth: 0, eyes: 0, undereye: 0, sharpen: 30 },
};
const NEUTRAL_KEYS = ['smooth', 'texture', 'even', 'shine', 'body', 'teeth', 'eyes', 'undereye', 'slim', 'eyesBig', 'nose', 'exposure', 'contrast', 'warmth', 'sharpen'];
const settings = {};
const ctrl = {};            // chave -> função que atualiza o controle na tela
const saved = JSON.parse(localStorage.getItem('retoque-settings') || '{}');
let refStats = JSON.parse(localStorage.getItem('retoque-ref') || 'null');
let logoImg = null;
function changed(key) {
  localStorage.setItem('retoque-settings', JSON.stringify(settings));
  if (key === 'group') { redetect().then(onSettingsChanged); return; }
  onSettingsChanged();
}
function setValue(k, v) { settings[k] = v; if (ctrl[k]) ctrl[k](v); }
function actionRow(html, wire) { const row = document.createElement('div'); row.className = 'row'; row.innerHTML = html; wire(row); return row; }
function buildControls() {
  const host = $('#controls');
  buildPresets(host);
  for (const g of GROUPS) {
    const d = document.createElement('details'); d.open = g.open;
    d.innerHTML = `<summary>${g.title}</summary>`;
    for (const it of g.items) {
      if (it.t === 'auto') {
        d.appendChild(actionRow('<div class="presets"><button type="button" class="act">Ajuste automático de exposição e contraste</button></div>', (r) => {
          r.querySelector('button').onclick = () => {
            if (!origPrev) return status('Escolha uma foto primeiro.');
            const id = origPrev.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, origPrev.width, origPrev.height);
            const t = E.autoTone({ data: id.data, w: id.width, h: id.height });
            setValue('exposure', t.exposure); setValue('contrast', t.contrast); changed();
            status(`Automático: exposição ${t.exposure}, contraste ${t.contrast}. Ajuste fino nos controles.`);
          };
        })); continue;
      }
      if (it.t === 'ref') {
        d.appendChild(actionRow(`<div class="presets"><button type="button" class="act" id="refPick">Escolher foto de referência</button><button type="button" class="act" id="refClear">Remover</button></div><div class="hint" id="refInfo"></div><input id="refFile" type="file" accept="image/*" hidden>`, (r) => {
          const info = r.querySelector('#refInfo'), upd = () => { info.textContent = refStats ? 'Referência ativa: as outras fotos serão aproximadas da cor dela.' : 'Sem referência.'; };
          upd();
          r.querySelector('#refPick').onclick = () => r.querySelector('#refFile').click();
          r.querySelector('#refFile').onchange = async (e) => {
            const f = e.target.files[0]; if (!f) return;
            try { const c = await loadCanvas(f, 512), id = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height); refStats = E.labStats({ data: id.data, w: id.width, h: id.height }); localStorage.setItem('retoque-ref', JSON.stringify(refStats)); upd(); onSettingsChanged(); log('Referência de cor definida.'); } catch (err) { fail('foto de referência', err); }
          };
          r.querySelector('#refClear').onclick = () => { refStats = null; localStorage.removeItem('retoque-ref'); upd(); onSettingsChanged(); };
        })); continue;
      }
      if (it.t === 'logo') {
        d.appendChild(actionRow(`<div class="presets"><button type="button" class="act" id="logoPick">Escolher logo</button><button type="button" class="act" id="logoClear">Remover logo</button></div><div class="hint" id="logoInfo"></div><input id="logoFile" type="file" accept="image/*" hidden>`, (r) => {
          const info = r.querySelector('#logoInfo'), upd = () => { info.textContent = logoImg ? 'Logo carregado.' : 'Sem logo.'; };
          upd();
          r.querySelector('#logoPick').onclick = () => r.querySelector('#logoFile').click();
          r.querySelector('#logoFile').onchange = async (e) => {
            const f = e.target.files[0]; if (!f) return;
            try { const c = await loadCanvas(f, 600); const url = c.toDataURL('image/png'); localStorage.setItem('retoque-logo', url); await loadLogo(url); setValue('wmType', 'Logo'); upd(); changed(); } catch (err) { fail('logo', err); }
          };
          r.querySelector('#logoClear').onclick = () => { localStorage.removeItem('retoque-logo'); logoImg = null; upd(); onSettingsChanged(); };
        })); continue;
      }
      settings[it.k] = saved[it.k] !== undefined ? saved[it.k] : it.v;
      const row = document.createElement('label'); row.className = 'row';
      if (it.t === 'range') {
        row.innerHTML = `<span>${it.label} <b></b></span><input type="range" min="${it.min}" max="${it.max}">`;
        const input = row.querySelector('input'), out = row.querySelector('b');
        ctrl[it.k] = (v) => { input.value = v; out.textContent = v; };
        input.oninput = () => { settings[it.k] = +input.value; out.textContent = input.value; changed(it.k); };
      } else if (it.t === 'check') {
        row.className = 'row check'; row.innerHTML = `<input type="checkbox"><span>${it.label}</span>`;
        const input = row.querySelector('input');
        ctrl[it.k] = (v) => { input.checked = !!v; };
        input.onchange = () => { settings[it.k] = input.checked; changed(it.k); };
      } else if (it.t === 'select') {
        row.innerHTML = `<span>${it.label}</span><select>${it.options.map((o) => `<option>${o}</option>`).join('')}</select>`;
        const input = row.querySelector('select');
        ctrl[it.k] = (v) => { input.value = v; };
        input.onchange = () => { settings[it.k] = input.value; changed(it.k); };
      } else if (it.t === 'text') {
        row.innerHTML = `<span>${it.label}</span><input type="text" maxlength="40">`;
        const input = row.querySelector('input');
        ctrl[it.k] = (v) => { input.value = v; };
        input.oninput = () => { settings[it.k] = input.value; changed(it.k); };
      } else {
        row.innerHTML = `<span>${it.label}</span><input type="color">`;
        const input = row.querySelector('input');
        ctrl[it.k] = (v) => { input.value = v; };
        input.oninput = () => { settings[it.k] = input.value; changed(it.k); };
      }
      ctrl[it.k](settings[it.k]);
      d.appendChild(row);
    }
    host.appendChild(d);
  }
  const url = localStorage.getItem('retoque-logo'); if (url) loadLogo(url).catch(() => {});
}
function loadLogo(url) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => { logoImg = im; res(); }; im.onerror = () => rej(new Error('Logo inválido')); im.src = url; }); }

// ---------------------------------------------------------------- presets
const userPresets = () => JSON.parse(localStorage.getItem('retoque-presets') || '{}');
function buildPresets(host) {
  const d = document.createElement('details'); d.open = true;
  d.innerHTML = `<summary>Presets</summary><div class="presets"><select id="presetSel"></select>
    <button type="button" class="act" id="presetApply">Aplicar</button><button type="button" class="act" id="presetSave">Salvar atual</button><button type="button" class="act" id="presetDel">Apagar</button></div>`;
  host.appendChild(d);
  const sel = d.querySelector('#presetSel');
  const fill = (pick) => {
    sel.innerHTML = '';
    for (const n of Object.keys(BUILTIN_PRESETS)) sel.add(new Option(n, 'b:' + n));
    for (const n of Object.keys(userPresets())) sel.add(new Option('★ ' + n, 'u:' + n));
    if (pick) sel.value = pick;
  };
  fill();
  d.querySelector('#presetApply').onclick = () => {
    const [kind, ...rest] = sel.value.split(':'), name = rest.join(':');
    const p = kind === 'b' ? BUILTIN_PRESETS[name] : userPresets()[name];
    if (!p) return;
    const base = {};
    for (const k of NEUTRAL_KEYS) base[k] = DEF_NEUTRAL[k];                  // cada preset parte do neutro
    if (settings.cutout === 'Produto' && p.cutout === undefined) { base.cutout = 'Pessoa'; base.bg = 'Manter'; }
    applyPreset({ ...base, ...p }); status(`Preset "${name}" aplicado.`);
  };
  d.querySelector('#presetSave').onclick = () => {
    const name = (prompt('Nome do preset:') || '').trim();
    if (!name) return;
    const p = { ...settings }; for (const k of ['maxSide', 'group', 'exportSize', 'keepExif']) delete p[k];
    const all = userPresets(); all[name] = p; localStorage.setItem('retoque-presets', JSON.stringify(all));
    fill('u:' + name); status(`Preset "${name}" salvo.`);
  };
  d.querySelector('#presetDel').onclick = () => {
    if (!sel.value.startsWith('u:')) return status('Só dá para apagar presets seus (com ★).');
    const all = userPresets(); delete all[sel.value.slice(2)]; localStorage.setItem('retoque-presets', JSON.stringify(all)); fill();
  };
}
const DEF_NEUTRAL = (() => { const o = {}; for (const g of GROUPS) for (const it of g.items) if (NEUTRAL_KEYS.includes(it.k)) o[it.k] = it.v; return o; })();
function applyPreset(p) {
  for (const k of Object.keys(p)) if (ctrl[k]) { settings[k] = p[k]; ctrl[k](p[k]); }
  localStorage.setItem('retoque-settings', JSON.stringify(settings));
  onSettingsChanged();
}

// ---------------------------------------------------------------- MediaPipe (local)
let faceMesh = null, faceResolve = null, selfie = null, selfieResolve = null;
async function getFaceMesh() {
  if (faceMesh) return faceMesh;
  if (typeof FaceMesh === 'undefined') throw new Error('Biblioteca de rosto não carregada (pasta lib/face_mesh).');
  const t = performance.now();
  const fm = new FaceMesh({ locateFile: (f) => 'lib/face_mesh/' + f });
  fm.setOptions({ maxNumFaces: 5, refineLandmarks: true, minDetectionConfidence: 0.5, selfieMode: false });
  fm.onResults((r) => { if (faceResolve) faceResolve(r); });
  await fm.initialize();
  log(`Detector de rosto iniciado em ${Math.round(performance.now() - t)} ms`);
  return (faceMesh = fm);
}
async function getSelfie() {
  if (selfie) return selfie;
  if (typeof SelfieSegmentation === 'undefined') throw new Error('Biblioteca de fundo não carregada (pasta lib/selfie_segmentation).');
  const t = performance.now();
  const sg = new SelfieSegmentation({ locateFile: (f) => 'lib/selfie_segmentation/' + f });
  sg.setOptions({ modelSelection: 0 });
  sg.onResults((r) => { if (selfieResolve) selfieResolve(r); });
  await sg.initialize();
  log(`Segmentador de fundo iniciado em ${Math.round(performance.now() - t)} ms`);
  return (selfie = sg);
}
function smallCanvas(src, max) {
  const s = Math.min(1, max / Math.max(src.width, src.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * s)); c.height = Math.max(1, Math.round(src.height * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}
async function detectFaces(canvas) {
  const fm = await getFaceMesh(), t = performance.now();
  const res = await new Promise(async (resolve, reject) => {
    const to = setTimeout(() => reject(new Error('A detecção de rosto não respondeu.')), 60000);
    faceResolve = (r) => { clearTimeout(to); resolve(r); };
    try { await fm.send({ image: smallCanvas(canvas, 1024) }); } catch (e) { clearTimeout(to); reject(e); }
  });
  const faces = (res.multiFaceLandmarks || []).map((f) => f.map((p) => [p.x, p.y]));
  log(`Rostos detectados: ${faces.length} (${Math.round(performance.now() - t)} ms)`);
  return faces;
}

// Converte a máscara do MediaPipe em números 0-1, descobrindo sozinho em qual canal ela vem
// (alfa ou vermelho) e se está invertida (pessoa no centro deve ser mais "forte" que as bordas).
function maskToFloat(m) {
  const c = document.createElement('canvas'); c.width = m.width; c.height = m.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(m, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data, n = c.width * c.height;
  const stat = (ch) => { let mn = 255, mx = 0, sum = 0; for (let i = 0; i < n; i++) { const v = px[i * 4 + ch]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; } return { mn, mx, mean: sum / n }; };
  const sa = stat(3), sr = stat(0);
  const ch = sa.mx - sa.mn > 40 ? 3 : sr.mx - sr.mn > 40 ? 0 : -1;
  log(`Máscara ${c.width}x${c.height}: alfa[${sa.mn}-${sa.mx}] vermelho[${sr.mn}-${sr.mx}] -> canal ${ch === 3 ? 'alfa' : ch === 0 ? 'vermelho' : 'NENHUM'}`);
  if (ch < 0) throw new Error('A máscara de fundo veio sem informação (todos os pixels iguais).');
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = px[i * 4 + ch] / 255;
  // pessoa normalmente está no centro: se o centro for mais "vazio" que a borda, inverte
  const W = c.width, H = c.height; let cs = 0, cn = 0, bs = 0, bn = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inC = x > W * 0.3 && x < W * 0.7 && y > H * 0.3 && y < H * 0.7, inB = x < W * 0.08 || x > W * 0.92 || y < H * 0.08;
    if (inC) { cs += out[y * W + x]; cn++; } else if (inB) { bs += out[y * W + x]; bn++; }
  }
  const cm = cs / Math.max(cn, 1), bm = bs / Math.max(bn, 1);
  if (bm > cm + 0.25) { for (let i = 0; i < n; i++) out[i] = 1 - out[i]; log(`Máscara invertida (centro ${cm.toFixed(2)} < borda ${bm.toFixed(2)})`); }
  else log(`Máscara ok (centro ${cm.toFixed(2)}, borda ${bm.toFixed(2)})`);
  return { data: out, w: W, h: H };
}
async function segmentPerson(canvas) {
  const sg = await getSelfie(), t = performance.now();
  const res = await new Promise(async (resolve, reject) => {
    const to = setTimeout(() => reject(new Error('A separação de fundo não respondeu.')), 60000);
    selfieResolve = (r) => { clearTimeout(to); resolve(r); };
    try { await sg.send({ image: smallCanvas(canvas, 1024) }); } catch (e) { clearTimeout(to); reject(e); }
  });
  const out = maskToFloat(res.segmentationMask);
  log(`Fundo separado em ${Math.round(performance.now() - t)} ms`);
  return out;
}

// ---------------------------------------------------------------- imagem
const E = window.RetoqueEngine, MT = window.RetoqueMeta;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
function scaleFor(spec, w, h) {
  if (typeof spec === 'string' && /MP$/.test(spec)) return Math.min(1, Math.sqrt((parseFloat(spec) * 1e6) / (w * h)));
  return Math.min(1, +spec / Math.max(w, h));
}
async function loadCanvas(file, spec) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = scaleFor(spec, bmp.width, bmp.height), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c;
}
// rostos: busca rápida na foto toda; com "foto de grupo", também em 4 blocos (acha rostos pequenos)
async function detectAll(file, baseCanvas) {
  const base = await detectFaces(baseCanvas);
  if (!settings.group) return base;
  status('Procurando rostos pequenos (foto de grupo)…');
  const big = await loadCanvas(file, 2048), W = big.width, H = big.height, lists = [...base];
  for (const r of E.tileRects(W, H)) {
    const t = document.createElement('canvas'); t.width = r.w; t.height = r.h;
    t.getContext('2d').drawImage(big, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    for (const f of await detectFaces(t)) lists.push(f.map((p) => [(r.x + p[0] * r.w) / W, (r.y + p[1] * r.h) / H]));
  }
  const merged = E.mergeFaces(lists);
  log(`Foto de grupo: ${merged.length} rosto(s) depois de juntar os blocos`);
  return merged;
}
const needsSeg = () => settings.cutout !== 'Produto' && (settings.bg !== 'Manter' || settings.body);
async function runWorker(canvas, faces, seg, label, opsList) {
  const id = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  const buf = id.data.buffer, t = performance.now();
  const r = await callWorker({ w: canvas.width, h: canvas.height, buffer: buf, faces: faces || [], seg, opts: { ...settings, ref: refStats, ops: opsList || [] } }, [buf], 300000);
  log(`${label}: ${canvas.width}x${canvas.height} retocada em ${Math.round(performance.now() - t)} ms`);
  return { data: new Uint8ClampedArray(r.buffer), w: r.w, h: r.h, hasAlpha: r.hasAlpha, faceCount: r.faceCount };
}

// ---- formato para redes: recorta centrando nos rostos
const EXPORTS = { 'Feed 4:5 (1080×1350)': [1080, 1350], 'Stories/Reels 9:16 (1080×1920)': [1080, 1920], 'Quadrado 1:1 (1080×1080)': [1080, 1080], 'Capa 16:9 (1920×1080)': [1920, 1080] };
function faceFocus(faces) {
  if (!faces || !faces.length) return [0.5, 0.45];
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const f of faces) { const b = E.faceBox(f); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}
function cropFor(w, h, faces) {
  const t = EXPORTS[settings.exportSize]; if (!t) return null;
  const [fx, fy] = faceFocus(faces);
  return { t, r: E.cropRect(w, h, t[0] / t[1], fx, fy) };
}
function exportCanvas(c, faces) {
  const cf = cropFor(c.width, c.height, faces); if (!cf) return c;
  const [tw, th] = cf.t; let cur = c, { x, y, w, h } = cf.r;
  while (w / 2 >= tw && h / 2 >= th) {                      // reduz em etapas para não serrilhar
    const half = document.createElement('canvas'); half.width = Math.round(w / 2); half.height = Math.round(h / 2);
    const hc = half.getContext('2d'); hc.imageSmoothingQuality = 'high'; hc.drawImage(cur, x, y, w, h, 0, 0, half.width, half.height);
    cur = half; x = 0; y = 0; w = half.width; h = half.height;
  }
  const out = document.createElement('canvas'); out.width = tw; out.height = th;
  const oc = out.getContext('2d'); oc.imageSmoothingQuality = 'high'; oc.drawImage(cur, x, y, w, h, 0, 0, tw, th);
  return out;
}
function watermark(canvas) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, op = settings.wmOpacity / 100;
  if (settings.wmType === 'Logo') {
    if (!logoImg) return canvas;
    const lw = Math.max(8, Math.round(W * settings.wmSize / 100)), lh = Math.round(lw * logoImg.height / logoImg.width), m = Math.round(W * 0.03);
    ctx.save(); ctx.globalAlpha = op;
    if (settings.wmPos === 'Repetido') {
      ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 6);
      const reach = Math.hypot(W, H);
      for (let y = -reach; y < reach; y += lh * 2.2) for (let x = -reach; x < reach; x += lw * 2) ctx.drawImage(logoImg, x, y, lw, lh);
    } else {
      const x = settings.wmPos === 'Centro' ? (W - lw) / 2 : settings.wmPos === 'Canto inferior esquerdo' ? m : W - lw - m, y = settings.wmPos === 'Centro' ? (H - lh) / 2 : H - lh - m;
      ctx.drawImage(logoImg, x, y, lw, lh);
    }
    ctx.restore(); return canvas;
  }
  const t = (settings.wmText || '').trim();
  if (!t) return canvas;
  const fs = Math.max(14, Math.round(Math.min(W, H) / 12));
  ctx.save(); ctx.globalAlpha = op;
  ctx.font = `700 ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = Math.max(1, fs / 14);
  ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 6);
  const reach = Math.hypot(W, H), stepY = fs * 3.2, stepX = Math.max(fs * 3.2, ctx.measureText(t).width * 1.6);
  for (let y = -reach; y < reach; y += stepY) for (let x = -reach; x < reach; x += stepX) { ctx.strokeText(t, x, y); ctx.fillText(t, x, y); }
  ctx.restore();
  return canvas;
}
function toCanvas(res, faces, forPreview) {
  const c = document.createElement('canvas'); c.width = res.w; c.height = res.h;
  c.getContext('2d').putImageData(new ImageData(res.data, res.w, res.h), 0, 0);
  return watermark(forPreview ? c : exportCanvas(c, faces));
}
// gera o arquivo final, copiando EXIF/perfil de cor da foto original quando for JPEG
async function makeFile(canvas, hasAlpha, srcFile, baseName) {
  let blob = await new Promise((r) => canvas.toBlob(r, hasAlpha ? 'image/png' : 'image/jpeg', 0.95));
  if (!hasAlpha && settings.keepExif && MT && srcFile && /jpe?g/i.test(srcFile.type || srcFile.name)) {
    try {
      const meta = MT.readJpegMeta(await srcFile.arrayBuffer());
      if (meta.exif || meta.icc.length) { blob = new Blob([MT.injectJpegMeta(await blob.arrayBuffer(), meta)], { type: 'image/jpeg' }); log(`Dados da câmera copiados (EXIF ${meta.exif ? 'sim' : 'não'}, perfil de cor ${meta.icc.length ? 'sim' : 'não'}).`); }
    } catch (e) { log('Não consegui copiar o EXIF: ' + e.message); }
  }
  return new File([blob], `${baseName}_retoque.${hasAlpha ? 'png' : 'jpg'}`, { type: blob.type });
}
async function saveFiles(list) {
  if (navigator.canShare && navigator.canShare({ files: list })) {
    try { await navigator.share({ files: list }); log('Compartilhado/salvo pelo menu do sistema.'); return; } catch (e) { if (e.name === 'AbortError') return; log('Compartilhar falhou (' + e.message + '); baixando direto.'); }
  }
  for (const f of list) { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); await sleep(500); }
}

// ---------------------------------------------------------------- estado da tela
let files = [], curFile = null, curName = 'foto';
let origPrev = null, resPrev = null, cache = null, peeking = false;
let compare = false, cmpPos = 0.5, dragging = false, tool = null, ops = [], curStroke = null;
let finalFile = null, batchOut = [];
let running = false, dirty = false, timer = null;
const view = $('#view'), vctx = view.getContext('2d');
const busy = (b) => document.querySelectorAll('button').forEach((x) => (x.disabled = b));

function render() {
  if (!origPrev) return;
  const w = origPrev.width, h = origPrev.height;
  if (view.width !== w || view.height !== h) { view.width = w; view.height = h; }
  vctx.clearRect(0, 0, w, h);
  if (!resPrev || peeking) vctx.drawImage(origPrev, 0, 0);
  else if (compare && !tool) {
    vctx.drawImage(resPrev, 0, 0);
    vctx.save(); vctx.beginPath(); vctx.rect(0, 0, w * cmpPos, h); vctx.clip(); vctx.drawImage(origPrev, 0, 0); vctx.restore();
    const x = w * cmpPos, lw = Math.max(2, w / 300);
    vctx.fillStyle = '#c9a227'; vctx.fillRect(x - lw / 2, 0, lw, h);
    vctx.beginPath(); vctx.arc(x, h / 2, Math.max(14, w / 28), 0, Math.PI * 2); vctx.fill();
    vctx.fillStyle = '#16130a'; vctx.font = `700 ${Math.max(14, w / 32)}px system-ui`; vctx.textAlign = 'center'; vctx.textBaseline = 'middle'; vctx.fillText('↔', x, h / 2 + 1);
  } else vctx.drawImage(resPrev, 0, 0);
  const cf = cropFor(w, h, cache && cache.faces);                       // guia do formato para redes
  if (cf) {
    const { x, y, w: cw, h: ch } = cf.r;
    vctx.save(); vctx.fillStyle = 'rgba(0,0,0,.45)'; vctx.beginPath(); vctx.rect(0, 0, w, h); vctx.rect(x, y, cw, ch); vctx.fill('evenodd');
    vctx.strokeStyle = '#c9a227'; vctx.lineWidth = Math.max(2, w / 300); vctx.setLineDash([10, 8]); vctx.strokeRect(x, y, cw, ch); vctx.restore();
  }
  if (tool) {
    vctx.strokeStyle = '#c9a227'; vctx.lineWidth = Math.max(2, w / 300);
    const mark = (o) => { if (o.t === 'spot') { vctx.beginPath(); vctx.arc(o.x * w, o.y * h, Math.max(4, o.r * w), 0, Math.PI * 2); vctx.stroke(); } };
    ops.forEach(mark);
    if (curStroke) for (const p of curStroke.pts) { vctx.beginPath(); vctx.arc(p[0] * w, p[1] * h, Math.max(3, curStroke.r * w), 0, Math.PI * 2); vctx.stroke(); }
  }
}
const spotRadius = () => 0.004 + (settings.spotSize / 100) * 0.026;
const brushRadius = () => 0.01 + (settings.spotSize / 100) * 0.09;
const brushStrength = () => settings.brushStrength / 100;
function pointerPos(e) { const r = view.getBoundingClientRect(); return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)]; }
view.onpointerdown = (e) => {
  if (!origPrev) return;
  const [nx, ny] = pointerPos(e);
  if (tool === 'spot') { ops.push({ t: 'spot', x: nx, y: ny, r: spotRadius() }); updateToggles(); log(`Mancha ${ops.filter((o) => o.t === 'spot').length}: ${nx.toFixed(3)}, ${ny.toFixed(3)}`); onSettingsChanged(); e.preventDefault(); return; }
  if (tool) { curStroke = { t: tool, pts: tool === 'push' ? [] : [[nx, ny]], r: brushRadius(), s: brushStrength(), last: [nx, ny] }; if (view.setPointerCapture) try { view.setPointerCapture(e.pointerId); } catch (_) {} render(); e.preventDefault(); return; }
  if (compare && resPrev) { dragging = true; cmpPos = nx; if (view.setPointerCapture) try { view.setPointerCapture(e.pointerId); } catch (_) {} render(); }
};
view.onpointermove = (e) => {
  const [nx, ny] = pointerPos(e);
  if (curStroke) {
    const [lx, ly] = curStroke.last, step = curStroke.r * 0.35;
    if (Math.hypot(nx - lx, ny - ly) >= step) { curStroke.pts.push(curStroke.t === 'push' ? [lx, ly, nx - lx, ny - ly] : [nx, ny]); curStroke.last = [nx, ny]; render(); }
  } else if (dragging) { cmpPos = nx; render(); }
};
view.onpointerup = view.onpointercancel = () => {
  dragging = false;
  if (curStroke) { const st = curStroke; curStroke = null; if (st.pts.length) { delete st.last; ops.push(st); updateToggles(); onSettingsChanged(); } else render(); }
};

const TOOLS = { spot: ['#tSpot', 'Manchas', 'Toque em cada espinha ou mancha.'], dodge: ['#tDodge', 'Clarear', 'Passe o dedo onde quer mais luz.'], burn: ['#tBurn', 'Escurecer', 'Passe o dedo onde quer mais sombra.'], push: ['#tPush', 'Empurrar', 'Arraste o dedo para empurrar a imagem (liquify manual).'] };
function updateToggles() {
  $('#compare').classList.toggle('on', compare); $('#compare').textContent = compare ? 'Comparar: ligado' : 'Comparar (arrastar)';
  for (const [k, [sel, name]] of Object.entries(TOOLS)) { const b = $(sel); b.classList.toggle('on', tool === k); b.textContent = tool === k ? `${name}: ligado` : name; }
  $('#undoOp').hidden = !origPrev; $('#undoOp').textContent = ops.length ? `Desfazer (${ops.length})` : 'Desfazer';
}
function setTool(k) { tool = tool === k ? null : k; if (tool) compare = false; updateToggles(); render(); status(tool ? TOOLS[tool][2] : 'Ferramenta desligada.'); }
$('#compare').onclick = () => { compare = !compare; if (compare) tool = null; updateToggles(); render(); };
for (const [k, [sel]] of Object.entries(TOOLS)) $(sel).onclick = () => setTool(k);
$('#undoOp').onclick = () => { ops.pop(); updateToggles(); onSettingsChanged(); };

async function ensureSeg() {
  if (cache.seg) return cache.seg;
  if (cache.segFailed) throw cache.segFailed;
  try { cache.seg = await segmentPerson(origPrev); return cache.seg; }
  catch (e) { cache.segFailed = e; throw e; }
}
async function doPreview() {
  status('Atualizando prévia…');
  let seg = null;
  if (needsSeg()) {
    try { seg = await ensureSeg(); }
    catch (e) { if (settings.bg !== 'Manter') throw e; log('Sem separação de fundo; seguindo só com a restrição geométrica: ' + e.message); }
  }
  const t = performance.now(), res = await runWorker(origPrev, cache.faces, seg, 'Prévia', ops);
  resPrev = toCanvas(res, cache.faces, true);
  ['#peek', '#compare', '#final', '#tSpot', '#tDodge', '#tBurn', '#tPush'].forEach((s) => ($(s).hidden = false));
  updateToggles(); render();
  status(`${res.faceCount ? res.faceCount + ' rosto(s)' : 'Nenhum rosto detectado'}. Prévia reduzida (${((performance.now() - t) / 1000).toFixed(1)} s). Ajuste à vontade e toque em "Gerar versão final".`);
}
async function previewLoop() {
  if (running) { dirty = true; return; }
  running = true;
  try { do { dirty = false; await doPreview(); } while (dirty); }
  catch (e) { fail('prévia', e); }
  running = false;
}
function schedulePreview(delay = 350) { clearTimeout(timer); if (origPrev && cache) timer = setTimeout(previewLoop, delay); }
function onSettingsChanged() {
  finalFile = null; const f = $('#final'); if (f) f.textContent = 'Gerar versão final';
  schedulePreview();
}
async function redetect() {
  if (!curFile || !cache) return;
  busy(true);
  try { status('Procurando rostos…'); cache.faces = await detectAll(curFile, origPrev); }
  catch (e) { fail('detectar rostos', e); }
  busy(false);
}

$('#pick').onchange = async (e) => {
  files = [...e.target.files]; batchOut = []; finalFile = null; resPrev = null; cache = null; ops = []; tool = null; compare = false; curStroke = null;
  ['#batchSave', '#batchZip', '#peek', '#final', '#batch', '#compare', '#tSpot', '#tDodge', '#tBurn', '#tPush', '#undoOp'].forEach((s) => ($(s).hidden = true));
  if (!files.length) return;
  busy(true);
  try {
    curFile = files[0]; curName = curFile.name.replace(/\.[^.]+$/, '');
    status('Abrindo foto…');
    origPrev = await loadCanvas(curFile, 1000); render();
    log(`Foto "${curFile.name}" (${Math.round(curFile.size / 1024)} KB) -> prévia ${origPrev.width}x${origPrev.height}`);
    cache = { faces: null, seg: null, segFailed: null };
    status('Procurando rostos…');
    cache.faces = await detectAll(curFile, origPrev);
    $('#final').hidden = false; $('#final').textContent = 'Gerar versão final';
    $('#batch').hidden = files.length < 2;
    if (files.length > 1) log(`${files.length} fotos escolhidas (a prévia mostra a primeira).`);
    updateToggles(); schedulePreview(0);
  } catch (err) { fail('abrir foto', err); }
  busy(false);
};

$('#final').onclick = async () => {
  if (finalFile) { await saveFiles([finalFile]); return; }       // 2º toque: salvar
  if (!curFile) return status('Escolha uma foto primeiro.');
  busy(true);
  try {
    status('Gerando versão final…');
    const full = await loadCanvas(curFile, settings.maxSide);
    let seg = null;
    if (needsSeg()) { try { seg = await ensureSeg(); } catch (e) { if (settings.bg !== 'Manter') throw e; } }
    const res = await runWorker(full, cache.faces, seg, 'Final', ops);
    const out = toCanvas(res, cache.faces, false);
    finalFile = await makeFile(out, res.hasAlpha, curFile, curName);
    $('#final').textContent = 'Salvar foto';
    status(`Versão final pronta (${out.width}×${out.height}, ${Math.round(finalFile.size / 1024)} KB). Toque em "Salvar foto".`);
  } catch (err) { fail('versão final', err); }
  busy(false);
};

const pk = $('#peek');
const peek = (on) => { peeking = on; render(); };
pk.onpointerdown = () => peek(true);
pk.onpointerup = pk.onpointerleave = pk.onpointercancel = () => peek(false);
pk.oncontextmenu = (e) => e.preventDefault();

$('#batch').onclick = async () => {
  busy(true); batchOut = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i], tag = `Foto ${i + 1}/${files.length}`;
      status(`${tag}: abrindo…`);
      const c = await loadCanvas(f, settings.maxSide);
      status(`${tag}: procurando rostos…`);
      const faces = await detectAll(f, c);
      let seg = null;
      if (needsSeg()) { status(`${tag}: separando fundo…`); try { seg = await segmentPerson(c); } catch (e) { if (settings.bg !== 'Manter') throw e; } }
      status(`${tag}: retocando…`);
      const res = await runWorker(c, faces, seg, tag, []);
      batchOut.push(await makeFile(toCanvas(res, faces, false), res.hasAlpha, f, f.name.replace(/\.[^.]+$/, '')));
    }
    $('#batchSave').hidden = false; $('#batchZip').hidden = false;
    status(`Pronto: ${batchOut.length} foto(s). Toque em "Salvar todas" ou "Salvar ZIP".`);
  } catch (err) { fail('lote', err); }
  busy(false);
};
$('#batchSave').onclick = () => saveFiles(batchOut);
$('#batchZip').onclick = async () => {
  try {
    const entries = []; for (const f of batchOut) entries.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    const zip = new File([MT.makeZip(entries)], `retoque_${new Date().toISOString().slice(0, 10)}.zip`, { type: 'application/zip' });
    await saveFiles([zip]);
  } catch (e) { fail('zip', e); }
};

// ---------------------------------------------------------------- teste do sistema
$('#selfTest').onclick = async () => {
  busy(true); log('--- Teste do sistema ---');
  const step = async (name, fn) => { const t = performance.now(); try { const r = await fn(); log(`OK   ${name}${r ? ': ' + r : ''} (${Math.round(performance.now() - t)} ms)`); } catch (e) { log(`FALHOU ${name}: ${(e && e.message) || e}`); } };
  log(`Aparelho: ${navigator.userAgent}`);
  log(`Memória: ${navigator.deviceMemory || '?'} GB | núcleos: ${navigator.hardwareConcurrency || '?'} | tela: ${screen.width}x${screen.height} @${window.devicePixelRatio}x`);
  log(`https/seguro: ${window.isSecureContext} | service worker: ${'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'ativo' : 'registrado, ainda não controla a página') : 'não suportado'}`);
  log(`WebGL: ${!!document.createElement('canvas').getContext('webgl2') ? '2' : !!document.createElement('canvas').getContext('webgl') ? '1' : 'NÃO'} | compartilhar arquivos: ${!!(navigator.canShare)}`);
  await step('Motor de retoque (tela)', async () => (E && E.processImage ? 'carregado' : (() => { throw new Error('engine.js não carregou'); })()));
  await step('Metadados e ZIP', async () => (MT && MT.makeZip ? 'carregado' : (() => { throw new Error('meta.js não carregou'); })()));
  await step('Processador (worker)', async () => { const r = await callWorker({ ping: true }, [], 10000); return r.engine ? 'motor carregado' : 'motor ausente'; });
  await step('Canvas grande (12 MP)', async () => { const c = document.createElement('canvas'); c.width = 4000; c.height = 3000; const x = c.getContext('2d'); x.fillRect(0, 0, 10, 10); return x.getImageData(0, 0, 1, 1).data[3] === 255 ? 'ok' : 'canvas não guardou pixels (use tamanho menor)'; });
  await step('Detector de rosto', async () => { await getFaceMesh(); return 'pronto'; });
  if (origPrev) await step('Rostos na foto atual', async () => `${(await detectFaces(origPrev)).length}`);
  else log('(escolha uma foto e rode o teste de novo para testar detecção e fundo)');
  await step('Separador de fundo', async () => { await getSelfie(); return 'pronto'; });
  if (origPrev) await step('Máscara de fundo', async () => { const m = await segmentPerson(origPrev); return `${m.w}x${m.h}`; });
  log('--- Fim do teste ---');
  const d = $('#diag'); if (d) d.open = true;
  busy(false);
};
$('#copyLog').onclick = async () => {
  const text = logLines.join('\n');
  try { await navigator.clipboard.writeText(text); status('Relatório copiado.'); }
  catch (e) { const r = document.createRange(); r.selectNodeContents($('#log')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); status('Selecione e copie o texto do relatório.'); }
};

buildControls();
log('App iniciado.');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(() => log('Modo offline registrado.')).catch((e) => log('Service worker não registrou: ' + e.message));
