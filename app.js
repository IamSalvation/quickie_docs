/* =========================================================
   Quickie Docs — v1.4.1
   iOS selection fixes + expanded toolbar
   ========================================================= */

// ---------- IndexedDB ----------
const DB_NAME = 'quickie-docs';
const DB_VERSION = 1;
const STORE = 'docs';
let db;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = e => { db = e.target.result; resolve(db); };
        req.onerror = e => reject(e.target.error);
    });
}
function dbGetAll() {
    return new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).getAll();
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
}
function dbGet(id) {
    return new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get(id);
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
}
function dbPut(doc) {
    return new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        const r = tx.objectStore(STORE).put(doc);
        r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    });
}
function dbDelete(id) {
    return new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        const r = tx.objectStore(STORE).delete(id);
        r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    });
}

// ---------- DOM ----------
const listView = document.getElementById('list-view');
const editorView = document.getElementById('editor-view');
const docList = document.getElementById('doc-list');
const emptyMsg = document.getElementById('empty-msg');
const noResultsMsg = document.getElementById('no-results-msg');
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
const newDocBtn = document.getElementById('new-doc-btn');
const importBtn = document.getElementById('import-btn');
const installBtn = document.getElementById('install-btn');
const backBtn = document.getElementById('back-btn');
const titleInput = document.getElementById('doc-title');
const editorEl = document.getElementById('editor');
const saveAsBtn = document.getElementById('save-as-btn');
const saveStatus = document.getElementById('save-status');
const ribbon = document.getElementById('ribbon');
const compactTB = document.getElementById('compact-toolbar');
const toastEl = document.getElementById('toast');
const tableMenu = document.getElementById('table-menu');
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
const themeLabel = document.getElementById('theme-label');
const mobileBar = document.getElementById('mobile-bar');
const mobileSheet = document.getElementById('mobile-sheet');
const mobileSheetClose = document.getElementById('mobile-sheet-close');

// Save As modal
const saveAsModal = document.getElementById('save-as-modal');
const saveAsName = document.getElementById('save-as-name');
const saveAsType = document.getElementById('save-as-type');
const saveAsHint = document.getElementById('save-as-hint');
const saveAsClose = document.getElementById('save-as-close');
const saveAsCancel = document.getElementById('save-as-cancel');
const saveAsConfirm = document.getElementById('save-as-confirm');

// Prompt modal
const promptModal = document.getElementById('prompt-modal');
const promptTitle = document.getElementById('prompt-title');
const promptMessage = document.getElementById('prompt-message');
const promptInput = document.getElementById('prompt-input');
const promptHint = document.getElementById('prompt-hint');
const promptClose = document.getElementById('prompt-close');
const promptCancel = document.getElementById('prompt-cancel');
const promptConfirm = document.getElementById('prompt-confirm');

// Table modal
const tableModal = document.getElementById('table-modal');
const tableRowsInput = document.getElementById('table-rows');
const tableColsInput = document.getElementById('table-cols');
const tableModalClose = document.getElementById('table-modal-close');
const tableModalCancel = document.getElementById('table-modal-cancel');
const tableModalConfirm = document.getElementById('table-modal-confirm');

// Link modal
const linkModal = document.getElementById('link-modal');
const linkUrlInput = document.getElementById('link-url');
const linkTextInput = document.getElementById('link-text');
const linkModalClose = document.getElementById('link-modal-close');
const linkModalCancel = document.getElementById('link-modal-cancel');
const linkModalConfirm = document.getElementById('link-modal-confirm');

// ---------- State ----------
let currentDoc = null;
let saveTimer = null;
let compactMode = false;
let previewMode = false;
let toastTimer = null;
let currentSearch = '';
let tableMenuTargetCell = null;
let savedRange = null;              // ← selection memory for iOS
let currentFindIndex = 0;
let findMatches = [];
const fileHandles = {};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function flashStatus(text) {
    saveStatus.textContent = text;
    setTimeout(() => { if (saveStatus.textContent === text) saveStatus.textContent = ''; }, 1500);
}

function isMobile() {
    return window.matchMedia('(max-width: 768px)').matches;
}

/* =========================================================
   SELECTION MEMORY — critical for iOS Safari
   Save selection:
     1. On every selectionchange, ONLY if non-collapsed
     2. On touchend (fires BEFORE iOS collapses it)
     3. On mouseup (desktop)
     4. On blur of the editor
   ========================================================= */
function saveSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!editorEl.contains(range.commonAncestorContainer)) return;
    if (range.collapsed) return;        // ← critical: never overwrite with cursor-only
    savedRange = range.cloneRange();
}

function restoreSelection() {
    if (!savedRange) return false;
    try {
        editorEl.focus({ preventScroll: true });
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
        return true;
    } catch (_) {
        return false;
    }
}

document.addEventListener('selectionchange', () => {
    if (!editorView.classList.contains('hidden')) saveSelection();
});

// iOS Safari: capture the selection on touchend BEFORE it collapses
editorEl.addEventListener('touchend', () => {
    setTimeout(saveSelection, 0);
}, { passive: true });

// Save on any touch interaction with the editor
['touchstart', 'touchmove', 'touchend'].forEach(ev => {
    editorEl.addEventListener(ev, () => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (!range.collapsed && editorEl.contains(range.commonAncestorContainer)) {
                savedRange = range.cloneRange();
            }
        }
    }, { passive: true, capture: true });
});

// Desktop
editorEl.addEventListener('mouseup', () => {
    setTimeout(saveSelection, 0);
});
editorEl.addEventListener('blur', saveSelection);

/* =========================================================
   THEME
   ========================================================= */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeIcon) themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (themeLabel) themeLabel.textContent = theme === 'dark' ? 'Light' : 'Dark';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#1a2027' : '#2b7fff');
}
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('quickie-theme', next);
    applyTheme(next);
}
themeToggle?.addEventListener('click', toggleTheme);

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('quickie-theme')) applyTheme(e.matches ? 'dark' : 'light');
});

(function initTheme() {
    const saved = localStorage.getItem('quickie-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));
})();

/* =========================================================
   TOAST
   ========================================================= */
function showToast(message, duration = 5000) {
    clearTimeout(toastTimer);
    toastEl.innerHTML = `<span>${message}</span><button class="toast-close" title="Dismiss">✕</button>`;
    toastEl.classList.remove('hidden');
    toastEl.querySelector('.toast-close').addEventListener('click', hideToast);
    toastTimer = setTimeout(hideToast, duration);
}
function hideToast() { toastEl.classList.add('hidden'); }

/* =========================================================
   MODAL-BASED PROMPT
   ========================================================= */
function promptModalOpen({ title = 'Input', message = 'Enter value', value = '', hint = '' } = {}) {
    return new Promise(resolve => {
        promptTitle.textContent = title;
        promptMessage.textContent = message;
        promptInput.value = value;
        promptHint.textContent = hint;
        promptHint.style.display = hint ? 'block' : 'none';
        promptModal.classList.remove('hidden');
        setTimeout(() => { promptInput.focus(); promptInput.select(); }, 40);

        const cleanup = () => {
            promptModal.classList.add('hidden');
            promptConfirm.removeEventListener('click', onOk);
            promptCancel.removeEventListener('click', onCancel);
            promptClose.removeEventListener('click', onCancel);
            promptInput.removeEventListener('keydown', onKey);
        };
        const onOk = () => { const v = promptInput.value; cleanup(); resolve(v); };
        const onCancel = () => { cleanup(); resolve(null); };
        const onKey = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); onOk(); }
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        };
        promptConfirm.addEventListener('click', onOk);
        promptCancel.addEventListener('click', onCancel);
        promptClose.addEventListener('click', onCancel);
        promptInput.addEventListener('keydown', onKey);
    });
}

/* =========================================================
   PWA INSTALL
   ========================================================= */
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installBtn?.classList.remove('hidden');
});
installBtn?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.classList.add('hidden');
});
window.addEventListener('appinstalled', () => installBtn?.classList.add('hidden'));

/* =========================================================
   COLLAPSE
   ========================================================= */
const COLLAPSE_WIDTH = 900;
const MIN_ITEMS_TO_COLLAPSE = 2;

function updateCollapse() {
    if (!ribbon || isMobile()) return;
    const ribbonWidth = ribbon.clientWidth || window.innerWidth;
    const shouldCollapse = ribbonWidth < COLLAPSE_WIDTH;

    document.querySelectorAll('.ribbon-panel .group').forEach(group => {
        const itemCount = group.querySelectorAll(':scope > .group-items > *').length;
        const eligible = itemCount >= MIN_ITEMS_TO_COLLAPSE;
        group.classList.toggle('collapsed', shouldCollapse && eligible);
    });

    requestAnimationFrame(() => {
        document.querySelectorAll('.ribbon-panel.active .group').forEach(group => {
            const rect = group.getBoundingClientRect();
            const nearRightEdge = rect.right + 220 > window.innerWidth;
            group.classList.toggle('dropdown-right', nearRightEdge);
        });
    });
}
const ro = new ResizeObserver(() => updateCollapse());
ro.observe(ribbon);
window.addEventListener('resize', updateCollapse);

/* =========================================================
   TAB SWITCHING
   ========================================================= */
document.querySelectorAll('.ribbon-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.ribbon-tabs .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.ribbon-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.querySelector(`.ribbon-panel[data-panel="${tab.dataset.tab}"]`)?.classList.add('active');
        requestAnimationFrame(updateCollapse);
    });
});

/* =========================================================
   TABLE TAB AUTO-SHOW
   ========================================================= */
const tableTabBtn = document.getElementById('table-tab-btn');
document.addEventListener('selectionchange', () => {
    if (editorView.classList.contains('hidden')) return;
    const sel = window.getSelection();
    let node = sel.anchorNode;
    let inTable = false;
    while (node) {
        if (node.nodeType === 1 && node.tagName === 'TABLE') { inTable = true; break; }
        if (node === editorEl) break;
        node = node.parentNode;
    }
    if (tableTabBtn) {
        tableTabBtn.style.display = inTable ? '' : 'none';
        if (!inTable && tableTabBtn.classList.contains('active')) {
            document.querySelector('.ribbon-tabs .tab[data-tab="home"]')?.click();
        }
    }
});

