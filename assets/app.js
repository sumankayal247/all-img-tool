/*
 * All Image Tool — 100% client-side. Nothing is uploaded to a server.
 *
 *  Background:  remove / replace (transparent · color · image)   @imgly/background-removal
 *  Text:        OCR extraction (12 languages)                    tesseract.js
 *  Convert:     PNG / JPG / WEBP                                  Canvas (+ heic2any input)
 *  Edit:        resize & rotate · crop · compress                Canvas
 *  Document:    images -> PDF                                     jsPDF
 *  Cleanup:     pixelate/blur · add watermark · remove watermark · EXIF view/strip
 *
 * QoL: copy-to-clipboard, paste-to-upload, before/after compare, adjust & re-run,
 *      toasts, keyboard shortcuts (Enter = run, Esc = back).
 */

const CDN = {
  imgly: "1.7.0",
  tess: "7.0.0",
  heic: "0.0.4",
  jspdf: "2.5.1",
  exifr: "7.1.3",
};

// ─────────────────────────── tiny DOM helpers ───────────────────────────
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const show = (e) => e.classList.remove("hidden");
const hide = (e) => e.classList.add("hidden");

const pages = { upload: $("page-upload"), confirm: $("page-confirm"), result: $("page-result"), format: $("page-format") };
function goto(name) {
  Object.values(pages).forEach(hide);
  show(pages[name]);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─────────────────────────── state ───────────────────────────
const state = {
  feature: null,
  file: null,        // single-file features
  files: [],         // multi-file features (PDF)
  imageURL: null,
  natW: 0, natH: 0,
  options: {},
  selection: null,   // normalized {x,y,w,h}
  outputBlob: null,
  outputName: "result",
  copyText: null,    // text to copy when result is text
  compareURL: null,
};
const _urls = [];
const trackURL = (u) => { _urls.push(u); return u; };

// ─────────────────────────── feature registry ───────────────────────────
const OCR_LANGS = { eng: "English", spa: "Spanish", fra: "French", deu: "German", ita: "Italian", por: "Portuguese", hin: "Hindi", ben: "Bengali", rus: "Russian", jpn: "Japanese", chi_sim: "Chinese (Simplified)", ara: "Arabic" };
const CONVERT_FORMATS = {
  PNG:  { mime: "image/png",  ext: "png",  alpha: true,  quality: false },
  JPG:  { mime: "image/jpeg", ext: "jpg",  alpha: false, quality: true },
  JPEG: { mime: "image/jpeg", ext: "jpeg", alpha: false, quality: true },
  JFIF: { mime: "image/jpeg", ext: "jfif", alpha: false, quality: true },
  WEBP: { mime: "image/webp", ext: "webp", alpha: true,  quality: true },
  AVIF: { mime: "image/avif", ext: "avif", alpha: true,  quality: true },
};
const RATIOS = { Free: null, "1:1": 1, "16:9": 16 / 9, "4:3": 4 / 3, "3:2": 3 / 2, "9:16": 9 / 16 };
const POSITIONS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];

const FEATURES = {
  removebg: { group: "Background", icon: "✂️", label: "Remove / Replace BG", sub: "Cut out the subject", runLabel: "Process", build: optRemoveBg, run: runRemoveBg },
  ocr:      { group: "Text",       icon: "🔤", label: "Extract Text (OCR)", sub: "Pull text from image", runLabel: "Extract Text", build: optOcr, run: runOcr },
  convert:  { group: "Convert",    icon: "🔁", label: "Convert Format",     sub: "PNG · JPG · WEBP",      runLabel: "Convert", build: optConvert, run: runConvert },
  topdf:    { group: "Convert",    icon: "📄", label: "Images → PDF",        sub: "Combine into a PDF",    runLabel: "Build PDF", multi: true, build: optPdf, run: runPdf },
  transform:{ group: "Edit",       icon: "📐", label: "Resize & Rotate",     sub: "Resize, rotate, flip",  runLabel: "Apply", build: optTransform, run: runTransform },
  crop:     { group: "Edit",       icon: "🔲", label: "Crop",                sub: "Drag a crop box",       runLabel: "Crop", selector: { mode: "crop", required: true }, build: optCrop, run: runCrop },
  compress: { group: "Edit",       icon: "🗜️", label: "Compress",            sub: "Shrink file size",      runLabel: "Compress", build: optCompress, run: runCompress },
  pixelate: { group: "Cleanup",    icon: "🟦", label: "Pixelate / Blur",     sub: "Censor a region",       runLabel: "Apply", selector: { mode: "region", required: true }, build: optPixelate, run: runPixelate },
  watermark:{ group: "Cleanup",    icon: "💧", label: "Add Watermark",       sub: "Text overlay",          runLabel: "Add Watermark", build: optWatermark, run: runWatermark },
  wmremove: { group: "Cleanup",    icon: "🧽", label: "Remove Watermark",    sub: "Inpaint a region",      runLabel: "Remove", selector: { mode: "region", required: true }, build: optWmRemove, run: runWmRemove },
  exif:     { group: "Cleanup",    icon: "🛈",  label: "EXIF / Metadata",     sub: "View & strip metadata", runLabel: "Read & Clean", build: optExif, run: runExif },
  formatter:{ group: "Code",       icon: "{ }", label: "Formatter",           sub: "Beautify HTML / JSON",  standalone: true, open: openFormatter },
};

// ─────────────────────────── build sidebar ───────────────────────────
(function buildSidebar() {
  const nav = $("features");
  const groups = [];
  for (const [key, def] of Object.entries(FEATURES)) {
    let g = groups.find((x) => x.name === def.group);
    if (!g) { g = { name: def.group, items: [] }; groups.push(g); }
    g.items.push([key, def]);
  }
  for (const g of groups) {
    nav.appendChild(el("div", "grouplabel", g.name));
    for (const [key, def] of g.items) {
      const b = el("button", "feature");
      b.dataset.feature = key;
      b.innerHTML = `<span class="ic">${def.icon}</span><span class="ftxt"><b>${def.label}</b><small>${def.sub}</small></span>`;
      nav.appendChild(b);
    }
  }
})();

