# All Image Tool

A simple, modern, **all-in-one image utility** that runs entirely in your browser.
Pick a feature, drop in an image, confirm the settings, and download the result —
no installs, no accounts, and **your images never leave your device**.

### 🔗 Live app: **https://sumankayal247.github.io/all-img-tool/**

---

## Features

| Feature | What it does | Powered by |
| --- | --- | --- |
| ✂️ **Remove / Replace Background** | Cut out the subject; optionally **box the object to keep**, then leave the background transparent or replace it with a color or another image | [`@imgly/background-removal`](https://github.com/imgly/background-removal-js) (WASM/ONNX) |
| 🔤 **Extract Text (OCR)** | Read text from an image; copy it or save as `.txt` (12 languages) | [`tesseract.js`](https://github.com/naptha/tesseract.js) |
| 🔁 **Convert Format** | Convert to **PNG / JPG / JPEG / JFIF / WEBP / AVIF**, with a quality slider | Browser Canvas + [`heic2any`](https://github.com/alexcorvi/heic2any) for HEIC input |
| 📄 **Images → PDF** | Combine one or many images into a single PDF (fit-to-image / A4 / Letter) | [`jsPDF`](https://github.com/parallax/jsPDF) |
| 📐 **Resize & Rotate** | Resize (with aspect lock), rotate in 90° steps, flip horizontal/vertical | Canvas |
| 🔲 **Crop** | Drag a crop box with optional fixed ratios (1:1, 16:9, 4:3, …) | Canvas |
| 🗜️ **Compress** | Shrink file size by quality **or** target KB; optional max-dimension limit | Canvas |
| 🟦 **Pixelate / Blur** | Censor a selected region (faces, plates, sensitive text) | Canvas |
| 💧 **Add Watermark** | Text overlay with size, opacity, color, 9-point position, or full tiling | Canvas |
| 🧽 **Remove Watermark** | Best-effort inpainting of a boxed region (good on smooth backgrounds) | Canvas (diffusion inpaint) |
| 🛈 **EXIF / Metadata** | View embedded camera/date/GPS metadata and download a stripped copy | [`exifr`](https://github.com/MikeKovarik/exifr) |

## How it works

1. **Upload an image** — drag & drop, browse, or **paste with `Ctrl/⌘+V`** (some features accept multiple).
2. **Choose a feature** from the left sidebar.
3. **Review & arrange** on the confirm screen — set options, or drag a box on the image
   (to keep an object, crop, censor, or mark a watermark).
4. The tool **processes the image** right in your browser.
5. **Download**, **copy to clipboard**, or **⚙ Adjust & re-run** with new settings.

**Quality-of-life:** before/after compare slider, copy-to-clipboard (text & images),
paste-to-upload, toast notifications, and keyboard shortcuts (**Enter** to run, **Esc** to go back).

Everything is **100% client-side**. There is no backend — that's exactly why it can
be hosted for free as a static site and run with full privacy.

## Run it locally

Because it's a static site, any web server works:

```bash
git clone https://github.com/sumankayal247/all-img-tool.git
cd all-img-tool
python3 -m http.server 8000
# then open http://localhost:8000
```

> Opening `index.html` directly with `file://` won't work — the app loads code as
> ES modules, which browsers only allow over `http(s)://`. Use the command above.

## Project structure

```
all-img-tool/
├── index.html          # UI (upload page · confirm page · result page)
├── assets/
│   ├── style.css       # dark, modern styling
│   └── app.js          # all processing logic (client-side)
├── .nojekyll           # serve /assets untouched on GitHub Pages
└── README.md
```

## Notes & limits

- **First run of a feature downloads its model/data** (background-removal model ≈ 40 MB,
  OCR language data a few MB, PDF/EXIF engines a few KB). Subsequent runs are cached.
- Heavy operations run on your CPU, so very large images take longer on low-end devices.
- Conversion outputs the formats the browser can *encode* (PNG/JPG/JFIF/WEBP/AVIF — AVIF
  encoding needs a recent Chromium-based browser); it can *read* far more, including HEIC/HEIF.
- **Watermark removal is best-effort.** True removal is an AI inpainting problem; a fully
  client-side tool can't match a server model. It works well on smooth/simple backgrounds
  and may smudge on busy textures or large marks.
- A modern browser (recent Chrome, Edge, or Firefox) is recommended.

## License

[MIT](LICENSE)