/* =========================================================
   EXEC CMD HELPER
   ========================================================= */
function runCmd(cmd, value = null) {
    restoreSelection();
    try { document.execCommand('styleWithCSS', false, true); } catch (_) { }
    try { document.execCommand(cmd, false, value); } catch (err) {
        console.warn('execCommand failed:', cmd, err);
    }
    setTimeout(saveSelection, 0);
}

/* =========================================================
   POINTER HANDLER — iOS-safe
   Uses touchstart on touch devices so selection isn't stolen.
   ========================================================= */
function attachPointerHandler(el, handler) {
    let handled = false;

    el.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();
        handled = true;
        handler(e);
        setTimeout(() => { handled = false; }, 400);
    }, { passive: false });

    el.addEventListener('pointerdown', e => {
        if (handled) return;
        if (e.pointerType === 'touch') return;
        e.preventDefault();
        e.stopPropagation();
        handler(e);
    });
}

// All buttons with data-cmd (ribbon)
document.querySelectorAll('button[data-cmd]').forEach(btn => {
    attachPointerHandler(btn, () => {
        runCmd(btn.dataset.cmd, btn.dataset.value || null);
        updateToolbarState();
    });
});

/* =========================================================
   DROPDOWN ITEMS — iOS-safe handler
   ========================================================= */
function handleDropdownItem(li, e) {
    if (!li) return;
    if (e) { e.preventDefault(); e.stopPropagation(); }
    li.closest('.group-dropdown')?.classList.remove('open');

    restoreSelection();

    if (li.dataset.targetCmd) {
        runCmd(li.dataset.targetCmd, li.dataset.targetValue || null);
    } else if (li.dataset.targetId) {
        const target = document.getElementById(li.dataset.targetId);
        if (target) {
            target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        }
    }
    updateToolbarState();
    saveSelection();
}

ribbon.addEventListener('touchstart', e => {
    const li = e.target.closest('.group-dropdown li');
    if (li) handleDropdownItem(li, e);
}, { passive: false });

ribbon.addEventListener('click', e => {
    const li = e.target.closest('.group-dropdown li');
    if (li) handleDropdownItem(li, e);
});

// Collapse button
ribbon.addEventListener('click', e => {
    const collapseBtn = e.target.closest('.group-collapsed-btn');
    if (collapseBtn) {
        e.stopPropagation();
        const group = collapseBtn.closest('.group');
        const dropdown = group.querySelector('.group-dropdown');
        const wasOpen = dropdown.classList.contains('open');
        document.querySelectorAll('.group-dropdown.open').forEach(d => d.classList.remove('open'));
        if (!wasOpen) dropdown.classList.add('open');
    }
});

document.addEventListener('click', e => {
    if (!e.target.closest('.group')) {
        document.querySelectorAll('.group-dropdown.open').forEach(d => d.classList.remove('open'));
    }
    if (!e.target.closest('#table-menu') && !e.target.closest('td')) {
        tableMenu.classList.add('hidden');
    }
});

/* =========================================================
   LIST VIEW + SEARCH
   ========================================================= */
function stripHTML(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}

async function renderList() {
    const docs = await dbGetAll();
    docs.sort((a, b) => b.updatedAt - a.updatedAt);

    const q = currentSearch.trim().toLowerCase();
    const filtered = q
        ? docs.filter(d =>
            (d.title || '').toLowerCase().includes(q) ||
            stripHTML(d.content).toLowerCase().includes(q)
        )
        : docs;

    docList.innerHTML = '';
    if (docs.length === 0) {
        emptyMsg.style.display = 'block';
        noResultsMsg.style.display = 'none';
        return;
    }
    emptyMsg.style.display = 'none';
    noResultsMsg.style.display = filtered.length === 0 ? 'block' : 'none';

    for (const doc of filtered) {
        const li = document.createElement('li');
        li.dataset.id = doc.id;

        const info = document.createElement('div');
        info.className = 'doc-info';

        const name = document.createElement('div');
        name.className = 'doc-name';
        name.textContent = doc.title || 'Untitled';
        name.title = 'Double-click to rename';

        name.addEventListener('dblclick', e => {
            e.stopPropagation();
            name.contentEditable = 'true';
            name.focus();
            const range = document.createRange();
            range.selectNodeContents(name);
            const sel = window.getSelection();
            sel.removeAllRanges(); sel.addRange(range);
        });
        const finishRename = async () => {
            name.contentEditable = 'false';
            const newTitle = name.textContent.trim() || 'Untitled';
            name.textContent = newTitle;
            const d = await dbGet(doc.id);
            if (d) { d.title = newTitle; d.updatedAt = Date.now(); await dbPut(d); }
            renderList();
        };
        name.addEventListener('blur', finishRename);
        name.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
            if (e.key === 'Escape') { name.textContent = doc.title || 'Untitled'; name.blur(); }
        });

        info.appendChild(name);

        if (q) {
            const preview = stripHTML(doc.content);
            if (preview) {
                const snippet = document.createElement('div');
                snippet.className = 'doc-preview';
                const idx = preview.toLowerCase().indexOf(q);
                if (idx >= 0) {
                    const start = Math.max(0, idx - 30);
                    const end = Math.min(preview.length, idx + q.length + 40);
                    snippet.textContent =
                        (start > 0 ? '…' : '') + preview.slice(start, end) + (end < preview.length ? '…' : '');
                } else {
                    snippet.textContent = preview.slice(0, 80) + (preview.length > 80 ? '…' : '');
                }
                info.appendChild(snippet);
            }
        }

        const meta = document.createElement('span');
        meta.className = 'doc-meta';
        meta.textContent = formatDate(doc.updatedAt);

        const del = document.createElement('button');
        del.className = 'delete-btn';
        del.textContent = '×';
        del.title = 'Delete';
        del.addEventListener('click', async e => {
            e.stopPropagation();
            if (!confirm(`Delete "${doc.title || 'Untitled'}"?`)) return;
            await dbDelete(doc.id);
            renderList();
        });

        li.appendChild(info);
        li.appendChild(meta);
        li.appendChild(del);
        li.addEventListener('click', () => openDoc(doc.id));
        docList.appendChild(li);
    }
}

let searchDebounce;
searchInput?.addEventListener('input', e => {
    currentSearch = e.target.value;
    searchClear.classList.toggle('hidden', !currentSearch);
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderList, 120);
});
searchClear?.addEventListener('click', () => {
    searchInput.value = '';
    currentSearch = '';
    searchClear.classList.add('hidden');
    renderList();
    searchInput.focus();
});

/* =========================================================
   EDITOR VIEW
   ========================================================= */
async function openDoc(id) {
    const doc = await dbGet(id);
    if (!doc) return;
    currentDoc = doc;
    titleInput.value = doc.title || 'Untitled';
    editorEl.innerHTML = doc.content || '';
    saveStatus.textContent = '';
    savedRange = null;
    listView.classList.add('hidden');
    editorView.classList.remove('hidden');
    editorEl.focus();
    requestAnimationFrame(updateCollapse);
}
function showList() {
    currentDoc = null;
    listView.classList.remove('hidden');
    editorView.classList.add('hidden');
    renderList();
}
async function createDoc() {
    const now = Date.now();
    const doc = { id: uid(), title: 'Untitled', content: '', createdAt: now, updatedAt: now };
    await dbPut(doc);
    openDoc(doc.id);
    titleInput.select();
}

/* =========================================================
   SAVE / SAVE AS
   ========================================================= */
function scheduleSave() {
    if (!currentDoc) return;
    clearTimeout(saveTimer);
    saveStatus.textContent = 'Saving…';
    saveTimer = setTimeout(saveNow, 800);
}
async function saveNow() {
    if (!currentDoc) return;
    currentDoc.title = titleInput.value.trim() || 'Untitled';
    currentDoc.content = editorEl.innerHTML;
    currentDoc.updatedAt = Date.now();
    await dbPut(currentDoc);
    flashStatus('Saved ✓');
}

function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* =========================================================
   CUSTOM DOCX WRITER
   ========================================================= */
function escapeXml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const PARA_STYLE_MAP = {
    H1: 'Heading1', H2: 'Heading2', H3: 'Heading3', H4: 'Heading4',
    H5: 'Heading5', H6: 'Heading6',
    BLOCKQUOTE: 'Quote', PRE: 'Code'
};

function rgbToHex(rgb) {
    if (!rgb) return null;
    if (rgb.startsWith('#')) return rgb.slice(1).toUpperCase().padStart(6, '0');
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    const h = n => parseInt(n, 10).toString(16).padStart(2, '0');
    return (h(m[1]) + h(m[2]) + h(m[3])).toUpperCase();
}
function pxToHalfPt(px) {
    const n = parseFloat(px);
    if (isNaN(n)) return null;
    return Math.round(n * 1.5);
}