// Flow: upload image(s) first, then pick a feature -> opens the confirm screen.
$("features").addEventListener("click", (e) => {
  const btn = e.target.closest(".feature");
  if (!btn) return;
  const def = FEATURES[btn.dataset.feature];
  // Standalone features (Formatter) don't need an uploaded image.
  if (def.standalone) {
    document.querySelectorAll(".feature").forEach((f) => f.classList.remove("active"));
    btn.classList.add("active");
    state.feature = btn.dataset.feature;
    def.open();
    return;
  }
  if (!state.files.length) { toast("Upload an image first.", "bad"); dz.classList.add("pulse"); setTimeout(() => dz.classList.remove("pulse"), 600); return; }
  document.querySelectorAll(".feature").forEach((f) => f.classList.remove("active"));
  btn.classList.add("active");
  state.feature = btn.dataset.feature;
  if (!def.multi && state.files.length > 1) toast("Using the first uploaded image for this feature.", "");
  buildConfirm();
  goto("confirm");
});

// ─────────────────────────── upload ───────────────────────────
const dz = $("dropzone");
const fileInput = $("fileInput");
$("browseBtn").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
dz.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => { if (fileInput.files.length) acceptFiles(fileInput.files); });
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) acceptFiles(e.dataTransfer.files); });

const isImage = (f) => /^image\//.test(f.type) || /\.(heic|heif|jfif|avif)$/i.test(f.name);

function acceptFiles(list) {
  const imgs = [...list].filter(isImage);
  if (!imgs.length) { $("dzFeature").textContent = "⚠️  That doesn't look like an image. Try another file."; return; }
  state.files = imgs;
  state.file = imgs[0];
  if (state.imageURL) URL.revokeObjectURL(state.imageURL);
  state.imageURL = URL.createObjectURL(state.file);
  showUploadPreview();
  // Clear the input so re-picking the SAME file fires `change` again.
  fileInput.value = "";
}

function restoreDropzone() {
  $("dzInner").innerHTML = `
    <div class="dz-icon">⬆️</div>
    <h2>Drop an image here</h2>
    <p>or <button class="link" id="browseBtn">browse your files</button> · or paste (Ctrl/⌘+V)</p>
    <p class="muted" id="dzFeature">Upload an image, then pick a feature on the left</p>`;
  $("browseBtn").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
}

// Full clean slate — used by "Start over" and when a run fails.
function resetUpload() {
  if (state.imageURL) URL.revokeObjectURL(state.imageURL);
  _urls.splice(0).forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
  state.files = []; state.file = null; state.imageURL = null;
  state.feature = null; state.options = {}; state.selection = null;
  state.outputBlob = null; state.copyText = null;
  fileInput.value = "";
  document.querySelectorAll(".feature").forEach((f) => f.classList.remove("active"));
  restoreDropzone();
  goto("upload");
}

function showUploadPreview() {
  const n = state.files.length;
  const inner = $("dzInner");
  inner.innerHTML = `
    <img class="up-preview" src="${state.imageURL}" alt="uploaded" />
    <h2>${n} image${n > 1 ? "s" : ""} ready</h2>
    <p class="muted">Now pick a feature on the left →</p>
    <p><button class="link" id="reBrowse">choose different image(s)</button></p>`;
  $("reBrowse").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
}

// paste-to-upload
document.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (!item) return;
  const file = item.getAsFile();
  if (file) { e.preventDefault(); acceptFiles([file]); }
});

// ─────────────────────────── confirm page ───────────────────────────
function buildConfirm() {
  const def = FEATURES[state.feature];
  $("confirmTitle").textContent = def.label;
  $("runBtn").textContent = def.runLabel;
  state.options = {};
  state.selection = null;

  if (def.multi) { renderPdfPreview(); }
  else { renderPreview(def); }

  def.build($("optionsCard"));
}

function renderPreview(def) {
  onDims = () => {}; // reset; only dimension-aware options (transform) re-set it
  const pcard = $("previewCard");
  if (def.selector) {
    pcard.innerHTML = `<div class="selwrap" id="selwrap"><img id="srcPreview" alt="preview" draggable="false" /><div class="selbox hidden" id="selbox"></div></div><div class="filemeta" id="srcMeta"></div>`;
  } else {
    pcard.innerHTML = `<img id="srcPreview" alt="preview" /><div class="filemeta" id="srcMeta"></div>`;
  }
  const img = $("srcPreview");
  img.src = state.imageURL;
  img.onload = () => { state.natW = img.naturalWidth; state.natH = img.naturalHeight; $("srcMeta").textContent = `${state.file.name} · ${img.naturalWidth}×${img.naturalHeight}px · ${prettySize(state.file.size)}`; onDims(); };
  img.onerror = () => { $("srcMeta").textContent = `${state.file.name} · ${prettySize(state.file.size)} (preview unavailable for this format)`; };
  if (def.selector) setupSelector(def.selector);
}
let onDims = () => {}; // set by options that need natural dimensions

function renderPdfPreview() {
  const pcard = $("previewCard");
  pcard.innerHTML = `<div class="thumbs" id="thumbs"></div><div class="filemeta">${state.files.length} image(s) · drag order is the order shown</div>`;
  const grid = $("thumbs");
  state.files.forEach((f, i) => {
    const url = trackURL(URL.createObjectURL(f));
    const cell = el("div", "thumb");
    cell.innerHTML = `<img src="${url}" /><span class="tnum">${i + 1}</span><button class="trm" data-i="${i}" title="Remove">✕</button>`;
    grid.appendChild(cell);
  });
  grid.addEventListener("click", (e) => {
    const rm = e.target.closest(".trm");
    if (!rm) return;
    state.files.splice(+rm.dataset.i, 1);
    if (!state.files.length) { goto("upload"); return; }
    renderPdfPreview();
  });
}

$("backBtn").addEventListener("click", () => goto("upload"));

