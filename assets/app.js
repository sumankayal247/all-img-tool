/*
 * All Image Tool — 100% client-side.
 * Nothing is uploaded to a server; every operation runs in the browser.
 *
 *   Remove Background  -> @imgly/background-removal (WASM/ONNX)
 *   Extract Text (OCR) -> tesseract.js
 *   Convert Format     -> Canvas (PNG / JPEG / WEBP), HEIC input via heic2any
 */

const IMGLY_VER = "1.7.0";
const TESS_VER = "7.0.0";
const HEIC_VER = "0.0.4";

// ─────────────────────────── tiny DOM helpers ───────────────────────────
const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");

const pages = {
  upload: $("page-upload"),
  confirm: $("page-confirm"),
  result: $("page-result"),
};
function goto(name) {
  Object.values(pages).forEach(hide);
  show(pages[name]);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─────────────────────────── app state ───────────────────────────
const state = {
  feature: null, // 'removebg' | 'ocr' | 'convert'
  file: null, // original File
  imageURL: null, // object URL for preview
  options: {}, // per-feature options
  outputBlob: null, // result blob (image or txt)
  outputName: "result",
};

const FEATURE_TITLES = {
  removebg: "Remove Background",
  ocr: "Extract Text (OCR)",
  convert: "Convert Format",
};

const OCR_LANGS = {
  eng: "English",
  spa: "Spanish",
  fra: "French",
  deu: "German",
  ita: "Italian",
  por: "Portuguese",
  hin: "Hindi",
  ben: "Bengali",
  rus: "Russian",
  jpn: "Japanese",
  chi_sim: "Chinese (Simplified)",
  ara: "Arabic",
};

const CONVERT_FORMATS = {
  PNG: { mime: "image/png", ext: "png", alpha: true, quality: false },
  JPG: { mime: "image/jpeg", ext: "jpg", alpha: false, quality: true },
  WEBP: { mime: "image/webp", ext: "webp", alpha: true, quality: true },
};

// ─────────────────────────── feature selection ───────────────────────────
$("features").addEventListener("click", (e) => {
  const btn = e.target.closest(".feature");
  if (!btn) return;
  document.querySelectorAll(".feature").forEach((f) => f.classList.remove("active"));
  btn.classList.add("active");
  state.feature = btn.dataset.feature;
  $("dzFeature").textContent = `Selected: ${FEATURE_TITLES[state.feature]} — now upload an image`;
});

// ─────────────────────────── upload handling ───────────────────────────
const dz = $("dropzone");
const fileInput = $("fileInput");

$("browseBtn").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
dz.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => { if (fileInput.files[0]) acceptFile(fileInput.files[0]); });

["dragenter", "dragover"].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); })
);
["dragleave", "drop"].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); })
);
dz.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f) acceptFile(f);
});

function acceptFile(file) {
  if (!state.feature) {
    $("dzFeature").textContent = "⚠️  Please pick a feature on the left first.";
    return;
  }
  if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) {
    $("dzFeature").textContent = "⚠️  That doesn't look like an image. Try another file.";
    return;
  }
  state.file = file;
  if (state.imageURL) URL.revokeObjectURL(state.imageURL);
  state.imageURL = URL.createObjectURL(file);
  buildConfirm();
  goto("confirm");
}

