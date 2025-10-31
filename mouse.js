// mouse.js
// Crosshair overlay + axis-derived X/Y readout (readout text removed; crosshair replaces it).
// Also converts mouse wheel into horizontal scrolling while pointer is over the spectrogram.

(function () {
  const viewportWrapper = document.getElementById('viewportWrapper');
  const scrollArea = document.getElementById('scrollArea');
  const spectrogramCanvas = document.getElementById('spectrogramCanvas');
  if (!viewportWrapper || !scrollArea || !spectrogramCanvas) return;

  // Ensure xAxisOverlay exists (playback.js normally creates it; create if missing)
  let xAxisCanvas = document.getElementById('xAxisOverlay');
  if (!xAxisCanvas) {
    xAxisCanvas = document.createElement('canvas');
    xAxisCanvas.id = 'xAxisOverlay';
    xAxisCanvas.style.position = 'absolute';
    xAxisCanvas.style.zIndex = 45;
    xAxisCanvas.style.pointerEvents = 'auto';
    viewportWrapper.appendChild(xAxisCanvas);
  }
  const dpr = window.devicePixelRatio || 1;
  const xAxisCtx = xAxisCanvas.getContext('2d', { alpha: true });

  // Remove textual readout and replace with crosshair overlay
  // (we keep legacy mouseReadout element handling in case other code references it,
  //  but we hide it and rely on the crosshair for visual feedback)
  let readout = document.getElementById('mouseReadout');
  if (!readout) {
    readout = document.createElement('div');
    readout.id = 'mouseReadout';
    readout.style.display = 'none';
    viewportWrapper.appendChild(readout);
  } else {
    readout.style.display = 'none';
  }

  // Crosshair overlay canvas (draws two intersecting lines)
  let overlay = document.getElementById('spectrogramCrosshairOverlay');
  if (!overlay) {
    overlay = document.createElement('canvas');
    overlay.id = 'spectrogramCrosshairOverlay';
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.pointerEvents = 'none'; // visual only; events stay on spectrogramCanvas
    overlay.style.zIndex = 999;
    // append inside viewportWrapper so overlay coordinates align with spectrogram + axis areas
    viewportWrapper.appendChild(overlay);
  }
  const octx = overlay.getContext('2d', { alpha: true });

  // Layout constants must match spectrogram.js
  const AXIS_TOP = 12;
  const AXIS_BOTTOM = 44;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function formatTimeLabel(sec) {
    if (!isFinite(sec) || sec < 0) return '0s';
    if (sec >= 3600) {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }
    if (sec >= 60) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${String(s).padStart(2,'0')}`;
    }
    return `${sec.toFixed(2)}s`;
  }

  function formatFreqLabel(hz) {
    if (!isFinite(hz) || hz <= 0) return '0 Hz';
    if (hz >= 1000) return `${(hz / 1000).toFixed(2)} kHz`;
    return `${Math.round(hz)} Hz`;
  }

  // Compute axis-derived values
  function computeAxisValues(clientX, clientY) {
    // authoritative mapping from spectrogram globals
    const pxPerSec = (globalThis._spectroMap && typeof globalThis._spectroMap.pxPerSec === 'function')
      ? globalThis._spectroMap.pxPerSec()
      : ((typeof globalThis._spectroPxPerSec === 'number' && globalThis._spectroPxPerSec>0) ? globalThis._spectroPxPerSec : ((globalThis._spectroPxPerFrame && globalThis._spectroFramesPerSec) ? globalThis._spectroPxPerFrame * globalThis._spectroFramesPerSec : 1));

    const imageHeight = (typeof globalThis._spectroImageHeight === 'number' && globalThis._spectroImageHeight > 0)
      ? globalThis._spectroImageHeight
      : Math.max(1, (spectrogramCanvas.clientHeight || 0) - AXIS_TOP - AXIS_BOTTOM);

    const ymaxHz = (typeof globalThis._spectroYMax === 'number' && globalThis._spectroYMax > 0)
      ? globalThis._spectroYMax
      : (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);

    const duration = (typeof globalThis._spectroDuration === 'number' && globalThis._spectroDuration > 0)
      ? globalThis._spectroDuration
      : Infinity;

    // X: local X relative to the visible scroll viewport (scrollArea), not the canvas bounding rect
    const scrollRect = scrollArea.getBoundingClientRect();
    const localX = clientX - scrollRect.left;                 // CSS px inside visible viewport
    const leftCol = Math.round(scrollArea.scrollLeft || 0);   // CSS px scrolled away left
    const globalX = leftCol + localX;                        // CSS px into full spectrogram image
    const timeSec = clamp(globalX / Math.max(1, pxPerSec), 0, duration);

    // Y: map using axis top and image height
    const canvasRect = spectrogramCanvas.getBoundingClientRect();
    const localY = clientY - canvasRect.top;
    const yInImage = localY - AXIS_TOP; // top of spectrogram image area
    const t = clamp(yInImage / Math.max(1, imageHeight - 1), 0, 1); // 0..1 top->bottom
    const freqHz = clamp((1 - t) * ymaxHz, 0, ymaxHz);

    return { timeSec, freqHz, localX, localY, globalX, pxPerSec };
  }

  // Draw ticks on xAxisOverlay using authoritative pxPerSec
  function drawTicksLocal() {
    const pxPerSec = (globalThis._spectroMap && typeof globalThis._spectroMap.pxPerSec === 'function')
      ? globalThis._spectroMap.pxPerSec()
      : ((typeof globalThis._spectroPxPerSec === 'number' && globalThis._spectroPxPerSec>0) ? globalThis._spectroPxPerSec : ((globalThis._spectroPxPerFrame && globalThis._spectroFramesPerSec) ? globalThis._spectroPxPerFrame * globalThis._spectroFramesPerSec : 1));

    const viewWidth = Math.max(1, scrollArea.clientWidth);
    const leftCol = Math.round(scrollArea.scrollLeft || 0);
    const leftTime = leftCol / Math.max(1, pxPerSec);

    xAxisCanvas.style.width = viewWidth + 'px';
    xAxisCanvas.style.height = '28px';
    xAxisCanvas.width = Math.round(viewWidth * dpr);
    xAxisCanvas.height = Math.round(28 * dpr);
    xAxisCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    xAxisCtx.clearRect(0, 0, viewWidth, 28);
    xAxisCtx.fillStyle = '#111';
    xAxisCtx.fillRect(0, 0, viewWidth, 28);

    xAxisCtx.lineWidth = Math.max(1 / dpr, 0.6);
    xAxisCtx.strokeStyle = '#888';
    xAxisCtx.fillStyle = '#ddd';
    xAxisCtx.font = '12px sans-serif';
    xAxisCtx.textBaseline = 'top';
    xAxisCtx.textAlign = 'center';

    const secondsVisible = viewWidth / pxPerSec;
    const niceSteps = [0.1,0.2,0.5,1,2,5,10,15,30,60,120];
    let step = niceSteps[0];
    for (let v of niceSteps) { if (v * pxPerSec >= 60) { step = v; break; } step = v; }

    const rightTime = leftTime + secondsVisible;
    const firstTick = Math.floor(leftTime / step) * step;

    for (let t = firstTick; t <= rightTime + 1e-9; t += step) {
      const cxFloat = (t - leftTime) * pxPerSec;
      const cx = Math.round(cxFloat) + 0.5;
      xAxisCtx.beginPath();
      xAxisCtx.moveTo(cx, 2);
      xAxisCtx.lineTo(cx, 10);
      xAxisCtx.stroke();
      const label = (t >= 60) ? ((t / 60).toFixed(0) + 'm') : (t.toFixed((step < 1) ? 1 : 0) + 's');
      xAxisCtx.fillText(label, Math.round(cxFloat), 10);
    }
  }

  // --- Crosshair drawing utilities ---
  function resizeOverlay() {
    // overlay should cover the spectrogramCanvas area inside viewportWrapper
    const specRect = spectrogramCanvas.getBoundingClientRect();
    const vwRect = viewportWrapper.getBoundingClientRect();

    // position overlay relative to viewportWrapper
    overlay.style.left = (specRect.left - vwRect.left) + 'px';
    overlay.style.top = (specRect.top - vwRect.top) + 'px';

    // size (CSS)
    const cssW = Math.max(1, Math.round(specRect.width));
    const cssH = Math.max(1, Math.round(specRect.height));
    overlay.style.width = cssW + 'px';
    overlay.style.height = cssH + 'px';
    // backing store (hi-dpi)
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (overlay.width !== bw || overlay.height !== bh) {
      overlay.width = bw;
      overlay.height = bh;
    }
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clearCrosshair();
  }

  function clearCrosshair() {
    if (!octx) return;
    octx.clearRect(0, 0, overlay.width / (dpr || 1), overlay.height / (dpr || 1));
  }

  function drawCrosshairAtCanvasCoords(cx, cy) {
    if (!octx) return;
    clearCrosshair();
    const w = overlay.width / dpr;
    const h = overlay.height / dpr;

    // clamp inside overlay
    cx = clamp(cx, 0, w);
    cy = clamp(cy, 0, h);

    // styling
    const color = 'rgba(0,136,255,0.95)';
    const thin = Math.max(1, 1);

    octx.strokeStyle = color;
    octx.fillStyle = color;
    octx.lineWidth = thin;
    octx.beginPath();
    // vertical
    octx.moveTo(Math.round(cx) + 0.5, 0);
    octx.lineTo(Math.round(cx) + 0.5, h);
    // horizontal
    octx.moveTo(0, Math.round(cy) + 0.5);
    octx.lineTo(w, Math.round(cy) + 0.5);
    octx.stroke();

    // small intersection marker for visibility
    octx.beginPath();
    octx.arc(Math.round(cx), Math.round(cy), 3, 0, Math.PI * 2);
    octx.fill();
  }

  // convert client coords to overlay-local canvas coords (CSS px)
  function clientToOverlayLocal(evt) {
    const specRect = spectrogramCanvas.getBoundingClientRect();
    const localX = evt.clientX - specRect.left;
    const localY = evt.clientY - specRect.top;
    // map to overlay CSS pixel coordinates (overlay covers same area)
    const cssW = overlay.getBoundingClientRect().width || specRect.width;
    const cssH = overlay.getBoundingClientRect().height || specRect.height;
    // clamp
    const x = clamp(localX * (cssW / specRect.width), 0, cssW);
    const y = clamp(localY * (cssH / specRect.height), 0, cssH);
    return { x, y, specRectLeft: specRect.left, specRectTop: specRect.top };
  }

  // --- Wheel -> horizontal scroll ---
  // Convert vertical wheel motion into horizontal scroll while pointer is over spectrogramCanvas.
  spectrogramCanvas.addEventListener('wheel', function (ev) {
    // prefer deltaMode handling: DOM_DELTA_PIXEL (0), LINE (1), PAGE (2)
    // We'll normalize to pixels and scale.
    let deltaY = ev.deltaY;
    if (ev.deltaMode === 1) { // lines
      deltaY *= 16; // approximate line height
    } else if (ev.deltaMode === 2) { // pages
      deltaY *= window.innerHeight;
    }
    const SCROLL_FACTOR = 1.2; // tune to taste
    scrollArea.scrollLeft += deltaY * SCROLL_FACTOR;
    ev.preventDefault();
  }, { passive: false });

  // Mirror wheel listener on overlay so future toggles of pointer-events won't break behaviour
  overlay.addEventListener('wheel', function (ev) {
    let deltaY = ev.deltaY;
    if (ev.deltaMode === 1) deltaY *= 16;
    else if (ev.deltaMode === 2) deltaY *= window.innerHeight;
    const SCROLL_FACTOR = 1.2;
    scrollArea.scrollLeft += deltaY * SCROLL_FACTOR;
    ev.preventDefault();
  }, { passive: false });

  // --- Pointer events for crosshair ---
  let inside = false;

  function onEnter(ev) {
    inside = true;
    // show crosshair immediately at pointer
    resizeOverlay();
    const pos = clientToOverlayLocal(ev);
    drawCrosshairAtCanvasCoords(pos.x, pos.y);
    drawTicksLocal();
  }

  function onLeave() {
    inside = false;
    clearCrosshair();
  }

  function onMove(ev) {
    if (!inside) return;
    const pos = clientToOverlayLocal(ev);
    drawCrosshairAtCanvasCoords(pos.x, pos.y);

    // Optionally, if you still want to expose textual readout elsewhere, compute values
    const { timeSec, freqHz } = computeAxisValues(ev.clientX, ev.clientY);
    // If other code expects mouseReadout's value, we keep it hidden but updated.
    readout.textContent = `X: ${formatTimeLabel(timeSec)}   Y: ${formatFreqLabel(freqHz)}`;

    drawTicksLocal();
  }

  spectrogramCanvas.addEventListener('mouseenter', onEnter);
  spectrogramCanvas.addEventListener('mouseleave', onLeave);
  spectrogramCanvas.addEventListener('mousemove', onMove);
  spectrogramCanvas.addEventListener('pointermove', onMove);

  // Keep ticks and overlay synchronized during scroll/resize
  scrollArea.addEventListener('scroll', () => {
    drawTicksLocal();
    // crosshair remains positioned relative to spectrogram; no change required other than redraw
    if (inside) {
      // force redraw overlay geometry because scroll may shift visible area
      resizeOverlay();
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    drawTicksLocal();
    resizeOverlay();
  });

  // Initial sync
  setTimeout(() => { drawTicksLocal(); resizeOverlay(); }, 120);

})();