function cssToRunProps(el) {
    const style = (el.style && el.style.cssText) ? el.style : null;
    let rPr = '';
    const tag = (el.tagName || '').toLowerCase();

    const isBold = tag === 'b' || tag === 'strong' || (style && style.fontWeight && /bold|[6-9]00/.test(style.fontWeight));
    const isItalic = tag === 'i' || tag === 'em' || (style && style.fontStyle === 'italic');
    const isUnderline = tag === 'u' || (style && style.textDecoration && style.textDecoration.includes('underline'));
    const isStrike = tag === 's' || tag === 'strike' || tag === 'del' || (style && style.textDecoration && style.textDecoration.includes('line-through'));

    if (isBold) rPr += '<w:b/>';
    if (isItalic) rPr += '<w:i/>';
    if (isUnderline) rPr += '<w:u w:val="single"/>';
    if (isStrike) rPr += '<w:strike/>';
    if (style && style.color) {
        const hex = rgbToHex(style.color);
        if (hex) rPr += `<w:color w:val="${hex}"/>`;
    }
    if (style && style.backgroundColor) {
        const hex = rgbToHex(style.backgroundColor);
        if (hex) rPr += `<w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>`;
    }
    if (style && style.fontSize) {
        const pt = pxToHalfPt(style.fontSize);
        if (pt) rPr += `<w:sz w:val="${pt}"/><w:szCs w:val="${pt}"/>`;
    }
    if (style && style.fontFamily) {
        const fam = style.fontFamily.replace(/['"]/g, '').split(',')[0].trim();
        if (fam) rPr += `<w:rFonts w:ascii="${escapeXml(fam)}" w:hAnsi="${escapeXml(fam)}"/>`;
    }
    return rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
}

function elementToRuns(node, inheritedRPr = '') {
    if (node.nodeType === 3) {
        const text = node.textContent;
        if (!text) return '';
        return `<w:r>${inheritedRPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
    }
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return `<w:r>${inheritedRPr}<w:br/></w:r>`;
    if (tag === 'a') {
        const text = node.textContent || node.href;
        const rPr = `<w:rPr><w:color w:val="2B7FFF"/><w:u w:val="single"/></w:rPr>`;
        return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
    }
    if (tag === 'img') {
        const alt = node.getAttribute('alt') || 'image';
        return `<w:r>${inheritedRPr}<w:t xml:space="preserve">[${escapeXml(alt)}]</w:t></w:r>`;
    }
    if (tag === 'input' && node.type === 'checkbox') {
        const mark = node.checked ? '☑' : '☐';
        return `<w:r>${inheritedRPr}<w:t xml:space="preserve">${mark} </w:t></w:r>`;
    }
    const ownRPr = cssToRunProps(node);
    const mergedRPr = ownRPr || inheritedRPr;
    let out = '';
    for (const child of node.childNodes) out += elementToRuns(child, mergedRPr);
    return out;
}

function elementToParagraph(el) {
    const tag = el.tagName ? el.tagName.toUpperCase() : '';
    const styleId = PARA_STYLE_MAP[tag];
    let pPr = '';
    if (styleId) pPr += `<w:pStyle w:val="${styleId}"/>`;
    if (el.style && el.style.textAlign) {
        const map = { left: 'left', right: 'right', center: 'center', justify: 'both' };
        const jc = map[el.style.textAlign];
        if (jc) pPr += `<w:jc w:val="${jc}"/>`;
    }
    const runs = elementToRuns(el, '');
    const pPrXml = pPr ? `<w:pPr>${pPr}</w:pPr>` : '';
    return `<w:p>${pPrXml}${runs}</w:p>`;
}

function listToListParagraphs(list) {
    const isOrdered = list.tagName.toLowerCase() === 'ol';
    const items = Array.from(list.children).filter(c => c.tagName.toLowerCase() === 'li');
    let out = '';
    items.forEach(li => {
        const text = elementToRuns(li, '');
        const numPr = isOrdered
            ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'
            : '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
        out += `<w:p><w:pPr>${numPr}</w:pPr>${text}</w:p>`;
    });
    return out;
}

function tableToOoxml(table) {
    const rows = Array.from(table.rows);
    if (!rows.length) return '';
    let out = '<w:tbl>';
    out += `<w:tblPr>
    <w:tblStyle w:val="TableGrid"/>
    <w:tblW w:w="5000" w:type="pct"/>
    <w:tblBorders>
      <w:top w:val="single" w:sz="4" w:color="auto"/>
      <w:left w:val="single" w:sz="4" w:color="auto"/>
      <w:bottom w:val="single" w:sz="4" w:color="auto"/>
      <w:right w:val="single" w:sz="4" w:color="auto"/>
      <w:insideH w:val="single" w:sz="4" w:color="auto"/>
      <w:insideV w:val="single" w:sz="4" w:color="auto"/>
    </w:tblBorders>
  </w:tblPr>`;
    for (const row of rows) {
        out += '<w:tr>';
        for (const cell of row.cells) {
            const runs = elementToRuns(cell, '');
            out += `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${runs}</w:p></w:tc>`;
        }
        out += '</w:tr>';
    }
    out += '</w:tbl><w:p/>';
    return out;
}

function buildDocumentBody(rootEl) {
    let out = '';
    for (const node of Array.from(rootEl.childNodes)) {
        if (node.nodeType === 3) {
            const text = node.textContent.trim();
            if (text) out += `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
            continue;
        }
        if (node.nodeType !== 1) continue;
        const tag = node.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'ol') out += listToListParagraphs(node);
        else if (tag === 'table') out += tableToOoxml(node);
        else if (tag === 'hr') out += `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="888888"/></w:pBdr></w:pPr></w:p>`;
        else if (tag === 'div' || tag === 'section' || tag === 'article') out += buildDocumentBody(node);
        else out += elementToParagraph(node);
    }
    if (!out.trim()) out = '<w:p/>';
    return out;
}

function buildContentTypes() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}
function buildRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}
function buildDocumentRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;
}
function buildStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
    <w:sz w:val="22"/><w:szCs w:val="22"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:pBdr><w:left w:val="single" w:sz="12" w:color="2B7FFF"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`;
}
function buildNumberingXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
}
function buildCoreXml(title) {
    const now = new Date().toISOString();
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>Quickie Docs</dc:creator>
  <cp:lastModifiedBy>Quickie Docs</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}
function buildAppXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Quickie Docs</Application></Properties>`;
}

async function generateDocxBlob(title, editorHtml) {
    if (!window.JSZip) throw new Error('JSZip not loaded.');
    const temp = document.createElement('div');
    temp.innerHTML = editorHtml || '';
    const bodyXml = buildDocumentBody(temp);
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bodyXml}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
    const zip = new window.JSZip();
    zip.file('[Content_Types].xml', buildContentTypes());
    zip.folder('_rels').file('.rels', buildRels());
    const word = zip.folder('word');
    word.file('document.xml', documentXml);
    word.file('styles.xml', buildStylesXml());
    word.file('numbering.xml', buildNumberingXml());
    word.folder('_rels').file('document.xml.rels', buildDocumentRels());
    const props = zip.folder('docProps');
    props.file('core.xml', buildCoreXml(title));
    props.file('app.xml', buildAppXml());
    return await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        compression: 'DEFLATE'
    });
}

/* =========================================================
   FORMAT BUILDERS
   ========================================================= */
function buildHtmlBlob(title) {
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;}</style>
</head><body>${editorEl.innerHTML}</body></html>`;
    return new Blob([html], { type: 'text/html' });
}
function buildTxtBlob() {
    return new Blob([editorEl.innerText || ''], { type: 'text/plain' });
}
function buildMdBlob() {
    return new Blob([htmlToMarkdown(editorEl.innerHTML || '')], { type: 'text/markdown' });
}
function htmlToMarkdown(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    function walk(node) {
        if (node.nodeType === 3) return node.textContent;
        if (node.nodeType !== 1) return '';
        const tag = node.tagName.toLowerCase();
        const inner = Array.from(node.childNodes).map(walk).join('');
        switch (tag) {
            case 'h1': return `\n# ${inner.trim()}\n\n`;
            case 'h2': return `\n## ${inner.trim()}\n\n`;
            case 'h3': return `\n### ${inner.trim()}\n\n`;
            case 'h4': return `\n#### ${inner.trim()}\n\n`;
            case 'h5': return `\n##### ${inner.trim()}\n\n`;
            case 'h6': return `\n###### ${inner.trim()}\n\n`;
            case 'p': return `${inner.trim()}\n\n`;
            case 'br': return `\n`;
            case 'strong': case 'b': return `**${inner}**`;
            case 'em': case 'i': return `*${inner}*`;
            case 'u': return `<u>${inner}</u>`;
            case 's': case 'strike': case 'del': return `~~${inner}~~`;
            case 'a': return `[${inner}](${node.getAttribute('href') || '#'})`;
            case 'code': return `\`${inner}\``;
            case 'pre': return `\n\`\`\`\n${node.textContent}\n\`\`\`\n\n`;
            case 'blockquote': return `\n> ${inner.trim().replace(/\n/g, '\n> ')}\n\n`;
            case 'ul': return '\n' + Array.from(node.children).map(li => `- ${walk(li).trim()}`).join('\n') + '\n\n';
            case 'ol': return '\n' + Array.from(node.children).map((li, i) => `${i + 1}. ${walk(li).trim()}`).join('\n') + '\n\n';
            case 'li': return inner;
            case 'hr': return `\n---\n\n`;
            case 'img': return `![${node.getAttribute('alt') || 'image'}](${node.getAttribute('src') || ''})`;
            default: return inner;
        }
    }
    return walk(temp).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* =========================================================
   SAVE AS
   ========================================================= */
