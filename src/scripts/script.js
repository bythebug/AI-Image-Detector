/* global exifr */
(function () {
  'use strict';

  /**
   * Utility: Selectors
   */
  const $ = (sel) => document.querySelector(sel);

  const dropzoneEl = $('#dropzone');
  const fileInputEl = $('#file-input');
  const urlInputEl = $('#url-input');
  const urlLoadEl = $('#url-load');
  const previewEl = $('#preview');
  const previewImgEl = $('#preview-img');
  const imageInfoEl = $('#image-info');
  const resultsEl = $('#results');
  const verdictBadgeEl = $('#verdict-badge');
  const confidenceEl = $('#confidence');
  const reasonsEl = $('#reasons');
  const rawMetaEl = $('#raw-meta-content');
  const breakdownContentEl = $('#breakdown-content');
  const debugEl = $('#debug');
  // theme toggle removed
  const copyShareEl = document.getElementById('copy-share');
  const shareLinkEl = document.getElementById('share-link');

  /**
   * Drag & Drop events
   */
  const preventDefaults = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzoneEl.addEventListener(evt, (e) => {
      preventDefaults(e);
      dropzoneEl.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropzoneEl.addEventListener(evt, (e) => {
      preventDefaults(e);
      dropzoneEl.classList.remove('dragover');
    });
  });
  dropzoneEl.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    const file = dt.files && dt.files[0];
    if (file) handleFile(file);
  });
  // Remove implicit click-to-open to avoid double-trigger issues; rely on visible button/input
  fileInputEl.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
  });
  // Paste support
  window.addEventListener('paste', async (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) {
      const file = item.getAsFile();
      if (file) handleFile(file);
    } else {
      const text = e.clipboardData?.getData('text');
      if (text && /^https?:\/\//i.test(text)) {
        urlInputEl.value = text;
        loadFromUrl();
      }
    }
  });
  // URL load support
  urlLoadEl?.addEventListener('click', (e) => {
    e.preventDefault();
    loadFromUrl();
  });

  /**
   * File handling
   */
  async function handleFile(file) {
    resetUI();
    if (!file || !file.type.startsWith('image/')) {
      showError('Unsupported file. Please select an image.');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    previewImgEl.src = objectUrl;
    previewImgEl.onload = () => URL.revokeObjectURL(objectUrl);
    previewEl.classList.remove('hidden');
    imageInfoEl.textContent = `${file.name} • ${(file.size / 1024).toFixed(1)} KB`;

    try {
      if (typeof exifr === 'undefined') {
        throw new Error('exifr library did not load');
      }
      const { metadata, summary } = await readMetadata(file);
      // Enrich with dimensions
      try {
        const { width, height } = await getImageDimensions(file);
        summary.dimensions = { width, height };
      } catch {}
      rawMetaEl.textContent = JSON.stringify(summary, null, 2);
      debugEl.textContent = `EXIF keys: ${Object.keys(metadata.exif||{}).length}${summary.dimensions ? `, ${summary.dimensions.width}x${summary.dimensions.height}` : ''}`;

      const classification = classify(metadata, summary);
      updateShareLink({ fromUrl: null });
      renderResult(classification);
    } catch (err) {
      console.error(err);
      showError('Failed to read image metadata. Classification may be less accurate.');
      debugEl.textContent = String(err && err.message ? err.message : err);
      // Attempt pixel-based minimal signal even without metadata
      const fallback = classify({}, {});
      renderResult(fallback);
    }
    // reset input so selecting same file again triggers change
    try { if (fileInputEl) fileInputEl.value = ''; } catch {}
  }

  async function loadFromUrl() {
    const url = (urlInputEl?.value || '').trim();
    if (!url) return;
    try {
      resetUI();
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], url.split('/').pop() || 'image', { type: blob.type || 'image/jpeg' });
      await handleFile(file);
      updateShareLink({ fromUrl: url });
    } catch (err) {
      showError('Failed to load image from URL. Check CORS or try downloading the file.');
      debugEl.textContent = String(err);
    }
  }

  function resetUI() {
    verdictBadgeEl.textContent = 'Pending';
    verdictBadgeEl.classList.remove('ai', 'real');
    confidenceEl.textContent = '';
    reasonsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
  }

  function showError(msg) {
    verdictBadgeEl.textContent = 'Error';
    confidenceEl.textContent = msg;
    resultsEl.classList.remove('hidden');
  }

  /**
   * Read EXIF metadata via exifr
   */
  async function readMetadata(file) {
    // Use exifr to extract EXIF (xmp/iptc helpers may not be present in this build)
    const exifData = await exifr.parse(file).catch(() => ({}));
    const xmpData = {}; // not available
    const iptcData = {}; // not available
    const thumbnailHash = await hashArrayBuffer(await file.arrayBuffer()).catch(() => null);
    const c2pa = await scanC2PA(await file.arrayBuffer()).catch(() => ({ present: false }));
    const c2paVerify = await tryVerifyC2PA(file).catch(() => null);

    const metadata = {
      exif: exifData || {},
      xmp: xmpData || {},
      iptc: iptcData || {},
      fileType: file.type,
      fileSize: file.size,
      name: file.name,
      thumbnailHash,
      c2pa,
      c2paVerify,
    };

    // small summary for display
    const summary = {
      make: metadata.exif.Make || metadata.iptc.Make || null,
      model: metadata.exif.Model || metadata.iptc.Model || null,
      software: metadata.exif.Software || metadata.xmp.Software || metadata.iptc.Software || null,
      xmpKeys: Object.keys(metadata.xmp || {}),
      iptcKeys: Object.keys(metadata.iptc || {}),
      exifKeys: Object.keys(metadata.exif || {}),
      mime: metadata.fileType,
      size: metadata.fileSize,
      exposure: {
        fNumber: metadata.exif.FNumber || null,
        exposureTime: metadata.exif.ExposureTime || null,
        iso: metadata.exif.ISOSpeedRatings || metadata.exif.ISO || null,
        focalLength: metadata.exif.FocalLength || null,
        dateTimeOriginal: metadata.exif.DateTimeOriginal || null,
        flash: metadata.exif.Flash || null,
        orientation: metadata.exif.Orientation || null,
        gpsLat: metadata.exif.GPSLatitude || null,
        gpsLon: metadata.exif.GPSLongitude || null,
      },
      c2pa: metadata.c2pa?.present ? { present: true, boxOffset: metadata.c2pa.boxOffset } : { present: false },
      c2paVerify: metadata.c2paVerify ? {
        available: true,
        status: metadata.c2paVerify.status || 'unknown',
        issuer: metadata.c2paVerify.issuer || null,
        claims: metadata.c2paVerify.claims || null,
      } : { available: false },
      dimensions: undefined,
    };

    return { metadata, summary };
  }

  // Expose API for tests
  window.AIDetector = {
    readMetadata,
    classify,
  };

  /**
   * Heuristic classification
   */
  function classify(metadata, summary) {
    const reasons = [];
    const mime = normalizeString(summary.mime || '');
    const software = normalizeString(
      summary.software || metadata?.xmp?.Software || metadata?.exif?.Software || ''
    );
    const fileName = (metadata.name || '').toLowerCase();
    const exif = metadata.exif && typeof metadata.exif === 'object' ? metadata.exif : {};
    const exifPresent = Object.keys(exif).length > 0;
    const dims = summary.dimensions || {};

    // C2PA/JUMBF provenance detection
    if (metadata.c2pa?.present) {
      reasons.push('C2PA provenance data detected (JUMBF).');
    }
    if (summary.c2paVerify?.available) {
      reasons.push(`C2PA verification: ${summary.c2paVerify.status}${summary.c2paVerify.issuer ? ` (issuer: ${summary.c2paVerify.issuer})` : ''}.`);
    }

    // 1) Strong device capture evidence
    const hasMake = !!exif.Make;
    const hasModel = !!exif.Model;
    const hasLens = !!exif.LensModel;
    const hasExposureParams = hasAny(exif, ['FNumber', 'ExposureTime', 'ISOSpeedRatings', 'ISO', 'FocalLength']);
    const hasDate = !!exif.DateTimeOriginal;
    const hasGPS = exif.GPSLatitude != null && exif.GPSLongitude != null;

    let deviceEvidence = 0;
    if (hasMake && hasModel) deviceEvidence += 2;
    if (hasExposureParams) deviceEvidence += 1;
    if (hasGPS) deviceEvidence += 1;
    if (hasLens || hasDate) deviceEvidence += 0.5;

    // 2) Explicit AI tool signatures (override)
    const aiToolHints = [
      'midjourney','stability','stable diffusion','sdxl','comfyui','invokeai','automatic1111',
      'dalle','openai','firefly','bing image creator','leonardo ai','playground ai','ideogram',
      'pixray','nightcafe','craiyon','gen-2','sd next','flux','recraft'
    ];
    const hasAiTool = matchAny(software, aiToolHints);
    const breakdown = [];
    if (hasAiTool) {
      reasons.push(`Software indicates AI generator: "${software}"`);
      breakdown.push({ label: 'AI tool in Software', weight: 0.9, sign: 1 });
      return { isAi: true, confidence: 90, reasons, score: 5, breakdown };
    }

    // 3) If any substantial device evidence with EXIF present, label Non-AI
    if (exifPresent && (hasMake || hasModel || hasExposureParams || hasDate || hasGPS)) {
      const present = [];
      if (hasMake) present.push(`Make: ${exif.Make}`);
      if (hasModel) present.push(`Model: ${exif.Model}`);
      if (hasExposureParams) present.push('Exposure data present');
      if (hasLens) present.push(`Lens: ${exif.LensModel}`);
      if (hasGPS) present.push('GPS present');
      if (hasDate) present.push('DateTimeOriginal present');
      reasons.push(`Camera metadata found (${present.join(', ')}).`);
      const confidence = Math.min(96, 70 + Math.round(deviceEvidence * 8));
      breakdown.push({ label: 'Camera make/model', weight: hasMake && hasModel ? 0.6 : 0, sign: -1 });
      breakdown.push({ label: 'Exposure params', weight: hasExposureParams ? 0.4 : 0, sign: -1 });
      breakdown.push({ label: 'GPS/Date/Lens', weight: (hasGPS ? 0.2 : 0) + (hasDate ? 0.1 : 0) + (hasLens ? 0.1 : 0), sign: -1 });
      return { isAi: false, confidence, reasons, score: -Math.max(2, deviceEvidence), breakdown };
    }

    // 4) Messaging-app heuristic: EXIF missing but patterns/dimensions suggest social app re-encode
    const messagingIndicators = [
      'whatsapp', 'wa', 'telegram', 'signal', 'messenger', 'wechat', 'snapchat', 'instagram'
    ];
    const looksMessagingName = messagingIndicators.some((w) => fileName.includes(w)) || /^(img[-_]|img_\d|pxl_)/i.test(metadata.name || '');
    const w = Number(dims.width) || 0;
    const h = Number(dims.height) || 0;
    const minSide = Math.min(w, h);
    const maxSide = Math.max(w, h);
    const aspect = w && h ? (maxSide / minSide) : 0;
    const commonMessagingMax = maxSide > 600 && maxSide <= 2048; // typical downscale range
    const commonAspect = aspect > 1.2 && aspect < 2.0; // ~4:3 to 16:9
    if (!exifPresent && (looksMessagingName || (commonMessagingMax && commonAspect))) {
      reasons.push('No EXIF, but dimensions/name suggest messaging app re-encode (likely real photo).');
      return { isAi: false, confidence: 55, reasons, score: -0.5 };
    }

    // 5) Otherwise, treat as possibly AI with contextual reasons
    const exifKeys = summary.exifKeys || [];
    if (mime.includes('png') && exifKeys.length === 0) {
      reasons.push('PNG has no EXIF; common for AI exports.');
      breakdown.push({ label: 'PNG no EXIF', weight: 0.3, sign: 1 });
    }
    reasons.push('Insufficient camera metadata (make/model/exposure/date/GPS).');
    breakdown.push({ label: 'Missing camera EXIF', weight: 0.5, sign: 1 });
    // Editors aren't conclusive; keep as weak hint
    if (software.includes('photoshop') || software.includes('lightroom') || software.includes('gimp')) {
      reasons.push('Edited in an image editor (not conclusive).');
      breakdown.push({ label: 'Edited in editor', weight: 0.1, sign: 1 });
    }

    const confidenceBase = Math.min(88, 55 + Math.round((2 - Math.min(2, deviceEvidence)) * 10));
    return { isAi: true, confidence: confidenceBase, reasons, score: 2 - deviceEvidence, breakdown };
  }

  function renderResult(result) {
    verdictBadgeEl.textContent = result.isAi ? 'AI' : 'Non-AI';
    verdictBadgeEl.classList.toggle('ai', result.isAi);
    verdictBadgeEl.classList.toggle('real', !result.isAi);
    confidenceEl.textContent = `Confidence: ${result.confidence}%`;
    reasonsEl.innerHTML = '';
    result.reasons.forEach((r) => {
      const li = document.createElement('li');
      li.textContent = r;
      reasonsEl.appendChild(li);
    });
    if (breakdownContentEl) {
      if (result.breakdown && Array.isArray(result.breakdown)) {
        breakdownContentEl.innerHTML = '';
        result.breakdown.forEach((b) => {
          const row = document.createElement('div');
          row.className = 'row';
          const label = document.createElement('div');
          label.className = 'label';
          label.textContent = b.label;
          const bar = document.createElement('div');
          bar.className = 'bar';
          const span = document.createElement('span');
          span.style.width = `${Math.max(0, Math.min(100, Math.round((b.weight || 0) * 100)))}%`;
          bar.appendChild(span);
          const value = document.createElement('div');
          value.textContent = `${b.sign > 0 ? '+' : ''}${(b.weight || 0).toFixed(2)}`;
          row.appendChild(label);
          row.appendChild(bar);
          row.appendChild(value);
          breakdownContentEl.appendChild(row);
        });
      } else {
        breakdownContentEl.innerHTML = '<div class="image-info">No breakdown available.</div>';
      }
    }
    resultsEl.classList.remove('hidden');
  }

  function updateShareLink(params) {
    if (!shareLinkEl) return;
    const url = new URL(window.location.href);
    if (params?.fromUrl) {
      url.searchParams.set('img', params.fromUrl);
    } else {
      url.searchParams.delete('img');
    }
    shareLinkEl.value = url.toString();
    if (copyShareEl && !copyShareEl.dataset.bound) {
      copyShareEl.dataset.bound = '1';
      copyShareEl.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(shareLinkEl.value); copyShareEl.textContent = 'Copied!'; setTimeout(() => (copyShareEl.textContent = 'Copy'), 1200); } catch {}
      });
    }
  }

  /**
   * Helpers
   */
  function normalizeString(s) {
    return (s || '').toString().trim().toLowerCase();
  }
  function matchAny(s, arr) {
    if (!s) return false;
    return arr.some((a) => s.includes(a));
  }
  function hasAny(obj, keys) {
    if (!obj) return false;
    return keys.some((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== '');
  }
  async function hashArrayBuffer(ab) {
    const buf = await crypto.subtle.digest('SHA-256', ab);
    const bytes = new Uint8Array(buf);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function getImageDimensions(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  async function scanC2PA(ab) {
    const bytes = new Uint8Array(ab);
    // JPEG detection: parse marker stream and collect APP11 (0xFFEB) segments containing 'JUMBF'
    const result = { present: false, container: null, segments: [] };
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      result.container = 'jpeg';
      let i = 2;
      while (i + 4 <= bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1];
        i += 2;
        if (marker === 0xd9 /* EOI */ || marker === 0xda /* SOS */) break;
        if (i + 2 > bytes.length) break;
        const segLen = (bytes[i] << 8) | bytes[i + 1];
        const segStart = i + 2;
        const segEnd = segStart + segLen - 2;
        if (segEnd > bytes.length) break;
        if (marker === 0xeb /* APP11 */) {
          const hasJumbf = segEnd - segStart >= 5 &&
            bytes[segStart] === 0x4a && bytes[segStart + 1] === 0x55 && bytes[segStart + 2] === 0x4d && bytes[segStart + 3] === 0x42 && bytes[segStart + 4] === 0x46; // 'JUMBF'
          if (hasJumbf) {
            result.present = true;
            result.segments.push({ marker: 'APP11', offset: i - 2, length: segLen, hasJumbf: true });
          }
        }
        i = segEnd;
      }
      if (result.present) return result;
    }

    // PNG detection: iterate chunks; look for iTXt/tEXt containing 'c2pa' or 'JUMBF'
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      result.container = 'png';
      let p = 8; // skip signature
      while (p + 8 <= bytes.length) {
        const len = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
        const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
        const dataStart = p + 8;
        const dataEnd = dataStart + len;
        if (dataEnd + 4 > bytes.length) break;
        if (type === 'iTXt' || type === 'tEXt' || type === 'zTXt') {
          try {
            const slice = bytes.slice(dataStart, dataEnd);
            const text = new TextDecoder().decode(slice);
            if (/JUMBF|c2pa/i.test(text)) {
              result.present = true;
              result.segments.push({ chunk: type, offset: p, length: len });
            }
          } catch {}
        }
        p = dataEnd + 4; // skip CRC
        if (type === 'IEND') break;
      }
      if (result.present) return result;
    }

    return { present: false };
  }

  // Attempt to load and verify C2PA using a browser library when available
  async function tryVerifyC2PA(file) {
    const ver = await ensureC2PALibrary();
    if (!ver) return null;
    try {
      // Common patterns: window.c2pa or window.C2PA with read/verify APIs.
      // We attempt a few shapes; if none match, we gracefully return null.
      const buf = await file.arrayBuffer();
      if (window.c2pa && typeof window.c2pa.read === 'function') {
        const res = await window.c2pa.read(new Uint8Array(buf));
        return normalizeC2PAResult(res);
      }
      if (window.C2PA && typeof window.C2PA.read === 'function') {
        const res = await window.C2PA.read(new Uint8Array(buf));
        return normalizeC2PAResult(res);
      }
      return null;
    } catch {
      return null;
    }
  }

  function normalizeC2PAResult(res) {
    if (!res) return null;
    // Best-effort normalization across potential libs
    const status = res.status || res.verificationStatus || res.ok === true ? 'verified' : 'unknown';
    const issuer = res.issuer || res.signer || null;
    const claims = res.claims || res.manifest || null;
    return { status, issuer, claims };
  }

  async function ensureC2PALibrary() {
    if (window.c2pa || window.C2PA) return true;
    // Try loading from known CDNs (best-effort, optional)
    const candidates = [
      'https://cdn.jsdelivr.net/npm/@contentauth/c2pa/dist/browser/c2pa.min.js',
      'https://unpkg.com/@contentauth/c2pa/dist/browser/c2pa.min.js'
    ];
    for (const src of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await loadScript(src, 3000);
        if (window.c2pa || window.C2PA) return true;
      } catch {}
    }
    return false;
  }

  function loadScript(src, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; s.remove(); reject(new Error('timeout')); } }, timeoutMs);
      s.onload = () => { if (!done) { done = true; clearTimeout(to); resolve(); } };
      s.onerror = () => { if (!done) { done = true; clearTimeout(to); reject(new Error('load error')); } };
      document.head.appendChild(s);
    });
  }
})();


