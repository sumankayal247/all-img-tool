# All Image Tool

A simple, modern, **all-in-one image utility** that runs entirely in your browser.
Pick a feature, drop in an image, confirm the settings, and download the result —
no installs, no accounts, and **your images never leave your device**.

### 🔗 Live app: **https://sumankayal247.github.io/all-img-tool/**

---

## Features

| Feature | What it does | Powered by |
| --- | --- | --- |
| ✂️ **Remove Background** | Detects the subject and erases the background, giving a transparent PNG | [`@imgly/background-removal`](https://github.com/imgly/background-removal-js) (WASM/ONNX) |
| 🔤 **Extract Text (OCR)** | Reads text out of an image; copy it or save as `.txt` (12 languages) | [`tesseract.js`](https://github.com/naptha/tesseract.js) |
| 🔁 **Convert Format** | Convert any image to **PNG / JPG / WEBP**, with a quality slider | Browser Canvas + [`heic2any`](https://github.com/alexcorvi/heic2any) for HEIC input |

## How it works

1. **Choose a feature** from the left sidebar.
2. **Upload an image** — drag & drop or browse.
3. **Review & confirm** any settings on the next screen (target format, OCR language, etc.).
4. The tool **processes the image** right in your browser.
5. **Download** the result.

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
  OCR language data a few MB). Subsequent runs are cached by the browser.
- Heavy operations run on your CPU, so very large images take longer on low-end devices.
- Format conversion outputs the web-native formats browsers can encode (PNG/JPG/WEBP);
  it can *read* far more, including HEIC/HEIF.
- A processing-friendly browser (recent Chrome, Edge, or Firefox) is recommended.

## License

[MIT](LICENSE)