async function getBlobForType(type, title) {
    switch (type) {
        case 'docx': return await generateDocxBlob(title, editorEl.innerHTML);
        case 'html': return buildHtmlBlob(title);
        case 'txt': return buildTxtBlob();
        case 'md': return buildMdBlob();
        default: throw new Error('Unknown format');
    }
}
function getMimeAndExt(type) {
    switch (type) {
        case 'docx': return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx', description: 'Word Document' };
        case 'html': return { mime: 'text/html', ext: '.html', description: 'Web Page' };
        case 'txt': return { mime: 'text/plain', ext: '.txt', description: 'Plain Text' };
        case 'md': return { mime: 'text/markdown', ext: '.md', description: 'Markdown' };
    }
}
async function performSaveAs(type, filename) {
    if (!currentDoc) return;
    const { mime, ext, description } = getMimeAndExt(type);
    const finalName = (filename || currentDoc.title || 'Untitled').trim() + ext;

    let blob;
    try { blob = await getBlobForType(type, filename); }
    catch (err) {
        console.error('Save As failed:', err);
        showToast('Could not generate file. Try a different format.');
        return;
    }

    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: finalName,
                types: [{ description, accept: { [mime]: [ext] } }]
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            if (currentDoc) fileHandles[currentDoc.id] = handle;
            showToast(`Saved as ${handle.name}`);
            return;
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.warn('showSaveFilePicker failed:', err);
        }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = finalName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Downloaded ${finalName}`);
}

function openSaveAsModal() {
    if (!currentDoc) return;
    saveAsName.value = (currentDoc.title || 'Untitled').replace(/[^\w\-. ]+/g, '_');
    saveAsType.value = 'docx';
    updateSaveAsHint();
    saveAsModal.classList.remove('hidden');
    setTimeout(() => { saveAsName.focus(); saveAsName.select(); }, 40);
}
function updateSaveAsHint() {
    if (window.showSaveFilePicker) {
        saveAsHint.textContent = 'Your browser will open a Save dialog where you can pick the folder.';
    } else {
        saveAsHint.textContent = 'Your browser will download the file to your Downloads folder.';
    }
}
async function confirmSaveAs() {
    const name = saveAsName.value.trim() || 'Untitled';
    const type = saveAsType.value;
    saveAsModal.classList.add('hidden');
    await performSaveAs(type, name);
}
saveAsBtn?.addEventListener('click', openSaveAsModal);
saveAsClose?.addEventListener('click', () => saveAsModal.classList.add('hidden'));
saveAsCancel?.addEventListener('click', () => saveAsModal.classList.add('hidden'));
saveAsConfirm?.addEventListener('click', confirmSaveAs);
saveAsType?.addEventListener('change', updateSaveAsHint);
saveAsModal?.addEventListener('click', e => {
    if (e.target === saveAsModal) saveAsModal.classList.add('hidden');
});

/* =========================================================
   IMPORT
   ========================================================= */
function pickAndImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx,.html,.htm,.txt,.md';
    input.onchange = () => {
        const file = input.files[0];
        if (file) importFile(file);
    };
    input.click();
}
function importFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    switch (ext) {
        case 'docx': return importDOCX(file);
        case 'html': case 'htm': return importHTML(file);
        case 'txt': return importTXT(file);
        case 'md': case 'markdown': return importMarkdown(file);
        default: alert('Unsupported file type: .' + ext);
    }
}
function importDOCX(file) {
    if (typeof window.mammoth === 'undefined') {
        alert('DOCX import library not loaded.');
        return;
    }
    const reader = new FileReader();
    reader.onload = async e => {
        try {
            const result = await window.mammoth.convertToHtml(
                { arrayBuffer: e.target.result },
                {
                    styleMap: [
                        "p[style-name='Title'] => h1", "p[style-name='Subtitle'] => h2",
                        "p[style-name='heading 1'] => h1", "p[style-name='heading 2'] => h2",
                        "p[style-name='heading 3'] => h3", "p[style-name='heading 4'] => h4",
                        "p[style-name='Quote'] => blockquote", "p[style-name='Code'] => pre",
                        "b => strong", "i => em"
                    ],
                    convertImage: window.mammoth.images.imgElement(img =>
                        img.read('base64').then(b64 => ({ src: 'data:' + img.contentType + ';base64,' + b64 }))
                    )
                }
            );
            let html = (result.value || '').trim();
            if (!html || /^<p>\s*<\/p>$/.test(html)) {
                html = await extractPlainTextFromDocx(e.target.result);
                if (html) showToast('Imported as plain text.');
            }
            if (!html) { alert('This DOCX could not be read.'); return; }
            await createImportedDoc(file.name, html);
        } catch (err) {
            console.error('DOCX import failed:', err);
            alert('Failed to import DOCX.');
        }
    };
    reader.readAsArrayBuffer(file);
}
async function extractPlainTextFromDocx(arrayBuffer) {
    try {
        if (!window.JSZip) return '';
        const zip = await window.JSZip.loadAsync(arrayBuffer);
        const docXmlFile = zip.file('word/document.xml');
        if (!docXmlFile) return '';
        const xml = await docXmlFile.async('string');
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        const paragraphs = doc.getElementsByTagNameNS('*', 'p');
        const lines = [];
        for (const p of paragraphs) {
            const texts = p.getElementsByTagNameNS('*', 't');
            let line = '';
            for (const t of texts) line += t.textContent;
            lines.push(line);
        }
        const text = lines.join('\n').trim();
        if (!text) return '';
        return text.split(/\n{2,}/).map(p => `<p>${escapeHTML(p).replace(/\n/g, '<br>')}</p>`).join('');
    } catch (err) {
        console.error('Raw extraction failed:', err);
        return '';
    }
}
function importHTML(file) {
    const reader = new FileReader();
    reader.onload = async e => {
        const text = e.target.result;
        const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        await createImportedDoc(file.name, bodyMatch ? bodyMatch[1] : text);
    };
    reader.readAsText(file);
}
function importTXT(file) {
    const reader = new FileReader();
    reader.onload = async e => {
        const html = e.target.result.split(/\n{2,}/)
            .map(p => `<p>${escapeHTML(p).replace(/\n/g, '<br>')}</p>`)
            .join('') || '<p></p>';
        await createImportedDoc(file.name, html);
    };
    reader.readAsText(file);
}
function importMarkdown(file) {
    const reader = new FileReader();
    reader.onload = async e => {
        await createImportedDoc(file.name, markdownToHTML(e.target.result));
    };
    reader.readAsText(file);
}
function markdownToHTML(md) {
    if (!md) return '<p></p>';
    let html = escapeHTML(md);
    html = html.replace(/```([\s\S]*?)```/g, (_, c) => `<pre>${c.trim()}</pre>`);
    html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>');
    html = html.replace(/^##### (.*)$/gm, '<h5>$1</h5>');
    html = html.replace(/^#### (.*)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
    html = html.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^---+$/gm, '<hr>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const blocks = html.split(/\n{2,}/).map(b => {
        const t = b.trim();
        if (!t) return '';
        if (/^<(h[1-6]|ul|ol|pre|blockquote|hr|p|table)/i.test(t)) return t;
        return `<p>${t.replace(/\n/g, '<br>')}</p>`;
    });
    return blocks.join('\n') || '<p></p>';
}
function escapeHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
async function createImportedDoc(filename, html) {
    const now = Date.now();
    const baseName = filename.replace(/\.[^.]+$/, '').slice(0, 60) || 'Imported';
    const doc = { id: uid(), title: baseName, content: html || '<p></p>', createdAt: now, updatedAt: now };
    await dbPut(doc);
    await openDoc(doc.id);
    flashStatus('Imported ✓');
}
importBtn?.addEventListener('click', pickAndImport);
['dragenter', 'dragover'].forEach(ev => docList.addEventListener(ev, e => { e.preventDefault(); docList.classList.add('drag-over'); }));
['dragleave', 'drop'].forEach(ev => docList.addEventListener(ev, e => { e.preventDefault(); docList.classList.remove('drag-over'); }));
docList.addEventListener('drop', e => {
    const file = e.dataTransfer.files?.[0];
    if (file) importFile(file);
});

/* =========================================================
   PRINT / PDF
   ========================================================= */
function printDoc() {
    if (!currentDoc) return;
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${titleInput.value || 'Untitled'}</title>
<style>
  @page { size: A4; margin: 1in; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; color: #1f2328; margin: 0; }
  h1 { font-size: 22pt; } h2 { font-size: 16pt; } h3 { font-size: 13pt; }
  p { margin: 0 0 10pt; }
  ul, ol { margin: 0 0 10pt 22pt; }
  blockquote { border-left: 3pt solid #2b7fff; padding-left: 12pt; color: #4a5568; font-style: italic; }
  pre { background: #f3f4f6; padding: 10pt; border-radius: 4pt; font-family: 'Courier New', monospace; font-size: 10pt; }
  a { color: #2b7fff; text-decoration: underline; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; }
  td { border: 1pt solid #cbd5e1; padding: 6pt 8pt; }
  hr { border: none; border-top: 1pt solid #cbd5e1; margin: 16pt 0; }
  hr.page-break { page-break-after: always; border: none; height: 0; }
</style></head><body>${editorEl.innerHTML}</body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => { w.print(); }, 400);
}

/* =========================================================
   TOOLBAR STATE
   ========================================================= */
function updateToolbarState() {
    ['bold', 'italic', 'underline', 'strikeThrough', 'superscript', 'subscript',
        'insertUnorderedList', 'insertOrderedList',
        'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'].forEach(cmd => {
            let active = false;
            try { active = document.queryCommandState(cmd); } catch (_) { }
            document.querySelectorAll(`[data-cmd="${cmd}"]`).forEach(btn => btn.classList.toggle('active', active));
            document.querySelectorAll(`[data-mb="${cmd}"]`).forEach(btn => btn.classList.toggle('active', active));
        });
}
document.addEventListener('selectionchange', () => {
    if (!editorView.classList.contains('hidden')) updateToolbarState();
});

/* =========================================================
   FONT CONTROLS
   ========================================================= */
function applyFontName(family) {
    if (family === 'default') { runCmd('removeFormat'); return; }
    runCmd('fontName', family);
}
function applyFontSize(px) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    try { document.execCommand('styleWithCSS', false, true); } catch (_) { }
    if (sel.isCollapsed) {
        document.execCommand('fontSize', false, '7');
        editorEl.querySelectorAll('font[size="7"]').forEach(el => {
            el.removeAttribute('size');
            el.style.fontSize = px + 'px';
        });
        return;
    }
    const span = document.createElement('span');
    span.style.fontSize = px + 'px';
    try { range.surroundContents(span); }
    catch (_) {
        const frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
    }
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.addRange(newRange);
}
function bindFontControls(familyId, sizeId) {
    const fam = document.getElementById(familyId);
    const size = document.getElementById(sizeId);
    if (fam) fam.addEventListener('change', e => { applyFontName(e.target.value); scheduleSave(); });
    if (size) size.addEventListener('change', e => { applyFontSize(parseInt(e.target.value, 10)); scheduleSave(); });
}
bindFontControls('font-family', 'font-size');
bindFontControls('font-family-compact', 'font-size-compact');

// Font size +/- buttons
document.getElementById('font-size-up')?.addEventListener('touchstart', e => {
    e.preventDefault();
    const sel = document.getElementById('font-size');
    const idx = sel.selectedIndex;
    if (idx < sel.options.length - 1) {
        sel.selectedIndex = idx + 1;
        applyFontSize(parseInt(sel.value, 10));
        scheduleSave();
    }
}, { passive: false });
document.getElementById('font-size-down')?.addEventListener('touchstart', e => {
    e.preventDefault();
    const sel = document.getElementById('font-size');
    const idx = sel.selectedIndex;
    if (idx > 0) {
        sel.selectedIndex = idx - 1;
        applyFontSize(parseInt(sel.value, 10));
        scheduleSave();
    }
}, { passive: false });
document.getElementById('font-size-up')?.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    const sel = document.getElementById('font-size');
    const idx = sel.selectedIndex;
    if (idx < sel.options.length - 1) {
        sel.selectedIndex = idx + 1;
        applyFontSize(parseInt(sel.value, 10));
        scheduleSave();
    }
});
document.getElementById('font-size-down')?.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    const sel = document.getElementById('font-size');
    const idx = sel.selectedIndex;
    if (idx > 0) {
        sel.selectedIndex = idx - 1;
        applyFontSize(parseInt(sel.value, 10));
        scheduleSave();
    }
});

/* =========================================================
   TEXT CASE
   ========================================================= */
document.getElementById('text-case-btn')?.addEventListener('touchstart', e => {
    e.preventDefault();
    openTextCasePrompt();
}, { passive: false });
document.getElementById('text-case-btn')?.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    openTextCasePrompt();
});

async function openTextCasePrompt() {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) {
        showToast('Select some text first.', 2000);
        return;
    }
    const current = sel.toString();
    const choice = await promptModalOpen({
        title: 'Change Case',
        message: 'Type: upper / lower / title / sentence',
        value: 'upper',
        hint: 'upper, lower, title, sentence'
    });
    if (!choice) return;
    let next = current;
    switch (choice.toLowerCase()) {
        case 'upper': next = current.toUpperCase(); break;
        case 'lower': next = current.toLowerCase(); break;
        case 'title': next = current.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()); break;
        case 'sentence': next = current.toLowerCase().replace(/(^\s*\w|[.!?]\s*\w)/g, c => c.toUpperCase()); break;
        default: return;
    }
    runCmd('insertText', next);
    scheduleSave();
}

/* =========================================================
   COLOR PICKERS
   ========================================================= */
const PRESET_TEXT_COLORS = ['#000000', '#1f2328', '#6b7280', '#9ca3af', '#d1d5db', '#dc2626', '#ea580c', '#eab308', '#16a34a', '#0891b2', '#2563eb', '#2b7fff', '#7c3aed', '#db2777', '#f472b6', '#92400e', '#0f766e', '#1e3a8a', '#701a75', '#ffffff'];
const PRESET_HIGHLIGHT_COLORS = ['#ffff00', '#fef08a', '#fde047', '#bbf7d0', '#86efac', '#a5f3fc', '#bae6fd', '#c7d2fe', '#e9d5ff', '#fbcfe8', '#fecaca', '#fed7aa', '#fef3c7', '#dcfce7', '#dbeafe', '#e0e7ff', '#f3e8ff', '#fce7f3', '#ffe4e6', '#ffffff'];

function buildColorGrids() {
    document.querySelectorAll('.color-grid').forEach(grid => {
        const kind = grid.dataset.swatches;
        const presets = kind === 'text' ? PRESET_TEXT_COLORS : PRESET_HIGHLIGHT_COLORS;
        grid.innerHTML = '';
        presets.forEach(color => {
            const b = document.createElement('button');
            b.type = 'button';
            b.style.background = color;
            b.title = color;
            b.addEventListener('touchstart', e => {
                e.preventDefault();
                e.stopPropagation();
                applyColor(kind === 'text' ? 'foreColor' : 'hiliteColor', color);
                closeAllColorMenus();
            }, { passive: false });
            b.addEventListener('click', e => {
                e.stopPropagation();
                applyColor(kind === 'text' ? 'foreColor' : 'hiliteColor', color);
                closeAllColorMenus();
            });
            grid.appendChild(b);
        });
    });
}
function applyColor(command, color) {
    restoreSelection();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(command, false, color);
    updateColorSwatches(command, color);
    saveSelection();
    scheduleSave();
}
function updateColorSwatches(command, color) {
    const picker = document.querySelector(
        command === 'foreColor' ? '.color-picker[data-color-target="foreColor"]' : '.color-picker[data-color-target="hiliteColor"]'
    );
    if (!picker) return;
    const letter = picker.querySelector('.color-letter');
    if (letter) letter.style.borderBottomColor = color;
}
function closeAllColorMenus() {
    document.querySelectorAll('.color-menu').forEach(m => m.classList.add('hidden'));
}
function initColorPickers() {
    buildColorGrids();
    document.querySelectorAll('.color-picker').forEach(picker => {
        const command = picker.dataset.colorTarget;
        const mainBtn = picker.querySelector('.color-main');
        const caret = picker.querySelector('.color-caret');
        const menu = picker.querySelector('.color-menu');
        const native = picker.querySelector('input[type="color"]');
        const customBtn = picker.querySelector('.color-custom');

        attachPointerHandler(mainBtn, () => {
            const current = picker.querySelector('.color-letter').style.borderBottomColor || '#1f2328';
            applyColor(command, current);
        });
        attachPointerHandler(caret, () => {
            const wasHidden = menu.classList.contains('hidden');
            closeAllColorMenus();
            if (wasHidden) menu.classList.remove('hidden');
        });
        customBtn?.addEventListener('touchstart', e => {
            e.preventDefault();
            native.click();
        }, { passive: false });
        customBtn?.addEventListener('click', () => native.click());
        native?.addEventListener('input', e => { applyColor(command, e.target.value); closeAllColorMenus(); });
        menu?.addEventListener('touchstart', e => e.stopPropagation(), { passive: false });
        menu?.addEventListener('click', e => e.stopPropagation());
    });
    document.addEventListener('click', () => closeAllColorMenus());
}
initColorPickers();

/* =========================================================
   CLEAR / LINE HEIGHT
   ========================================================= */
document.getElementById('clear-format')?.addEventListener('touchstart', e => {
    e.preventDefault();
    runCmd('removeFormat');
    scheduleSave();
}, { passive: false });
document.getElementById('clear-format')?.addEventListener('click', () => {
    runCmd('removeFormat');
    scheduleSave();
});
document.getElementById('line-height')?.addEventListener('change', e => {
    const val = e.target.value;
    getSelectedBlocks().forEach(b => b.style.lineHeight = val);
    scheduleSave(); editorEl.focus();
});
function getSelectedBlocks() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return [];
    const range = sel.getRangeAt(0);
    const blocks = new Set();
    let node = range.startContainer;
    while (node && node !== editorEl) {
        if (node.nodeType === 1 && /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE)$/.test(node.tagName)) blocks.add(node);
        node = node.parentNode;
    }
    if (!blocks.size) blocks.add(editorEl);
    return [...blocks];
}

/* =========================================================
   INSERT HELPERS
   ========================================================= */
function bindAction(el, handler) {
    if (!el) return;
    el.addEventListener('touchstart', e => {
        e.preventDefault();
        handler();
    }, { passive: false });
    el.addEventListener('pointerdown', e => {
        if (e.pointerType === 'touch') return;
        e.preventDefault();
        handler();
    });
}

bindAction(document.getElementById('insert-link'), () => {
    linkUrlInput.value = 'https://';
    linkTextInput.value = window.getSelection().toString() || '';
    linkModal.classList.remove('hidden');
    setTimeout(() => linkUrlInput.focus(), 40);
});

linkModalClose?.addEventListener('click', () => linkModal.classList.add('hidden'));
linkModalCancel?.addEventListener('click', () => linkModal.classList.add('hidden'));
linkModalConfirm?.addEventListener('click', () => {
    const url = linkUrlInput.value.trim();
    const label = linkTextInput.value.trim();
    if (!url) { linkModal.classList.add('hidden'); return; }
    const sel = window.getSelection();
    if (sel.toString() && editorEl.contains(sel.anchorNode)) {
        runCmd('createLink', url);
    } else {
        const text = label || url;
        runCmd('insertHTML', `<a href="${url}" target="_blank" rel="noopener">${text}</a>`);
    }
    linkModal.classList.add('hidden');
    scheduleSave();
});

bindAction(document.getElementById('insert-bookmark'), async () => {
    const name = await promptModalOpen({
        title: 'Insert Bookmark',
        message: 'Bookmark name',
        value: 'bookmark-' + Date.now().toString(36)
    });
    if (!name) return;
    runCmd('insertHTML', `<span class="bookmark" id="${escapeHTML(name)}">🔖 ${escapeHTML(name)}</span>&nbsp;`);
    scheduleSave();
});

bindAction(document.getElementById('insert-date'), () => {
    runCmd('insertText', new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
    scheduleSave();
});
bindAction(document.getElementById('insert-datetime'), () => {
    runCmd('insertText', new Date().toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
    scheduleSave();
});
bindAction(document.getElementById('insert-hr'), () => {
    runCmd('insertHorizontalRule');
    scheduleSave();
});
bindAction(document.getElementById('insert-tasklist'), () => {
    const html = `<div class="task-item"><input type="checkbox">&nbsp;<span>Task 1</span></div>
