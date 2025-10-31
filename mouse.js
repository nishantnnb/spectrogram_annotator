// mouse.js
// Crosshair + axis-derived X/Y readout. Draws synchronized X-axis ticks into xAxisOverlay (creates it if missing).

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

  // Readout element
  let readout = document.getElementById('mouseReadout');
  if (!readout) {
    readout = document.createElement('div');
    readout.id = 'mouseReadout';
    readout.style.position = 'absolute';
    readout.style.pointerEvents = 'none';
    readout.style.background = 'rgba(0,0,0,0.75)';
    readout.style.color = '#fff';
    readout.style.font = '12px system-ui, -apple-system, "Segoe UI", Roboto, Arial';
    readout.style.padding = '6px 8px';
    readout.style.borderRadius = '4px';
    readout.style.zIndex = 999;
    readout.style.whiteSpace = 'nowrap';
    readout.style.display = 'none';
    viewportWrapper.appendChild(readout);
  }

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

  // Position readout box within viewportWrapper bounds
  function positionReadoutAt(clientX, clientY) {
    const vwRect = viewportWrapper.getBoundingClientRect();
    const offsetX = 12;
    const offsetY = 12;
    let left = clientX - vwRect.left + offsetX;
    let top = clientY - vwRect.top + offsetY;

    const approxW = 160;
    const approxH = 28;
    left = Math.max(6, Math.min(vwRect.width - 6 - approxW, left));
    top = Math.max(6, Math.min(vwRect.height - 6 - approxH, top));
    readout.style.left = left + 'px';
    readout.style.top = top + 'px';
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

  // Events
  function onEnter() {
    spectrogramCanvas.style.cursor = 'crosshair';
    readout.style.display = 'block';
    drawTicksLocal();
  }
  function onLeave() {
    spectrogramCanvas.style.cursor = '';
    readout.style.display = 'none';
  }
  function onMove(ev) {
    const { timeSec, freqHz } = computeAxisValues(ev.clientX, ev.clientY);
    positionReadoutAt(ev.clientX, ev.clientY);
    readout.textContent = `X: ${formatTimeLabel(timeSec)}   Y: ${formatFreqLabel(freqHz)}`;
    drawTicksLocal();
  }

  spectrogramCanvas.addEventListener('mouseenter', onEnter);
  spectrogramCanvas.addEventListener('mouseleave', onLeave);
  spectrogramCanvas.addEventListener('mousemove', onMove);
  spectrogramCanvas.addEventListener('pointermove', onMove);

  // Keep ticks and readout synchronized during scroll/resize
  scrollArea.addEventListener('scroll', () => {
    drawTicksLocal();
    if (readout.style.display !== 'none') readout.style.display = 'block';
  });
  window.addEventListener('resize', () => {
    drawTicksLocal();
  });

  // Initial draw
  setTimeout(() => { drawTicksLocal(); }, 120);

})();