// ─────────────────────────── drag-box selector ───────────────────────────
let _selGlobals = null;
function setupSelector(cfg) {
  if (_selGlobals) { window.removeEventListener("mousemove", _selGlobals.move); window.removeEventListener("mouseup", _selGlobals.up); }
  const wrap = $("selwrap"), box = $("selbox");
  let dragging = false, start = null;

  const clear = () => { state.selection = null; box.classList.add("hidden"); };
  const pos = (e) => {
    const r = wrap.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return { x: Math.max(0, Math.min(r.width, cx)), y: Math.max(0, Math.min(r.height, cy)), w: r.width, h: r.height };
  };
  const drawBox = (a, b) => {
    let x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    const ratio = cfg.mode === "crop" && state.options.ratio ? RATIOS[state.options.ratio] : null;
    if (ratio) h = w / ratio;
    box.style.left = x + "px"; box.style.top = y + "px"; box.style.width = w + "px"; box.style.height = h + "px";
    return { x, y, w, h, cw: a.w, ch: a.h };
  };
  const down = (e) => { e.preventDefault(); dragging = true; start = pos(e); box.classList.remove("hidden"); drawBox(start, start); };
  const move = (e) => { if (!dragging) return; e.preventDefault(); drawBox(start, pos(e)); };
  const up = (e) => {
    if (!dragging) return; dragging = false;
    const end = e.changedTouches ? pos({ touches: e.changedTouches }) : pos(e);
    const r = drawBox(start, end);
    if (r.w < 8 || r.h < 8) { clear(); return; }
    state.selection = { x: r.x / r.cw, y: r.y / r.ch, w: r.w / r.cw, h: r.h / r.ch };
  };
  wrap.addEventListener("mousedown", down);
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  wrap.addEventListener("touchstart", down, { passive: false });
  wrap.addEventListener("touchmove", move, { passive: false });
  wrap.addEventListener("touchend", up);
  _selGlobals = { move, up };
}

// ─────────────────────────── run dispatch ───────────────────────────
$("runBtn").addEventListener("click", run);
$("resetBtn").addEventListener("click", resetUpload);
$("errorBack").addEventListener("click", () => goto("confirm"));

async function run() {
  const def = FEATURES[state.feature];
  if (def.selector && def.selector.required && !state.selection) { toast("Draw a box on the image first.", "bad"); return; }
  goto("result");
  hide($("resultBox")); hide($("errorBox")); show($("working"));
  setProgress(null, "Preparing…");
  try {
    await def.run();
  } catch (err) {
    console.error(err);
    hide($("working"));
    $("errorText").textContent = (err && err.message) || String(err);
    show($("errorBox"));
    return;
  }
  hide($("working")); show($("resultBox"));
}

// ═══════════════════════════ OPTION PANELS ═══════════════════════════
function optRemoveBg(card) {
  card.innerHTML = `
    <h3>Remove / Replace Background</h3>
    <p class="note">The subject is detected and the background removed <b>automatically</b>.</p>
    <label>New background</label>
    <select class="field" id="bgMode"><option value="transparent">Transparent (PNG)</option><option value="color">Solid color</option><option value="image">Another image</option></select>
    <div id="bgColorRow" style="display:none"><label>Color</label><input class="field" type="color" id="bgColor" value="#ffffff" style="height:42px" /></div>
    <div id="bgImageRow" style="display:none"><label>Background image</label><input class="field" type="file" id="bgImage" accept="image/*" /></div>
    <p class="note">First run downloads the AI model (~40&nbsp;MB).</p>`;
  const mode = $("bgMode");
  const sync = () => { $("bgColorRow").style.display = mode.value === "color" ? "block" : "none"; $("bgImageRow").style.display = mode.value === "image" ? "block" : "none"; };
  mode.addEventListener("change", sync); sync();
}

function optOcr(card) {
  const opts = Object.entries(OCR_LANGS).map(([k, v]) => `<option value="${k}"${k === "eng" ? " selected" : ""}>${v}</option>`).join("");
  card.innerHTML = `<h3>Options</h3><label>Language of the text</label><select class="field" id="ocrLang">${opts}</select><p class="note">Recognised text appears next, ready to copy or save as <b>.txt</b>.</p>`;
}

function optConvert(card) {
  const opts = Object.keys(CONVERT_FORMATS).map((k) => `<option value="${k}"${k === "PNG" ? " selected" : ""}>${k}</option>`).join("");
  card.innerHTML = `<h3>Options</h3><label>Convert to</label><select class="field" id="fmt">${opts}</select>
    <div id="qRow"><label>Quality <span class="rowval" id="qval">92%</span></label><input class="field" type="range" id="quality" min="40" max="100" value="92" /></div>
    <p class="note">HEIC/HEIF inputs are decoded automatically.</p>`;
  const fmt = $("fmt"), q = $("quality");
  const sync = () => { $("qval").textContent = q.value + "%"; $("qRow").style.display = CONVERT_FORMATS[fmt.value].quality ? "block" : "none"; };
  fmt.addEventListener("change", sync); q.addEventListener("input", sync); sync();
}

function optPdf(card) {
  card.innerHTML = `<h3>PDF options</h3><label>Page size</label><select class="field" id="pdfPage"><option value="fit">Fit to each image</option><option value="a4">A4</option><option value="letter">Letter</option></select><p class="note">Images become pages in the order shown on the left.</p>`;
}

