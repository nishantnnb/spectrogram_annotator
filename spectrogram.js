// spectrogram.js
// Spectrogram generator with live Colormap/Gain, Y max in kHz.
// Behavior: when Generate is pressed we capture the currently visible time (at press).
// After generate/re-render completes, the captured time is positioned at the left edge
// of the viewport so that the view's leftmost time equals the captured time.

(function(){
  function hannWindow(N){ const w=new Float32Array(N); for(let n=0;n<N;n++) w[n]=0.5*(1-Math.cos(2*Math.PI*n/(N-1))); return w; }
  function log10(x){ return Math.log(x)/Math.LN10; }
  function reverseBits(x,bits){ let y=0; for(let i=0;i<bits;i++){ y=(y<<1)|(x&1); x>>>=1; } return y; }
  function fft(real, imag){
    const n = real.length; const levels = Math.log2(n)|0; if((1<<levels)!==n) throw new Error('FFT must be power of two');
    for(let i=0;i<n;i++){ const j=reverseBits(i,levels); if(j>i){ const tr=real[i], ti=imag[i]; real[i]=real[j]; imag[i]=imag[j]; real[j]=tr; imag[j]=ti; } }
    for(let size=2; size<=n; size<<=1){
      const half = size>>>1; const theta = -2*Math.PI/size; const wpr=Math.cos(theta), wpi=Math.sin(theta);
      for(let i=0;i<n;i+=size){
        let wr=1, wi=0;
        for(let j=0;j<half;j++){
          const k=i+j, l=k+half;
          const tr = wr*real[l] - wi*imag[l];
          const ti = wr*imag[l] + wi*real[l];
          real[l] = real[k] - tr; imag[l] = imag[k] - ti;
          real[k] += tr; imag[k] += ti;
          const tmp = wr; wr = tmp*wpr - wi*wpi; wi = tmp*wpi + wi*wpr;
        }
      }
    }
  }

  // DOM refs
  const fileInput = document.getElementById('file');
  const goBtn = document.getElementById('go');
  const cmapSelect = document.getElementById('cmap');
  const xzoomSelect = document.getElementById('xzoom');
  const ymaxInput = document.getElementById('ymax'); // kHz
  const gainInput = document.getElementById('gain');
  const gainVal = document.getElementById('gainVal');
  const axisCanvas = document.getElementById('axisCanvas');
  const axisCtx = axisCanvas && axisCanvas.getContext ? axisCanvas.getContext('2d', { alpha:false }) : null;
  const scrollArea = document.getElementById('scrollArea') || document.body;
  const canvas = document.getElementById('spectrogramCanvas');
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d', { alpha:false }) : null;

  // Layout constants
  const AXIS_TOP = 12;
  const AXIS_BOTTOM = 44;
  const VIEWPORT_H = (axisCanvas && axisCanvas.height) ? axisCanvas.height : 240;
  const IMAGE_H = VIEWPORT_H - AXIS_TOP - AXIS_BOTTOM;
  const DEFAULT_FFT_SIZE = 2048;

  // Global state (sane defaults)
  globalThis._spectroLastGen = globalThis._spectroLastGen || { fileId:null, pxpf:null, sampleRate:null, numFrames:null, fftSize:null, ymax:null };
  globalThis._spectroTiles = globalThis._spectroTiles || null;
  globalThis._spectroSpectra = globalThis._spectroSpectra || null;
  globalThis._spectroSampleRate = globalThis._spectroSampleRate || 44100;
  globalThis._spectroNumFrames = globalThis._spectroNumFrames || 0;
  globalThis._spectroPxPerFrame = globalThis._spectroPxPerFrame || 2;
  globalThis._spectroFramesPerSec = globalThis._spectroFramesPerSec || (globalThis._spectroSampleRate / (DEFAULT_FFT_SIZE/2));
  globalThis._spectroImageWidth = globalThis._spectroImageWidth || 800;
  globalThis._spectroImageHeight = globalThis._spectroImageHeight || IMAGE_H;
  globalThis._spectroYMax = globalThis._spectroYMax || (globalThis._spectroSampleRate/2);
  // axisLeft remains the axis column width for overlays and ticks; do not use it to shift image pixels
  globalThis._spectroAxisLeft = (axisCanvas && typeof axisCanvas.clientWidth === 'number') ? Math.round(axisCanvas.clientWidth) : 70;

  // mapping helpers (single authoritative mapping)
  function effectivePxPerSec() {
    if (isFinite(globalThis._spectroPxPerSec) && globalThis._spectroPxPerSec > 0) return globalThis._spectroPxPerSec;
    if (globalThis._spectroPxPerFrame && globalThis._spectroFramesPerSec) return globalThis._spectroPxPerFrame * globalThis._spectroFramesPerSec;
    return 1;
  }
  function pxToSec(px) { return px / Math.max(1, effectivePxPerSec()); }
  function secToPx(sec) { return Math.round(sec * Math.max(1, effectivePxPerSec())); }
  globalThis._spectroMap = { pxToSec, secToPx, pxPerSec: () => effectivePxPerSec() };

  // placeholders
  drawAxisPlaceholder();
  drawSpectrogramPlaceholder();

  // gain label
  function updateGainLabel(){ if (gainVal) gainVal.textContent = parseFloat(gainInput.value).toFixed(1) + '×'; }
  if (gainInput) { gainInput.addEventListener('input', updateGainLabel); updateGainLabel(); }

  // debounce helper
  function debounce(fn, wait){
    let id = 0;
    return function(...args){
      if (id) clearTimeout(id);
      id = setTimeout(() => { id = 0; try { fn.apply(this, args); } catch(e){ console.error(e); } }, wait);
    };
  }

  // viewport helpers and safe scroll/clamp
  function viewportWidthPx() { return (scrollArea && typeof scrollArea.clientWidth === 'number') ? scrollArea.clientWidth : globalThis._spectroImageWidth || 800; }
  function safeSetScrollLeft(px) {
    const vp = viewportWidthPx();
    const maxScroll = Math.max(0, (globalThis._spectroImageWidth || 0) - vp);
    const clamped = Math.max(0, Math.min(maxScroll, Math.round(px || 0)));
    if (scrollArea && typeof scrollArea.scrollLeft === 'number') scrollArea.scrollLeft = clamped;
    return clamped;
  }
  function alignCanvasLeft() { if (canvas && canvas.style) { canvas.style.left = '0px'; canvas.style.transform = ''; } }

  // read user Y max (kHz -> Hz)
  function readUserYmaxHz() {
    if (!ymaxInput) return NaN;
    const raw = ymaxInput.value;
    if (raw == null || String(raw).trim() === '') return NaN;
    const v = Number(raw);
    if (!isFinite(v)) return NaN;
    return v * 1000;
  }

  // draw X ticks into axisCanvas (axisCanvas stays fixed left column)
  function drawXTicksAxis(sampleRate, totalFrames, imgW, imgH, framesPerSec, pxpf, visibleStartSec = 0){
    if(!axisCtx) return;
    const axisLeft = 0;
    const tickY = AXIS_TOP + imgH;
    axisCtx.clearRect(0, 0, axisCanvas.width, axisCanvas.height);
    axisCtx.fillStyle = '#000';
    axisCtx.fillRect(0, 0, axisCanvas.width, axisCanvas.height);
    // draw spectrogram background area in axis canvas for readability near axis right edge
    axisCtx.fillStyle = '#111';
    axisCtx.fillRect(0, AXIS_TOP, axisCanvas.width, imgH);

    axisCtx.strokeStyle = '#666'; axisCtx.lineWidth = 1; axisCtx.fillStyle = '#fff'; axisCtx.font = '12px sans-serif';
    const pxPerSec = Math.max(1, effectivePxPerSec());
    const vp = viewportWidthPx();
    const visibleDuration = Math.max(0, vp / pxPerSec);
    const niceSteps = [0.1,0.2,0.5,1,2,5,10,15,30,60,120];
    let step = niceSteps[0];
    for (let v of niceSteps) { if (v * pxPerSec >= 60) { step = v; break; } step = v; }
    const startSec = Math.max(0, visibleStartSec);
    const endSec = startSec + visibleDuration;
    const firstTick = Math.ceil(startSec / step) * step;
    axisCtx.textAlign = 'center'; axisCtx.textBaseline = 'top';

    // We draw tick lines into the axis canvas area at positions relative to the viewport.
    // Compute visibleStartSec relative to full image (passed in).
    for (let t = firstTick; t <= endSec + 1e-9; t += step) {
      const xPxFloat = (t - visibleStartSec) * pxPerSec; // css px relative to viewport left
      const xOnAxisCanvas = Math.round(axisCanvas.clientWidth + xPxFloat); // axisCanvas is left column, so ticks visually align at axisRight + xPx
      // vertical tick inside axis canvas only if it intersects the small right strip we keep for labels; we will always draw minor marker near axis right edge
      const markerX = axisCanvas.clientWidth - 6;
      axisCtx.beginPath(); axisCtx.moveTo(markerX + 0.5, AXIS_TOP + Math.round((xPxFloat/Math.max(1, imgW))*0) ); // small line
      axisCtx.lineTo(markerX + 0.5, AXIS_TOP + 8);
      axisCtx.stroke();
      // Show label vertically centered on axis canvas near same Y as tick area
      const label = (t >= 60) ? ((t / 60).toFixed(0) + 'm') : (t.toFixed((step < 1) ? 1 : 0) + 's');
      // put label offset to the right of axis canvas content area
      axisCtx.fillText(label, axisCanvas.clientWidth / 2, AXIS_TOP + imgH + 2);
    }

    // draw frequency ticks and label on axis left column
    drawYAxis(sampleRate, imgH, globalThis._spectroYMax);
  }

  // compute visibleStartSec from scrollLeft and redraw ticks into axisCanvas
  function updateXTicksFromScroll() {
    if (!globalThis._spectroImageWidth || !globalThis._spectroFramesPerSec || !globalThis._spectroPxPerFrame) {
      drawXTicksAxis(globalThis._spectroSampleRate || 44100, globalThis._spectroNumFrames || 0, globalThis._spectroImageWidth || 800, globalThis._spectroImageHeight || IMAGE_H, globalThis._spectroFramesPerSec || (globalThis._spectroSampleRate/(DEFAULT_FFT_SIZE/2)), globalThis._spectroPxPerFrame || 2, 0);
      return;
    }
    const currentScroll = (scrollArea && typeof scrollArea.scrollLeft === 'number') ? scrollArea.scrollLeft : 0;
    const clamped = safeSetScrollLeft(currentScroll);
    const pxPerSec = Math.max(1, effectivePxPerSec());
    const visibleStartSec = clamped / Math.max(1, pxPerSec);
    drawXTicksAxis(globalThis._spectroSampleRate, globalThis._spectroNumFrames, globalThis._spectroImageWidth, globalThis._spectroImageHeight, globalThis._spectroFramesPerSec, globalThis._spectroPxPerFrame, visibleStartSec);
  }

  // wire scroll updates (debounced)
  if (scrollArea) {
    let id=0;
    scrollArea.addEventListener('scroll', ()=>{ if(id) clearTimeout(id); id=setTimeout(()=>{ id=0; updateXTicksFromScroll(); }, 50); });
  }

  // draw Y axis (into axisCanvas)
  function drawYAxis(sampleRate, imgH, ymax){
    if(!axisCtx) return;
    axisCtx.fillStyle='#000'; axisCtx.fillRect(0,0,axisCanvas.width, axisCanvas.height);
    axisCtx.fillStyle='#111'; axisCtx.fillRect(0, AXIS_TOP, axisCanvas.width, imgH);
    axisCtx.strokeStyle = '#666'; axisCtx.lineWidth = 1; axisCtx.fillStyle = '#fff'; axisCtx.font = '12px sans-serif';
    const nyq = sampleRate / 2;
    const topFreq = (typeof ymax === 'number' && ymax > 0) ? Math.min(nyq, ymax) : nyq;
    const yTicks = 6;
    axisCtx.textAlign = 'right'; axisCtx.textBaseline = 'middle';
    for(let i=0;i<yTicks;i++){
      const t = i / (yTicks - 1);
      const freq = topFreq * (1 - t);
      const yPx = AXIS_TOP + Math.round(t * imgH);
      axisCtx.beginPath(); axisCtx.moveTo(axisCanvas.width - 6, yPx + 0.5); axisCtx.lineTo(axisCanvas.width - 0, yPx + 0.5); axisCtx.stroke();
      const label = (freq >= 1000) ? (Math.round(freq/10)/100).toString() + ' kHz' : Math.round(freq) + ' Hz';
      axisCtx.fillText(label, axisCanvas.width - 8, yPx);
    }
    axisCtx.save(); axisCtx.translate(12, AXIS_TOP + imgH/2); axisCtx.rotate(-Math.PI/2); axisCtx.textAlign='center'; axisCtx.fillStyle='#fff'; axisCtx.fillText('Frequency (kHz)', 0, 0); axisCtx.restore();
  }

  function drawAxisPlaceholder(){ if(!axisCtx) return; axisCtx.fillStyle='#000'; axisCtx.fillRect(0,0,axisCanvas.width, axisCanvas.height); axisCtx.fillStyle='#111'; axisCtx.fillRect(0, AXIS_TOP, axisCanvas.width, IMAGE_H); drawYAxis(44100, IMAGE_H, 22050); }
  function drawSpectrogramPlaceholder(){ const placeholderW = Math.max(300, (scrollArea && scrollArea.clientWidth) ? scrollArea.clientWidth - 20 : 400); const innerW = placeholderW; canvas.width = innerW; canvas.height = AXIS_TOP + IMAGE_H + AXIS_BOTTOM; canvas.style.width = innerW + 'px'; canvas.style.height = VIEWPORT_H + 'px'; canvas.style.background = 'transparent'; ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#111'; ctx.fillRect(0, AXIS_TOP, placeholderW, IMAGE_H); updateXTicksFromScroll(); }

  function formatTime(s){ if(!isFinite(s)||s<0.001) return '0s'; if(s>=3600){ const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=Math.floor(s%60); return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; } if(s>=60){ const m=Math.floor(s/60), sec=Math.floor(s%60); return `${m}:${String(sec).padStart(2,'0')}`; } return s.toFixed(0) + 's'; }

  // colormap approximations
  function colormapSwitch(t, name){ t=Math.max(0,Math.min(1,t)); switch(name){ case 'viridis': return viridisApprox(t); case 'magma': return magmaApprox(t); case 'grayscale': return grayscale(t); case 'jet': return jetApprox(t); case 'cividis': return cividisApprox(t); default: return customMap(t); } }
  function customMap(t){ let r=0,g=0,b=0; if(t<0.25){ const u=t/0.25; r=0; g=Math.round(30*u); b=Math.round(80+175*u); } else if(t<0.5){ const u=(t-0.25)/0.25; r=0; g=Math.round(30+200*u); b=Math.round(255-55*u); } else if(t<0.75){ const u=(t-0.5)/0.25; r=Math.round(255*u); g=Math.round(230-100*u); b=Math.round(200-200*u); } else { const u=(t-0.75)/0.25; r=Math.round(255-20*(1-u)); g=Math.round(130+125*u); b=Math.round(0+255*u); } return [r,g,b]; }
  function grayscale(t){ const v=Math.round(255*t); return [v,v,v]; }
  function viridisApprox(t){ const r = Math.round(68 + 187 * Math.pow(t,1.0)); const g = Math.round(1 + 210 * Math.pow(t,0.8)); const b = Math.round(84 + 170 * (1 - t)); return [r,g,b]; }
  function magmaApprox(t){ const r = Math.round(10 + 245 * Math.pow(t,0.9)); const g = Math.round(5 + 160 * Math.pow(t,1.2)); const b = Math.round(20 + 120 * (1 - t)); return [r,g,b]; }
  function cividisApprox(t){ const r = Math.round(32 + 180 * t); const g = Math.round(69 + 130 * Math.pow(t,0.9)); const b = Math.round(92 + 60 * (1 - t)); return [r,g,b]; }
  function jetApprox(t){ const r = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(2*t - 1)))); const g = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(2*t)))); const b = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(2*t + 1)))); return [r,g,b]; }
  function buildLUT(name){ const lut=new Uint8ClampedArray(256*3); for(let i=0;i<256;i++){ const t=i/255; const [r,g,b]=colormapSwitch(t,name); lut[i*3]=r; lut[i*3+1]=g; lut[i*3+2]=b; } return lut; }

  // processFile: compute STFT and draw image; updates globals
  async function processFile(file, fftSize, overlapFactor, pxpf, cmap){
    globalThis._spectroTiles = null; globalThis._spectroSpectra = null; globalThis._spectroYMax = null;
    const arrayBuffer = await file.arrayBuffer();
    const CtxClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!CtxClass) throw new Error('AudioContext not supported');
    const audioCtx = new CtxClass();
    let decoded;
    try { decoded = await audioCtx.decodeAudioData(arrayBuffer); } finally { if (audioCtx.close) audioCtx.close().catch(()=>{}); }

    const sr = decoded.sampleRate;
    const channels = decoded.numberOfChannels;
    const length = decoded.length;
    const mono = new Float32Array(length);
    if (channels === 1) mono.set(decoded.getChannelData(0)); else { const ch=[]; for(let c=0;c<channels;c++) ch.push(decoded.getChannelData(c)); for(let i=0;i<length;i++){ let s=0; for(let c=0;c<channels;c++) s+=ch[c][i]; mono[i]=s/channels; } }

    const N = fftSize; if ((N & (N - 1)) !== 0) throw new Error('FFT size must be a power of two');
    const hop = Math.max(1, Math.floor(N / overlapFactor));
    const framesPerSec = sr / hop;
    const window = hannWindow(N);
    const numFrames = Math.max(0, Math.floor((mono.length - N) / hop) + 1);
    if (numFrames <= 0) { alert('Audio too short for FFT size'); return; }
    const bins = N / 2;
    const spectra = new Float32Array(numFrames * bins);

    let minDB = Infinity, maxDB = -Infinity;
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let fIdx = 0; fIdx < numFrames; fIdx++){
      const off = fIdx * hop;
      for (let n=0;n<N;n++){ const s = mono[off+n] || 0; re[n] = s * window[n]; im[n] = 0; }
      fft(re, im);
      for (let b=0;b<bins;b++){ const r=re[b], i=im[b]; const mag=Math.sqrt(r*r+i*i)/N; const db=20*log10(mag+1e-12); if(db<minDB) minDB=db; if(db>maxDB) maxDB=db; spectra[fIdx*bins + b] = mag; }
      if ((fIdx & 127) === 0) await new Promise(r => setTimeout(r,0));
    }

    const DR = 80, top = maxDB, bottom = Math.max(minDB, maxDB - DR);
    const denom = (top - bottom) || 1e-6;
    const imageW = Math.max(1, numFrames * pxpf);
    const imageH = IMAGE_H;
    const dpr = window.devicePixelRatio || 1;
    // crucial: canvas width is image width only (no left axis margin)
    const cssWidth = imageW;
    const cssHeight = AXIS_TOP + imageH + AXIS_BOTTOM;

    if (scrollArea && scrollArea.style){ scrollArea.style.overflowX='auto'; scrollArea.style.overflowY='hidden'; scrollArea.style.whiteSpace='nowrap'; }

    canvas.style.display = 'block'; canvas.style.maxWidth = 'none';
    canvas.style.width = cssWidth + 'px'; canvas.style.height = cssHeight + 'px';
    canvas.width = Math.round(cssWidth * dpr); canvas.height = Math.round(cssHeight * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    // draw background for the image area at x = 0
    ctx.fillStyle = '#111'; ctx.fillRect(0, AXIS_TOP, imageW, imageH);

    const lut = buildLUT(cmap);
    const MAX_TILE_W = 8192;
    const tileW = Math.min(MAX_TILE_W, imageW);
    const tiles = [];
    const gain = Math.max(0.0001, parseFloat(gainInput && gainInput.value) || 1);

    for (let tileX = 0, tileIndex = 0; tileX < imageW; tileX += tileW, tileIndex++){
      const w = Math.min(tileW, imageW - tileX);
      const tilePixels = new Uint8ClampedArray(w * imageH * 4);

      for (let localX = 0; localX < w; localX++){
        const globalX = tileX + localX;
        const frameIdx = Math.floor(globalX / pxpf);
        const baseFrame = Math.min(numFrames - 1, Math.max(0, frameIdx));
        for (let y = 0; y < imageH; y++){
          const binIdx = Math.floor(y * bins / imageH);
          const bin = bins - 1 - Math.min(bins - 1, Math.max(0, binIdx));
          const mag = spectra[baseFrame * bins + bin];
          const magAdj = mag * gain;
          const db = 20 * (Math.log(magAdj + 1e-12) / Math.LN10);
          let v = (db - bottom) / denom; if (!isFinite(v)) v = 0; v = Math.max(0, Math.min(1, v));
          const lutIdx = Math.round(v * 255) | 0;
          const rgbBase = lutIdx * 3;
          const idx = (y * w + localX) * 4;
          tilePixels[idx] = lut[rgbBase]; tilePixels[idx+1] = lut[rgbBase+1]; tilePixels[idx+2] = lut[rgbBase+2]; tilePixels[idx+3] = 255;
        }
      }

      try {
        const tileImage = new ImageData(tilePixels, w, imageH);
        // draw at tileX (flush to left), not offset by axis column
        ctx.putImageData(tileImage, tileX, AXIS_TOP);

        const tcanvas = document.createElement('canvas');
        tcanvas.style.width = w + 'px';
        tcanvas.style.height = imageH + 'px';
        tcanvas.width = Math.round(w * dpr);
        tcanvas.height = Math.round(imageH * dpr);
        const tctx = tcanvas.getContext('2d', { alpha:false });
        tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        tctx.putImageData(tileImage, 0, 0);

        const leftFrameIdx = Math.floor(tileX / pxpf);
        const startTime = Math.max(0, Math.min((numFrames - 1) / framesPerSec, leftFrameIdx / framesPerSec));
        const endTime = Math.min((numFrames - 1) / framesPerSec, ((tileX + w - 1) / pxpf) / framesPerSec);

        tiles.push({ bitmap: tcanvas, cols: w, startCol: tileX, startTime, endTime });
      } catch(e){
        console.error('paint tile failed', e);
      }

      if ((tileIndex & 1) === 0) await new Promise(r => setTimeout(r,0));
    }

    // update globals (authoritative)
    globalThis._spectroTiles = tiles;
    globalThis._spectroAudioBuffer = decoded;
    globalThis._spectroDuration = length / sr;
    globalThis._spectroFramesPerSec = framesPerSec;
    globalThis._spectroPxPerFrame = pxpf;
    globalThis._spectroImageWidth = imageW;
    // keep axisLeft as axis column width for overlays (unchanged)
    globalThis._spectroAxisLeft = globalThis._spectroAxisLeft || ((axisCanvas && typeof axisCanvas.clientWidth === 'number') ? Math.round(axisCanvas.clientWidth) : 70);
    globalThis._spectroSampleRate = sr;
    globalThis._spectroNumFrames = numFrames;
    globalThis._spectroImageHeight = imageH;
    globalThis._spectroPxPerSec = (isFinite(globalThis._spectroDuration) && globalThis._spectroDuration > 0) ? (imageW / globalThis._spectroDuration) : (framesPerSec * pxpf);
    globalThis._spectroSpectra = spectra;
    globalThis._spectroBins = bins;
    globalThis._spectroFFTSize = N;
    globalThis._spectroTopDB = top;
    globalThis._spectroBottomDB = bottom;
    globalThis._spectroDenom = denom;
    globalThis._spectroYMax = sr / 2;

    if (ymaxInput) ymaxInput.max = Math.round(sr / 1000);

    globalThis._spectroPageCols = Math.max(1, tileW);
    globalThis._spectroPages = tiles.length;

    alignCanvasLeft();
    drawYAxis(sr, imageH, globalThis._spectroYMax);
    updateXTicksFromScroll();
  }

  // re-render from spectra (ymax in Hz)
  async function reRenderFromSpectra(ymax){
    if (!globalThis._spectroSpectra) return;
    const spectra = globalThis._spectroSpectra;
    const bins = globalThis._spectroBins;
    const N = globalThis._spectroFFTSize;
    const top = globalThis._spectroTopDB;
    const bottom = globalThis._spectroBottomDB;
    const denom = globalThis._spectroDenom;
    const sr = globalThis._spectroSampleRate;
    const framesPerSec = globalThis._spectroFramesPerSec;
    const pxpf = globalThis._spectroPxPerFrame;
    const imageW = globalThis._spectroImageWidth;
    const imageH = globalThis._spectroImageHeight;

    const dpr = window.devicePixelRatio || 1;
    const nyq = sr / 2;
    const ymaxClamped = Math.max(1, Math.min(nyq, Number(ymax) || nyq));

    const lut = buildLUT(cmapSelect.value || 'custom');
    const gain = Math.max(0.0001, parseFloat(gainInput && gainInput.value) || 1);

    const MAX_TILE_W = 8192;
    const effectiveTileW = Math.min(MAX_TILE_W, imageW);

    for (let tileX = 0, tileIndex = 0; tileX < imageW; tileX += effectiveTileW, tileIndex++){
      const w = Math.min(effectiveTileW, imageW - tileX);
      const tilePixels = new Uint8ClampedArray(w * imageH * 4);

      for (let localX = 0; localX < w; localX++){
        const globalX = tileX + localX;
        const frameIdx = Math.floor(globalX / pxpf);
        const baseFrame = Math.min(globalThis._spectroNumFrames - 1, Math.max(0, frameIdx));

        for (let y = 0; y < imageH; y++){
          const t = y / (imageH - 1);
          const freq = (1 - t) * ymaxClamped;
          const fracBin = (freq / nyq) * (bins - 1);
          const fIdx = Math.floor(fracBin);
          const fFrac = fracBin - fIdx;
          const a = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, fIdx))];
          const b = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, fIdx+1))];
          const mag = a + (b - a) * fFrac;
          const magAdj = mag * gain;
          const db = 20 * (Math.log(magAdj + 1e-12) / Math.LN10);
          let v = (db - bottom) / (denom || 1e-12);
          if (!isFinite(v)) v = 0;
          v = Math.max(0, Math.min(1, v));
          const lutIdx = Math.round(v * 255) | 0;
          const rgbBase = lutIdx * 3;
          const idx = (y * w + localX) * 4;
          tilePixels[idx] = lut[rgbBase];
          tilePixels[idx+1] = lut[rgbBase+1];
          tilePixels[idx+2] = lut[rgbBase+2];
          tilePixels[idx+3] = 255;
        }
      }

      try {
        const tileImage = new ImageData(tilePixels, w, imageH);
        // draw flush to left
        ctx.putImageData(tileImage, tileX, AXIS_TOP);
      } catch(e){
        console.error('paint tile failed', e);
      }

      if ((tileIndex & 1) === 0) await new Promise(r => setTimeout(r,0));
    }

    globalThis._spectroYMax = ymaxClamped;
    alignCanvasLeft();
    drawYAxis(sr, imageH, ymaxClamped);
    updateXTicksFromScroll();
  }

  // reset playback helpers (pause/seek to 0) but we will align view to captured start time later
  function resetPlaybackState() {
    try {
      if (globalThis._playback && typeof globalThis._playback.stop === 'function') {
        try { globalThis._playback.stop(); } catch(e){}
      }
      const audioEls = document.getElementsByTagName('audio');
      if (audioEls && audioEls.length) {
        for (let i=0;i<audioEls.length;i++){
          try { audioEls[i].pause(); audioEls[i].currentTime = 0; } catch(e){}
        }
      }
      if (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.setPosition === 'function') {
        try { globalThis._playbackScrollJump.setPosition(0); } catch(e){}
      }
      globalThis._spectroPlayheadSec = 0;
      const playheadEl = document.getElementById('playhead');
      if (playheadEl) {
        try { if ('value' in playheadEl) playheadEl.value = 0; else playheadEl.style.left = '0px'; } catch(e){}
      }
    } catch(e){ console.error('resetPlaybackState failed', e); }
  }

  // scroll nudge helper (+0.5s, -0.5s, restore)
  function scrollNudgeHalfSecond() {
    if (!globalThis._spectroFramesPerSec || !globalThis._spectroPxPerFrame || !scrollArea) return;
    const pxPerSec = Math.max(1, effectivePxPerSec());
    const deltaPx = Math.round(0.5 * pxPerSec);
    const vp = viewportWidthPx();
    const maxScroll = Math.max(0, (globalThis._spectroImageWidth || 0) - vp);
    const orig = Math.max(0, Math.min(maxScroll, (scrollArea.scrollLeft || 0)));
    function setScroll(px) {
      const clamped = Math.max(0, Math.min(maxScroll, Math.round(px)));
      scrollArea.scrollLeft = clamped;
      try { updateXTicksFromScroll(); } catch(e) {}
      return clamped;
    }
    setScroll(orig + deltaPx);
    requestAnimationFrame(() => {
      setScroll(orig - deltaPx);
      requestAnimationFrame(() => {
        setScroll(orig);
      });
    });
  }

  // live colormap/gain apply (debounced)
  const debouncedLiveApply = debounce(async ()=>{
    try {
      if (globalThis._spectroSpectra) {
        const lastY = (globalThis._spectroLastGen && isFinite(globalThis._spectroLastGen.ymax)) ? globalThis._spectroLastGen.ymax : globalThis._spectroYMax;
        const useY = isFinite(lastY) ? lastY : (globalThis._spectroSampleRate ? globalThis._spectroSampleRate/2 : 22050);
        await reRenderFromSpectra(useY);
        updateXTicksFromScroll();
        return;
      }
      const placeholderW = Math.max(300, (scrollArea && scrollArea.clientWidth) ? scrollArea.clientWidth - 20 : 400);
      const w = Math.min(placeholderW, 800);
      const h = IMAGE_H;
      const lut = buildLUT(cmapSelect.value || 'custom');
      const gain = Math.max(0.0001, parseFloat(gainInput && gainInput.value) || 1);
      const pixels = new Uint8ClampedArray(w * h * 4);
      for (let x=0;x<w;x++){ const t=x/Math.max(1,w-1); for (let y=0;y<h;y++){ const vbase = 0.2 + 0.8*Math.pow(t,0.7)*(1 - y/Math.max(1,h-1)); let v=Math.max(0, Math.min(1, vbase * gain)); const idx=Math.round(v*255)|0; const rgbBase=idx*3; const pi=(y*w+x)*4; pixels[pi]=lut[rgbBase]; pixels[pi+1]=lut[rgbBase+1]; pixels[pi+2]=lut[rgbBase+2]; pixels[pi+3]=255; } }
      const tileImage = new ImageData(pixels, w, h);
      ctx.clearRect(0, AXIS_TOP, w, h);
      ctx.putImageData(tileImage, 0, AXIS_TOP);
      updateXTicksFromScroll();
    } catch(e){ console.error('liveApply failed', e); }
  }, 150);

  if (cmapSelect) cmapSelect.addEventListener('change', ()=>debouncedLiveApply());
  if (gainInput) { gainInput.addEventListener('input', ()=>{ updateGainLabel(); debouncedLiveApply(); }); gainInput.addEventListener('change', ()=>debouncedLiveApply()); }

  // Generate handler: capture current left-edge time at press and after processing align that time to left edge
  if (goBtn) {
    goBtn.addEventListener('click', async ()=>{
      const f = fileInput && fileInput.files && fileInput.files[0];
      if (!f) { alert('Choose an audio file'); return; }

      const fftSize = DEFAULT_FFT_SIZE;
      const overlapFactor = 2;
      const zoomVal = (xzoomSelect && xzoomSelect.value) ? xzoomSelect.value : '2';
      const pxpf = Math.max(1, Math.min(4, parseInt(String(zoomVal).replace(/\D/g,''), 10) || 2));
      const cmap = cmapSelect.value || 'custom';
      const userYmaxHz = readUserYmaxHz();
      const fileId = `${f.name}|${f.size}|${f.lastModified}`;

      // Capture the currently visible left-edge time (the time at scrollLeft) at the moment Generate is pressed.
      const currentScrollPx = (scrollArea && typeof scrollArea.scrollLeft === 'number') ? scrollArea.scrollLeft : 0;
      // Use authoritative pxPerSec if present, otherwise fallback to previous frame-based product
      const prevPxPerSec = effectivePxPerSec();
      const capturedLeftTimeSec = currentScrollPx / Math.max(1, prevPxPerSec); // time at left edge when pressing Generate

      // block during playback if required
      if (typeof globalThis._playbackScrollJump === 'object' && globalThis._playbackScrollJump.status) {
        const st = globalThis._playbackScrollJump.status();
        if (st && st.playing) { return; }
      }

      const last = globalThis._spectroLastGen || {};
      const needFullCompute = (last.fileId !== fileId) || (last.pxpf !== pxpf) || (last.fftSize !== fftSize);

      try {
        if (needFullCompute) {
          await processFile(f, fftSize, overlapFactor, pxpf, cmap);

          const generatedDefaultYmax = globalThis._spectroYMax || (globalThis._spectroSampleRate ? globalThis._spectroSampleRate/2 : null);
          globalThis._spectroLastGen = { fileId, pxpf, sampleRate: globalThis._spectroSampleRate, numFrames: globalThis._spectroNumFrames, fftSize, ymax: generatedDefaultYmax };

          if (ymaxInput && (ymaxInput.value == null || String(ymaxInput.value).trim() === '')) {
            try { ymaxInput.value = (Math.round((generatedDefaultYmax || 0) / 1000 * 100) / 100).toString(); } catch(e){}
            if (ymaxInput) ymaxInput.max = Math.round((globalThis._spectroSampleRate || 0) / 1000);
          } else {
            if (ymaxInput) ymaxInput.max = Math.round((globalThis._spectroSampleRate || 0) / 1000);
          }

          if (isFinite(userYmaxHz) && Math.abs(userYmaxHz - (generatedDefaultYmax || 0)) > 1) {
            await reRenderFromSpectra(userYmaxHz);
            globalThis._spectroLastGen.ymax = userYmaxHz;
          }

          updateXTicksFromScroll();

          if (last.pxpf !== pxpf) {
            scrollNudgeHalfSecond();
          }

          alignCapturedTimeToLeft(capturedLeftTimeSec, pxpf);

          resetPlaybackState();
        } else {
          const lastY = last.ymax;
          if (isFinite(userYmaxHz) && Math.abs(userYmaxHz - (lastY || 0)) > 1) {
            await reRenderFromSpectra(userYmaxHz);
            globalThis._spectroLastGen.ymax = userYmaxHz;
          } else {
            const useY = (isFinite(lastY) ? lastY : (globalThis._spectroYMax || (globalThis._spectroSampleRate ? globalThis._spectroSampleRate/2 : 22050)));
            await reRenderFromSpectra(useY);
          }

          updateXTicksFromScroll();

          if (last.pxpf !== pxpf) {
            scrollNudgeHalfSecond();
          }

          alignCapturedTimeToLeft(capturedLeftTimeSec, pxpf);

          resetPlaybackState();

          globalThis._spectroLastGen = Object.assign({}, globalThis._spectroLastGen, {
            sampleRate: globalThis._spectroSampleRate,
            numFrames: globalThis._spectroNumFrames,
            fftSize
          });
        }
      } catch (e) {
        console.error(e);
      }
    });
  }

  // Align a captured left-edge time (seconds) to the left edge using updated globals and pxpf
  function alignCapturedTimeToLeft(capturedLeftTimeSec, newPxpf) {
    const pxPerSec = effectivePxPerSec();
    const imageW = globalThis._spectroImageWidth || 0;
    const vp = viewportWidthPx();
    const desiredScroll = Math.round(capturedLeftTimeSec * pxPerSec);
    const maxScroll = Math.max(0, imageW - vp);
    const clamped = Math.max(0, Math.min(maxScroll, desiredScroll));
    safeSetScrollLeft(clamped);
    updateXTicksFromScroll();
    alignCanvasLeft();
  }

  // reset playback helpers (pause/seek to 0)
  function resetPlaybackState() {
    try {
      if (globalThis._playback && typeof globalThis._playback.stop === 'function') {
        try { globalThis._playback.stop(); } catch(e){}
      }
      const audioEls = document.getElementsByTagName('audio');
      if (audioEls && audioEls.length) {
        for (let i=0;i<audioEls.length;i++){
          try { audioEls[i].pause(); audioEls[i].currentTime = 0; } catch(e){}
        }
      }
      if (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.setPosition === 'function') {
        try { globalThis._playbackScrollJump.setPosition(0); } catch(e){}
      }
      globalThis._spectroPlayheadSec = 0;
      const playheadEl = document.getElementById('playhead');
      if (playheadEl) {
        try { if ('value' in playheadEl) playheadEl.value = 0; else playheadEl.style.left = '0px'; } catch(e){}
      }
    } catch(e){ console.error('resetPlaybackState failed', e); }
  }

  // expose re-render for debugging
  globalThis._spectrogram_reRenderFromSpectra = reRenderFromSpectra;

})();