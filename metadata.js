// metadata.js — modal only (index.html wires the metaOpenBtn)
// Features:
// - Focuses Latitude on open
// - Inline Target species autocomplete (dropdown) that writes selection into the species input
// - Waits briefly for window.__speciesRecords, falls back to [] if not present
// - Contributors input (chips) same as before
// - Exposes window.__openMetadataModal() API consistent with existing usage
// - Recording date & time is placed in left column (same width as Latitude)
// - Adds a fixed Rating dropdown (1-5) that persists like other fields

(function () {
  if (window.__metadataInit) return;
  window.__metadataInit = true;

  window.__lastMetadata = window.__lastMetadata || null;

  // DOM builder helper
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === 'cls') node.className = props[k];
        else if (k === 'html') node.innerHTML = props[k];
        else if (k && k.startsWith && k.startsWith('aria-')) node.setAttribute(k, props[k]);
        else node[k] = props[k];
      }
    }
    children.forEach(c => {
      if (c == null) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }

  function buildModalDom() {
    const style = document.createElement('style');
    style.id = 'metadata-modal-styles';
    style.textContent = `
#metaOverlay { position:fixed; inset:0; background: rgba(18,22,26,0.45); display:flex; align-items:center; justify-content:center; z-index:2147483646; -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
#metaCard { width:96%; max-width:760px; background:#fff; border-radius:10px; box-shadow:0 10px 40px rgba(0,0,0,0.25); padding:18px; color:#111; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial; max-height:88vh; overflow:auto; }
#metaCard h4 { margin:0 0 6px 0; font-size:16px; }
#metaFilename { font-size:13px; color:#555; margin:0 0 12px 0; display:block; }
.meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; align-items:center; margin-bottom:10px; }
.meta-row-full { grid-column:1 / -1; }
.meta-label { font-size:13px; color:#333; margin-bottom:6px; display:block; }
.meta-input, .meta-select, .meta-textarea { width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #d0d4d7; border-radius:6px; font-size:14px; background:#fff; }
.meta-input.small { padding:8px 10px; font-size:14px; }
.meta-textarea { min-height:82px; resize:vertical; }
.meta-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:12px; }
.btn { padding:8px 12px; border-radius:8px; border:1px solid transparent; font-size:14px; cursor:pointer; }
.btn-muted { background:#f6f7f8; color:#222; border-color:#e0e3e6; }
.btn-primary { background:#0b66ff; color:#fff; border-color:#075be0; box-shadow: 0 6px 18px rgba(11,102,255,0.12); }
.small-note { font-size:12px; color:#666; margin-top:6px; }
.meta-chip-wrap { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.meta-chip { display:inline-flex; align-items:center; gap:6px; padding:6px 8px; background:#f3f6ff; color:#08306b; border-radius:999px; font-size:13px; }
.meta-chip button { background:transparent; border:0; cursor:pointer; color:#08306b; padding:0 4px; }
.species-autocomplete { position:relative; }
.species-suggestions { position:absolute; left:0; right:0; top:calc(100% + 6px); background:#fff; border:1px solid #d6d9dc; box-shadow:0 6px 20px rgba(20,24,28,0.08); border-radius:6px; max-height:260px; overflow:auto; z-index:999999; }
.species-suggestions .item { padding:8px 10px; cursor:pointer; font-size:13px; color:#111; border-bottom:1px solid rgba(0,0,0,0.03); }
.species-suggestions .item:last-child { border-bottom: none; }
.species-suggestions .item:hover, .species-suggestions .item.active { background:#eef6ff; }
.species-mark { background:transparent; font-weight:600; color:#0b66ff; }
@media (max-width:640px) { .meta-grid { grid-template-columns:1fr; } .meta-actions { justify-content:stretch; } }
`;
    document.head.appendChild(style);

    const overlay = el('div', { id: 'metaOverlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Recording metadata entry' });
    const card = el('div', { id: 'metaCard' });
    card.appendChild(el('h4', null, 'Recording metadata'));
    card.appendChild(el('div', { id: 'metaFilename', role: 'status', 'aria-live': 'polite' }, ''));
    const grid = el('div', { cls: 'meta-grid' });

    // Left column: Latitude (small input)
    const latWrap = el('div', null,
      el('label', { cls: 'meta-label', html: 'Latitude' }),
      el('input', { type: 'text', className: 'meta-input small', id: 'meta-lat', placeholder: 'e.g. 19.391234' })
    );

    // Right column: Longitude (small input)
    const lonWrap = el('div', null,
      el('label', { cls: 'meta-label', html: 'Longitude' }),
      el('input', { type: 'text', className: 'meta-input small', id: 'meta-lon', placeholder: 'e.g. 72.817654' })
    );

    // Recording date & time in left column (small to match Latitude)
    const dtWrap = el('div', null,
      el('label', { cls: 'meta-label', html: 'Recording date & time' }),
      el('input', { type: 'datetime-local', className: 'meta-input small', id: 'meta-datetime' })
    );

    // NEW: Rating dropdown (right column) fixed values 1..5
    const ratingWrap = el('div', null,
      el('label', { cls: 'meta-label', html: 'Rating' }),
      el('select', { className: 'meta-select', id: 'meta-rating' },
        el('option', { value: '' }, ''),
        el('option', { value: '1' }, '1: Very Strong target sound, little or no noise'),
        el('option', { value: '2' }, '2: Strong target sound, limited noise'),
        el('option', { value: '3' }, '3: Good target sound, moderate noise'),
        el('option', { value: '4' }, '4: Weak target sound, significant noise'),
        el('option', { value: '5' }, '5: Very Weak target sound, High noise')
      )
    );

    const typeWrap = el('div', null,
      el('label', { cls: 'meta-label', html: 'Type of recording' }),
      el('select', { className: 'meta-select', id: 'meta-type' }, el('option', { value: '' }, ''), el('option', { value: 'focal' }, 'Focal'), el('option', { value: 'passive' }, 'Passive'))
    );

    const speciesInput = el('input', { type: 'text', className: 'meta-input', id: 'meta-species', placeholder: 'Common or scientific name', autocomplete: 'off', 'aria-label': 'Target species' });
    const speciesWrap = el('div', null,
      el('label', { cls: 'meta-label', html: 'Target species' }),
      el('div', { cls: 'species-autocomplete' },
        speciesInput,
        el('div', { cls: 'species-suggestions', id: 'meta-species-suggest', style: 'display:none' })
      )
    );

    const recorderWrap = el('div', null,
      el('label', { cls: 'meta-label', html: 'Recorder' }),
      el('input', { type: 'text', className: 'meta-input', id: 'meta-recorder', placeholder: 'Make / model / Smartphone' })
    );
    const micWrap = el('div', null,
      el('label', { cls: 'meta-label', html: 'Microphone' }),
      el('input', { type: 'text', className: 'meta-input', id: 'meta-mic', placeholder: 'Make / model' })
    );
    const accWrap = el('div', null,
      el('label', { cls: 'meta-label', html: 'Accessories' }),
      el('input', { type: 'text', className: 'meta-input', id: 'meta-accessories', placeholder: 'e.g. windscreen, preamp, parabola' })
    );

    const contribWrap = el('div', null,
      el('label', { cls: 'meta-label', html: 'Contributor(s)' }),
      (function () {
        const container = el('div', { cls: 'meta-chip-wrap', id: 'meta-contrib-wrap' });
        const input = el('input', { type: 'text', className: 'meta-input', id: 'meta-contrib-input', placeholder: "Type a name and press Enter or , or Tab" });
        container.appendChild(input);
        return container;
      })()
    );

    const commentsWrap = el('div', { cls: 'meta-row-full' },
      el('label', { cls: 'meta-label', html: 'Overall comments' }),
      el('textarea', { className: 'meta-textarea', id: 'meta-comments', placeholder: 'Any notes about environment, behaviour, or recording conditions' })
    );

    // Grid: lat | lon, datetime | rating, type | (spacer), species | recorder, mic | accessories, contributors (left) | comments (full)
    grid.appendChild(latWrap);
    grid.appendChild(lonWrap);
    grid.appendChild(dtWrap);
    grid.appendChild(ratingWrap);
    grid.appendChild(typeWrap);
    grid.appendChild(el('div', null));
    grid.appendChild(speciesWrap);
    grid.appendChild(recorderWrap);
    grid.appendChild(micWrap);
    grid.appendChild(accWrap);
    grid.appendChild(contribWrap);
    grid.appendChild(commentsWrap);

    const actions = el('div', { cls: 'meta-actions' });
    const okBtn = el('button', { type: 'button', className: 'btn btn-primary', id: 'meta-ok' }, 'OK');
    const cancelBtn = el('button', { type: 'button', className: 'btn btn-muted', id: 'meta-cancel' }, 'Cancel');
    actions.appendChild(okBtn);
    actions.appendChild(cancelBtn);

    const footer = el('div', { cls: 'small-note', style: 'margin-top:8px; text-align:left' }, 'All fields are optional. Press OK to save and Press Esc or Cancel to close without saving.');

    card.appendChild(grid);
    card.appendChild(actions);
    card.appendChild(footer);
    overlay.appendChild(card);

    return { overlay, speciesInput, speciesSuggest: overlay.querySelector('#meta-species-suggest') };
  }

  // utility to safely set node value by id
  function nodesSafeSet(id, val) {
    try {
      const n = document.getElementById(id);
      if (n) n.value = val === undefined || val === null ? '' : val;
    } catch (e) {}
  }

  // Contributors chip logic (used when modal created)
  function initContribWrap(wrap) {
    if (!wrap) return;
    if (wrap.__contribAPI) return wrap.__contribAPI;
    const input = wrap.querySelector('#meta-contrib-input');
    const state = { contributors: [] };
    function renderChips(names) {
      Array.from(wrap.querySelectorAll('.meta-chip')).forEach(c => c.remove());
      names.forEach(nm => {
        const display = String(nm).trim();
        if (!display) return;
        const chip = el('span', { cls: 'meta-chip' }, display, el('button', { type: 'button', title: 'Remove', 'aria-label': 'Remove contributor' }, '✕'));
        chip.querySelector('button').addEventListener('click', () => {
          const idx = state.contributors.indexOf(display);
          if (idx >= 0) { state.contributors.splice(idx, 1); renderChips(state.contributors); }
        });
        wrap.insertBefore(chip, input);
      });
    }
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          const v = input.value.trim().replace(/,$/, '');
          if (v) { state.contributors.push(v); input.value = ''; renderChips(state.contributors); }
        } else if (e.key === 'Backspace' && input.value === '') {
          state.contributors.pop(); renderChips(state.contributors);
        } else if (e.key === 'Tab' && input.value.trim()) {
          const v2 = input.value.trim().replace(/,$/, '');
          if (v2) { state.contributors.push(v2); input.value = ''; renderChips(state.contributors); }
        }
      });
      input.addEventListener('blur', () => {
        const v = input.value.trim().replace(/,$/, '');
        if (v) { state.contributors.push(v); input.value = ''; renderChips(state.contributors); }
      });
    }
    wrap.__contribAPI = {
      get: () => state.contributors.slice(),
      set: (arr) => { state.contributors = Array.isArray(arr) ? arr.map(String).map(s => s.trim()).filter(Boolean) : []; renderChips(state.contributors); }
    };
    return wrap.__contribAPI;
  }

  // Species autocomplete implementation (dropdown inside modal). Waits for window.__speciesRecords.
  function wireSpeciesAutocompleteWithWait(inputEl, suggestEl) {
    if (!inputEl || !suggestEl) return;

    const MIN_CHARS = 2;
    const DEBOUNCE_MS = 120;
    const MAX_RESULTS = 10;

    function norm(s) { return (s || '').toString().normalize().toLowerCase(); }
    function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || '&amp;'); }
    function score(rec, q) {
      const nq = norm(q);
      const k = norm(rec.key || '');
      const c = norm(rec.common || '');
      let s = 0;
      if (k.startsWith(nq)) s += 120;
      else if (k.includes(nq)) s += 80;
      if (c.startsWith(nq)) s += 60;
      else if (c.includes(nq)) s += 30;
      s += Math.max(0, 10 - Math.min(9, (k.length || 0) / 10));
      return s;
    }
    function highlight(orig, q) {
      if (!q) return escapeHtml(orig || '');
      const o = orig || '';
      const lower = norm(o);
      const nq = norm(q);
      const idx = lower.indexOf(nq);
      if (idx < 0) return escapeHtml(o);
      const before = o.slice(0, idx), match = o.slice(idx, idx + q.length), after = o.slice(idx + q.length);
      return escapeHtml(before) + '<span class="species-mark">' + escapeHtml(match) + '</span>' + escapeHtml(after);
    }

    let debounceTimer = null;
    let lastQuery = '';
    let activeIdx = -1;

    function closeList() {
      suggestEl.innerHTML = '';
      suggestEl.style.display = 'none';
      activeIdx = -1;
    }

    function renderList(records, q) {
      lastQuery = q;
      activeIdx = -1;
      suggestEl.innerHTML = '';
      suggestEl.style.display = 'none';
      if (!q || q.length < MIN_CHARS) return;
      const cand = records.map(r => ({ r, s: score(r, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, MAX_RESULTS);
      if (!cand.length) return;
      cand.forEach((cobj, i) => {
        const r = cobj.r;
        const div = document.createElement('div');
        div.className = 'item';
        div.dataset.idx = i;
        div.innerHTML = '<div class="common">' + (r.common ? highlight(r.common, q) : escapeHtml(r.key)) + (r.scientific ? ' <small style="color:#666">(' + escapeHtml(r.scientific) + ')</small>' : '') + '</div>';
        // mousedown to capture selection before blur
        div.addEventListener('mousedown', (ev) => { ev.preventDefault(); pick(records, i); });
        suggestEl.appendChild(div);
      });
      suggestEl.style.display = 'block';
    }

    function applySelection(rec) {
      if (!rec) return;
      inputEl.value = rec.common || rec.key || '';
      try { inputEl.dataset.speciesKey = rec.key || ''; } catch (e) {}
      closeList();
      inputEl.focus();
      try { inputEl.dispatchEvent(new CustomEvent('species-chosen', { detail: { key: rec.key, common: rec.common, scientific: rec.scientific }, bubbles: true })); } catch (e) {}
    }

    function pick(records, idx) {
      const q = lastQuery || inputEl.value || '';
      const cand = records.map(r => ({ r, s: score(r, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, MAX_RESULTS);
      const chosen = (cand[idx] && cand[idx].r) || null;
      if (!chosen) return;
      applySelection(chosen);
    }

    function acceptTop(records) {
      const q = inputEl.value.trim();
      if (!q) return;
      const best = records.map(r => ({ r, s: score(r, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s)[0];
      if (!best) return;
      applySelection(best.r);
    }

    inputEl.addEventListener('input', function () {
      const q = inputEl.value.trim();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const recs = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [];
        renderList(recs, q);
      }, DEBOUNCE_MS);
    });

    inputEl.addEventListener('keydown', function (e) {
      const items = suggestEl.querySelectorAll('.item');
      if (suggestEl.style.display === 'block' && items.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); updateActive(items); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); updateActive(items); return; }
        if (e.key === 'Enter') {
          if (activeIdx >= 0 && activeIdx < items.length) { e.preventDefault(); pick(Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [], activeIdx); return; }
          e.preventDefault(); acceptTop(Array.isArray(window.__speciesRecords) ? window.__speciesRecords : []); return;
        }
        if (e.key === 'Escape') { closeList(); return; }
      } else {
        if (e.key === 'Enter') { e.preventDefault(); acceptTop(Array.isArray(window.__speciesRecords) ? window.__speciesRecords : []); return; }
      }
    });

    function updateActive(items) {
      items.forEach((it, i) => {
        it.classList.toggle('active', i === activeIdx);
        if (i === activeIdx) it.scrollIntoView({ block: 'nearest' });
      });
    }

    // outside click closes the list; suggestions clicks handled by mousedown above
    document.addEventListener('click', function (ev) {
      try {
        const path = (ev.composedPath && ev.composedPath()) || ev.path || [];
        const inside = path.some(node => {
          try { return node && node.classList && node.classList.contains && node.classList.contains('species-autocomplete'); } catch (e) { return false; }
        });
        if (!inside) closeList();
      } catch (err) {
        try {
          if (!inputEl.closest('.species-autocomplete') && !document.querySelector('.species-autocomplete').contains(ev.target)) closeList();
        } catch (e) {}
      }
    }, false);

    // defensive: z-index
    suggestEl.style.zIndex = suggestEl.style.zIndex || '999999';
  }

  // Wait short period for species-data; if not present install with empty dataset
  function wireSpeciesAutocompleteWithWait(inputEl, suggestEl) {
    if (!inputEl || !suggestEl) return;
    const MAX_TRIES = 60;
    let tries = 0;
    (function waitForRecords() {
      const recs = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : null;
      if (recs !== null) {
        // make sure global exists (may be already set)
        window.__speciesRecords = Array.isArray(recs) ? recs : [];
        wireSpeciesAutocompleteWithRecords(inputEl, suggestEl);
        return;
      }
      tries++;
      if (tries >= MAX_TRIES) {
        window.__speciesRecords = window.__speciesRecords || [];
        wireSpeciesAutocompleteWithRecords(inputEl, suggestEl);
        return;
      }
      setTimeout(waitForRecords, 80);
    })();
  }

  function wireSpeciesAutocompleteWithRecords(inputEl, suggestEl) {
    if (inputEl.__speciesWired) return;
    inputEl.__speciesWired = true;
    wireSpeciesAutocompleteWithWait_INTERNAL(inputEl, suggestEl);
  }

  function wireSpeciesAutocompleteWithWait_INTERNAL(inputEl, suggestEl) {
    const MIN_CHARS = 2;
    const DEBOUNCE_MS = 120;
    const MAX_RESULTS = 10;

    function norm(s) { return (s || '').toString().normalize().toLowerCase(); }
    function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || '&amp;'); }
    function score(rec, q) {
      const nq = norm(q);
      const k = norm(rec.key || '');
      const c = norm(rec.common || '');
      let s = 0;
      if (k.startsWith(nq)) s += 120;
      else if (k.includes(nq)) s += 80;
      if (c.startsWith(nq)) s += 60;
      else if (c.includes(nq)) s += 30;
      s += Math.max(0, 10 - Math.min(9, (k.length || 0) / 10));
      return s;
    }
    function highlight(orig, q) {
      if (!q) return escapeHtml(orig || '');
      const o = orig || '';
      const lower = norm(o);
      const nq = norm(q);
      const idx = lower.indexOf(nq);
      if (idx < 0) return escapeHtml(o);
      const before = o.slice(0, idx), match = o.slice(idx, idx + q.length), after = o.slice(idx + q.length);
      return escapeHtml(before) + '<span class="species-mark">' + escapeHtml(match) + '</span>' + escapeHtml(after);
    }

    let debounceTimer = null;
    let lastQuery = '';
    let activeIdx = -1;

    function closeList() {
      suggestEl.innerHTML = '';
      suggestEl.style.display = 'none';
      activeIdx = -1;
    }

    function renderList(q) {
      lastQuery = q;
      activeIdx = -1;
      suggestEl.innerHTML = '';
      suggestEl.style.display = 'none';
      if (!q || q.length < MIN_CHARS) return;
      const records = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [];
      const cand = records.map(r => ({ r, s: score(r, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, MAX_RESULTS);
      if (!cand.length) return;
      cand.forEach((cobj, i) => {
        const r = cobj.r;
        const div = document.createElement('div');
        div.className = 'item';
        div.dataset.idx = i;
        div.innerHTML = '<div class="common">' + (r.common ? highlight(r.common, q) : escapeHtml(r.key)) + (r.scientific ? ' <small style="color:#666">(' + escapeHtml(r.scientific) + ')</small>' : '') + '</div>';
        div.addEventListener('mousedown', (ev) => { ev.preventDefault(); pick(i); });
        suggestEl.appendChild(div);
      });
      suggestEl.style.display = 'block';
    }

    function applySelection(rec) {
      if (!rec) return;
      inputEl.value = rec.common || rec.key || '';
      try { inputEl.dataset.speciesKey = rec.key || ''; } catch (e) {}
      closeList();
      inputEl.focus();
      try { inputEl.dispatchEvent(new CustomEvent('species-chosen', { detail: { key: rec.key, common: rec.common, scientific: rec.scientific }, bubbles: true })); } catch (e) {}
    }

    function pick(idx) {
      const q = lastQuery || inputEl.value || '';
      const records = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [];
      const cand = records.map(r => ({ r, s: score(r, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, MAX_RESULTS);
      const chosen = (cand[idx] && cand[idx].r) || null;
      if (!chosen) return;
      applySelection(chosen);
    }

    function acceptTop() {
      const q = inputEl.value.trim();
      if (!q) return;
      const records = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [];
      const best = records.map(r => ({ r, s: score(r, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s)[0];
      if (!best) return;
      applySelection(best.r);
    }

    inputEl.addEventListener('input', function () {
      const q = inputEl.value.trim();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => renderList(q), DEBOUNCE_MS);
    });

    inputEl.addEventListener('keydown', function (e) {
      const items = suggestEl.querySelectorAll('.item');
      if (suggestEl.style.display === 'block' && items.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); updateActive(items); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); updateActive(items); return; }
        if (e.key === 'Enter') {
          if (activeIdx >= 0 && activeIdx < items.length) { e.preventDefault(); pick(activeIdx); return; }
          e.preventDefault(); acceptTop(); return;
        }
        if (e.key === 'Escape') { closeList(); return; }
      } else {
        if (e.key === 'Enter') { e.preventDefault(); acceptTop(); return; }
      }
    });

    function updateActive(items) {
      items.forEach((it, i) => {
        it.classList.toggle('active', i === activeIdx);
        if (i === activeIdx) it.scrollIntoView({ block: 'nearest' });
      });
    }

    document.addEventListener('click', function (ev) {
      try {
        const path = (ev.composedPath && ev.composedPath()) || ev.path || [];
        const inside = path.some(node => {
          try { return node && node.classList && node.classList.contains && node.classList.contains('species-autocomplete'); } catch (e) { return false; }
        });
        if (!inside) closeList();
      } catch (err) {
        try {
          if (!inputEl.closest('.species-autocomplete') && !document.querySelector('.species-autocomplete').contains(ev.target)) closeList();
        } catch (e) {}
      }
    }, false);

    suggestEl.style.zIndex = suggestEl.style.zIndex || '999999';
  }

  // Core modal open implementation (public)
  function openMetadataModal(initial) {
    const existing = document.getElementById('metaOverlay');
    if (existing) {
      if (initial && typeof initial === 'object' && Object.keys(initial).length) applyInitialToOpen(existing, initial);
      else applyInitialToOpen(existing, window.__lastMetadata || {});
      return {
        close: () => { const ov = document.getElementById('metaOverlay'); if (ov) ov.remove(); },
        set: (obj) => { const ex = document.getElementById('metaOverlay'); if (ex) applyInitialToOpen(ex, obj); },
        getValues: () => ({
          latitude: document.getElementById('meta-lat') ? document.getElementById('meta-lat').value : null,
          longitude: document.getElementById('meta-lon') ? document.getElementById('meta-lon').value : null,
          datetime: document.getElementById('meta-datetime') ? document.getElementById('meta-datetime').value : null,
          rating: document.getElementById('meta-rating') ? (document.getElementById('meta-rating').value ? Number(document.getElementById('meta-rating').value) : null) : null,
          type: document.getElementById('meta-type') ? document.getElementById('meta-type').value : null,
          species: document.getElementById('meta-species') ? document.getElementById('meta-species').value : null,
          recorder: document.getElementById('meta-recorder') ? document.getElementById('meta-recorder').value : null,
          microphone: document.getElementById('meta-mic') ? document.getElementById('meta-mic').value : null,
          accessories: document.getElementById('meta-accessories') ? document.getElementById('meta-accessories').value : null,
          contributors: (function () {
            const wrap = document.getElementById('meta-contrib-wrap'); if (!wrap) return [];
            const chips = Array.from(wrap.querySelectorAll('.meta-chip')).map(ch => ch.childNodes[0].textContent.trim());
            const input = wrap.querySelector('#meta-contrib-input');
            return chips.concat(input && input.value ? [input.value.trim()] : []).filter(Boolean);
          })(),
          comments: document.getElementById('meta-comments') ? document.getElementById('meta-comments').value : null
        })
      };
    }

    const meta = buildModalDom();
    document.body.appendChild(meta.overlay);

    const overlayScope = meta.overlay;
    const nodes = {
      filenameLabel: overlayScope.querySelector('#metaFilename'),
      lat: overlayScope.querySelector('#meta-lat'),
      lon: overlayScope.querySelector('#meta-lon'),
      datetime: overlayScope.querySelector('#meta-datetime'),
      rating: overlayScope.querySelector('#meta-rating'),
      type: overlayScope.querySelector('#meta-type'),
      species: overlayScope.querySelector('#meta-species'),
      speciesSuggest: overlayScope.querySelector('#meta-species-suggest'),
      recorder: overlayScope.querySelector('#meta-recorder'),
      mic: overlayScope.querySelector('#meta-mic'),
      accessories: overlayScope.querySelector('#meta-accessories'),
      contributorsWrap: overlayScope.querySelector('#meta-contrib-wrap'),
      comments: overlayScope.querySelector('#meta-comments'),
      ok: overlayScope.querySelector('#meta-ok'),
      cancel: overlayScope.querySelector('#meta-cancel')
    };

    // filename label
    const fileInput = document.getElementById('file');
    if (fileInput && fileInput.files && fileInput.files.length > 0) {
      nodes.filenameLabel.textContent = 'File: ' + (fileInput.files[0].name || '(selected file)');
    } else {
      nodes.filenameLabel.textContent = 'File: (no file)';
    }

    // contributors init
    try { initContribWrap(nodes.contributorsWrap); } catch (e) {}

    // apply initial values
    applyInitial(initial && Object.keys(initial).length ? initial : window.__lastMetadata || null);

    // wire species autocomplete (waits for species-data)
    try { wireSpeciesAutocompleteWithWait(nodes.species, nodes.speciesSuggest); } catch (e) {}

    // OK handler (reads rating dropdown and persists)
    nodes.ok.addEventListener('click', () => {
      const ratingVal = (nodes.rating && nodes.rating.value) ? Number(nodes.rating.value) : null;
      const out = {
        latitude: nodes.lat.value ? nodes.lat.value.trim() : null,
        longitude: nodes.lon.value ? nodes.lon.value.trim() : null,
        datetime: nodes.datetime.value ? new Date(nodes.datetime.value).toISOString() : null,
        rating: (ratingVal === null || isNaN(ratingVal)) ? null : ratingVal,
        type: nodes.type.value || null,
        species: nodes.species.value ? nodes.species.value.trim() : null,
        recorder: nodes.recorder.value ? nodes.recorder.value.trim() : null,
        microphone: nodes.mic.value ? nodes.mic.value.trim() : null,
        accessories: nodes.accessories.value ? nodes.accessories.value.trim() : null,
        contributors: (nodes.contributorsWrap && nodes.contributorsWrap.__contribAPI) ? nodes.contributorsWrap.__contribAPI.get().map(s => String(s).trim()).filter(Boolean) : [],
        comments: nodes.comments.value ? nodes.comments.value.trim() : null,
        savedAt: new Date().toISOString()
      };
      window.__lastMetadata = out;
      document.dispatchEvent(new CustomEvent('metadata-saved', { detail: out }));
      closeModal();
    });

    nodes.cancel.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('metadata-cancelled', {}));
      closeModal();
    });

    function onKey(e) {
      if (e.key === 'Escape') {
        document.dispatchEvent(new CustomEvent('metadata-cancelled', {}));
        closeModal();
      }
    }
    document.addEventListener('keydown', onKey);

    // focus order: lat -> lon -> datetime -> species
    setTimeout(() => {
      const first = overlayScope.querySelector('#meta-lat') || overlayScope.querySelector('#meta-lon') || overlayScope.querySelector('#meta-datetime') || overlayScope.querySelector('#meta-species');
      try { if (first) first.focus(); } catch (e) {}
    }, 40);

    return {
      close: () => { const ov = document.getElementById('metaOverlay'); if (ov) ov.remove(); },
      set: (obj) => applyInitial(obj),
      getValues: () => ({
        latitude: document.getElementById('meta-lat') ? document.getElementById('meta-lat').value : null,
        longitude: document.getElementById('meta-lon') ? document.getElementById('meta-lon').value : null,
        datetime: document.getElementById('meta-datetime') ? document.getElementById('meta-datetime').value : null,
        rating: document.getElementById('meta-rating') ? (document.getElementById('meta-rating').value ? Number(document.getElementById('meta-rating').value) : null) : null,
        type: document.getElementById('meta-type') ? document.getElementById('meta-type').value : null,
        species: document.getElementById('meta-species') ? document.getElementById('meta-species').value : null,
        recorder: document.getElementById('meta-recorder') ? document.getElementById('meta-recorder').value : null,
        microphone: document.getElementById('meta-mic') ? document.getElementById('meta-mic').value : null,
        accessories: document.getElementById('meta-accessories') ? document.getElementById('meta-accessories').value : null,
        contributors: (function () {
          const wrap = document.getElementById('meta-contrib-wrap'); if (!wrap) return [];
          const chips = Array.from(wrap.querySelectorAll('.meta-chip')).map(ch => ch.childNodes[0].textContent.trim());
          const input = wrap.querySelector('#meta-contrib-input');
          return chips.concat(input && input.value ? [input.value.trim()] : []).filter(Boolean);
        })(),
        comments: document.getElementById('meta-comments') ? document.getElementById('meta-comments').value : null
      })
    };
  }

  // applyInitial helpers
  function applyInitial(init) {
    const source = Object.assign({}, window.__lastMetadata || {}, init || {});
    nodesSafeSet('meta-lat', (source.latitude !== undefined && source.latitude !== null) ? source.latitude : '');
    nodesSafeSet('meta-lon', (source.longitude !== undefined && source.longitude !== null) ? source.longitude : '');
    if (source.datetime) {
      try {
        const d = new Date(source.datetime);
        if (!isNaN(d)) {
          const pad = (n) => n.toString().padStart(2, '0');
          const yyyy = d.getFullYear();
          const mm = pad(d.getMonth() + 1);
          const dd = pad(d.getDate());
          const hh = pad(d.getHours());
          const mi = pad(d.getMinutes());
          nodesSafeSet('meta-datetime', `${yyyy}-${mm}-${dd}T${hh}:${mi}`);
        } else nodesSafeSet('meta-datetime', '');
      } catch (e) { nodesSafeSet('meta-datetime', ''); }
    } else nodesSafeSet('meta-datetime', '');
    nodesSafeSet('meta-type', source.type || '');
    nodesSafeSet('meta-species', source.species || '');
    nodesSafeSet('meta-recorder', source.recorder || '');
    nodesSafeSet('meta-mic', source.microphone || '');
    nodesSafeSet('meta-accessories', source.accessories || '');
    if (Array.isArray(source.contributors)) {
      const wrap = document.getElementById('meta-contrib-wrap');
      try { wrap && wrap.__contribAPI && wrap.__contribAPI.set(source.contributors); } catch (e) {}
    }
    nodesSafeSet('meta-comments', source.comments || '');

    // set rating dropdown if present
    try {
      const rnode = document.getElementById('meta-rating');
      const val = (source.rating === undefined || source.rating === null) ? '' : String(source.rating);
      if (rnode) rnode.value = (val === 'null' || val === 'undefined') ? '' : val;
    } catch (e) {}
  }

  function applyInitialToOpen(existingOverlay, init) {
    const n = {
      lat: existingOverlay.querySelector('#meta-lat'),
      lon: existingOverlay.querySelector('#meta-lon'),
      datetime: existingOverlay.querySelector('#meta-datetime'),
      rating: existingOverlay.querySelector('#meta-rating'),
      type: existingOverlay.querySelector('#meta-type'),
      species: existingOverlay.querySelector('#meta-species'),
      recorder: existingOverlay.querySelector('#meta-recorder'),
      mic: existingOverlay.querySelector('#meta-mic'),
      accessories: existingOverlay.querySelector('#meta-accessories'),
      contributorsWrap: existingOverlay.querySelector('#meta-contrib-wrap'),
      comments: existingOverlay.querySelector('#meta-comments'),
      filenameLabel: existingOverlay.querySelector('#metaFilename')
    };
    if (!n.lat) return;
    const source = Object.assign({}, window.__lastMetadata || {}, init && Object.keys(init).length ? init : {});
    try { if (source.latitude !== undefined && source.latitude !== null) n.lat.value = source.latitude; else n.lat.value = ''; } catch (e) { n.lat && (n.lat.value = ''); }
    try { if (source.longitude !== undefined && source.longitude !== null) n.lon.value = source.longitude; else n.lon.value = ''; } catch (e) { n.lon && (n.lon.value = ''); }
    if (source.datetime) {
      try {
        const d = new Date(source.datetime);
        if (!isNaN(d)) {
          const pad = (x) => x.toString().padStart(2, '0');
          const yyyy = d.getFullYear();
          const mm = pad(d.getMonth() + 1);
          const dd = pad(d.getDate());
          const hh = pad(d.getHours());
          const mi = pad(d.getMinutes());
          n.datetime.value = `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
        } else n.datetime.value = '';
      } catch (e) { n.datetime.value = ''; }
    } else n.datetime.value = '';
    n.type.value = source.type || '';
    n.species.value = source.species || '';
    n.recorder.value = source.recorder || '';
    n.mic.value = source.microphone || '';
    n.accessories.value = source.accessories || '';
    n.comments.value = source.comments || '';
    if (Array.isArray(source.contributors) && source.contributors.length && n.contributorsWrap) {
      const input = n.contributorsWrap.querySelector('#meta-contrib-input');
      if (input) {
        Array.from(n.contributorsWrap.querySelectorAll('.meta-chip')).forEach(c => n.contributorsWrap.removeChild(c));
        source.contributors.forEach(name => {
          const safeName = String(name).trim();
          if (!safeName) return;
          const chip = el('span', { cls: 'meta-chip' }, safeName, el('button', { type: 'button', title: 'Remove', 'aria-label': 'Remove contributor' }, '✕'));
          chip.querySelector('button').addEventListener('click', () => { chip.remove(); });
          n.contributorsWrap.insertBefore(chip, input);
        });
      }
    } else {
      if (n.contributorsWrap) Array.from(n.contributorsWrap.querySelectorAll('.meta-chip')).forEach(c => n.contributorsWrap.removeChild(c));
    }
    const fileInput2 = document.getElementById('file');
    if (fileInput2 && fileInput2.files && fileInput2.files.length > 0) {
      n.filenameLabel && (n.filenameLabel.textContent = 'File: ' + (fileInput2.files[0].name || '(selected file)'));
    } else {
      n.filenameLabel && (n.filenameLabel.textContent = 'File: (no file)');
    }

    // rating
    try {
      const rv = (source.rating === undefined || source.rating === null) ? '' : String(source.rating);
      if (n.rating) n.rating.value = (rv === 'null' || rv === 'undefined') ? '' : rv;
    } catch (e) {}
  }

  function closeModal() {
    const ov = document.getElementById('metaOverlay'); if (ov) ov.remove();
    const st = document.getElementById('metadata-modal-styles'); if (st) st.remove();
  }

  // Public API
  window.__openMetadataModal = function (initial) { return openMetadataModal(initial); };

  // openMetadataModal exported above; implement function below to keep hoisting simple
  function openMetadataModal(initial) { return openMetadataModal_internal(initial); }

  function openMetadataModal_internal(initial) {
    return openMetadataModal_internal_impl(initial);
  }

  function openMetadataModal_internal_impl(initial) {
    return openMetadataModal_internal_real(initial);
  }

  function openMetadataModal_internal_real(initial) {
    // main implementation (kept separate for readability)
    return openMetadataModal_core(initial);
  }

  function openMetadataModal_core(initial) {
    // delegate to openMetadataModal_core which implements the modal; previously defined above as openMetadataModal_internal
    return (function () {
      // call the core open function defined earlier
      return (function core(initialArg) {
        // reuse openMetadataModal_internal implementation body: call the previously defined openMetadataModal_internal (we already have it)
        // To avoid confusion, implement here directly:
        const existing = document.getElementById('metaOverlay');
        if (existing) {
          if (initialArg && typeof initialArg === 'object' && Object.keys(initialArg).length) applyInitialToOpen(existing, initialArg);
          else applyInitialToOpen(existing, window.__lastMetadata || {});
          return {
            close: () => { const ov = document.getElementById('metaOverlay'); if (ov) ov.remove(); },
            set: (obj) => { const ex = document.getElementById('metaOverlay'); if (ex) applyInitialToOpen(ex, obj); },
            getValues: () => ({
              latitude: document.getElementById('meta-lat') ? document.getElementById('meta-lat').value : null,
              longitude: document.getElementById('meta-lon') ? document.getElementById('meta-lon').value : null,
              datetime: document.getElementById('meta-datetime') ? document.getElementById('meta-datetime').value : null,
              rating: document.getElementById('meta-rating') ? (document.getElementById('meta-rating').value ? Number(document.getElementById('meta-rating').value) : null) : null,
              type: document.getElementById('meta-type') ? document.getElementById('meta-type').value : null,
              species: document.getElementById('meta-species') ? document.getElementById('meta-species').value : null,
              recorder: document.getElementById('meta-recorder') ? document.getElementById('meta-recorder').value : null,
              microphone: document.getElementById('meta-mic') ? document.getElementById('meta-mic').value : null,
              accessories: document.getElementById('meta-accessories') ? document.getElementById('meta-accessories').value : null,
              contributors: (function () {
                const wrap = document.getElementById('meta-contrib-wrap'); if (!wrap) return [];
                const chips = Array.from(wrap.querySelectorAll('.meta-chip')).map(ch => ch.childNodes[0].textContent.trim());
                const input = wrap.querySelector('#meta-contrib-input');
                return chips.concat(input && input.value ? [input.value.trim()] : []).filter(Boolean);
              })(),
              comments: document.getElementById('meta-comments') ? document.getElementById('meta-comments').value : null
            })
          };
        }

        const meta = buildModalDom();
        document.body.appendChild(meta.overlay);

        const overlayScope = meta.overlay;
        const nodes = {
          filenameLabel: overlayScope.querySelector('#metaFilename'),
          lat: overlayScope.querySelector('#meta-lat'),
          lon: overlayScope.querySelector('#meta-lon'),
          datetime: overlayScope.querySelector('#meta-datetime'),
          rating: overlayScope.querySelector('#meta-rating'),
          type: overlayScope.querySelector('#meta-type'),
          species: overlayScope.querySelector('#meta-species'),
          speciesSuggest: overlayScope.querySelector('#meta-species-suggest'),
          recorder: overlayScope.querySelector('#meta-recorder'),
          mic: overlayScope.querySelector('#meta-mic'),
          accessories: overlayScope.querySelector('#meta-accessories'),
          contributorsWrap: overlayScope.querySelector('#meta-contrib-wrap'),
          comments: overlayScope.querySelector('#meta-comments'),
          ok: overlayScope.querySelector('#meta-ok'),
          cancel: overlayScope.querySelector('#meta-cancel')
        };

        // filename
        const fileInput = document.getElementById('file');
        if (fileInput && fileInput.files && fileInput.files.length > 0) {
          nodes.filenameLabel.textContent = 'File: ' + (fileInput.files[0].name || '(selected file)');
        } else {
          nodes.filenameLabel.textContent = 'File: (no file)';
        }

        // contributors
        try { initContribWrap(nodes.contributorsWrap); } catch (e) {}

        // apply initial values
        applyInitial(initial && Object.keys(initial).length ? initial : window.__lastMetadata || null);

        // species autocomplete wiring (wait for species-data)
        try { wireSpeciesAutocompleteWithWait(nodes.species, nodes.speciesSuggest); } catch (e) {}

        // OK
        nodes.ok.addEventListener('click', () => {
          const ratingVal = (nodes.rating && nodes.rating.value) ? Number(nodes.rating.value) : null;
          const out = {
            latitude: nodes.lat.value ? nodes.lat.value.trim() : null,
            longitude: nodes.lon.value ? nodes.lon.value.trim() : null,
            datetime: nodes.datetime.value ? new Date(nodes.datetime.value).toISOString() : null,
            rating: (ratingVal === null || isNaN(ratingVal)) ? null : ratingVal,
            type: nodes.type.value || null,
            species: nodes.species.value ? nodes.species.value.trim() : null,
            recorder: nodes.recorder.value ? nodes.recorder.value.trim() : null,
            microphone: nodes.mic.value ? nodes.mic.value.trim() : null,
            accessories: nodes.accessories.value ? nodes.accessories.value.trim() : null,
            contributors: (nodes.contributorsWrap && nodes.contributorsWrap.__contribAPI) ? nodes.contributorsWrap.__contribAPI.get().map(s => String(s).trim()).filter(Boolean) : [],
            comments: nodes.comments.value ? nodes.comments.value.trim() : null,
            savedAt: new Date().toISOString()
          };
          window.__lastMetadata = out;
          document.dispatchEvent(new CustomEvent('metadata-saved', { detail: out }));
          closeModal();
        });

        nodes.cancel.addEventListener('click', () => {
          document.dispatchEvent(new CustomEvent('metadata-cancelled', {}));
          closeModal();
        });

        function onKey(e) {
          if (e.key === 'Escape') {
            document.dispatchEvent(new CustomEvent('metadata-cancelled', {}));
            closeModal();
          }
        }
        document.addEventListener('keydown', onKey);

        // focus lat first
        setTimeout(() => {
          const first = overlayScope.querySelector('#meta-lat') || overlayScope.querySelector('#meta-lon') || overlayScope.querySelector('#meta-datetime') || overlayScope.querySelector('#meta-species');
          try { if (first) first.focus(); } catch (e) {}
        }, 40);

        return {
          close: () => { const ov = document.getElementById('metaOverlay'); if (ov) ov.remove(); },
          set: (obj) => applyInitial(obj),
          getValues: () => ({
            latitude: document.getElementById('meta-lat') ? document.getElementById('meta-lat').value : null,
            longitude: document.getElementById('meta-lon') ? document.getElementById('meta-lon').value : null,
            datetime: document.getElementById('meta-datetime') ? document.getElementById('meta-datetime').value : null,
            rating: document.getElementById('meta-rating') ? (document.getElementById('meta-rating').value ? Number(document.getElementById('meta-rating').value) : null) : null,
            type: document.getElementById('meta-type') ? document.getElementById('meta-type').value : null,
            species: document.getElementById('meta-species') ? document.getElementById('meta-species').value : null,
            recorder: document.getElementById('meta-recorder') ? document.getElementById('meta-recorder').value : null,
            microphone: document.getElementById('meta-mic') ? document.getElementById('meta-mic').value : null,
            accessories: document.getElementById('meta-accessories') ? document.getElementById('meta-accessories').value : null,
            contributors: (function () {
              const wrap = document.getElementById('meta-contrib-wrap'); if (!wrap) return [];
              const chips = Array.from(wrap.querySelectorAll('.meta-chip')).map(ch => ch.childNodes[0].textContent.trim());
              const input = wrap.querySelector('#meta-contrib-input');
              return chips.concat(input && input.value ? [input.value.trim()] : []).filter(Boolean);
            })(),
            comments: document.getElementById('meta-comments') ? document.getElementById('meta-comments').value : null
          })
        };
      })(initial);
    })();
  }

})();