function optTransform(card) {
  card.innerHTML = `<h3>Resize</h3>
    <label>Width (px)</label><input class="field" type="number" id="tW" min="1" />
    <label>Height (px)</label><input class="field" type="number" id="tH" min="1" />
    <label class="inline"><input type="checkbox" id="tLock" checked /> Lock aspect ratio</label>
    <h3 style="margin-top:18px">Rotate / Flip</h3>
    <label>Rotation</label><select class="field" id="tRot"><option value="0">0°</option><option value="90">90° ↻</option><option value="180">180°</option><option value="270">270° ↺</option></select>
    <label class="inline"><input type="checkbox" id="tFlipH" /> Flip horizontal</label>
    <label class="inline"><input type="checkbox" id="tFlipV" /> Flip vertical</label>`;
  const w = $("tW"), h = $("tH"), lock = $("tLock");
  onDims = () => { w.value = state.natW; h.value = state.natH; };
  if (state.natW) onDims();
  const aspect = () => (state.natW && state.natH ? state.natW / state.natH : 1);
  w.addEventListener("input", () => { if (lock.checked && w.value) h.value = Math.max(1, Math.round(w.value / aspect())); });
  h.addEventListener("input", () => { if (lock.checked && h.value) w.value = Math.max(1, Math.round(h.value * aspect())); });
}

function optCrop(card) {
  const opts = Object.keys(RATIOS).map((k) => `<option value="${k}">${k}</option>`).join("");
  card.innerHTML = `<h3>Crop</h3><p class="note"><b>Drag a box</b> on the image to set the crop area.</p><label>Aspect ratio</label><select class="field" id="cropRatio">${opts}</select>`;
  $("cropRatio").addEventListener("change", (e) => { state.options.ratio = e.target.value; });
  state.options.ratio = "Free";
}

function optCompress(card) {
  card.innerHTML = `<h3>Compress</h3><label>Output format</label><select class="field" id="cFmt"><option value="JPG">JPG (most compatible)</option><option value="WEBP">WEBP (smaller)</option><option value="AVIF">AVIF (smallest)</option></select>
    <label>Mode</label><select class="field" id="cMode"><option value="quality">By quality</option><option value="target">Target file size</option></select>
    <div id="cQRow"><label>Quality <span class="rowval" id="cqv">75%</span></label><input class="field" type="range" id="cQ" min="20" max="95" value="75" /></div>
    <div id="cTRow" style="display:none"><label>Target size (KB)</label><input class="field" type="number" id="cTarget" value="200" min="10" /></div>
    <label class="inline"><input type="checkbox" id="cMax" /> Limit longest side to <input type="number" id="cMaxPx" value="1920" min="100" style="width:90px" /> px</label>`;
  const mode = $("cMode"), q = $("cQ");
  const sync = () => { $("cqv").textContent = q.value + "%"; $("cQRow").style.display = mode.value === "quality" ? "block" : "none"; $("cTRow").style.display = mode.value === "target" ? "block" : "none"; };
  mode.addEventListener("change", sync); q.addEventListener("input", sync); sync();
}

function optPixelate(card) {
  card.innerHTML = `<h3>Pixelate / Blur a region</h3><p class="note"><b>Drag a box</b> over the area to censor.</p>
    <label>Effect</label><select class="field" id="pxMode"><option value="pixelate">Pixelate</option><option value="blur">Blur</option></select>
    <label>Strength <span class="rowval" id="pxv">14</span></label><input class="field" type="range" id="pxStr" min="4" max="40" value="14" />`;
  const s = $("pxStr"); s.addEventListener("input", () => $("pxv").textContent = s.value);
}

function optWatermark(card) {
  const posOpts = POSITIONS.map((p) => `<option value="${p}"${p === "bottom-right" ? " selected" : ""}>${p}</option>`).join("");
  card.innerHTML = `<h3>Add Watermark</h3>
    <label>Text</label><input class="field" type="text" id="wmText" value="© All Image Tool" />
    <label>Size <span class="rowval" id="wsv">6%</span></label><input class="field" type="range" id="wmSize" min="2" max="20" value="6" />
    <label>Opacity <span class="rowval" id="wov">45%</span></label><input class="field" type="range" id="wmOp" min="5" max="100" value="45" />
    <label>Color</label><input class="field" type="color" id="wmColor" value="#ffffff" style="height:42px" />
    <label>Position</label><select class="field" id="wmPos">${posOpts}</select>
    <label class="inline"><input type="checkbox" id="wmTile" /> Tile across the whole image</label>`;
  $("wmSize").addEventListener("input", (e) => $("wsv").textContent = e.target.value + "%");
  $("wmOp").addEventListener("input", (e) => $("wov").textContent = e.target.value + "%");
}

function optWmRemove(card) {
  card.innerHTML = `<h3>Remove Watermark <span class="muted">(best-effort)</span></h3>
    <p class="note"><b>Drag a box</b> over the watermark. The area is reconstructed by pulling in surrounding colors (inpainting).</p>
    <label>Smoothing passes <span class="rowval" id="wrv">balanced</span></label><input class="field" type="range" id="wrStr" min="1" max="3" value="2" />
    <p class="note">⚠️ Works best on smooth or simple backgrounds. Busy textures or large watermarks may smudge — there's no perfect client-side removal.</p>`;
  const labels = { 1: "light", 2: "balanced", 3: "strong" };
  $("wrStr").addEventListener("input", (e) => $("wrv").textContent = labels[e.target.value]);
}

function optExif(card) {
  card.innerHTML = `<h3>EXIF / Metadata</h3><p class="note">Reads camera, date and GPS metadata embedded in the image, then gives you a <b>cleaned copy</b> with all metadata stripped — useful before sharing photos.</p>`;
}

