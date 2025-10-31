// species_bulkedit.js
// Bulk-edit behavior for the shared species label.
// - Adds checkbox handling for bulk selection (leftmost column is added by this module if missing)
// - When one or more rows are selected, clears and enables the shared species label/input for input.
// - On acceptance (Enter while the species input focused OR species-select event) prompts confirm.
//   If OK => writes new common name into selected annotations and reloads authoritative store.
//   If Cancel => clears the label and does nothing.
// - Respects edit mode: edit_annotations will leave species control enabled when bulk selection exists.

(function () {
  if (!window || !document) return;

  // Config
  const TABLE_CONTAINER_SELECTOR = '#annotationsContainer';
  const TBODY_SELECTOR = '#annotationsContainer tbody';
  const SPECIES_LABEL_SELECTOR = '#speciesResult';
  const SPECIES_INPUT_SELECTOR = '#speciesKwInput';
  const SPECIES_INPUT_BUTTON_CLEAR = '#speciesClearBtn';
  const CHECKBOX_CLASS = 'ann-bulk-check';
  const HEADER_CHECKBOX_ID = 'ann-bulk-check-all';

  // Bounded wait used when Enter pressed to allow upstream autocompletes to finalize selection
  const LABEL_WAIT_TIMEOUT_MS = 200; // maximum time to wait for label update
  const LABEL_WAIT_POLL_MS = 20;     // poll interval

  // State
  const selectedIds = new Set();
  let observing = false;

  // Helpers to access authoritative annotations
  function getAnnotations() {
    if (globalThis._annotations && typeof globalThis._annotations.getAll === 'function') {
      try { return globalThis._annotations.getAll() || []; } catch (e) { return []; }
    }
    return [];
  }
  function replaceAnnotations(arr) {
    if (globalThis._annotations && typeof globalThis._annotations.import === 'function') {
      try { globalThis._annotations.import(Array.isArray(arr) ? arr.slice() : []); } catch (e) { console.error('bulk: replaceAnnotations failed', e); }
    }
  }

  // DOM refs (look up fresh when needed)
  function findTableTbody() { return document.querySelector(TBODY_SELECTOR); }
  function findSpeciesLabelEl() { return document.querySelector(SPECIES_LABEL_SELECTOR); }
  function findSpeciesInputEl() { return document.querySelector(SPECIES_INPUT_SELECTOR); }
  function findSpeciesClearBtn() { return document.querySelector(SPECIES_INPUT_BUTTON_CLEAR); }

  // Ensure header checkbox and per-row checkboxes exist
  function ensureCheckboxesPresent() {
    const container = document.querySelector(TABLE_CONTAINER_SELECTOR);
    if (!container) return;
    const table = container.querySelector('table');
    if (!table) return;
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;

    // Insert header checkbox cell as leftmost if missing
    const headerRow = thead.querySelector('tr');
    if (headerRow && !headerRow.querySelector('#' + HEADER_CHECKBOX_ID)) {
      const th = document.createElement('th');
      th.style.padding = '6px 8px';
      th.style.textAlign = 'left';
      const master = document.createElement('input');
      master.type = 'checkbox';
      master.id = HEADER_CHECKBOX_ID;
      master.title = 'Select all annotations';
      master.addEventListener('change', () => {
        const checked = !!master.checked;
        const checkboxes = tbody.querySelectorAll('input.' + CHECKBOX_CLASS);
        checkboxes.forEach(cb => cb.checked = checked);
        selectedIds.clear();
        if (checked) {
          const rows = tbody.querySelectorAll('tr[data-aid]');
          rows.forEach(r => { const id = r.getAttribute('data-aid'); if (id) selectedIds.add(id); });
        }
        onSelectionChanged();
      });
      headerRow.insertBefore(th, headerRow.firstChild);
      th.appendChild(master);
    }

    // Add checkbox cell to each row if missing
    const rows = tbody.querySelectorAll('tr[data-aid]');
    rows.forEach(row => {
      if (!row.querySelector('td.ann-bulk-td')) {
        const td = document.createElement('td');
        td.className = 'ann-bulk-td';
        td.style.padding = '6px 8px';
        td.style.width = '28px';
        td.style.verticalAlign = 'middle';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = CHECKBOX_CLASS;
        const aid = row.getAttribute('data-aid') || '';
        cb.dataset.aid = aid;
        cb.addEventListener('change', () => {
          const checked = !!cb.checked;
          if (checked) selectedIds.add(aid);
          else selectedIds.delete(aid);
          syncMasterCheckbox();
          onSelectionChanged();
        });
        td.appendChild(cb);
        row.insertBefore(td, row.firstChild);
      } else {
        const cb = row.querySelector('input.' + CHECKBOX_CLASS);
        const aid = row.getAttribute('data-aid') || '';
        if (cb && !cb.dataset.aid) cb.dataset.aid = aid;
        if (!cb) {
          const td = row.querySelector('td.ann-bulk-td');
          td.innerHTML = '';
          const cb2 = document.createElement('input');
          cb2.type = 'checkbox';
          cb2.className = CHECKBOX_CLASS;
          cb2.dataset.aid = aid;
          cb2.addEventListener('change', () => {
            if (cb2.checked) selectedIds.add(aid); else selectedIds.delete(aid);
            syncMasterCheckbox();
            onSelectionChanged();
          });
          td.appendChild(cb2);
        }
      }
    });
  }

  // Sync master header checkbox state
  function syncMasterCheckbox() {
    const master = document.getElementById(HEADER_CHECKBOX_ID);
    const tbody = findTableTbody();
    if (!master || !tbody) return;
    const total = tbody.querySelectorAll('tr[data-aid]').length;
    const checked = selectedIds.size;
    if (checked === 0) { master.checked = false; master.indeterminate = false; }
    else if (checked === total) { master.checked = true; master.indeterminate = false; }
    else { master.checked = false; master.indeterminate = true; }
  }

  // Called when selection changes
  function onSelectionChanged() {
    ensureCheckboxesPresent();

    if (selectedIds.size === 0) {
      // No bulk selection: restore species control to normal (do not override edit mode behavior)
      const spInput = findSpeciesInputEl();
      const spLabel = findSpeciesLabelEl();
      const spClear = findSpeciesClearBtn();
      if (spInput && typeof spInput.disabled !== 'undefined') {
        // leave disabled state as set by edit_annotations; if not in edit mode it should be enabled already
      }
      // nothing else to do
      return;
    }

    // Bulk mode active: if species control is disabled because Edit mode set it, override and enable it for bulk
    const spInput = findSpeciesInputEl();
    const spLabel = findSpeciesLabelEl();
    const spClear = findSpeciesClearBtn();

    if (spInput) {
      spInput.disabled = false;
      spInput.removeAttribute('aria-disabled');
      spInput.value = '';
      try { spInput.focus(); } catch (e) {}
    }
    if (spLabel) {
      spLabel.removeAttribute('aria-disabled');
      spLabel.textContent = '';
      spLabel.style.opacity = '';
    }
    if (spClear) spClear.style.display = 'none';
  }

  // Determine if species control is currently disabled by edit mode
  function isSpeciesControlDisabled() {
    const spInput = findSpeciesInputEl();
    const spLabel = findSpeciesLabelEl();
    if (spInput) {
      if (spInput.disabled) return true;
      if (spInput.getAttribute('aria-disabled') === 'true') return true;
    }
    if (spLabel) {
      if (spLabel.getAttribute('aria-disabled') === 'true') return true;
    }
    if (globalThis._editAnnotations && typeof globalThis._editAnnotations.isEditMode === 'function') {
      try { if (globalThis._editAnnotations.isEditMode()) return true; } catch (e) {}
    }
    return false;
  }

  // Helper: wait up to timeoutMs for species label to become non-empty or to change from initial.
  // Resolves with the authoritative label text (trimmed) or empty string if not available in time.
  function waitForLabelUpdate(initialLabel, timeoutMs, intervalMs) {
    const labelEl = findSpeciesLabelEl();
    return new Promise((resolve) => {
      if (!labelEl) return resolve('');
      const start = Date.now();
      // If initialLabel is already non-empty, resolve immediately with trimmed value
      const cur = String(labelEl.textContent || '').trim();
      if (cur && cur !== '') return resolve(cur);
      // Poll for change/non-empty
      const id = setInterval(() => {
        const now = Date.now();
        const val = String(labelEl.textContent || '').trim();
        if (val && val !== '') {
          clearInterval(id);
          return resolve(val);
        }
        if (val !== initialLabel && val !== '') {
          clearInterval(id);
          return resolve(val);
        }
        if (now - start >= timeoutMs) {
          clearInterval(id);
          return resolve('');
        }
      }, intervalMs);
    });
  }

  // Handle accepted species for bulk application
  function handleSpeciesAccepted(commonName) {
    if (selectedIds.size === 0) return;

    // Normalize and escape the incoming commonName for display and application
    const name = commonName && String(commonName).trim() ? String(commonName).trim() : '';
    const safeNameForMessage = name.replace(/'/g, "\\'");

    // Build confirmation message including the actual name when available
    const msg = safeNameForMessage
      ? `Species will be replaced '${safeNameForMessage}' for the selected rows. OK to proceed?`
      : 'Common name will be replaced for the selected rows. OK to proceed?';

    const ok = window.confirm(msg);
    if (!ok) {
      // Clear label and input, do nothing
      const spLabel = findSpeciesLabelEl();
      if (spLabel) spLabel.textContent = '';
      const spInput = findSpeciesInputEl();
      if (spInput) spInput.value = '';
      return;
    }

    // Apply changes
    try {
      const anns = getAnnotations();
      if (!anns || !anns.length) return;
      const idSet = new Set(selectedIds);
      const updated = anns.map(a => {
        if (idSet.has(a.id)) {
          const copy = Object.assign({}, a);
          copy.species = name || '';
          return copy;
        }
        return a;
      });
      replaceAnnotations(updated);
    } catch (e) {
      console.error('bulk apply failed', e);
    } finally {
      // clear selection
      selectedIds.clear();
      const master = document.getElementById(HEADER_CHECKBOX_ID);
      if (master) { master.checked = false; master.indeterminate = false; }
    }
  }

  // species-select event handler
  function onSpeciesSelectEvent(ev) {
    try {
      if (!ev || !ev.detail) return;
      const common = String(ev.detail.common || '').trim();
      if (selectedIds.size > 0) {
        handleSpeciesAccepted(common);
      }
    } catch (e) { console.error('bulk: species-select handler error', e); }
  }
  window.addEventListener('species-select', onSpeciesSelectEvent, { passive: true });

  // species clear event handler when bulk active
  function onSpeciesCleared(ev) {
    if (selectedIds.size === 0) return;
    const spInput = findSpeciesInputEl();
    if (spInput) spInput.value = '';
    const spLabel = findSpeciesLabelEl();
    if (spLabel) spLabel.textContent = '';
  }
  window.addEventListener('species-select-cleared', onSpeciesCleared, { passive: true });

  // Enter on species input triggers bulk accept when rows selected
  // Robust handler: prefer visible label, wait briefly for upstream autocomplete to finalize keyboard selection.
  function onSpeciesInputKeydown(e) {
    if (!e) return;
    if (selectedIds.size === 0) return;
    const spInput = findSpeciesInputEl();
    const spLabel = findSpeciesLabelEl();
    if (!spInput || spInput.disabled) return;
    if (e.key === 'Enter') {
      try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
      const initialLabel = String(spLabel && spLabel.textContent ? spLabel.textContent : '').trim();
      const typedValue = String(spInput.value || '').trim();

      // Wait up to LABEL_WAIT_TIMEOUT_MS for an authoritative label; poll at LABEL_WAIT_POLL_MS
      waitForLabelUpdate(initialLabel, LABEL_WAIT_TIMEOUT_MS, LABEL_WAIT_POLL_MS)
        .then((labelText) => {
          let common = '';
          // Prefer authoritative visible label when available
          if (labelText && String(labelText).trim()) {
            common = String(labelText).trim();
          } else if (typedValue) {
            // fallback to typed text
            common = typedValue;
          } else if (spLabel && spLabel.textContent && String(spLabel.textContent).trim()) {
            // final fallback check
            common = String(spLabel.textContent).trim();
          } else {
            common = '';
          }
          handleSpeciesAccepted(common);
        })
        .catch((err) => {
          // if anything unexpected happens, fallback and proceed
          try {
            const fallback = typedValue || (spLabel && spLabel.textContent ? String(spLabel.textContent).trim() : '');
            handleSpeciesAccepted(fallback);
          } catch (e) {}
        });
    }
  }

  // Table mutation handling: keep checkboxes present and sync selection
  function onTableMutated() {
    ensureCheckboxesPresent();
    const currentIds = new Set();
    const cbNodes = Array.from(document.querySelectorAll('input.' + CHECKBOX_CLASS));
    cbNodes.forEach(cb => {
      const id = cb.dataset && cb.dataset.aid ? cb.dataset.aid : (cb.getAttribute && cb.getAttribute('data-aid'));
      if (!id) return;
      if (cb.checked) currentIds.add(id);
    });
    selectedIds.clear();
    currentIds.forEach(i => selectedIds.add(i));
    syncMasterCheckbox();
    onSelectionChanged();
  }

  let tableObserver = null;
  function startObservingTable() {
    if (observing) return;
    const tbodyEl = findTableTbody();
    if (!tbodyEl) return;
    tableObserver = new MutationObserver(() => { setTimeout(onTableMutated, 0); });
    tableObserver.observe(tbodyEl, { childList: true, subtree: false });
    observing = true;
    setTimeout(onTableMutated, 0);
  }

  function init() {
    function attachSpeciesKeyHandler() {
      const inp = findSpeciesInputEl();
      if (inp) {
        inp.removeEventListener('keydown', onSpeciesInputKeydown);
        inp.addEventListener('keydown', onSpeciesInputKeydown);
        return true;
      }
      return false;
    }

    if (!attachSpeciesKeyHandler()) {
      let tries = 0;
      const t = setInterval(() => {
        tries++;
        if (attachSpeciesKeyHandler() || tries >= 40) clearInterval(t);
      }, 80);
    }

    startObservingTable();

    if (globalThis._annotations && typeof globalThis._annotations.onChange === 'function') {
      try { globalThis._annotations.onChange(() => setTimeout(onTableMutated, 0)); } catch (e) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

  // expose small API
  globalThis._speciesBulkEdit = globalThis._speciesBulkEdit || {};
  globalThis._speciesBulkEdit.getSelectedIds = () => Array.from(selectedIds);
  globalThis._speciesBulkEdit.clearSelection = () => {
    selectedIds.clear();
    document.querySelectorAll('input.' + CHECKBOX_CLASS).forEach(cb => cb.checked = false);
    const master = document.getElementById(HEADER_CHECKBOX_ID);
    if (master) { master.checked = false; master.indeterminate = false; }
    syncMasterCheckbox();
    onSelectionChanged();
  };
})();