// ─────────────────────────── confirm / options page ───────────────────────────
function buildConfirm() {
  $("confirmTitle").textContent = FEATURE_TITLES[state.feature];
  const img = $("srcPreview");
  img.src = state.imageURL;
  img.onload = () => {
    $("srcMeta").textContent =
      `${state.file.name} · ${img.naturalWidth}×${img.naturalHeight}px · ${prettySize(state.file.size)}`;
  };
  // HEIC can't be shown by <img>; give a friendly placeholder note.
  img.onerror = () => {
    $("srcMeta").textContent = `${state.file.name} · ${prettySize(state.file.size)} (preview not available for this format)`;
  };

  const card = $("optionsCard");
  state.options = {};

  if (state.feature === "removebg") {
    card.innerHTML = `
      <h3>What will happen</h3>
      <p class="note">The subject is detected automatically and the background is
      erased, producing a transparent <b>PNG</b>. The first run downloads the AI
      model (~40&nbsp;MB) and may take a moment.</p>`;
    $("runBtn").textContent = "Remove Background";
  }

  if (state.feature === "ocr") {
    const opts = Object.entries(OCR_LANGS)
      .map(([k, v]) => `<option value="${k}"${k === "eng" ? " selected" : ""}>${v}</option>`)
      .join("");
    card.innerHTML = `
      <h3>Options</h3>
      <label for="ocrLang">Language of the text</label>
      <select class="field" id="ocrLang">${opts}</select>
      <p class="note">The recognised text appears on the next screen, ready to copy
      or download as a <b>.txt</b> file. The language data downloads on first use.</p>`;
    $("runBtn").textContent = "Extract Text";
  }

  if (state.feature === "convert") {
    const opts = Object.keys(CONVERT_FORMATS)
      .map((k) => `<option value="${k}"${k === "PNG" ? " selected" : ""}>${k}</option>`)
      .join("");
    card.innerHTML = `
      <h3>Options</h3>
      <label for="fmt">Convert to</label>
      <select class="field" id="fmt">${opts}</select>
      <div id="qualityRow">
        <label for="quality">Quality <span class="rowval" id="qval">92%</span></label>
        <input class="field" type="range" id="quality" min="40" max="100" value="92" />
      </div>
      <p class="note">Conversion happens instantly in your browser. HEIC/HEIF inputs
      are decoded automatically.</p>`;
    $("runBtn").textContent = "Convert";

    const fmtSel = $("fmt");
    const qRow = $("qualityRow");
    const q = $("quality");
    const syncQ = () => {
      $("qval").textContent = q.value + "%";
      qRow.style.display = CONVERT_FORMATS[fmtSel.value].quality ? "block" : "none";
    };
    fmtSel.addEventListener("change", syncQ);
    q.addEventListener("input", syncQ);
    syncQ();
  }
}

$("backBtn").addEventListener("click", () => goto("upload"));

// ─────────────────────────── run ───────────────────────────
$("runBtn").addEventListener("click", run);
$("resetBtn").addEventListener("click", () => goto("upload"));
$("errorBack").addEventListener("click", () => goto("confirm"));

async function run() {
  goto("result");
  hide($("resultBox"));
  hide($("errorBox"));
  show($("working"));
  setProgress(null, "Preparing…");

  try {
    if (state.feature === "removebg") await runRemoveBg();
    else if (state.feature === "ocr") await runOcr();
    else if (state.feature === "convert") await runConvert();
  } catch (err) {
    console.error(err);
    hide($("working"));
    $("errorText").textContent = (err && err.message) || String(err);
    show($("errorBox"));
    return;
  }
  hide($("working"));
  show($("resultBox"));
}

// ── Remove background ───────────────────────────────────────────────
async function runRemoveBg() {
  setProgress(null, "Loading background-removal model…");
  const { removeBackground } = await import(
    `https://cdn.jsdelivr.net/npm/@imgly/background-removal@${IMGLY_VER}/+esm`
  );
  const config = {
    publicPath: `https://cdn.jsdelivr.net/npm/@imgly/background-removal@${IMGLY_VER}/dist/`,
    progress: (key, current, total) => {
      const pct = total ? Math.round((current / total) * 100) : 0;
      if (key.startsWith("fetch")) setProgress(pct, `Downloading model… ${pct}%`);
      else setProgress(pct, `Processing… ${pct}%`);
    },
  };
  const blob = await removeBackground(state.file, config);
  state.outputBlob = blob;
  state.outputName = `${stem(state.file.name)}-nobg.png`;

  const url = URL.createObjectURL(blob);
  const dims = await imgDims(url);
  $("resultTitle").textContent = "Background removed";
  $("resultMeta").textContent = `${dims} · transparent PNG · ${prettySize(blob.size)}`;
  $("resultBody").innerHTML = `<img src="${url}" alt="result" />`;
}