// ═══════════════════════════ RUN HANDLERS ═══════════════════════════
async function runRemoveBg() {
  setProgress(null, "Loading background-removal model…");
  const { removeBackground } = await import(`https://cdn.jsdelivr.net/npm/@imgly/background-removal@${CDN.imgly}/+esm`);
  const cfg = {
    // Models live in the separate data package hosted on staticimgly (content-addressed chunks).
    publicPath: `https://staticimgly.com/@imgly/background-removal-data/${CDN.imgly}/dist/`,
    progress: (key, cur, total) => { const pct = total ? Math.round((cur / total) * 100) : 0; setProgress(pct, key.startsWith("fetch") ? `Downloading model… ${pct}%` : `Processing… ${pct}%`); },
  };
  let blob = await removeBackground(state.file, cfg);

  const mode = $("bgMode").value;
  if (mode !== "transparent") {
    const cut = await loadBitmap(blob);
    const c = el("canvas"); c.width = cut.width; c.height = cut.height;
    const ctx = c.getContext("2d");
    if (mode === "color") { ctx.fillStyle = $("bgColor").value; ctx.fillRect(0, 0, c.width, c.height); }
    else if (mode === "image") {
      const bgFile = $("bgImage").files[0];
      if (!bgFile) throw new Error("Choose a background image, or pick a different background mode.");
      const bg = await loadBitmap(await decodeForCanvasIfNeeded(bgFile));
      drawCover(ctx, bg, c.width, c.height);
    }
    ctx.drawImage(cut, 0, 0);
    blob = await canvasBlob(c, mode === "transparent" ? "image/png" : "image/png");
  }
  await finishImage(blob, `${stem(srcName())}-bg.png`, "Background " + (mode === "transparent" ? "removed" : "replaced"), { compare: true });
}

async function runOcr() {
  const lang = $("ocrLang").value || "eng";
  setProgress(null, "Loading OCR engine…");
  await ensureScript(`https://cdn.jsdelivr.net/npm/tesseract.js@${CDN.tess}/dist/tesseract.min.js`, () => window.Tesseract, "OCR engine");
  const input = await decodeForCanvasIfNeeded(state.file);
  const { data } = await window.Tesseract.recognize(input, lang, {
    logger: (m) => { if (m.status && typeof m.progress === "number") { const p = Math.round(m.progress * 100); setProgress(p, `${cap(m.status)}… ${p}%`); } },
  });
  const text = (data.text || "").trim();
  finishText(text || "(no text detected)", `${stem(srcName())}.txt`, `${text ? text.split(/\s+/).length : 0} words · ${text.length} characters`);
}

async function runConvert() {
  const key = $("fmt").value, fmt = CONVERT_FORMATS[key];
  const q = (parseInt($("quality").value, 10) || 92) / 100;
  const { canvas } = await currentCanvas(!fmt.alpha);
  const blob = await canvasBlob(canvas, fmt.mime, fmt.quality ? q : undefined);
  await finishImage(blob, `${stem(srcName())}.${fmt.ext}`, `${canvas.width}×${canvas.height}px · ${key}`);
}

