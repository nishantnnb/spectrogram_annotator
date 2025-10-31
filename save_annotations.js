// save_annotations.js
// Produces two tab-separated text files when user clicks Save:
//  - <soundfile>_Matadata.txt  (single-row metadata table: header row + one row)
//  - <soundfile>_annotations.txt  (annotations only, tab-delimited; required columns first, extras appended)
// Behavior:
//  - Metadata headers use visible form labels
//  - Recording date/time split into "Recording date" (dd-mm-yyyy) and "Recording time" (HH:MM)
//  - ONLY uses meta.datetime (no savedAt fallback). If meta.datetime is empty, date/time are blank.
//  - Comments newline characters replaced with spaces
//  - Contributors output as comma-separated list: "name1, name2, name3"
//  - Alias/internal annotation keys are not appended as extra columns
//  - Begin Time (s), End Time (s), Low Freq (Hz), High Freq (Hz) rounded to 4 decimals
// Values otherwise kept raw; objects/arrays are JSON-stringified.

(function () {
  if (window.__saveAnnotationsInit) return;
  window.__saveAnnotationsInit = true;

  const SAVE_BTN_ID = 'saveAnnoBtn';
  const FILE_INPUT_ID = 'file';

  function q(id) { return document.getElementById(id); }

  function updateSaveBtnState() {
    const btn = q(SAVE_BTN_ID);
    const file = q(FILE_INPUT_ID);
    if (!btn) return;
    try {
      const hasFile = file && file.files && file.files.length > 0;
      btn.disabled = !hasFile;
    } catch (e) {
      btn.disabled = true;
    }
  }

  function fileBaseName() {
    try {
      const f = q(FILE_INPUT_ID);
      if (f && f.files && f.files.length > 0 && f.files[0].name) {
        const name = f.files[0].name;
        const idx = name.lastIndexOf('.');
        return idx > 0 ? name.slice(0, idx) : name;
      }
    } catch (e) {}
    return 'export';
  }

  function nowStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // Keep raw values; stringify objects; don't round numbers except explicitly requested fields
  function cellString(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch (e) { return String(v); }
    }
    return String(v);
  }

  // Round numeric value to 4 decimals, preserving as string.
  function round4(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!isFinite(n)) return '';
    return n.toFixed(4);
  }

  // ----- Metadata handling -----
  function formatDateAndTimeFromISO(iso) {
    if (!iso) return { date: '', time: '' };
    try {
      const s = String(iso).trim();
      if (s === '') return { date: '', time: '' };
      const d = new Date(s);
      if (isNaN(d)) return { date: '', time: '' };
      const pad = (n) => String(n).padStart(2, '0');
      const dd = pad(d.getDate());
      const mm = pad(d.getMonth() + 1);
      const yyyy = d.getFullYear();
      const hh = pad(d.getHours());
      const min = pad(d.getMinutes());
      return { date: `${dd}-${mm}-${yyyy}`, time: `${hh}:${min}` };
    } catch (e) {
      return { date: '', time: '' };
    }
  }

  function normalizeComments(s) {
    if (s === null || s === undefined) return '';
    try {
      return String(s).replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
    } catch (e) {
      return String(s).replace(/\r\n|\r|\n/g, ' ');
    }
  }

  // METADATA builder using visible labels; uses ONLY meta.datetime (no savedAt)
  function buildMetadataTSV_usingLabels(meta) {
    meta = meta || {};
    const latitude = meta.latitude !== undefined && meta.latitude !== null ? cellString(meta.latitude) : '';
    const longitude = meta.longitude !== undefined && meta.longitude !== null ? cellString(meta.longitude) : '';

    // IMPORTANT: use only explicit datetime provided by user; do not fall back to savedAt or now
    const dtIso = (meta.datetime !== undefined && meta.datetime !== null && String(meta.datetime).trim() !== '') ? String(meta.datetime).trim() : null;
    const dt = formatDateAndTimeFromISO(dtIso);

    const typeOfRecording = meta.type || '';
    const targetSpecies = meta.species || '';
    const recorder = meta.recorder || '';
    const microphone = meta.microphone || '';
    const accessories = meta.accessories || '';

    // Contributors: if array, join with comma + space; if string, use as-is
    let contributors = '';
    if (Array.isArray(meta.contributors)) {
      contributors = meta.contributors.map(c => String(c).trim()).filter(Boolean).join(', ');
    } else if (meta.contributors) {
      contributors = cellString(meta.contributors);
    }

    const comments = normalizeComments(meta.comments || '');

    const headers = [
      'Latitude',
      'Longitude',
      'Recording date',
      'Recording time',
      'Type of recording',
      'Target species',
      'Recorder',
      'Microphone',
      'Accessories',
      'Contributor(s)',
      'Overall comments'
    ];

    const row = [
      latitude,
      longitude,
      dt.date,
      dt.time,
      cellString(typeOfRecording),
      cellString(targetSpecies),
      cellString(recorder),
      cellString(microphone),
      cellString(accessories),
      cellString(contributors),
      cellString(comments)
    ];

    return { content: headers.join('\t') + '\n' + row.join('\t') + '\n', filenameSuffix: '_Matadata' };
  }

  // ----- Annotations handling -----
  const requiredCols = [
    'Selection',
    'View',
    'Channel',
    'Begin Time (s)',
    'End Time (s)',
    'Low Freq (Hz)',
    'High Freq (Hz)',
    'Species',
    'Notes'
  ];

  const aliasSkip = new Set([
    'id',
    'beginTime', 'begin_time', 'begin',
    'endTime', 'end_time', 'end',
    'lowFreq', 'low_freq', 'low',
    'highFreq', 'high_freq', 'high',
    'species',
    'notes', 'note',
    // Also skip exact required column names if present
    'Selection','View','Channel','Begin Time (s)','End Time (s)','Low Freq (Hz)','High Freq (Hz)','Species','Notes'
  ]);

  function buildAnnotationsTSV(annotations) {
    annotations = Array.isArray(annotations) ? annotations : [];

    // Discover truly-extra keys (exclude alias/internal)
    const extras = [];
    const seen = new Set();
    annotations.forEach(a => {
      if (!a || typeof a !== 'object') return;
      Object.keys(a).forEach(k => {
        if (aliasSkip.has(k)) return;
        if (seen.has(k)) return;
        seen.add(k);
        extras.push(k);
      });
    });

    // Header = requiredCols + extras
    const header = requiredCols.concat(extras).join('\t');
    const lines = [header];

    annotations.forEach((a, idx) => {
      const sel = String(idx + 1);
      const view = '1';
      const channel = '1';

      // Map common fields to required columns and round to 4 decimals where requested
      const beginRaw = (a && Object.prototype.hasOwnProperty.call(a, 'beginTime')) ? a.beginTime :
                       (a && Object.prototype.hasOwnProperty.call(a, 'begin')) ? a.begin : '';
      const endRaw = (a && Object.prototype.hasOwnProperty.call(a, 'endTime')) ? a.endTime :
                     (a && Object.prototype.hasOwnProperty.call(a, 'end')) ? a.end : '';
      const lowRaw = (a && Object.prototype.hasOwnProperty.call(a, 'lowFreq')) ? a.lowFreq :
                     (a && Object.prototype.hasOwnProperty.call(a, 'low')) ? a.low : '';
      const highRaw = (a && Object.prototype.hasOwnProperty.call(a, 'highFreq')) ? a.highFreq :
                      (a && Object.prototype.hasOwnProperty.call(a, 'high')) ? a.high : '';

      const begin = round4(beginRaw);
      const end = round4(endRaw);
      const low = round4(lowRaw);
      const high = round4(highRaw);

      const species = (a && Object.prototype.hasOwnProperty.call(a, 'species')) ? cellString(a.species) : '';
      const notes = (a && Object.prototype.hasOwnProperty.call(a, 'notes')) ? cellString(a.notes) : '';

      const baseRow = [ sel, view, channel, begin, end, low, high, species, notes ];
      const extrasRow = extras.map(k => (a && Object.prototype.hasOwnProperty.call(a, k)) ? cellString(a[k]) : '');
      lines.push(baseRow.concat(extrasRow).join('\t'));
    });

    return { content: lines.join('\n') + '\n', filenameSuffix: '_annotations' };
  }

  // Main save action: build both files and download
  function saveAction() {
    try {
      const annotations = (globalThis._annotations && typeof globalThis._annotations.getAll === 'function') ? (globalThis._annotations.getAll() || []) : [];
      const metadata = window.__lastMetadata || {};
      const base = fileBaseName();

      // Metadata file (uses visible labels and splits date/time; only meta.datetime is considered)
      const md = buildMetadataTSV_usingLabels(metadata);
      const mdBlob = new Blob([md.content], { type: 'text/plain;charset=utf-8' });
      const mdFilename = `${base}${md.filenameSuffix}.txt`;
      downloadBlob(mdBlob, mdFilename);

      // Annotations file
      const an = buildAnnotationsTSV(annotations);
      const anBlob = new Blob([an.content], { type: 'text/plain;charset=utf-8' });
      const anFilename = `${base}${an.filenameSuffix}.txt`;
      downloadBlob(anBlob, anFilename);

    } catch (err) {
      console.error('Save action failed', err);
      try { window.alert('Save failed. See console for details.'); } catch (e) {}
    }
  }

  // Wire button and keep enable state in sync with file input changes
  function wireSaveButtonOnce() {
    const btn = q(SAVE_BTN_ID);
    if (!btn) return;
    if (btn.__saveWired) return;
    btn.addEventListener('click', function (ev) {
      try { ev && ev.preventDefault && ev.preventDefault(); } catch (e) {}
      if (btn.disabled) return;
      saveAction();
    }, true);
    btn.__saveWired = true;
  }

  function observeFileInput() {
    const file = q(FILE_INPUT_ID);
    if (!file) {
      setTimeout(observeFileInput, 120);
      return;
    }
    updateSaveBtnState();
    file.addEventListener('change', () => updateSaveBtnState(), true);
    const mo = new MutationObserver(() => updateSaveBtnState());
    mo.observe(file, { attributes: true, attributeFilter: ['value'] });
  }

  function init() {
    wireSaveButtonOnce();
    observeFileInput();
    setTimeout(() => updateSaveBtnState(), 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else init();

  // Expose for debug
  window.__saveAnnotations = { saveNow: saveAction };

})();