// ── OCR ─────────────────────────────────────────────────────────────
let tesseractLoaded = null;
async function ensureTesseract() {
  if (window.Tesseract) return;
  if (!tesseractLoaded) {
    tesseractLoaded = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VER}/dist/tesseract.min.js`;
      s.onload = res;
      s.onerror = () => rej(new Error("Failed to load the OCR engine. Check your connection."));
      document.head.appendChild(s);
    });
  }
  await tesseractLoaded;
}

async function runOcr() {
  const lang = $("ocrLang").value || "eng";
  setProgress(null, "Loading OCR engine…");
  await ensureTesseract();

  // HEIC needs decoding to a canvas-friendly blob first.
  const input = await decodeForCanvasIfNeeded(state.file);

  const { data } = await window.Tesseract.recognize(input, lang, {
    logger: (m) => {
      if (m.status && typeof m.progress === "number") {
        const pct = Math.round(m.progress * 100);
        setProgress(pct, `${capitalize(m.status)}… ${pct}%`);
      }
    },
  });

  const text = (data.text || "").trim();
  state.outputBlob = new Blob([text], { type: "text/plain" });
  state.outputName = `${stem(state.file.name)}.txt`;

  const words = text ? text.split(/\s+/).length : 0;
  $("resultTitle").textContent = "Text extracted";
  $("resultMeta").textContent = `${words} words · ${text.length} characters`;
  $("resultBody").innerHTML =
    `<textarea class="ocr-out" readonly>${escapeHtml(text || "(no text detected)")}</textarea>`;
}

// ── Convert format ──────────────────────────────────────────────────
async function runConvert() {
  const fmtKey = $("fmt").value;
  const fmt = CONVERT_FORMATS[fmtKey];
  const quality = (parseInt($("quality").value, 10) || 92) / 100;
  setProgress(null, "Decoding image…");

  const src = await decodeForCanvasIfNeeded(state.file);
  const bitmap = await loadBitmap(src);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!fmt.alpha) {
    ctx.fillStyle = "#ffffff"; // flatten transparency for JPG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);

  setProgress(null, `Encoding ${fmtKey}…`);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(`Your browser can't export ${fmtKey}.`))),
      fmt.mime,
      fmt.quality ? quality : undefined
    )
  );

  state.outputBlob = blob;
  state.outputName = `${stem(state.file.name)}.${fmt.ext}`;
  const url = URL.createObjectURL(blob);
  $("resultTitle").textContent = `Converted to ${fmtKey}`;
  $("resultMeta").textContent =
    `${bitmap.width}×${bitmap.height}px · ${fmtKey} · ${prettySize(blob.size)}`;
  $("resultBody").innerHTML = `<img src="${url}" alt="result" />`;
}

// ─────────────────────────── download ───────────────────────────
$("downloadBtn").addEventListener("click", () => {
  if (!state.outputBlob) return;
  const url = URL.createObjectURL(state.outputBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = state.outputName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});

// ─────────────────────────── utilities ───────────────────────────
function setProgress(pct, text) {
  $("workingText").textContent = text;
  const wrap = $("barWrap");
  if (pct === null || isNaN(pct)) { hide(wrap); return; }
  show(wrap);
  $("bar").style.width = Math.max(0, Math.min(100, pct)) + "%";
}

// Decode HEIC/HEIF to a PNG blob (browsers can't draw HEIC to canvas natively).
async function decodeForCanvasIfNeeded(file) {
  if (!/\.(heic|heif)$/i.test(file.name) && !/heic|heif/i.test(file.type)) return file;
  setProgress(null, "Decoding HEIC…");
  const heic2any = (await import(
    `https://cdn.jsdelivr.net/npm/heic2any@${HEIC_VER}/+esm`
  )).default;
  const out = await heic2any({ blob: file, toType: "image/png" });
  return Array.isArray(out) ? out[0] : out;
}

async function loadBitmap(srcBlobOrFile) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(srcBlobOrFile); } catch (_) { /* fall through */ }
  }
  const url = URL.createObjectURL(srcBlobOrFile);
  try {
    return await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("Could not decode this image."));
      im.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

function imgDims(url) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(`${im.naturalWidth}×${im.naturalHeight}px`);
    im.onerror = () => res("image");
    im.src = url;
  });
}

const prettySize = (b) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`;
const stem = (name) => name.replace(/\.[^.]+$/, "") || "image";
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
