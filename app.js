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
    { k: 'body', t: 'check', label: 'Incluir pescoço, ombros e braços', v: false } ] },
  { title: 'Dentes e olhos', open: true, items: [
    { k: 'teeth', t: 'range', label: 'Clareamento dos dentes', min: 0, max: 100, v: 40 },
    { k: 'eyes', t: 'range', label: 'Brilho nos olhos', min: 0, max: 100, v: 30 } ] },
  { title: 'Formato (liquify)', open: false, items: [
    { k: 'slim', t: 'range', label: 'Afinar rosto', min: 0, max: 100, v: 0 },
    { k: 'eyesBig', t: 'range', label: 'Aumentar olhos', min: 0, max: 100, v: 0 },
    { k: 'nose', t: 'range', label: 'Afinar nariz', min: 0, max: 100, v: 0 } ] },
  { title: 'Fundo', open: false, items: [
    { k: 'bg', t: 'select', label: 'Fundo', options: ['Manter', 'Transparente', 'Cor sólida', 'Desfocar'], v: 'Manter' },
    { k: 'bgColor', t: 'color', label: 'Cor (para cor sólida)', v: '#FFFFFF' },
    { k: 'bgBlur', t: 'range', label: 'Intensidade do desfoque', min: 1, max: 100, v: 35 } ] },
  { title: 'Qualidade da versão final', open: false, items: [
    { k: 'maxSide', t: 'select', label: 'Tamanho máximo (lado maior). 4096 pode travar celulares fracos.', options: ['1600', '2048', '3072', '4096'], v: '2048' } ] },
];
const settings = {};
const saved = JSON.parse(localStorage.getItem('retoque-settings') || '{}');
function changed() { localStorage.setItem('retoque-settings', JSON.stringify(settings)); onSettingsChanged(); }
function buildControls() {
  const host = $('#controls');
  for (const g of GROUPS) {
    const d = document.createElement('details'); d.open = g.open;
    d.innerHTML = `<summary>${g.title}</summary>`;
    for (const it of g.items) {
      settings[it.k] = saved[it.k] !== undefined ? saved[it.k] : it.v;
      const row = document.createElement('label'); row.className = 'row';
      let input;
      if (it.t === 'range') {
        row.innerHTML = `<span>${it.label} <b></b></span><input type="range" min="${it.min}" max="${it.max}">`;
        input = row.querySelector('input'); input.value = settings[it.k];
        const out = row.querySelector('b'); out.textContent = settings[it.k];
        input.oninput = () => { settings[it.k] = +input.value; out.textContent = input.value; changed(); };
      } else if (it.t === 'check') {
        row.className = 'row check'; row.innerHTML = `<input type="checkbox"><span>${it.label}</span>`;
        input = row.querySelector('input'); input.checked = !!settings[it.k];
        input.onchange = () => { settings[it.k] = input.checked; changed(); };
      } else if (it.t === 'select') {
        row.innerHTML = `<span>${it.label}</span><select>${it.options.map((o) => `<option>${o}</option>`).join('')}</select>`;
        input = row.querySelector('select'); input.value = settings[it.k];
        input.onchange = () => { settings[it.k] = input.value; changed(); };
      } else {
        row.innerHTML = `<span>${it.label}</span><input type="color">`;
        input = row.querySelector('input'); input.value = settings[it.k];
        input.oninput = () => { settings[it.k] = input.value; changed(); };
      }
      d.appendChild(row);
    }
    host.appendChild(d);
  }
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
async function loadCanvas(file, max) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c;
}
async function runWorker(canvas, faces, seg, label) {
  const id = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  const buf = id.data.buffer, t = performance.now();
  const r = await callWorker({ w: canvas.width, h: canvas.height, buffer: buf, faces: faces || [], seg, opts: { ...settings } }, [buf]);
  log(`${label}: ${canvas.width}x${canvas.height} retocada em ${Math.round(performance.now() - t)} ms`);
  return { data: new Uint8ClampedArray(r.buffer), w: r.w, h: r.h, hasAlpha: r.hasAlpha, faceCount: r.faceCount };
}
function toCanvas(res) {
  const c = document.createElement('canvas'); c.width = res.w; c.height = res.h;
  c.getContext('2d').putImageData(new ImageData(res.data, res.w, res.h), 0, 0);
  return c;
}
const toBlob = (canvas, alpha) => new Promise((r) => canvas.toBlob(r, alpha ? 'image/png' : 'image/jpeg', 0.95));
async function saveFiles(files) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files }); log('Compartilhado/salvo pelo menu do sistema.'); return; } catch (e) { if (e.name === 'AbortError') return; log('Compartilhar falhou (' + e.message + '); baixando direto.'); }
  }
  for (const f of files) { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); await sleep(500); }
}
const needsSeg = () => settings.bg !== 'Manter' || settings.body;

// ---------------------------------------------------------------- estado da tela
let files = [], curFile = null, curName = 'foto';
let origPrev = null, resPrev = null, cache = null, peeking = false;
let finalFile = null, batchOut = [];
let running = false, dirty = false, timer = null;
const view = $('#view'), vctx = view.getContext('2d');
function show(c) { view.width = c.width; view.height = c.height; vctx.clearRect(0, 0, c.width, c.height); vctx.drawImage(c, 0, 0); }
const busy = (b) => document.querySelectorAll('button').forEach((x) => (x.disabled = b));

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
  const t = performance.now(), res = await runWorker(origPrev, cache.faces, seg, 'Prévia');
  resPrev = toCanvas(res);
  if (!peeking) show(resPrev);
  $('#peek').hidden = false; $('#final').hidden = false;
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

