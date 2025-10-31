// create_annotations.js
// Annotation creation UI and logic (Create mode primary).
// Authoritative mode source: #createEditToggle (data-mode and 'mode-change' events).
// Checkboxes removed; Selection column shows row numbers.
// Multi-delete behavior:
// - If no rows selected -> alert "No rows selected for Multi-delete" and do nothing.
// - If rows selected -> single confirmation "Delete N selected rows?" -> on OK delete rows and reindex Selection column.
// This file ensures a single prompt and atomic deletion.

(function () {
  const AXIS_TOP = 12;
  const PENDING_FILL = 'rgba(255,165,0,0.18)';
  const PENDING_STROKE = 'rgba(255,165,0,0.95)';
  const COMMITTED_FILL = 'rgba(0,150,255,0.12)';
  const COMMITTED_STROKE = 'rgba(0,150,255,0.95)';
  const DASH = [6, 4];

  const viewportWrapper = document.getElementById('viewportWrapper');
  const scrollArea = document.getElementById('scrollArea');
  const spectrogramCanvas = document.getElementById('spectrogramCanvas');

  if (!viewportWrapper || !scrollArea || !spectrogramCanvas) return;

  // overlay canvas for annotation rendering
  let annotationOverlay = document.getElementById('annotationOverlay');
  if (!annotationOverlay) {
    annotationOverlay = document.createElement('canvas');
    annotationOverlay.id = 'annotationOverlay';
    annotationOverlay.style.position = 'absolute';
    annotationOverlay.style.pointerEvents = 'none';
    annotationOverlay.style.zIndex = 70;
    viewportWrapper.appendChild(annotationOverlay);
  }
  const aCtx = annotationOverlay.getContext('2d', { alpha: true });

  // annotations container (insert after toolbar when available)
  let annotationsContainer = document.getElementById('annotationsContainer');
  if (!annotationsContainer) {
    annotationsContainer = document.createElement('div');
    annotationsContainer.id = 'annotationsContainer';
    annotationsContainer.style.marginTop = '12px';
    annotationsContainer.style.display = 'flex';
    annotationsContainer.style.flexDirection = 'column';
    annotationsContainer.style.gap = '8px';
    const toolbar = document.getElementById('annotationControls');
    if (toolbar && toolbar.parentNode) {
      toolbar.parentNode.insertBefore(annotationsContainer, toolbar.nextSibling);
    } else if (viewportWrapper.parentNode) {
      viewportWrapper.parentNode.insertBefore(annotationsContainer, viewportWrapper.nextSibling);
    } else {
      document.body.appendChild(annotationsContainer);
    }
  }

  // Delete and multi-delete buttons (may be present)
  const deleteBtn = document.getElementById('annoDeleteBtn');
  const multiDeleteBtn = document.getElementById('multiDeleteBtn');

  // --- TABLE + SCROLLER SETUP ---
  // wrapper that provides vertical scrolling for many rows
  let tableScrollWrap = document.getElementById('annotationsTableScrollWrap');
  if (!tableScrollWrap) {
    tableScrollWrap = document.createElement('div');
    tableScrollWrap.id = 'annotationsTableScrollWrap';
    // initial fallback maxHeight; will be recalculated to fit 10 rows
    tableScrollWrap.style.maxHeight = '360px';
    tableScrollWrap.style.overflowY = 'auto';
    tableScrollWrap.style.overflowX = 'auto';
    tableScrollWrap.style.border = '1px solid rgba(255,255,255,0.04)';
    tableScrollWrap.style.borderRadius = '4px';
    tableScrollWrap.style.background = '#0b0b0b';
    tableScrollWrap.style.position = 'relative';
    tableScrollWrap.style.zIndex = 10;
  }

  // table creation (moved to scroll wrapper)
  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'separate'; // allow vertical column lines reliably with sticky header
  table.style.borderSpacing = '0';
  table.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial';
  table.style.fontSize = '13px';
  table.style.background = 'transparent';
  table.style.color = '#eee';
  table.style.maxWidth = '100%';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  // Keep a single numbered Selection column (no checkboxes)
  const headers = ['Selection', 'Begin Time (s)', 'End Time (s)', 'Low Freq (Hz)', 'High Freq (Hz)', 'Species', 'Notes'];
  headers.forEach((h, hi) => {
    const th = document.createElement('th');
    th.textContent = h;
    th.style.padding = '8px 10px';
    th.style.textAlign = 'left';
    th.style.fontWeight = 600;
    th.style.background = '#0b0b0b';
    th.style.color = '#eee';
    // freeze header
    th.style.position = 'sticky';
    th.style.top = '0';
    th.style.zIndex = 20;
    th.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
    // vertical column line: right border on each header except last
    if (hi < headers.length - 1) {
      th.style.borderRight = '1px solid rgba(255,255,255,0.06)';
    }
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);

  const topRow = document.createElement('div');
  topRow.style.display = 'flex';
  topRow.style.justifyContent = 'space-between';
  topRow.style.alignItems = 'center';
  topRow.appendChild(document.createElement('div'));

  // insert scroll wrapper and table into annotationsContainer
  if (!annotationsContainer.contains(tableScrollWrap)) {
    annotationsContainer.appendChild(topRow);
    tableScrollWrap.appendChild(table);
    annotationsContainer.appendChild(tableScrollWrap);
  } else {
    tableScrollWrap.innerHTML = '';
    tableScrollWrap.appendChild(table);
  }

  // in-memory annotations, pending creation, mode, id counter and change callback
  let annotations = [];
  let pending = null; // { startTime, startFreq, currentTime, currentFreq, pxPerSec }
  let mode = 'create';
  let nextId = 1;
  let onChangeCb = null;

  function r4(v) { return Number((+v).toFixed(4)); }

  // Toggle wrapper (authoritative mode source)
  const toggleWrap = document.getElementById('createEditToggle');
  function readModeFromToggle() {
    try {
      if (toggleWrap && toggleWrap.dataset && toggleWrap.dataset.mode) return toggleWrap.dataset.mode;
    } catch (e) {}
    return null;
  }
  function handleToggleChange(ev) {
    const m = (ev && ev.detail && ev.detail.mode) ? ev.detail.mode : readModeFromToggle();
    if (m && m !== mode) mode = m;
  }
  if (toggleWrap) {
    toggleWrap.addEventListener('mode-change', handleToggleChange, { passive: true });
    const initial = readModeFromToggle();
    if (initial) mode = initial;
  }

  // Keep Delete button disabled unless mode === 'edit'
  (function syncDeleteButtonWithMode_create() {
    const deleteBtnLocal = document.getElementById('annoDeleteBtn') || document.querySelector('button[title="Delete"]');
    function applyMode(m) {
      try {
        const enabled = (m === 'edit');
        if (deleteBtnLocal) {
          deleteBtnLocal.disabled = !enabled;
          deleteBtnLocal.style.opacity = enabled ? '1.0' : '0.45';
          deleteBtnLocal.style.cursor = enabled ? 'pointer' : 'default';
        }
      } catch (e) {}
    }
    try { applyMode(readModeFromToggle() || mode); } catch (e) {}
    if (toggleWrap) {
      toggleWrap.addEventListener('mode-change', (ev) => {
        const m = (ev && ev.detail && ev.detail.mode) ? ev.detail.mode : readModeFromToggle();
        applyMode(m || mode);
      }, { passive: true });
    } else {
      applyMode(mode);
    }
  })();

  // Helper: authoritative duration getter
  function getDurationSec() {
    if (typeof globalThis._spectroDuration === 'number' && isFinite(globalThis._spectroDuration)) return globalThis._spectroDuration;
    const audio = document.querySelector('audio');
    if (audio && isFinite(audio.duration)) return audio.duration;
    return Infinity;
  }

  // Resize overlay to match spectrogram image region
  function resizeAnnotationOverlay() {
    const viewWidth = Math.max(1, scrollArea.clientWidth);
    const viewHeight = Math.max(1, (globalThis._spectroImageHeight || (spectrogramCanvas.clientHeight - AXIS_TOP - 44)) || 100);
    const axisLeft = (typeof globalThis._spectroAxisLeft === 'number') ? globalThis._spectroAxisLeft : 70;
    annotationOverlay.style.left = axisLeft + 'px';
    annotationOverlay.style.top = AXIS_TOP + 'px';
    annotationOverlay.style.width = viewWidth + 'px';
    annotationOverlay.style.height = viewHeight + 'px';
    const dpr = window.devicePixelRatio || 1;
    annotationOverlay.width = Math.round(viewWidth * dpr);
    annotationOverlay.height = Math.round(viewHeight * dpr);
    aCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderAllAnnotations();
  }

  // convert client coords to time/freq using the app mapping
  function clientToTimeAndFreq_local(clientX, clientY) {
    const scrollRect = scrollArea.getBoundingClientRect();
    const localX = clientX - scrollRect.left;
    const leftCol = Math.round(scrollArea.scrollLeft || 0);
    const globalX = leftCol + localX;
    const pxPerSec = (globalThis._spectroMap && typeof globalThis._spectroMap.pxPerSec === 'function')
      ? globalThis._spectroMap.pxPerSec()
      : (globalThis._spectroPxPerSec || (globalThis._spectroPxPerFrame && globalThis._spectroFramesPerSec ? globalThis._spectroPxPerFrame * globalThis._spectroFramesPerSec : 1));
    const timeSec = Math.max(0, globalX / Math.max(1, pxPerSec));

    const canvasRect = spectrogramCanvas.getBoundingClientRect();
    const imageHeight = (typeof globalThis._spectroImageHeight === 'number' && globalThis._spectroImageHeight > 0)
      ? globalThis._spectroImageHeight
      : Math.max(1, (spectrogramCanvas.clientHeight || 0) - AXIS_TOP - 44);
    const ymaxHz = (typeof globalThis._spectroYMax === 'number' && globalThis._spectroYMax > 0)
      ? globalThis._spectroYMax
      : (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);
    const localY = clientY - canvasRect.top;
    const yInImage = localY - AXIS_TOP;
    const t = Math.max(0, Math.min(1, yInImage / Math.max(1, imageHeight - 1)));
    const freqHz = Math.max(0, Math.min(ymaxHz, (1 - t) * ymaxHz));

    return { timeSec, freqHz, globalX, localX, localY, pxPerSec };
  }

  function clearOverlay() {
    aCtx.clearRect(0, 0, annotationOverlay.width / (window.devicePixelRatio || 1), annotationOverlay.height / (window.devicePixelRatio || 1));
  }

  function drawBoxOnOverlay(x1, y1, x2, y2, options = {}) {
    const { fill = COMMITTED_FILL, stroke = COMMITTED_STROKE, dashed = false } = options;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    aCtx.save();
    if (dashed) aCtx.setLineDash(DASH); else aCtx.setLineDash([]);
    aCtx.fillStyle = fill;
    aCtx.strokeStyle = stroke;
    aCtx.lineWidth = 1.5;
    aCtx.fillRect(left, top, w, h);
    aCtx.strokeRect(left + 0.5, top + 0.5, w, h);
    aCtx.restore();
  }

  function renderAllAnnotations() {
    if (!aCtx) return;
    clearOverlay();
    const pxPerSec = (globalThis._spectroMap && typeof globalThis._spectroMap.pxPerSec === 'function') ? globalThis._spectroMap.pxPerSec() : (globalThis._spectroPxPerSec || 1);
    const imageHeight = globalThis._spectroImageHeight || (annotationOverlay.clientHeight || 100);
    const ymaxHz = globalThis._spectroYMax || (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);
    const duration = getDurationSec();
    const fullImagePx = (duration === Infinity) ? Infinity : Math.round(duration * pxPerSec);

    annotations.forEach(a => {
      // clamp persisted annotations on render so stale or invalid entries don't draw past edge
      const beginClamped = Math.max(0, Math.min(a.beginTime, duration));
      const endClamped = Math.max(beginClamped, Math.min(a.endTime, duration));
      const x1 = (beginClamped * pxPerSec) - Math.round(scrollArea.scrollLeft || 0);
      const x2 = (endClamped * pxPerSec) - Math.round(scrollArea.scrollLeft || 0);
      const t1 = 1 - (a.highFreq / ymaxHz);
      const t2 = 1 - (a.lowFreq / ymaxHz);
      const y1 = t1 * imageHeight;
      const y2 = t2 * imageHeight;
      drawBoxOnOverlay(x1, y1, x2, y2, { fill: COMMITTED_FILL, stroke: COMMITTED_STROKE, dashed: false });
    });

    if (pending) {
      const curPxPerSec = pending.pxPerSec || pxPerSec;
      // clamp pending currentTime to duration for visual feedback
      const clampedCurrent = Math.min(pending.currentTime, duration);
      const clampedStart = Math.min(pending.startTime, duration);
      const x1 = (Math.min(clampedStart, clampedCurrent) * curPxPerSec) - Math.round(scrollArea.scrollLeft || 0);
      const x2 = (Math.max(clampedStart, clampedCurrent) * curPxPerSec) - Math.round(scrollArea.scrollLeft || 0);

      const low = Math.min(pending.startFreq, pending.currentFreq);
      const high = Math.max(pending.startFreq, pending.currentFreq);
      const t1 = 1 - (high / ymaxHz);
      const t2 = 1 - (low / ymaxHz);
      const y1 = t1 * imageHeight;
      const y2 = t2 * imageHeight;
      drawBoxOnOverlay(x1, y1, x2, y2, { fill: PENDING_FILL, stroke: PENDING_STROKE, dashed: true });
    }
  }

  // adjust the table wrapper maxHeight so at least 10 rows are visible before scrolling
  function adjustTableHeightToShowRows(rowCount = 10) {
    try {
      // header height
      const headerTh = table.querySelector('thead th');
      const headerH = headerTh ? headerTh.offsetHeight : 0;
      // sample row height: take first tbody row if present, else create a temp row to measure
      let rowH = 0;
      const firstRow = tbody.querySelector('tr');
      if (firstRow) {
        rowH = firstRow.offsetHeight || firstRow.getBoundingClientRect().height;
      } else {
        // create temporary row
        const tempTr = document.createElement('tr');
        tempTr.style.visibility = 'hidden';
        tempTr.style.position = 'absolute';
        tempTr.style.pointerEvents = 'none';
        const tdCount = headers.length;
        for (let i = 0; i < tdCount; i++) {
          const td = document.createElement('td');
          td.textContent = '\u00A0'; // non-breaking space
          td.style.padding = '6px 8px';
          tempTr.appendChild(td);
        }
        tbody.appendChild(tempTr);
        rowH = tempTr.offsetHeight || tempTr.getBoundingClientRect().height || 28;
        tbody.removeChild(tempTr);
      }
      // compute target max height: header + rowCount * rowH + small buffer
      const buffer = 4; // px
      const target = Math.round(headerH + (rowH * rowCount) + buffer);
      tableScrollWrap.style.maxHeight = target + 'px';
    } catch (e) {
      // fallback: keep existing maxHeight
    }
  }

  function rebuildTable() {
    tbody.innerHTML = '';
    annotations.forEach((a, idx) => {
      const tr = document.createElement('tr');
      tr.style.borderTop = '1px solid rgba(255,255,255,0.03)';
      tr.dataset.aid = a.id;
      tr.style.background = 'transparent';

      // Numbered Selection column (single column, no checkbox)
      const selTd = document.createElement('td');
      selTd.textContent = String(idx + 1);
      selTd.style.padding = '6px 8px';
      selTd.style.color = '#ccc';
      selTd.style.minWidth = '48px';
      selTd.style.width = '48px';
      selTd.style.boxSizing = 'border-box';
      selTd.style.borderRight = '1px solid rgba(255,255,255,0.04)';
      tr.appendChild(selTd);

      const btTd = document.createElement('td');
      btTd.textContent = r4(a.beginTime).toFixed(4);
      btTd.style.padding = '6px 8px';
      btTd.style.borderRight = '1px solid rgba(255,255,255,0.04)';
      tr.appendChild(btTd);

      const etTd = document.createElement('td');
      etTd.textContent = r4(a.endTime).toFixed(4);
      etTd.style.padding = '6px 8px';
      etTd.style.borderRight = '1px solid rgba(255,255,255,0.04)';
      tr.appendChild(etTd);

      const lfTd = document.createElement('td');
      lfTd.textContent = r4(a.lowFreq).toFixed(4);
      lfTd.style.padding = '6px 8px';
      lfTd.style.borderRight = '1px solid rgba(255,255,255,0.04)';
      tr.appendChild(lfTd);

      const hfTd = document.createElement('td');
      hfTd.textContent = r4(a.highFreq).toFixed(4);
      hfTd.style.padding = '6px 8px';
      hfTd.style.borderRight = '1px solid rgba(255,255,255,0.04)';
      tr.appendChild(hfTd);

      const spTd = document.createElement('td');
      spTd.textContent = a.species || '';
      spTd.style.padding = '6px 8px';
      spTd.style.borderRight = '1px solid rgba(255,255,255,0.04)';
      tr.appendChild(spTd);

      const notesTd = document.createElement('td');
      notesTd.style.padding = '6px 8px';
      // no right border on last column
      const notesInput = document.createElement('input');
      notesInput.type = 'text';
      notesInput.value = a.notes || '';
      notesInput.style.width = '100%';
      notesInput.style.background = 'transparent';
      notesInput.style.border = '1px solid rgba(255,255,255,0.03)';
      notesInput.style.color = '#eee';
      notesInput.addEventListener('blur', () => { a.notes = notesInput.value; emitChange(); });
      notesInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') notesInput.blur(); });
      notesTd.appendChild(notesInput);
      tr.appendChild(notesTd);

      tbody.appendChild(tr);
    });
    renderAllAnnotations();
    // ensure the wrapper height is recalculated to show at least 10 rows
    // defer slightly to allow DOM to flush measured heights
    setTimeout(() => adjustTableHeightToShowRows(10), 20);
  }

  // Helper: collect selected annotation ids by multiple strategies
  function collectSelectedIdsFromTable() {
    const ids = new Set();

    // 1) check for checkbox inputs (legacy)
    try {
      document.querySelectorAll('#annotationsContainer tbody input[type="checkbox"]:checked').forEach(cb => {
        const aid = cb.dataset && cb.dataset.aid ? cb.dataset.aid : (cb.closest && cb.closest('tr') ? cb.closest('tr').getAttribute('data-aid') : null);
        if (aid) ids.add(String(aid));
      });
    } catch (e) {}

    // 2) check rows with explicit selection class 'selected' or 'is-selected'
    try {
      document.querySelectorAll('#annotationsContainer tbody tr.selected, #annotationsContainer tbody tr.is-selected').forEach(tr => {
        const aid = tr.getAttribute('data-aid');
        if (aid) ids.add(String(aid));
      });
    } catch (e) {}

    // 3) check rows with aria-selected="true" or data-selected="true"
    try {
      document.querySelectorAll('#annotationsContainer tbody tr[aria-selected="true"], #annotationsContainer tbody tr[data-selected="true"]').forEach(tr => {
        const aid = tr.getAttribute('data-aid');
        if (aid) ids.add(String(aid));
      });
    } catch (e) {}

    return Array.from(ids);
  }

  // multi-delete: collect ids, confirm once, then delete and reindex Selection numbers
  function deleteSelectedAnnotations() {
    const ids = collectSelectedIdsFromTable();

    if (!ids || !ids.length) {
      // If central API might manage selection itself, prefer it (no local alert)
      try {
        if (globalThis._deleteAnnotations && typeof globalThis._deleteAnnotations.deleteNow === 'function') {
          try { globalThis._deleteAnnotations.deleteNow(); } catch (e) { try { globalThis._deleteAnnotations.deleteNow(); } catch (err) {} }
          return;
        }
      } catch (e) {}
      try { window.alert('No rows selected for Multi-delete'); } catch (e) {}
      return;
    }

    const confirmed = window.confirm(ids.length === 1 ? 'Delete selected row?' : `Delete ${ids.length} selected rows?`);
    if (!confirmed) return;

    // Try central API with ids first
    try {
      if (globalThis._deleteAnnotations && typeof globalThis._deleteAnnotations.deleteNow === 'function') {
        try {
          if (globalThis._deleteAnnotations.deleteNow.length > 0) globalThis._deleteAnnotations.deleteNow(ids);
          else globalThis._deleteAnnotations.deleteNow();
        } catch (e) {
          try { globalThis._deleteAnnotations.deleteNow(ids); } catch (err) {}
        }
        // central handler expected to update annotations; attempt local rebuild after a tick
        setTimeout(() => { try { annotations = (globalThis._annotations && typeof globalThis._annotations.getAll === 'function') ? globalThis._annotations.getAll().slice() : annotations; rebuildTable(); } catch (e) {} }, 40);
        return;
      }
    } catch (e) {}

    // Fallback: operate on _annotations directly or local array
    try {
      if (globalThis._annotations && typeof globalThis._annotations.getAll === 'function') {
        const all = globalThis._annotations.getAll() || [];
        const idSet = new Set(ids.map(String));
        const remaining = all.filter(a => !idSet.has(String(a.id)));
        if (typeof globalThis._annotations.import === 'function') {
          globalThis._annotations.import(remaining);
        } else if (typeof globalThis._annotations.replace === 'function') {
          globalThis._annotations.replace(remaining);
        } else {
          globalThis._annotations._store = remaining;
        }
        // update local copy and rebuild (ensures Selection column reindexes)
        annotations = (remaining || []).slice();
        rebuildTable();
        try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'multi-delete', deleted: ids } })); } catch (e) {}
        return;
      }
    } catch (err) {
      console.error('multi-delete fallback error', err);
      try { window.alert('Deletion failed; see console'); } catch (e) {}
    }

    // Final fallback: remove from local annotations array
    try {
      const idSet = new Set(ids.map(String));
      annotations = annotations.filter(a => !idSet.has(String(a.id)));
      rebuildTable();
      try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'multi-delete', deleted: ids } })); } catch (e) {}
    } catch (err) {
      console.error('local multi-delete error', err);
      try { window.alert('Deletion failed; see console'); } catch (e) {}
    }
  }

  function highlightAnnotation(id) {
    renderAllAnnotations();
    const a = annotations.find(x => x.id === id);
    if (!a) return;
    const pxPerSec = (globalThis._spectroMap && typeof globalThis._spectroMap.pxPerSec === 'function') ? globalThis._spectroMap.pxPerSec() : (globalThis._spectroPxPerSec || 1);
    const imageH = globalThis._spectroImageHeight || annotationOverlay.clientHeight || 100;
    const ymax = globalThis._spectroYMax || 22050;
    const x1 = (a.beginTime * pxPerSec) - Math.round(scrollArea.scrollLeft || 0);
    const x2 = (a.endTime * pxPerSec) - Math.round(scrollArea.scrollLeft || 0);
    const t1 = 1 - (a.highFreq / ymax);
    const t2 = 1 - (a.lowFreq / ymax);
    const y1 = t1 * imageH;
    const y2 = t2 * imageH;
    aCtx.save();
    aCtx.lineWidth = 2.5;
    aCtx.strokeStyle = '#ffff66';
    aCtx.setLineDash([]);
    aCtx.strokeRect(Math.min(x1, x2) + 0.5, Math.min(y1, y2) + 0.5, Math.abs(x2 - x1), Math.abs(y2 - y1));
    aCtx.restore();
  }

  function emitChange() {
    if (typeof onChangeCb === 'function') onChangeCb(annotations.slice());
  }

  // commit/cancel logic (species read from visible label)
  function commitPending() {
    if (!pending) return;
    const begin = Math.min(pending.startTime, pending.currentTime);
    let end = Math.max(pending.startTime, pending.currentTime);
    const low = Math.min(pending.startFreq, pending.currentFreq);
    const high = Math.max(pending.startFreq, pending.currentFreq);

    if (!(begin < end && low < high)) {
      pending = null;
      renderAllAnnotations();
      return;
    }

    const duration = getDurationSec();

    // Final authoritative clamp: end <= duration
    if (end > duration) end = duration;

    // Enforce minimum duration (10ms) if clamping caused start >= end
    const MIN_DUR = 0.01;
    let startClamped = begin;
    if (startClamped >= end) {
      startClamped = Math.max(0, end - MIN_DUR);
    }

    let speciesVal = '';
    try {
      const spLabel = document.querySelector('#speciesResult');
      if (spLabel) speciesVal = String(spLabel.textContent || '').trim();
    } catch (e) { speciesVal = ''; }

    if (!speciesVal) {
      // New behavior: do not allow commit without an explicit species selection.
      try { window.alert('Species was not selected hence box is not committed.'); } catch (e) {}
      // Clear pending and redraw (box not committed)
      pending = null;
      renderAllAnnotations();
      return;
    }

    const ann = {
      id: 'a' + String(nextId++).padStart(4, '0'),
      beginTime: r4(startClamped),
      endTime: r4(end),
      lowFreq: r4(low),
      highFreq: r4(high),
      species: speciesVal || '',
      notes: ''
    };
    annotations.push(ann);
    pending = null;
    rebuildTable();
    emitChange();
  }

  function cancelPending() {
    pending = null;
    renderAllAnnotations();
  }

  // pointer & keyboard handlers; honor toggle when present
  let pointerDown = false;
  function currentMode() {
    return readModeFromToggle() || mode;
  }

  function onPointerDown(ev) {
    if (currentMode() !== 'create') return;
    if (ev.button !== 0) return;
    const canvasRect = spectrogramCanvas.getBoundingClientRect();
    const yInCanvas = ev.clientY - canvasRect.top;
    const imageHeight = globalThis._spectroImageHeight || (spectrogramCanvas.clientHeight - AXIS_TOP - 44);
    if (yInCanvas < AXIS_TOP || yInCanvas > AXIS_TOP + imageHeight) return;
    pointerDown = true;
    const start = clientToTimeAndFreq_local(ev.clientX, ev.clientY);
    pending = {
      startTime: start.timeSec,
      startFreq: start.freqHz,
      currentTime: start.timeSec,
      currentFreq: start.freqHz,
      pxPerSec: start.pxPerSec
    };
    try { ev.target.setPointerCapture && ev.target.setPointerCapture(ev.pointerId); } catch (e) {}
    renderAllAnnotations();
  }

  function onPointerMove(ev) {
    if (currentMode() !== 'create') return;
    if (!pointerDown || !pending) return;
    const cur = clientToTimeAndFreq_local(ev.clientX, ev.clientY);
    // clamp visual currentTime to duration to avoid drawing past end
    const duration = getDurationSec();
    pending.currentTime = Math.min(cur.timeSec, duration);
    pending.currentFreq = cur.freqHz;
    pending.pxPerSec = cur.pxPerSec;
    renderAllAnnotations();
  }

  function onPointerUp(ev) {
    if (currentMode() !== 'create') return;
    if (!pointerDown) return;
    pointerDown = false;
    try { ev.target.releasePointerCapture && ev.target.releasePointerCapture(ev.pointerId); } catch (e) {}
    // do not auto-commit on pointer up; commit is via Enter/context/auxclick per current UX
    renderAllAnnotations();
  }

  function onKeyDown(ev) {
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
    if (currentMode() !== 'create') return;
    if (!pending) return;
    if (ev.key === 'Enter') {
      commitPending();
      ev.preventDefault();
      ev.stopPropagation();
    } else if (ev.key === 'Escape') {
      cancelPending();
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  function onSpectrogramContextMenu(ev) {
    if (currentMode() !== 'create') return;
    if (!pending) return;
    ev.preventDefault();
    ev.stopPropagation();
    commitPending();
  }

  function onSpectrogramAuxClick(ev) {
    if (currentMode() !== 'create') return;
    if (!pending) return;
    if (ev.button !== 2) return;
    ev.preventDefault();
    ev.stopPropagation();
    commitPending();
  }

  // Delete button wiring: never change mode. Respect authoritative toggle.
  if (deleteBtn) {
    deleteBtn.addEventListener('click', (ev) => {
      try { ev && ev.preventDefault && ev.preventDefault(); } catch (e) {}

      // Delegate to edit module if it exists
      try {
        if (globalThis._editAnnotations && typeof globalThis._editAnnotations.deleteEditing === 'function') {
          globalThis._editAnnotations.deleteEditing();
          return;
        }
      } catch (e) { console.error('Delegation to _editAnnotations.deleteEditing failed', e); }

      const authMode = readModeFromToggle() || mode;
      if (authMode === 'edit') {
        // fallback attempt to delete via edit APIs (no selection UI here)
        try {
          if (globalThis._editAnnotations && typeof globalThis._editAnnotations.getEditingId === 'function') {
            const editingId = globalThis._editAnnotations.getEditingId();
            if (editingId) {
              if (globalThis._annotations && typeof globalThis._annotations.delete === 'function') {
                globalThis._annotations.delete(editingId);
                return;
              }
              if (globalThis._annotations && typeof globalThis._annotations.getAll === 'function' && typeof globalThis._annotations.import === 'function') {
                const remaining = (globalThis._annotations.getAll() || []).filter(a => String(a.id) !== String(editingId));
                globalThis._annotations.import(remaining);
                return;
              }
            }
          }
        } catch (e) { console.error('Fallback edit-mode deletion failed', e); }
        try { window.alert('Unable to delete the selected annotation. See console.'); } catch (e) {}
        return;
      }

      // Create mode: delete button disabled normally; if reached, inform user
      try { window.alert('No annotation selected to delete. Select a box first or switch to edit mode.'); } catch (e) {}
    }, false);
  }

  // Multi-delete wiring (matches your exact spec)
  if (multiDeleteBtn) {
    multiDeleteBtn.addEventListener('click', (ev) => {
      try {
        ev && ev.preventDefault && ev.preventDefault();
        // prevent duplicate prompts from other handlers attached to same element
        if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      } catch (e) {}
      deleteSelectedAnnotations();
    }, false);
  }

  // local setMode: only updates internal variable and syncs visual aria-pressed states if toggle present.
  // This function will never set a "delete" mode.
  function setMode(m) {
    if (m === 'delete') return; // defensive: never allow delete mode
    mode = m;
    try {
      if (toggleWrap) {
        const btnCreate = toggleWrap.querySelector('[data-mode="create"]');
        const btnEdit = toggleWrap.querySelector('[data-mode="edit"]');
        toggleWrap.dataset.mode = m;
        if (btnCreate) btnCreate.setAttribute('aria-pressed', m === 'create' ? 'true' : 'false');
        if (btnEdit) btnEdit.setAttribute('aria-pressed', m === 'edit' ? 'true' : 'false');
        toggleWrap.dispatchEvent(new CustomEvent('mode-change', { detail: { mode: m }, bubbles: true }));
      }
    } catch (e) {}
  }

  // Attach events
  spectrogramCanvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  spectrogramCanvas.addEventListener('contextmenu', onSpectrogramContextMenu);
  spectrogramCanvas.addEventListener('auxclick', onSpectrogramAuxClick);
  spectrogramCanvas.tabIndex = spectrogramCanvas.tabIndex || 0;
  spectrogramCanvas.addEventListener('keydown', onKeyDown);
  window.addEventListener('keydown', onKeyDown);

  scrollArea.addEventListener('scroll', () => { resizeAnnotationOverlay(); });
  window.addEventListener('resize', () => { resizeAnnotationOverlay(); adjustTableHeightToShowRows(10); });

  // Keep overlay responsive if the table wrapper's scrollbar changes layout
  tableScrollWrap.addEventListener('scroll', () => { /* no-op; present for potential future sync hooks */ });

  // Authoritative API used by other modules
  globalThis._annotations = globalThis._annotations || {};
  globalThis._annotations.getAll = () => annotations.slice();
  globalThis._annotations.import = (arr) => { annotations = Array.isArray(arr) ? arr.slice() : []; rebuildTable(); };
  globalThis._annotations.onChange = (cb) => { onChangeCb = cb; };
  globalThis._annotations.delete = (id) => { annotations = annotations.filter(a => a.id !== id); rebuildTable(); emitChange(); };
  globalThis._annotations.clear = () => { annotations = []; rebuildTable(); emitChange(); };

  // initial render
  setTimeout(() => {
    resizeAnnotationOverlay();
    rebuildTable();
    // make sure height matches 10 rows after first render
    setTimeout(() => adjustTableHeightToShowRows(10), 40);
  }, 120);

})();
