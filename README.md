# AI Image Detector

Author: Suraj Van Verma (id: bythebug)

A lightweight, static web app that classifies whether an image is AI-generated or a real photograph using metadata and provenance signals. Runs entirely in the browser.

Demo: https://aiimagedetector.netlify.app/

## Features
- Drag-and-drop image upload with preview
- Client-side EXIF/XMP/IPTC parsing (via `exifr`) – no uploads to any server
- Heuristic classification with confidence and human-readable reasons
- Raw metadata viewer for transparency/debugging
- Clipboard paste and URL loading
- Confidence breakdown UI (per-signal contributions)
- Basic C2PA/JUMBF provenance scan (experimental)
- Theme toggle (light/dark)

## Quick Start
1. Open `index.html` directly in your browser, or serve the folder with any static server.
2. Drag and drop an image (PNG, JPG/JPEG, WebP, HEIC) onto the dropzone.
3. Read the verdict (AI or Non-AI), confidence, and reasons. Expand "Show raw metadata" to inspect details.

Tip: For local dev with a static server:
```bash
# macOS has Python; this starts a simple server on http://localhost:8000
cd "/Users/sverma/Files/Git/AI Image Detector" && python3 -m http.server 8000
```

## How It Works
- Parses EXIF (and XMP/IPTC when available) using `exifr` and applies heuristics such as:
  - Presence of AI tool names in `Software` or XMP fields (e.g., Stable Diffusion, DALL·E, Midjourney)
  - Presence/absence of typical camera EXIF fields (Make/Model/Exposure/etc.)
  - File type patterns (e.g., PNG without EXIF is common in AI exports)
  - Known camera vendor signals (Canon, Nikon, Sony, Apple, etc.)
- Produces a verdict, confidence score, and a list of reasons.

### Signals and Scoring
- Camera EXIF (Make/Model/Exposure/GPS/Date): strong Non-AI signal
- AI tool in Software tag: strong AI signal
- PNG without EXIF: weak AI signal
- Edited-in-editor tags: very weak AI signal

The UI shows a breakdown of which signals contributed to the decision.

### No ML Model (By Design)
- This project deliberately avoids an ML model. It relies on metadata/provenance heuristics to provide transparent, explainable results that run fully client-side. A model can be added later if desired, but is not required for this tool’s purpose.

### C2PA/JUMBF (Enhanced)
- Parses JPEG markers (APP11) and PNG text chunks to detect JUMBF/C2PA references and surfaces counts and offsets in debug.
- Note: This is still not full trust verification. For cryptographic validation of provenance, integrate a dedicated C2PA verification library and policy.

## Privacy
- Images never leave your device. All analysis happens locally in your browser.

## Disclaimer
- This tool provides heuristic indications, not definitive proof. It can produce false positives/negatives, especially if metadata is stripped or manipulated.

## Tech
- Plain HTML/CSS/JS
- [`exifr`](https://github.com/MikeKovarik/exifr) via CDN for metadata parsing

## Testing
- Open `tests.html`, paste a list of image URLs (direct links), and click Run. The app exposes `window.AIDetector.readMetadata` and `window.AIDetector.classify` for automation.

## Deployment
- Recommend GitHub Pages/Netlify. Deploy the root folder as a static site.

## License
MIT