async function runPdf() {
  setProgress(null, "Loading PDF engine…");
  await ensureScript(`https://cdn.jsdelivr.net/npm/jspdf@${CDN.jspdf}/dist/jspdf.umd.min.js`, () => window.jspdf, "PDF engine");
  const { jsPDF } = window.jspdf;
  const page = $("pdfPage").value;
  let pdf = null;
  const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
  for (let i = 0; i < state.files.length; i++) {
    setProgress(Math.round((i / state.files.length) * 100), `Adding page ${i + 1} of ${state.files.length}…`);
    const bm = await loadBitmap(await decodeForCanvasIfNeeded(state.files[i]));
    const c = el("canvas"); c.width = bm.width; c.height = bm.height; c.getContext("2d").drawImage(bm, 0, 0);
    const dataURL = c.toDataURL("image/jpeg", 0.92);
    if (page === "fit") {
      const fmt = [bm.width, bm.height];
      // Pass the explicit [w,h] format only (no orientation) so jsPDF doesn't swap dims.
      if (!pdf) pdf = new jsPDF({ unit: "px", format: fmt });
      else pdf.addPage(fmt);
      pdf.addImage(dataURL, "JPEG", 0, 0, bm.width, bm.height);
    } else {
      const [pw, ph] = SIZES[page];
      const orient = bm.width > bm.height ? "l" : "p";
      const W = orient === "l" ? ph : pw, H = orient === "l" ? pw : ph;
      if (!pdf) pdf = new jsPDF({ unit: "pt", format: page, orientation: orient });
      else pdf.addPage(page, orient);
      const m = 24, scale = Math.min((W - m * 2) / bm.width, (H - m * 2) / bm.height);
      const dw = bm.width * scale, dh = bm.height * scale;
      pdf.addImage(dataURL, "JPEG", (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
  }
  const blob = pdf.output("blob");
  finishFile(blob, "images.pdf", `PDF · ${state.files.length} page(s) · ${prettySize(blob.size)}`, `<div class="filechip">📄 images.pdf — ${state.files.length} page(s)</div>`);
}

async function runTransform() {
  const { canvas: src } = await currentCanvas(false);
  let tw = Math.max(1, parseInt($("tW").value, 10) || src.width);
  let th = Math.max(1, parseInt($("tH").value, 10) || src.height);
  const rot = parseInt($("tRot").value, 10) || 0;
  const fh = $("tFlipH").checked, fv = $("tFlipV").checked;

  // resize + flip first
  const r = el("canvas"); r.width = tw; r.height = th;
  const rc = r.getContext("2d");
  rc.translate(fh ? tw : 0, fv ? th : 0); rc.scale(fh ? -1 : 1, fv ? -1 : 1);
  rc.drawImage(src, 0, 0, tw, th);

  // rotate
  let out = r;
  if (rot % 360 !== 0) {
    const swap = rot === 90 || rot === 270;
    const o = el("canvas"); o.width = swap ? th : tw; o.height = swap ? tw : th;
    const oc = o.getContext("2d");
    oc.translate(o.width / 2, o.height / 2); oc.rotate((rot * Math.PI) / 180); oc.drawImage(r, -tw / 2, -th / 2);
    out = o;
  }
  const blob = await canvasBlob(out, "image/png");
  await finishImage(blob, `${stem(srcName())}-edited.png`, `${out.width}×${out.height}px · PNG`);
}

async function runCrop() {
  const sel = state.selection;
  const { canvas: src } = await currentCanvas(false);
  const x = Math.round(sel.x * src.width), y = Math.round(sel.y * src.height);
  const w = Math.max(1, Math.round(sel.w * src.width)), h = Math.max(1, Math.round(sel.h * src.height));
  const c = el("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(src, x, y, w, h, 0, 0, w, h);
  const blob = await canvasBlob(c, "image/png");
  await finishImage(blob, `${stem(srcName())}-crop.png`, `${w}×${h}px · PNG`);
}

async function runCompress() {
  const key = $("cFmt").value, fmt = CONVERT_FORMATS[key];
  let { canvas } = await currentCanvas(!fmt.alpha);
  if ($("cMax").checked) {
    const max = Math.max(100, parseInt($("cMaxPx").value, 10) || 1920);
    const scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
    if (scale < 1) { const c2 = el("canvas"); c2.width = Math.round(canvas.width * scale); c2.height = Math.round(canvas.height * scale); const cx = c2.getContext("2d"); if (!fmt.alpha) { cx.fillStyle = "#fff"; cx.fillRect(0, 0, c2.width, c2.height); } cx.drawImage(canvas, 0, 0, c2.width, c2.height); canvas = c2; }
  }
  let blob;
  if ($("cMode").value === "target") {
    const targetKB = Math.max(10, parseInt($("cTarget").value, 10) || 200);
    setProgress(null, "Searching best quality for target size…");
    let lo = 0.2, hi = 0.95, best = null;
    for (let i = 0; i < 8; i++) { const mid = (lo + hi) / 2; const b = await canvasBlob(canvas, fmt.mime, mid); if (b.size / 1024 <= targetKB) { best = b; lo = mid; } else { hi = mid; } }
    blob = best || await canvasBlob(canvas, fmt.mime, 0.2);
  } else {
    blob = await canvasBlob(canvas, fmt.mime, (parseInt($("cQ").value, 10) || 75) / 100);
  }
  const saved = state.file.size ? Math.max(0, Math.round((1 - blob.size / state.file.size) * 100)) : 0;
  await finishImage(blob, `${stem(srcName())}-min.${fmt.ext}`, `${canvas.width}×${canvas.height}px · ${prettySize(blob.size)} (−${saved}% from ${prettySize(state.file.size)})`);
}

async function runPixelate() {
  const sel = state.selection, strength = parseInt($("pxStr").value, 10) || 14, mode = $("pxMode").value;
  const { canvas } = await currentCanvas(false);
  const ctx = canvas.getContext("2d");
  const x = Math.round(sel.x * canvas.width), y = Math.round(sel.y * canvas.height);
  const w = Math.max(1, Math.round(sel.w * canvas.width)), h = Math.max(1, Math.round(sel.h * canvas.height));
  if (mode === "pixelate") {
    const tmp = el("canvas"); const tw = Math.max(1, Math.round(w / strength)), th = Math.max(1, Math.round(h / strength));
    tmp.width = tw; tmp.height = th; const tc = tmp.getContext("2d"); tc.imageSmoothingEnabled = false;
    tc.drawImage(canvas, x, y, w, h, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(tmp, 0, 0, tw, th, x, y, w, h); ctx.imageSmoothingEnabled = true;
  } else {
    const tmp = el("canvas"); tmp.width = w; tmp.height = h; const tc = tmp.getContext("2d");
    tc.filter = `blur(${strength}px)`; tc.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    ctx.drawImage(tmp, 0, 0, w, h, x, y, w, h);
  }
  const blob = await canvasBlob(canvas, "image/png");
  await finishImage(blob, `${stem(srcName())}-censored.png`, `${canvas.width}×${canvas.height}px · PNG`);
}

async function runWatermark() {
  const { canvas } = await currentCanvas(false);
  const ctx = canvas.getContext("2d");
  const text = $("wmText").value || "watermark";
  const size = Math.round((parseInt($("wmSize").value, 10) / 100) * Math.min(canvas.width, canvas.height));
  ctx.font = `bold ${size}px Inter, sans-serif`;
  ctx.fillStyle = hexToRGBA($("wmColor").value, (parseInt($("wmOp").value, 10) || 45) / 100);
  ctx.textBaseline = "middle";
  if ($("wmTile").checked) {
    ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(-Math.PI / 6); ctx.translate(-canvas.width / 2, -canvas.height / 2);
    const stepX = ctx.measureText(text).width + size * 2, stepY = size * 3;
    for (let yy = -canvas.height; yy < canvas.height * 2; yy += stepY) for (let xx = -canvas.width; xx < canvas.width * 2; xx += stepX) ctx.fillText(text, xx, yy);
    ctx.restore();
  } else {
    const m = size * 0.6, tw = ctx.measureText(text).width, pos = $("wmPos").value;
    const xs = { left: m, center: (canvas.width - tw) / 2, right: canvas.width - tw - m };
    const ys = { top: size / 2 + m, center: canvas.height / 2, bottom: canvas.height - size / 2 - m };
    const px = pos.includes("left") ? xs.left : pos.includes("right") ? xs.right : xs.center;
    const py = pos.includes("top") ? ys.top : pos.includes("bottom") ? ys.bottom : ys.center;
    ctx.textAlign = "left"; ctx.fillText(text, px, py);
  }
  const blob = await canvasBlob(canvas, "image/png");
  await finishImage(blob, `${stem(srcName())}-wm.png`, `${canvas.width}×${canvas.height}px · PNG`);
}

async function runWmRemove() {
  const sel = state.selection, passes = parseInt($("wrStr").value, 10) || 2;
  const { canvas } = await currentCanvas(false);
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const x = Math.round(sel.x * W), y = Math.round(sel.y * H);
  const w = Math.max(1, Math.round(sel.w * W)), h = Math.max(1, Math.round(sel.h * H));
  setProgress(null, "Reconstructing region…");
  await inpaint(ctx, W, H, x, y, w, h, passes);
  const blob = await canvasBlob(canvas, "image/png");
  await finishImage(blob, `${stem(srcName())}-clean.png`, `${W}×${H}px · PNG · region inpainted`, { compare: true });
}

async function runExif() {
  setProgress(null, "Reading metadata…");
  const exifr = (await import(`https://cdn.jsdelivr.net/npm/exifr@${CDN.exifr}/dist/full.esm.mjs`)).default;
  let meta = null;
  try { meta = await exifr.parse(state.file, { gps: true, translateValues: true }); } catch (_) { meta = null; }

  // cleaned copy (canvas export drops all metadata)
  const { canvas } = await currentCanvas(false);
  const isJpg = /jpe?g/i.test(state.file.type) || /\.jpe?g$/i.test(state.file.name);
  const blob = await canvasBlob(canvas, isJpg ? "image/jpeg" : "image/png", isJpg ? 0.95 : undefined);
  const ext = isJpg ? "jpg" : "png";

  let rows;
  if (meta && Object.keys(meta).length) {
    const pick = ["Make", "Model", "LensModel", "DateTimeOriginal", "CreateDate", "ISO", "FNumber", "ExposureTime", "FocalLength", "Orientation", "Software", "latitude", "longitude"];
    const entries = pick.filter((k) => meta[k] != null).map((k) => [k, meta[k]]);
    const gps = meta.latitude != null ? `<p class="note">📍 GPS location present — removed in the cleaned copy.</p>` : "";
    rows = `<table class="exif">${entries.map(([k, v]) => `<tr><td>${k}</td><td>${escapeHtml(String(v))}</td></tr>`).join("")}</table>${gps}<p class="note">All of this is stripped from your cleaned download.</p>`;
  } else {
    rows = `<p class="note">No EXIF metadata found (or already stripped). The cleaned copy is still re-encoded with no metadata.</p>`;
  }
  finishFile(blob, `${stem(srcName())}-clean.${ext}`, `Cleaned copy · ${prettySize(blob.size)}`, rows);
}

// ═══════════════════════════ RESULT RENDERING ═══════════════════════════
async function finishImage(blob, name, meta, opts = {}) {
  state.outputBlob = blob; state.outputName = name; state.copyText = null;
  const url = trackURL(URL.createObjectURL(blob));
  let body;
  if (opts.compare && state.imageURL) body = compareHTML(state.imageURL, url);
  else body = `<img src="${url}" alt="result" />`;
  showResult(name, meta, body, { copy: "image" });
  if (opts.compare && state.imageURL) wireCompare();
}

function finishText(text, name, meta) {
  state.outputBlob = new Blob([text], { type: "text/plain" });
  state.outputName = name; state.copyText = text;
  showResult(name, meta, `<textarea class="ocr-out" readonly>${escapeHtml(text)}</textarea>`, { copy: "text" });
}

function finishFile(blob, name, meta, bodyHTML) {
  state.outputBlob = blob; state.outputName = name; state.copyText = null;
  showResult(name, meta, bodyHTML, {});
}

function showResult(name, meta, bodyHTML, { copy }) {
  $("resultTitle").textContent = "Done";
  $("resultMeta").textContent = meta || "";
  $("resultBody").innerHTML = bodyHTML;
  const actions = $("resultActions"); actions.innerHTML = "";
  const dl = el("button", "primary", "⬇ Download"); dl.onclick = doDownload; actions.appendChild(dl);
  if (copy === "text") { const b = el("button", "ghost", "📋 Copy text"); b.onclick = () => copyText(state.copyText); actions.appendChild(b); }
  if (copy === "image") { const b = el("button", "ghost", "📋 Copy image"); b.onclick = copyImage; actions.appendChild(b); }
  const adj = el("button", "ghost", "⚙ Adjust & re-run"); adj.onclick = () => goto("confirm"); actions.appendChild(adj);
}

function compareHTML(beforeURL, afterURL) {
  return `<div class="cmp" id="cmp"><img class="cmp-after" src="${afterURL}" /><div class="cmp-before" id="cmpBefore"><img src="${beforeURL}" /></div><div class="cmp-handle" id="cmpHandle"></div><input type="range" min="0" max="100" value="50" id="cmpRange" class="cmp-range" /><span class="cmp-tagl">Before</span><span class="cmp-tagr">After</span></div>`;
}
function wireCompare() {
  const range = $("cmpRange"), before = $("cmpBefore"), handle = $("cmpHandle");
  const set = (v) => { before.style.width = v + "%"; handle.style.left = v + "%"; };
  range.addEventListener("input", () => set(range.value)); set(50);
}

// ═══════════════════════════ DOWNLOAD / CLIPBOARD ═══════════════════════════
function doDownload() {
  if (!state.outputBlob) return;
  const url = URL.createObjectURL(state.outputBlob);
  const a = el("a"); a.href = url; a.download = state.outputName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast("Downloaded " + state.outputName, "good");
}
async function copyText(t) { try { await navigator.clipboard.writeText(t || ""); toast("Text copied", "good"); } catch { toast("Clipboard blocked by browser", "bad"); } }
async function copyImage() {
  try {
    let blob = state.outputBlob;
    if (blob.type !== "image/png") { const bm = await loadBitmap(blob); const c = el("canvas"); c.width = bm.width; c.height = bm.height; c.getContext("2d").drawImage(bm, 0, 0); blob = await canvasBlob(c, "image/png"); }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast("Image copied to clipboard", "good");
  } catch { toast("Clipboard image copy not supported here", "bad"); }
}

// ═══════════════════════════ IMAGE / CANVAS HELPERS ═══════════════════════════
async function currentCanvas(flattenWhite) {
  const src = await decodeForCanvasIfNeeded(state.file);
  const bm = await loadBitmap(src);
  const c = el("canvas"); c.width = bm.width; c.height = bm.height;
  const ctx = c.getContext("2d");
  if (flattenWhite) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(bm, 0, 0);
  return { canvas: c, ctx, w: c.width, h: c.height };
}

function drawCover(ctx, bm, W, H) {
  const scale = Math.max(W / bm.width, H / bm.height);
  const dw = bm.width * scale, dh = bm.height * scale;
  ctx.drawImage(bm, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

// Iterative diffusion inpaint of a rectangular region (best-effort).
async function inpaint(ctx, W, H, x, y, w, h, passes) {
  x = Math.max(1, x); y = Math.max(1, y); w = Math.min(w, W - x - 1); h = Math.min(h, H - y - 1);
  if (w < 1 || h < 1) return;
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  // seed region with the average color of the surrounding ring
  let rs = [0, 0, 0], n = 0;
  for (let px = x - 1; px <= x + w; px++) { for (const py of [y - 1, y + h]) { const i = (py * W + px) * 4; rs[0] += d[i]; rs[1] += d[i + 1]; rs[2] += d[i + 2]; n++; } }
  for (let py = y; py < y + h; py++) { for (const px of [x - 1, x + w]) { const i = (py * W + px) * 4; rs[0] += d[i]; rs[1] += d[i + 1]; rs[2] += d[i + 2]; n++; } }
  rs = rs.map((v) => v / Math.max(1, n));
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) { const i = (py * W + px) * 4; d[i] = rs[0]; d[i + 1] = rs[1]; d[i + 2] = rs[2]; d[i + 3] = 255; }
  // relax: each pixel becomes the average of its 4 neighbours (boundary stays fixed)
  const iters = Math.min(600, Math.round(Math.max(w, h) * passes));
  for (let k = 0; k < iters; k++) {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
      const i = (py * W + px) * 4, l = i - 4, r = i + 4, u = i - W * 4, dn = i + W * 4;
      d[i] = (d[l] + d[r] + d[u] + d[dn]) >> 2;
      d[i + 1] = (d[l + 1] + d[r + 1] + d[u + 1] + d[dn + 1]) >> 2;
      d[i + 2] = (d[l + 2] + d[r + 2] + d[u + 2] + d[dn + 2]) >> 2;
    }
    if (k % 40 === 0) setProgress(Math.round((k / iters) * 100), `Reconstructing… ${Math.round((k / iters) * 100)}%`);
  }
  ctx.putImageData(img, 0, 0);
}

const canvasBlob = (canvas, mime, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(`Your browser can't export ${mime}.`))), mime, q));

async function decodeForCanvasIfNeeded(file) {
  if (!/\.(heic|heif)$/i.test(file.name) && !/heic|heif/i.test(file.type)) return file;
  setProgress(null, "Decoding HEIC…");
  const heic2any = (await import(`https://cdn.jsdelivr.net/npm/heic2any@${CDN.heic}/+esm`)).default;
  const out = await heic2any({ blob: file, toType: "image/png" });
  return Array.isArray(out) ? out[0] : out;
}

async function loadBitmap(src) {
  if (window.createImageBitmap) { try { return await createImageBitmap(src); } catch (_) {} }
  const url = URL.createObjectURL(src);
  try { return await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Could not decode this image.")); im.src = url; }); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 4000); }
}

function ensureScript(src, ready, label) {
  if (ready()) return Promise.resolve();
  return new Promise((res, rej) => { const s = el("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(`Failed to load the ${label}. Check your connection.`)); document.head.appendChild(s); });
}

// ═══════════════════════════ FORMATTER (HTML / JSON) ═══════════════════════════
function openFormatter() { $("fmtMsg").textContent = ""; goto("format"); setTimeout(() => $("fmtArea").focus(), 0); }
$("fmtBack").addEventListener("click", () => goto("upload"));
$("fmtClear").addEventListener("click", () => { $("fmtArea").value = ""; $("fmtMsg").textContent = ""; $("fmtArea").focus(); });
$("fmtCopy").addEventListener("click", () => { const v = $("fmtArea").value; if (!v.trim()) { toast("Nothing to copy.", "bad"); return; } copyText(v); });
$("fmtRun").addEventListener("click", formatText);

async function formatText() {
  const ta = $("fmtArea");
  const raw = ta.value;
  if (!raw.trim()) { toast("Paste some HTML or JSON first.", "bad"); return; }

  // 1) Try JSON first.
  try {
    const obj = JSON.parse(raw);
    ta.value = JSON.stringify(obj, null, 2);
    $("fmtMsg").textContent = "✓ Formatted as JSON.";
    toast("Formatted as JSON", "good");
    return;
  } catch (_) { /* not JSON — fall through to HTML */ }

  // 2) Otherwise beautify as HTML/XML.
  try {
    $("fmtMsg").textContent = "Formatting…";
    await ensureScript(`https://cdn.jsdelivr.net/npm/js-beautify@1.15.1/js/lib/beautifier.min.js`, () => window.beautifier, "formatter");
    ta.value = window.beautifier.html(raw, { indent_size: 2, wrap_line_length: 0, preserve_newlines: true, max_preserve_newlines: 2, end_with_newline: false });
    $("fmtMsg").textContent = "✓ Formatted as HTML.";
    toast("Formatted as HTML", "good");
  } catch (err) {
    $("fmtMsg").textContent = "Couldn't format: " + (err.message || err);
    toast("Couldn't format the text", "bad");
  }
}

// ═══════════════════════════ TOASTS / SHORTCUTS ═══════════════════════════
function toast(msg, kind) {
  const t = el("div", "toast " + (kind || ""), msg);
  $("toasts").appendChild(t);
  setTimeout(() => t.classList.add("in"), 10);
  setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 300); }, 2600);
}
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === "Enter" && !pages.confirm.classList.contains("hidden") && !typing) { e.preventDefault(); run(); }
  if (e.key === "Escape") {
    if (!pages.format.classList.contains("hidden")) goto("upload");
    else if (!pages.confirm.classList.contains("hidden")) goto("upload");
    else if (!pages.result.classList.contains("hidden")) goto("confirm");
  }
});

// ═══════════════════════════ small utils ═══════════════════════════
function setProgress(pct, text) { $("workingText").textContent = text; const w = $("barWrap"); if (pct === null || isNaN(pct)) { hide(w); return; } show(w); $("bar").style.width = Math.max(0, Math.min(100, pct)) + "%"; }
const srcName = () => state.file?.name || "image";
const prettySize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`);
const stem = (n) => n.replace(/\.[^.]+$/, "") || "image";
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function hexToRGBA(hex, a) { const m = hex.replace("#", ""); const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