$('#pick').onchange = async (e) => {
  files = [...e.target.files]; batchOut = []; finalFile = null; resPrev = null; cache = null;
  ['#batchSave', '#peek', '#final', '#batch'].forEach((s) => ($(s).hidden = true));
  if (!files.length) return;
  busy(true);
  try {
    curFile = files[0]; curName = curFile.name.replace(/\.[^.]+$/, '');
    status('Abrindo foto…');
    origPrev = await loadCanvas(curFile, 1000); show(origPrev);
    log(`Foto "${curFile.name}" (${Math.round(curFile.size / 1024)} KB) -> prévia ${origPrev.width}x${origPrev.height}`);
    cache = { faces: null, seg: null, segFailed: null };
    status('Procurando rostos…');
    cache.faces = await detectFaces(origPrev);
    $('#final').hidden = false; $('#final').textContent = 'Gerar versão final';
    $('#batch').hidden = files.length < 2;
    if (files.length > 1) log(`${files.length} fotos escolhidas (a prévia mostra a primeira).`);
    schedulePreview(0);
  } catch (err) { fail('abrir foto', err); }
  busy(false);
};

$('#final').onclick = async () => {
  if (finalFile) { await saveFiles([finalFile]); return; }       // 2º toque: salvar
  if (!curFile) return status('Escolha uma foto primeiro.');
  busy(true);
  try {
    status('Gerando versão final…');
    const full = await loadCanvas(curFile, +settings.maxSide);
    let seg = null;
    if (needsSeg()) { try { seg = await ensureSeg(); } catch (e) { if (settings.bg !== 'Manter') throw e; } }
    const res = await runWorker(full, cache.faces, seg, 'Final');
    const blob = await toBlob(toCanvas(res), res.hasAlpha);
    finalFile = new File([blob], `${curName}_retoque.${res.hasAlpha ? 'png' : 'jpg'}`, { type: blob.type });
    $('#final').textContent = 'Salvar foto';
    status(`Versão final pronta (${res.w}×${res.h}, ${Math.round(blob.size / 1024)} KB). Toque em "Salvar foto".`);
  } catch (err) { fail('versão final', err); }
  busy(false);
};

const pk = $('#peek');
const peek = (on) => { peeking = on; if (resPrev && origPrev) show(on ? origPrev : resPrev); };
pk.onpointerdown = () => peek(true);
pk.onpointerup = pk.onpointerleave = pk.onpointercancel = () => peek(false);
pk.oncontextmenu = (e) => e.preventDefault();

$('#batch').onclick = async () => {
  busy(true); batchOut = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i], tag = `Foto ${i + 1}/${files.length}`;
      status(`${tag}: abrindo…`);
      const c = await loadCanvas(f, +settings.maxSide);
      status(`${tag}: procurando rostos…`);
      const faces = await detectFaces(c);
      let seg = null;
      if (needsSeg()) { status(`${tag}: separando fundo…`); try { seg = await segmentPerson(c); } catch (e) { if (settings.bg !== 'Manter') throw e; } }
      status(`${tag}: retocando…`);
      const res = await runWorker(c, faces, seg, tag);
      const blob = await toBlob(toCanvas(res), res.hasAlpha);
      batchOut.push(new File([blob], `${f.name.replace(/\.[^.]+$/, '')}_retoque.${res.hasAlpha ? 'png' : 'jpg'}`, { type: blob.type }));
    }
    $('#batchSave').hidden = false;
    status(`Pronto: ${batchOut.length} foto(s). Toque em "Salvar todas".`);
  } catch (err) { fail('lote', err); }
  busy(false);
};
$('#batchSave').onclick = () => saveFiles(batchOut);

// ---------------------------------------------------------------- teste do sistema
$('#selfTest').onclick = async () => {
  busy(true); log('--- Teste do sistema ---');
  const step = async (name, fn) => { const t = performance.now(); try { const r = await fn(); log(`OK   ${name}${r ? ': ' + r : ''} (${Math.round(performance.now() - t)} ms)`); } catch (e) { log(`FALHOU ${name}: ${(e && e.message) || e}`); } };
  log(`Aparelho: ${navigator.userAgent}`);
  log(`Memória: ${navigator.deviceMemory || '?'} GB | núcleos: ${navigator.hardwareConcurrency || '?'} | tela: ${screen.width}x${screen.height} @${window.devicePixelRatio}x`);
  log(`https/seguro: ${window.isSecureContext} | service worker: ${'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'ativo' : 'registrado, ainda não controla a página') : 'não suportado'}`);
  log(`WebGL: ${!!document.createElement('canvas').getContext('webgl2') ? '2' : !!document.createElement('canvas').getContext('webgl') ? '1' : 'NÃO'} | compartilhar arquivos: ${!!(navigator.canShare)}`);
  await step('Processador (worker)', async () => { const r = await callWorker({ ping: true }, [], 10000); return r.engine ? 'motor carregado' : 'motor ausente'; });
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
