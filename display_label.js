// display_label.js
// Shows a small label at the top-left of every drawn annotation box.
// Format: "Selection|Species". Labels update live when annotations are created/edited/deleted.
// When an annotation is in an edit session (selected), its label text color matches the box color
// (falls back to yellow if annotation.color is absent).
//
// Include this script after your UI scripts or bundle it. It is idempotent and tolerant of late-loading DOM.

(function () {
  if (!window || !document) return;

  const VIEWPORT_WRAPPER_ID = 'viewportWrapper';
  const TBODY_SELECTOR = '#annotationsContainer tbody';
  const ROW_DATA_AID = 'data-aid';
  const LABEL_CONTAINER_ID = 'annotationLabelContainer_v1';
  const AXIS_TOP = 12;
  const LABEL_CLASS = 'ann-toplabel-v1';
  const UPDATE_DEBOUNCE_MS = 60;
  const DEFAULT_SELECTED_COLOR = '#ffff66';

  // Public configurable options
  globalThis._displayAnnotationLabels = globalThis._displayAnnotationLabels || {};
  globalThis._displayAnnotationLabels.options = globalThis._displayAnnotationLabels.options || {
    defaultTextColor: '#fff',
    selectedTextColorFallback: DEFAULT_SELECTED_COLOR,
    fontWeight: '600', // set to 600 as requested
    textShadow: '0 1px 2px rgba(0,0,0,0.9)'
  };

  function getOptions() { return globalThis._displayAnnotationLabels.options; }

  function getAnnotations() {
    try {
      if (globalThis._annotations && typeof globalThis._annotations.getAll === 'function') {
        return globalThis._annotations.getAll() || [];
      }
    } catch (e) {}
    return [];
  }

  function getMapping() {
    const pxPerSec = (globalThis._spectroMap && typeof globalThis._spectroMap.pxPerSec === 'function')
      ? globalThis._spectroMap.pxPerSec()
      : (globalThis._spectroPxPerSec || 1);
    const imageHeight = (typeof globalThis._spectroImageHeight === 'number' && globalThis._spectroImageHeight > 0)
      ? globalThis._spectroImageHeight
      : Math.max(1, ((document.getElementById('spectrogramCanvas') && document.getElementById('spectrogramCanvas').clientHeight) || 300) - AXIS_TOP - 44);
    const ymaxHz = (typeof globalThis._spectroYMax === 'number' && globalThis._spectroYMax > 0)
      ? globalThis._spectroYMax
      : (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);
    const axisLeft = (typeof globalThis._spectroAxisLeft === 'number') ? globalThis._spectroAxisLeft : 70;
    return { pxPerSec, imageHeight, ymaxHz, axisLeft };
  }

  function annotationToRectPx(a) {
    const scrollArea = document.getElementById('scrollArea');
    if (!scrollArea) return null;
    const { pxPerSec, imageHeight, ymaxHz } = getMapping();
    const left = (a.beginTime * pxPerSec) - Math.round(scrollArea.scrollLeft || 0);
    const right = (a.endTime * pxPerSec) - Math.round(scrollArea.scrollLeft || 0);
    const t1 = 1 - (a.highFreq / ymaxHz);
    const t2 = 1 - (a.lowFreq / ymaxHz);
    const top = t1 * imageHeight;
    const bottom = t2 * imageHeight;
    return { left, top, right, bottom };
  }

  function ensureLabelContainer() {
    let container = document.getElementById(LABEL_CONTAINER_ID);
    if (container) return container;
    const vw = document.getElementById(VIEWPORT_WRAPPER_ID) || document.body;
    container = document.createElement('div');
    container.id = LABEL_CONTAINER_ID;
    container.style.position = 'absolute';
    container.style.left = '0px';
    container.style.top = '0px';
    container.style.pointerEvents = 'none';
    container.style.zIndex = 90;
    vw.appendChild(container);
    return container;
  }

  function buildAnnotationRowMap() {
    const map = new Map();
    try {
      const tbody = document.querySelector(TBODY_SELECTOR);
      if (!tbody) return map;
      const rows = Array.from(tbody.querySelectorAll('tr'));
      for (let i = 0; i < rows.length; i++) {
        const tr = rows[i];
        const aid = tr.getAttribute(ROW_DATA_AID) || (tr.dataset && tr.dataset.aid);
        if (!aid) continue;
        let species = '';
        const speciesCell = tr.querySelector('td[data-col="species"], td.species, td[data-field="species"]');
        if (speciesCell) species = (speciesCell.textContent || '').trim();
        else {
          try {
            const table = tbody.closest && tbody.closest('table');
            if (table) {
              const ths = Array.from(table.querySelectorAll('thead th'));
              let speciesIdx = -1;
              for (let j = 0; j < ths.length; j++) {
                const txt = (ths[j].textContent || '').trim().toLowerCase();
                if (txt === 'species') { speciesIdx = j; break; }
              }
              if (speciesIdx >= 0) {
                const tds = Array.from(tr.querySelectorAll('td'));
                if (tds[speciesIdx]) species = (tds[speciesIdx].textContent || '').trim();
              }
            }
          } catch (e) {}
        }
        map.set(String(aid), { index: i + 1, species: species || '' });
      }
    } catch (e) {}
    return map;
  }

  function createOrUpdateLabel(container, aidStr, rectPx, rowInfo) {
    if (!rectPx) return;
    const id = 'ann_label_' + aidStr;
    let el = document.getElementById(id);
    const labelText = (rowInfo && typeof rowInfo.index === 'number' ? String(rowInfo.index) : '?') + '|' + (rowInfo && rowInfo.species ? rowInfo.species : '');
    const opts = getOptions();
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = LABEL_CLASS;
      Object.assign(el.style, {
        position: 'absolute',
        left: '0px',
        top: '0px',
        pointerEvents: 'none',
        background: 'transparent',
        color: opts.defaultTextColor || '#fff',
        padding: '2px 6px',
        fontSize: '12px',
        lineHeight: '16px',
        borderRadius: '3px',
        whiteSpace: 'nowrap',
        transform: 'translate(-2px, -16px)',
        textShadow: opts.textShadow || '0 1px 2px rgba(0,0,0,0.9)',
        fontWeight: opts.fontWeight || '600'
      });
      container.appendChild(el);
    }
    el.textContent = labelText;
    const axisLeft = getMapping().axisLeft || 70;
    const leftPx = (axisLeft + (rectPx.left || 0));
    const topPx = (AXIS_TOP + (rectPx.top || 0));
    el.style.left = Math.round(leftPx) + 'px';
    el.style.top = Math.round(topPx) + 'px';
  }

  function removeLabelIfExists(aidStr) {
    const id = 'ann_label_' + aidStr;
    const el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function updateLabelColors() {
    try {
      const opts = getOptions();
      const defaultColor = opts.defaultTextColor || '#fff';
      const selectedFallback = opts.selectedTextColorFallback || DEFAULT_SELECTED_COLOR;
      const editingId = (globalThis._editAnnotations && typeof globalThis._editAnnotations.getEditingId === 'function')
        ? globalThis._editAnnotations.getEditingId() : null;

      const container = document.getElementById(LABEL_CONTAINER_ID);
      if (!container) return;
      const children = Array.from(container.children || []);
      for (const ch of children) {
        ch.style.color = defaultColor;
      }

      if (editingId === null || editingId === undefined) return;

      const aidStr = String(editingId);
      const anns = getAnnotations();
      const ann = anns.find(a => String(a.id) === aidStr);
      const color = (ann && ann.color) ? String(ann.color) : selectedFallback;

      const el = document.getElementById('ann_label_' + aidStr);
      if (el) {
        el.style.color = color;
      }
    } catch (e) {
      console.error('updateLabelColors error', e);
    }
  }

  function syncAllLabels() {
    try {
      const container = ensureLabelContainer();
      const anns = getAnnotations();
      const rowMap = buildAnnotationRowMap();
      const currentIds = new Set(anns.map(a => String(a.id)));

      for (const a of anns) {
        const aidStr = String(a.id);
        const rect = annotationToRectPx(a);
        createOrUpdateLabel(container, aidStr, rect, rowMap.get(aidStr) || { index: '?', species: '' });
      }

      const children = Array.from(container.children || []);
      for (const ch of children) {
        if (!ch.id) continue;
        const m = ch.id.match(/^ann_label_(.+)$/);
        if (!m) continue;
        const aid = String(m[1]);
        if (!currentIds.has(aid)) ch.remove();
      }

      updateLabelColors();
    } catch (e) {
      console.error('syncAllLabels error', e);
    }
  }

  let debounceTimer = null;
  function scheduleSync() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { syncAllLabels(); debounceTimer = null; }, UPDATE_DEBOUNCE_MS);
  }

  function installEventListeners() {
    window.addEventListener('annotations-changed', () => scheduleSync(), { passive: true });
    window.addEventListener('edit-selection-changed', () => scheduleSync(), { passive: true });

    const tbody = document.querySelector(TBODY_SELECTOR);
    if (tbody) {
      const mo = new MutationObserver(() => scheduleSync());
      mo.observe(tbody, { childList: true, subtree: true, characterData: true });
    } else {
      const docMo = new MutationObserver((mutations, obs) => {
        const tb = document.querySelector(TBODY_SELECTOR);
        if (tb) {
          const mo = new MutationObserver(() => scheduleSync());
          mo.observe(tb, { childList: true, subtree: true, characterData: true });
          scheduleSync();
          obs.disconnect();
        }
      });
      docMo.observe(document.documentElement || document.body, { childList: true, subtree: true });
    }

    const scrollArea = document.getElementById('scrollArea');
    if (scrollArea) scrollArea.addEventListener('scroll', () => scheduleSync(), { passive: true });
    window.addEventListener('resize', () => scheduleSync(), { passive: true });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(scheduleSync, 60));
    else setTimeout(scheduleSync, 60);

    setInterval(() => scheduleSync(), 2000);
  }

  globalThis._displayAnnotationLabels = globalThis._displayAnnotationLabels || {};
  globalThis._displayAnnotationLabels.sync = syncAllLabels;
  globalThis._displayAnnotationLabels.schedule = scheduleSync;
  globalThis._displayAnnotationLabels.updateLabelColors = updateLabelColors;
  globalThis._displayAnnotationLabels.setOption = function (k, v) {
    globalThis._displayAnnotationLabels.options = globalThis._displayAnnotationLabels.options || {};
    globalThis._displayAnnotationLabels.options[k] = v;
    scheduleSync();
  };

  ensureLabelContainer();
  installEventListeners();

})();