<div class="task-item"><input type="checkbox">&nbsp;<span>Task 2</span></div><p><br></p>`;
    runCmd('insertHTML', html);
    scheduleSave();
});
bindAction(document.getElementById('insert-quote'), async () => {
    const text = await promptModalOpen({ title: 'Insert Quote', message: 'Quote text', value: '' });
    if (!text) return;
    runCmd('insertHTML', `<blockquote>${escapeHTML(text)}</blockquote><p><br></p>`);
    scheduleSave();
});
bindAction(document.getElementById('insert-code'), async () => {
    const lang = await promptModalOpen({ title: 'Code block', message: 'Language (optional)', value: '' });
    const code = await promptModalOpen({ title: 'Code block', message: 'Code', value: '' });
    if (code === null) return;
    const langAttr = lang ? ` data-lang="${escapeHTML(lang)}"` : '';
    runCmd('insertHTML', `<pre${langAttr}>${escapeHTML(code)}</pre><p><br></p>`);
    scheduleSave();
});
bindAction(document.getElementById('insert-toc'), () => {
    const headings = editorEl.querySelectorAll('h1, h2, h3');
    if (!headings.length) { showToast('No headings found in this document.', 2500); return; }
    let html = '<div class="toc"><div class="toc-title">Table of Contents</div><ul>';
    headings.forEach((h, i) => {
        const id = 'toc-' + i;
        h.id = id;
        const indent = h.tagName === 'H1' ? 0 : h.tagName === 'H2' ? 16 : 32;
        html += `<li style="margin-left:${indent}px"><a href="#${id}">${escapeHTML(h.textContent)}</a></li>`;
    });
    html += '</ul></div><p><br></p>';
    runCmd('insertHTML', html);
    scheduleSave();
});
bindAction(document.getElementById('insert-footnote'), async () => {
    const text = await promptModalOpen({ title: 'Footnote', message: 'Footnote text', value: '' });
    if (!text) return;
    const num = (editorEl.querySelectorAll('.footnote').length || 0) + 1;
    runCmd('insertHTML', `<span class="footnote" title="${escapeHTML(text)}" data-note="${escapeHTML(text)}">[${num}]</span>&nbsp;`);
    scheduleSave();
});
bindAction(document.getElementById('insert-pagenum'), () => {
    runCmd('insertHTML', `<span class="page-number">Page&nbsp;<span class="page-num">1</span></span>&nbsp;`);
    scheduleSave();
});
bindAction(document.getElementById('insert-table'), () => {
    tableModal.classList.remove('hidden');
    setTimeout(() => tableRowsInput.focus(), 40);
});
tableModalClose?.addEventListener('click', () => tableModal.classList.add('hidden'));
tableModalCancel?.addEventListener('click', () => tableModal.classList.add('hidden'));
tableModalConfirm?.addEventListener('click', () => {
    const rows = parseInt(tableRowsInput.value, 10) || 3;
    const cols = parseInt(tableColsInput.value, 10) || 3;
    if (rows < 1 || cols < 1) return;
    let html = '<table><tbody>';
    for (let r = 0; r < rows; r++) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) html += '<td><br></td>';
        html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    runCmd('insertHTML', html);
    tableModal.classList.add('hidden');
    scheduleSave();
});

const IMAGE_MAX_WIDTH = 1600;
const IMAGE_QUALITY = 0.82;
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > IMAGE_MAX_WIDTH) {
                    const ratio = IMAGE_MAX_WIDTH / width;
                    width = IMAGE_MAX_WIDTH; height = Math.round(height * ratio);
                }
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
                canvas.toBlob(blob => {
                    if (!blob) return reject(new Error('Canvas failed'));
                    resolve(blob.size > file.size ? file : blob);
                }, type, type === 'image/jpeg' ? IMAGE_QUALITY : undefined);
            };
            img.onerror = reject;
            img.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
function blobToDataURL(blob) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(blob);
    });
}
bindAction(document.getElementById('insert-image'), () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        try {
            const compressed = await compressImage(file);
            const dataUrl = await blobToDataURL(compressed);
            runCmd('insertImage', dataUrl);
            scheduleSave();
            const saved = Math.max(0, file.size - compressed.size);
            if (saved > 1024) showToast(`Image compressed — saved ${(saved / 1024).toFixed(0)} KB`);
        } catch (err) {
            const reader = new FileReader();
            reader.onload = () => { runCmd('insertImage', reader.result); scheduleSave(); };
            reader.readAsDataURL(file);
        }
    };
    input.click();
});
bindAction(document.getElementById('insert-shape'), async () => {
    const shape = await promptModalOpen({ title: 'Insert Shape', message: 'Type: rect, circle, or triangle', value: 'rect' });
    if (!shape) return;
    const svg = shape === 'circle'
        ? '<svg width="80" height="80"><circle cx="40" cy="40" r="38" fill="#2b7fff"/></svg>'
        : shape === 'triangle'
            ? '<svg width="80" height="80"><polygon points="40,4 76,76 4,76" fill="#2b7fff"/></svg>'
            : '<svg width="100" height="60"><rect width="100" height="60" fill="#2b7fff"/></svg>';
    runCmd('insertHTML', svg);
    scheduleSave();
});
bindAction(document.getElementById('insert-emoji'), async () => {
    const emoji = await promptModalOpen({ title: 'Insert Emoji', message: 'Type or paste an emoji', value: '😀' });
    if (!emoji) return;
    runCmd('insertText', emoji);
    scheduleSave();
});
bindAction(document.getElementById('insert-symbol'), async () => {
    const sym = await promptModalOpen({ title: 'Insert Symbol', message: 'Type or paste a symbol', value: '©' });
    if (!sym) return;
    runCmd('insertText', sym);
    scheduleSave();
});
bindAction(document.getElementById('insert-pagebreak'), () => {
    runCmd('insertHTML', '<hr class="page-break"><p><br></p>');
    scheduleSave();
});

/* =========================================================
   TABLE ACTIONS
   ========================================================= */
function runTableAction(action, cell) {
    if (!cell) return;
    const row = cell.parentElement;
    const table = cell.closest('table');
    if (!row || !table) return;
    const idx = Array.from(row.children).indexOf(cell);
    const newCell = () => { const td = document.createElement('td'); td.innerHTML = '<br>'; return td; };

    switch (action) {
        case 'row-above': {
            const nr = row.cloneNode(false);
            for (let i = 0; i < row.children.length; i++) nr.appendChild(newCell());
            row.parentNode.insertBefore(nr, row); break;
        }
        case 'row-below': {
            const nr = row.cloneNode(false);
            for (let i = 0; i < row.children.length; i++) nr.appendChild(newCell());
            row.parentNode.insertBefore(nr, row.nextSibling); break;
        }
        case 'col-left': {
            Array.from(table.rows).forEach(r => {
                const ref = r.children[idx];
                if (ref) r.insertBefore(newCell(), ref);
            }); break;
        }
        case 'col-right': {
            Array.from(table.rows).forEach(r => {
                const ref = r.children[idx];
                if (ref) r.insertBefore(newCell(), ref.nextSibling);
            }); break;
        }
        case 'row-delete': row.remove(); break;
        case 'col-delete': Array.from(table.rows).forEach(r => r.children[idx]?.remove()); break;
        case 'table-delete': table.remove(); break;
        case 'merge': {
            const sel = window.getSelection();
            if (sel.rangeCount > 0 && !sel.isCollapsed) {
                const range = sel.getRangeAt(0);
                const cells = [];
                table.querySelectorAll('td').forEach(td => {
                    if (range.intersectsNode(td)) cells.push(td);
                });
                if (cells.length > 1) {
                    const first = cells[0];
                    let combined = '';
                    cells.forEach((c, i) => { combined += (i ? '<br>' : '') + c.innerHTML; });
                    first.innerHTML = combined;
                    first.colSpan = cells.length;
                    cells.slice(1).forEach(c => c.remove());
                }
            }
            break;
        }
    }
    scheduleSave();
}
document.querySelectorAll('[data-table-action]').forEach(btn => {
    btn.addEventListener('touchstart', e => {
        e.preventDefault();
        const cell = tableMenuTargetCell || getCurrentTableCell();
        if (cell) runTableAction(btn.dataset.tableAction, cell);
    }, { passive: false });
    btn.addEventListener('click', () => {
        const cell = tableMenuTargetCell || getCurrentTableCell();
        if (cell) runTableAction(btn.dataset.tableAction, cell);
    });
});
function getCurrentTableCell() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    let node = sel.anchorNode;
    while (node) {
        if (node.nodeType === 1 && node.tagName === 'TD') return node;
        node = node.parentNode;
    }
    return null;
}
function showTableMenu(clientX, clientY, cell) {
    tableMenuTargetCell = cell;
    tableMenu.classList.remove('hidden');
    tableMenu.style.left = Math.min(clientX, window.innerWidth - 240) + 'px';
    tableMenu.style.top = Math.min(clientY, window.innerHeight - 300) + 'px';
}
editorEl.addEventListener('contextmenu', e => {
    const cell = e.target.closest('td');
    if (!cell) return;
    e.preventDefault();
    showTableMenu(e.clientX, e.clientY, cell);
});
let longPressTimer = null;
editorEl.addEventListener('touchstart', e => {
    const cell = e.target.closest('td');
    if (!cell) return;
    const touch = e.touches[0];
    longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (navigator.vibrate) navigator.vibrate(30);
        showTableMenu(touch.clientX, touch.clientY, cell);
    }, 500);
}, { passive: true });
editorEl.addEventListener('touchend', () => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
});
editorEl.addEventListener('touchmove', () => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
});
tableMenu.addEventListener('click', e => {
    const btn = e.target.closest('button[data-table-action]');
    if (!btn || !tableMenuTargetCell) return;
    runTableAction(btn.dataset.tableAction, tableMenuTargetCell);
    tableMenu.classList.add('hidden');
    editorEl.focus();
});
document.getElementById('cell-bg-color')?.addEventListener('input', e => {
    const cell = tableMenuTargetCell || getCurrentTableCell();
    if (cell) { cell.style.backgroundColor = e.target.value; scheduleSave(); }
});
document.getElementById('cell-border-color')?.addEventListener('input', e => {
    const cell = tableMenuTargetCell || getCurrentTableCell();
    if (cell) { cell.style.borderColor = e.target.value; scheduleSave(); }
});

/* =========================================================
   FIND / REPLACE
   ========================================================= */
const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const replaceInput = document.getElementById('replace-input');
const findCount = document.getElementById('find-count');

function openFind(replaceMode = false) {
    findBar.classList.remove('hidden');
    findBar.classList.toggle('replace-mode', replaceMode);
    findInput.focus();
    findInput.select();
}
bindAction(document.getElementById('find-btn'), () => openFind(false));
bindAction(document.getElementById('replace-btn'), () => openFind(true));
document.getElementById('find-close')?.addEventListener('click', () => {
    findBar.classList.add('hidden');
    window.getSelection().removeAllRanges();
});
findInput?.addEventListener('input', performFind);
document.getElementById('find-next')?.addEventListener('click', () => moveFind(1));
document.getElementById('find-prev')?.addEventListener('click', () => moveFind(-1));

function performFind() {
    const q = findInput.value;
    findMatches = [];
    currentFindIndex = 0;
    if (!q) { findCount.textContent = ''; return; }
    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
    let node;
    const lower = q.toLowerCase();
    while ((node = walker.nextNode())) {
        const text = node.textContent.toLowerCase();
        let start = 0;
        while ((start = text.indexOf(lower, start)) !== -1) {
            findMatches.push({ node, start, end: start + q.length });
            start += lower.length;
        }
    }
    findCount.textContent = `${findMatches.length} match${findMatches.length === 1 ? '' : 'es'}`;
    if (findMatches.length) {
        currentFindIndex = 0;
        highlightMatch();
    }
}
function moveFind(dir) {
    if (!findMatches.length) return;
    currentFindIndex = (currentFindIndex + dir + findMatches.length) % findMatches.length;
    highlightMatch();
}
function highlightMatch() {
    const m = findMatches[currentFindIndex];
    if (!m) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    const r = document.createRange();
    r.setStart(m.node, m.start);
    r.setEnd(m.node, m.end);
    sel.addRange(r);
    m.node.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
    findCount.textContent = `${currentFindIndex + 1} of ${findMatches.length}`;
}
document.getElementById('replace-one')?.addEventListener('click', () => {
    const m = findMatches[currentFindIndex];
    if (!m) return;
    const replaceWith = replaceInput.value;
    const r = document.createRange();
    r.setStart(m.node, m.start);
    r.setEnd(m.node, m.end);
    r.deleteContents();
    r.insertNode(document.createTextNode(replaceWith));
    scheduleSave();
    performFind();
});
document.getElementById('replace-all')?.addEventListener('click', () => {
    const q = findInput.value;
    const replaceWith = replaceInput.value;
    if (!q) return;
    let count = 0;
    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(n => {
        const text = n.textContent;
        const lower = text.toLowerCase();
        const ql = q.toLowerCase();
        let idx = lower.indexOf(ql);
        if (idx !== -1) {
            const parts = [];
            let last = 0;
            while (idx !== -1) {
                parts.push(text.slice(last, idx));
                parts.push(replaceWith);
                last = idx + q.length;
                idx = lower.indexOf(ql, last);
                count++;
            }
            parts.push(text.slice(last));
            n.textContent = parts.join('');
        }
    });
    scheduleSave();
    showToast(`Replaced ${count} occurrence${count === 1 ? '' : 's'}.`);
    performFind();
});

/* =========================================================
   WORD COUNT / STATS
   ========================================================= */
const wcPopup = document.getElementById('wordcount-popup');
function showWordCount() {
    const text = editorEl.innerText;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    const charsNS = text.replace(/\s/g, '').length;
    const paras = editorEl.querySelectorAll('p, h1, h2, h3, h4, li, blockquote, pre').length || 1;
    const lines = text.split(/\n/).length;
    wcPopup.innerHTML = `
    <div><strong>${words}</strong> words</div>
    <div><strong>${chars}</strong> characters</div>
    <div><strong>${charsNS}</strong> chars (no spaces)</div>
    <div><strong>${paras}</strong> paragraphs</div>
    <div><strong>${lines}</strong> lines
  `;
    wcPopup.classList.toggle('hidden');
}
function showReadingTime() {
    const text = editorEl.innerText;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const minutes = Math.ceil(words / 200);
    wcPopup.innerHTML = `<div>⏱ <strong>~${minutes} min</strong> reading time</div><div style="font-size:11px;color:var(--muted);margin-top:4px">based on 200 wpm</div>`;
    wcPopup.classList.remove('hidden');
}
function showCharFreq() {
    const text = editorEl.innerText.toLowerCase().replace(/\s/g, '');
    const freq = {};
    for (const ch of text) freq[ch] = (freq[ch] || 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
    wcPopup.innerHTML = '<div style="margin-bottom:6px"><strong>Top characters</strong></div>' +
        top.map(([c, n]) => `<div><code>${escapeHTML(c)}</code> × ${n}</div>`).join('');
    wcPopup.classList.remove('hidden');
}
document.getElementById('wordcount-btn')?.addEventListener('click', showWordCount);
document.getElementById('wordcount-btn-2')?.addEventListener('click', showWordCount);
document.getElementById('readingtime-btn')?.addEventListener('click', showReadingTime);
document.getElementById('charfreq-btn')?.addEventListener('click', showCharFreq);
document.addEventListener('click', e => {
    if (wcPopup.classList.contains('hidden')) return;
    if (!wcPopup.contains(e.target) && !e.target.closest('#wordcount-btn, #wordcount-btn-2, #readingtime-btn, #charfreq-btn'))
        wcPopup.classList.add('hidden');
});

/* =========================================================
   REVIEW
   ========================================================= */
document.getElementById('spellcheck-btn')?.addEventListener('click', () => {
    editorEl.spellcheck = !editorEl.spellcheck;
    showToast(editorEl.spellcheck ? 'Spell check ON' : 'Spell check OFF', 2000);
});
document.getElementById('thesaurus-btn')?.addEventListener('click', () => {
    const word = window.getSelection().toString().trim();
    if (!word) { showToast('Select a word first.', 2500); return; }
    window.open('https://www.thesaurus.com/browse/' + encodeURIComponent(word), '_blank');
});
bindAction(document.getElementById('comment-btn'), async () => {
    const text = await promptModalOpen({ title: 'Add Comment', message: 'Comment text', value: '' });
    if (!text) return;
    runCmd('insertHTML', ` <span class="doc-comment" title="${escapeHTML(text)}" style="background:#fff8b8;border-bottom:2px solid #f0c000;">[💬]</span> `);
    scheduleSave();
});

/* =========================================================
   FULLSCREEN / PREVIEW / COMPACT
   ========================================================= */
document.getElementById('fullscreen-btn')?.addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
});
document.getElementById('print-btn')?.addEventListener('click', printDoc);
document.getElementById('preview-btn')?.addEventListener('click', () => {
    previewMode = !previewMode;
    editorEl.contentEditable = previewMode ? 'false' : 'true';
    editorEl.classList.toggle('preview-mode', previewMode);
    document.getElementById('preview-btn').classList.toggle('active', previewMode);
});
document.getElementById('compact-toggle')?.addEventListener('click', () => {
    compactMode = !compactMode;
    compactTB.classList.toggle('hidden', !compactMode);
    ribbon.classList.toggle('hidden', compactMode);
    document.getElementById('compact-toggle').classList.toggle('active', compactMode);
});

/* =========================================================
   MOBILE BOTTOM BAR
   ========================================================= */
mobileBar?.addEventListener('touchstart', e => {
    const btn = e.target.closest('.mb-btn');
    if (!btn) return;
    e.preventDefault();
    handleMobileBar(btn.dataset.mb);
}, { passive: false });
mobileBar?.addEventListener('click', e => {
    const btn = e.target.closest('.mb-btn');
    if (!btn) return;
    handleMobileBar(btn.dataset.mb);
});

function handleMobileBar(cmd) {
    switch (cmd) {
        case 'undo': runCmd('undo'); break;
        case 'redo': runCmd('redo'); break;
        case 'bold': runCmd('bold'); break;
        case 'italic': runCmd('italic'); break;
        case 'underline': runCmd('underline'); break;
        case 'heading': runCmd('formatBlock', 'H2'); break;
        case 'bullet': runCmd('insertUnorderedList'); break;
        case 'more': mobileSheet.classList.remove('hidden'); return;
    }
    updateToolbarState();
}

mobileSheetClose?.addEventListener('click', () => mobileSheet.classList.add('hidden'));

mobileSheet?.addEventListener('touchstart', e => {
    const btn = e.target.closest('.sheet-btn');
    if (!btn) return;
    e.preventDefault();
    handleSheetAction(btn.dataset.sheet);
}, { passive: false });
mobileSheet?.addEventListener('click', e => {
    const btn = e.target.closest('.sheet-btn');
    if (!btn) return;
    handleSheetAction(btn.dataset.sheet);
});

function handleSheetAction(action) {
    mobileSheet.classList.add('hidden');
    switch (action) {
        case 'strikeThrough': runCmd('strikeThrough'); break;
        case 'superscript': runCmd('superscript'); break;
        case 'subscript': runCmd('subscript'); break;
        case 'ordered': runCmd('insertOrderedList'); break;
        case 'tasklist': document.getElementById('insert-tasklist')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); break;
        case 'quote': document.getElementById('insert-quote')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); break;
        case 'code': document.getElementById('insert-code')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); break;
        case 'link': document.getElementById('insert-link')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); break;
        case 'image': document.getElementById('insert-image')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); break;
        case 'table': document.getElementById('insert-table')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); break;
        case 'hr': runCmd('insertHorizontalRule'); break;
        case 'date': document.getElementById('insert-date')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); break;
        case 'toc': document.getElementById('insert-toc')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); break;
        case 'footnote': document.getElementById('insert-footnote')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); break;
        case 'bookmark': document.getElementById('insert-bookmark')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); break;
        case 'clear': runCmd('removeFormat'); break;
        case 'find': openFind(false); break;
        case 'save': saveNow(); break;
        case 'saveas': openSaveAsModal(); break;
        case 'back': saveNow().then(showList); break;
    }
    updateToolbarState();
}

/* =========================================================
   FILE MENU
   ========================================================= */
document.querySelector('.file-menu-row')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-file]');
    if (!b) return;
    const action = b.dataset.file;
    if (action === 'new') createDoc();
    if (action === 'save') saveNow();
    if (action === 'save-as') openSaveAsModal();
    if (action === 'import') pickAndImport();
    if (action === 'print') printDoc();
    if (action === 'back') saveNow().then(showList);
});

/* =========================================================
   COMMAND PALETTE
   ========================================================= */
const paletteOverlay = document.getElementById('palette-overlay');
const paletteInput = document.getElementById('palette-input');
const paletteList = document.getElementById('palette-list');

const COMMANDS = [
    { name: 'Bold', icon: 'B', run: () => runCmd('bold') },
    { name: 'Italic', icon: 'I', run: () => runCmd('italic') },
    { name: 'Underline', icon: 'U', run: () => runCmd('underline') },
    { name: 'Strikethrough', icon: 'S', run: () => runCmd('strikeThrough') },
    { name: 'Heading 1', icon: 'H1', run: () => runCmd('formatBlock', 'H1') },
    { name: 'Heading 2', icon: 'H2', run: () => runCmd('formatBlock', 'H2') },
    { name: 'Heading 3', icon: 'H3', run: () => runCmd('formatBlock', 'H3') },
    { name: 'Normal', icon: '¶', run: () => runCmd('formatBlock', 'P') },
    { name: 'Quote', icon: '❝', run: () => runCmd('formatBlock', 'BLOCKQUOTE') },
    { name: 'Code Block', icon: '{ }', run: () => runCmd('formatBlock', 'PRE') },
    { name: 'Bullet List', icon: '•', run: () => runCmd('insertUnorderedList') },
    { name: 'Numbered List', icon: '1.', run: () => runCmd('insertOrderedList') },
    { name: 'Align Left', icon: '⬅', run: () => runCmd('justifyLeft') },
    { name: 'Align Center', icon: '↔', run: () => runCmd('justifyCenter') },
    { name: 'Align Right', icon: '➡', run: () => runCmd('justifyRight') },
    { name: 'Insert Link', icon: '🔗', run: () => document.getElementById('insert-link')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) },
    { name: 'Insert Image', icon: '🖼', run: () => document.getElementById('insert-image')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) },
    { name: 'Insert Table', icon: '▦', run: () => document.getElementById('insert-table')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) },
    { name: 'Insert Horizontal Rule', icon: '―', run: () => runCmd('insertHorizontalRule') },
    { name: 'Insert Page Break', icon: '⎯', run: () => document.getElementById('insert-pagebreak')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) },
    { name: 'Insert Date', icon: '📅', run: () => document.getElementById('insert-date')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) },
    { name: 'Insert Date & Time', icon: '🕐', run: () => document.getElementById('insert-datetime')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) },
    { name: 'Insert Emoji', icon: '😀', run: () => document.getElementById('insert-emoji')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) },
    { name: 'Insert Bookmark', icon: '🔖', run: () => document.getElementById('insert-bookmark')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) },
    { name: 'Insert Table of Contents', icon: '☰', run: () => document.getElementById('insert-toc')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) },
    { name: 'Insert Footnote', icon: '⁽¹⁾', run: () => document.getElementById('insert-footnote')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) },
    { name: 'Insert Checklist', icon: '☑', run: () => document.getElementById('insert-tasklist')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) },
    { name: 'Find in document', icon: '🔍', run: () => openFind(false) },
    { name: 'Find & Replace', icon: '⇄', run: () => openFind(true) },
    { name: 'Word Count', icon: '#', run: showWordCount },
    { name: 'Reading Time', icon: '⏱', run: showReadingTime },
    { name: 'Character Frequency', icon: '🔤', run: showCharFreq },
    { name: 'Toggle Dark Mode', icon: '🌙', run: toggleTheme },
    { name: 'Preview', icon: '👁', run: () => document.getElementById('preview-btn')?.click() },
    { name: 'Fullscreen', icon: '⛶', run: () => document.getElementById('fullscreen-btn')?.click() },
    { name: 'Print / Save as PDF', icon: '🖨', run: printDoc },
    { name: 'Save', icon: '💾', run: saveNow },
    { name: 'Save As…', icon: '⬇', run: openSaveAsModal },
    { name: 'Import File', icon: '📂', run: pickAndImport },
    { name: 'New Document', icon: '📄', run: createDoc },
    { name: 'Back to Documents', icon: '←', run: () => saveNow().then(showList) },
    {
        name: 'Search Documents', icon: '🔎', run: () => {
            if (!editorView.classList.contains('hidden')) saveNow().then(() => { showList(); searchInput.focus(); });
            else searchInput.focus();
        }
    },
    { name: 'Toggle Compact Toolbar', icon: '⇕', run: () => document.getElementById('compact-toggle')?.click() },
    { name: 'Install App', icon: '📲', run: () => installBtn?.click() },
];

let paletteSelection = 0;
let paletteFiltered = COMMANDS;

function openPalette() {
    paletteOverlay.classList.remove('hidden');
    paletteInput.value = '';
    paletteSelection = 0;
    renderPalette('');
    setTimeout(() => paletteInput.focus(), 20);
}
function closePalette() { paletteOverlay.classList.add('hidden'); }
function renderPalette(query) {
    const q = query.trim().toLowerCase();
    paletteFiltered = q ? COMMANDS.filter(c => c.name.toLowerCase().includes(q)) : COMMANDS;
    paletteSelection = 0;
    paletteList.innerHTML = '';
    if (!paletteFiltered.length) {
        const li = document.createElement('li');
        li.className = 'no-result';
        li.textContent = 'No matching commands';
        paletteList.appendChild(li);
        return;
    }
    paletteFiltered.forEach((cmd, i) => {
        const li = document.createElement('li');
        li.className = i === paletteSelection ? 'selected' : '';
        li.innerHTML = `<span class="p-icon">${cmd.icon}</span><span>${cmd.name}</span>`;
        li.addEventListener('mouseenter', () => { paletteSelection = i; updatePaletteSelection(); });
        li.addEventListener('click', () => runPaletteSelection());
        paletteList.appendChild(li);
    });
}
function updatePaletteSelection() {
    [...paletteList.children].forEach((li, i) => li.classList.toggle('selected', i === paletteSelection));
}
function runPaletteSelection() {
    const cmd = paletteFiltered[paletteSelection];
    if (!cmd) return;
    closePalette();
    cmd.run();
}
document.getElementById('palette-btn').addEventListener('click', openPalette);
paletteInput.addEventListener('input', e => renderPalette(e.target.value));
paletteInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        paletteSelection = Math.min(paletteSelection + 1, paletteFiltered.length - 1);
        updatePaletteSelection();
        paletteList.children[paletteSelection]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        paletteSelection = Math.max(paletteSelection - 1, 0);
        updatePaletteSelection();
        paletteList.children[paletteSelection]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
        e.preventDefault();
        runPaletteSelection();
    } else if (e.key === 'Escape') closePalette();
});
paletteOverlay.addEventListener('click', e => {
    if (e.target === paletteOverlay) closePalette();
});

/* =========================================================
   GLOBAL KEYBOARD SHORTCUTS
   ========================================================= */
document.addEventListener('keydown', e => {
    const target = e.target;
    const isTextInput = target && (
        (target.tagName === 'INPUT' && target.type !== 'color') ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
    );
    const inModal = target && target.closest && target.closest('.modal-overlay');
    if (isTextInput && !inModal) return;

    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (!mod) return;

    if (e.shiftKey) {
        if (key === 'p') { e.preventDefault(); e.stopPropagation(); openPalette(); return; }
        if (key === 'd') { e.preventDefault(); e.stopPropagation(); toggleTheme(); return; }
        if (key === 's') { e.preventDefault(); e.stopPropagation(); openSaveAsModal(); return; }
        if (key === 'o') { e.preventDefault(); e.stopPropagation(); pickAndImport(); return; }
        return;
    }

    switch (key) {
        case 's': e.preventDefault(); e.stopPropagation(); saveNow(); return;
        case 'b': e.preventDefault(); e.stopPropagation(); runCmd('bold'); updateToolbarState(); return;
        case 'i': e.preventDefault(); e.stopPropagation(); runCmd('italic'); updateToolbarState(); return;
        case 'u': e.preventDefault(); e.stopPropagation(); runCmd('underline'); updateToolbarState(); return;
        case 'k': e.preventDefault(); e.stopPropagation(); document.getElementById('insert-link')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return;
        case 'p': e.preventDefault(); e.stopPropagation(); printDoc(); return;
        case 'f':
            e.preventDefault(); e.stopPropagation();
            if (editorView.classList.contains('hidden')) searchInput?.focus();
            else openFind(false);
            return;
        case 'a':
            if (document.activeElement === editorEl || editorEl.contains(document.activeElement)) {
                e.preventDefault(); e.stopPropagation();
                const range = document.createRange();
                range.selectNodeContents(editorEl);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
            return;
    }
}, true);

window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') e.preventDefault();
}, true);

/* =========================================================
   PASTE PLAIN TEXT
   ========================================================= */
editorEl.addEventListener('paste', e => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
});

/* =========================================================
   VISUAL VIEWPORT
   ========================================================= */
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        if (isMobile()) {
            document.documentElement.style.setProperty('--vh', window.visualViewport.height + 'px');
        }
    });
}

/* =========================================================
   EVENTS
   ========================================================= */
newDocBtn.addEventListener('click', createDoc);
backBtn.addEventListener('click', async () => { await saveNow(); showList(); });
titleInput.addEventListener('input', scheduleSave);
editorEl.addEventListener('input', scheduleSave);

document.addEventListener('keydown', e => {
    if (editorView.classList.contains('hidden') && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInput?.focus();
    }
});

/* =========================================================
   PWA
   ========================================================= */
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[PWA] New service worker is now controlling the page');
    });
}

/* =========================================================
   BOOT
   ========================================================= */
(async function init() {
    await openDB();
    renderList();
    updateCollapse();
    updateSaveAsHint();
})();