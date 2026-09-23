/* =========================================================
   Quickie Docs — v1.3.0
   Custom DOCX writer + Save As + fixed keyboard shortcuts
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
            if (!d.objectStoreNames.contains(STORE)) {
                d.createObjectStore(STORE, { keyPath: 'id' });
            }
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

// Save As modal
const saveAsModal = document.getElementById('save-as-modal');
const saveAsName = document.getElementById('save-as-name');
const saveAsType = document.getElementById('save-as-type');
const saveAsHint = document.getElementById('save-as-hint');
const saveAsClose = document.getElementById('save-as-close');
const saveAsCancel = document.getElementById('save-as-cancel');
const saveAsConfirm = document.getElementById('save-as-confirm');

// ---------- State ----------
let currentDoc = null;
let saveTimer = null;
let compactMode = false;
let previewMode = false;
let toastTimer = null;
let currentSearch = '';
let tableMenuTargetCell = null;
const fileHandles = {};   // docId -> FileSystemFileHandle

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function flashStatus(text) {
    saveStatus.textContent = text;
    setTimeout(() => { if (saveStatus.textContent === text) saveStatus.textContent = ''; }, 1500);
}

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
    if (!localStorage.getItem('quickie-theme')) {
        applyTheme(e.matches ? 'dark' : 'light');
    }
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
    toastEl.innerHTML = `
    <span>${message}</span>
    <button class="toast-close" title="Dismiss">✕</button>
  `;
    toastEl.classList.remove('hidden');
    toastEl.querySelector('.toast-close').addEventListener('click', hideToast);
    toastTimer = setTimeout(hideToast, duration);
}
function hideToast() {
    toastEl.classList.add('hidden');
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
window.addEventListener('appinstalled', () => {
    installBtn?.classList.add('hidden');
});

/* =========================================================
   COLLAPSE
   ========================================================= */
const COLLAPSE_WIDTH = 900;
const MIN_ITEMS_TO_COLLAPSE = 2;

function updateCollapse() {
    if (!ribbon) return;
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
   DROPDOWNS
   ========================================================= */
ribbon.addEventListener('click', e => {
    const collapseBtn = e.target.closest('.group-collapsed-btn');
    if (collapseBtn) {
        e.stopPropagation();
        const group = collapseBtn.closest('.group');
        const dropdown = group.querySelector('.group-dropdown');
        const wasOpen = dropdown.classList.contains('open');
        document.querySelectorAll('.group-dropdown.open').forEach(d => d.classList.remove('open'));
        if (!wasOpen) dropdown.classList.add('open');
        return;
    }
    const li = e.target.closest('.group-dropdown li');
    if (li) {
        e.stopPropagation();
        li.closest('.group-dropdown')?.classList.remove('open');
        if (li.dataset.targetCmd) {
            document.execCommand(li.dataset.targetCmd, false, li.dataset.targetValue || null);
        } else if (li.dataset.targetId) {
            document.getElementById(li.dataset.targetId)?.click();
        }
        editorEl.focus();
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
                        (start > 0 ? '…' : '') +
                        preview.slice(start, end) +
                        (end < preview.length ? '…' : '');
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
   SAVE (IndexedDB)
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

/* =========================================================
   CUSTOM DOCX WRITER (Path B)
   Walks the editor DOM and emits proper OOXML with styles.xml,
   so files round-trip cleanly back through Mammoth.
   ========================================================= */
function escapeXml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Paragraph styles we know how to write
const PARA_STYLE_MAP = {
    H1: 'Heading1', H2: 'Heading2', H3: 'Heading3', H4: 'Heading4',
    H5: 'Heading5', H6: 'Heading6',
    BLOCKQUOTE: 'Quote',
    PRE: 'Code'
};

// Convert inline CSS style string to OOXML run properties
function cssToRunProps(el) {
    const styles = (el.style && el.style.cssText) ? el.style : (el.getAttribute && el.getAttribute('style') ? parseStyleString(el.getAttribute('style')) : null);
    let rPr = '';

    const tag = (el.tagName || '').toLowerCase();

    // Bold / italic / underline / strike
    const isBold = tag === 'b' || tag === 'strong' || (el.style && el.style.fontWeight && /bold|[6-9]00/.test(el.style.fontWeight));
    const isItalic = tag === 'i' || tag === 'em' || (el.style && el.style.fontStyle === 'italic');
    const isUnderline = tag === 'u' || (el.style && el.style.textDecoration && el.style.textDecoration.includes('underline'));
    const isStrike = tag === 's' || tag === 'strike' || tag === 'del' || (el.style && el.style.textDecoration && el.style.textDecoration.includes('line-through'));

    if (isBold) rPr += '<w:b/>';
    if (isItalic) rPr += '<w:i/>';
    if (isUnderline) rPr += '<w:u w:val="single"/>';
    if (isStrike) rPr += '<w:strike/>';

    // Color
    if (el.style && el.style.color) {
        const hex = rgbToHex(el.style.color);
        if (hex) rPr += `<w:color w:val="${hex}"/>`;
    }

    // Background (highlight)
    if (el.style && el.style.backgroundColor) {
        const hex = rgbToHex(el.style.backgroundColor);
        if (hex) rPr += `<w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>`;
    }

    // Font size
    if (el.style && el.style.fontSize) {
        const pt = pxToHalfPt(el.style.fontSize);
        if (pt) rPr += `<w:sz w:val="${pt}"/><w:szCs w:val="${pt}"/>`;
    }

    // Font family
    if (el.style && el.style.fontFamily) {
        const fam = el.style.fontFamily.replace(/['"]/g, '').split(',')[0].trim();
        if (fam) rPr += `<w:rFonts w:ascii="${escapeXml(fam)}" w:hAnsi="${escapeXml(fam)}"/>`;
    }

    return rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
}

function parseStyleString(s) {
    const fake = document.createElement('span');
    fake.setAttribute('style', s || '');
    return fake.style;
}

function rgbToHex(rgb) {
    if (!rgb) return null;
    if (rgb.startsWith('#')) return rgb.slice(1).toUpperCase().padStart(6, '0');
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    const [_, r, g, b] = m;
    const h = (n) => parseInt(n, 10).toString(16).padStart(2, '0');
    return (h(r) + h(g) + h(b)).toUpperCase();
}

function pxToHalfPt(px) {
    const n = parseFloat(px);
    if (isNaN(n)) return null;
    // 1 pt = 1.333 px; 1 pt = 2 half-points
    return Math.round(n * 1.5);
}

// Convert a single text-containing element into <w:r> runs
function elementToRuns(node, inheritedRPr = '') {
    if (node.nodeType === 3) {
        const text = node.textContent;
        if (!text) return '';
        return `<w:r>${inheritedRPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
    }
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toLowerCase();

    // Skip style-only wrappers we don't care about
    if (tag === 'br') {
        return `<w:r>${inheritedRPr}<w:br/></w:r>`;
    }

    // Anchors → hyperlink runs (simplified: write as plain text with underline + color)
    if (tag === 'a') {
        const text = node.textContent || node.href;
        const rPr = `<w:rPr><w:color w:val="2B7FFF"/><w:u w:val="single"/></w:rPr>`;
        return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
    }

    // Images — write as inline text placeholder (images are complex in OOXML)
    if (tag === 'img') {
        const alt = node.getAttribute('alt') || 'image';
        return `<w:r>${inheritedRPr}<w:t xml:space="preserve">[${escapeXml(alt)}]</w:t></w:r>`;
    }

    // Merge this element's inline styles with inherited
    const ownRPr = cssToRunProps(node);
    const mergedRPr = ownRPr || inheritedRPr;

    let out = '';
    for (const child of node.childNodes) {
        out += elementToRuns(child, mergedRPr);
    }
    return out;
}

// Convert a paragraph-like element into <w:p>
function elementToParagraph(el) {
    const tag = el.tagName ? el.tagName.toUpperCase() : '';
    const styleId = PARA_STYLE_MAP[tag];

    let pPr = '';
    if (styleId) {
        pPr += `<w:pStyle w:val="${styleId}"/>`;
    }

    // Text alignment
    if (el.style && el.style.textAlign) {
        const map = { left: 'left', right: 'right', center: 'center', justify: 'both' };
        const jc = map[el.style.textAlign];
        if (jc) pPr += `<w:jc w:val="${jc}"/>`;
    }

    const runs = elementToRuns(el, '');
    const pPrXml = pPr ? `<w:pPr>${pPr}</w:pPr>` : '';
    return `<w:p>${pPrXml}${runs}</w:p>`;
}

// Convert a list (ul/ol) into a sequence of <w:p> with numbering
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

// Convert a table into <w:tbl>
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

// Walk editor children and produce the body content
function buildDocumentBody(rootEl) {
    let out = '';
    const children = Array.from(rootEl.childNodes);

    for (const node of children) {
        if (node.nodeType === 3) {
            const text = node.textContent.trim();
            if (text) {
                out += `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
            }
            continue;
        }
        if (node.nodeType !== 1) continue;

        const tag = node.tagName.toLowerCase();

        if (tag === 'ul' || tag === 'ol') {
            out += listToListParagraphs(node);
        } else if (tag === 'table') {
            out += tableToOoxml(node);
        } else if (tag === 'hr') {
            out += `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="888888"/></w:pBdr></w:pPr></w:p>`;
        } else if (tag === 'div' || tag === 'section' || tag === 'article') {
            out += buildDocumentBody(node);
        } else {
            out += elementToParagraph(node);
        }
    }

    if (!out.trim()) {
        out = '<w:p/>';
    }
    return out;
}

// ---- Static OOXML side files ----
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
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
        <w:sz w:val="22"/><w:szCs w:val="22"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/><w:qFormat/>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="200" w:after="100"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading4">
    <w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:outlineLvl w:val="3"/></w:pPr>
    <w:rPr><w:b/><w:i/><w:sz w:val="22"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:ind w:left="720"/><w:pBdr><w:left w:val="single" w:sz="12" w:color="2B7FFF"/></w:pBdr></w:pPr>
    <w:rPr><w:i/><w:color w:val="555555"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr>
  </w:style>
</w:styles>`;
}

function buildNumberingXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
}

function buildCoreXml(title) {
    const now = new Date().toISOString();
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>Quickie Docs</dc:creator>
  <cp:lastModifiedBy>Quickie Docs</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function buildAppXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Quickie Docs</Application>
</Properties>`;
}

// Top-level: generate a real .docx Blob
async function generateDocxBlob(title, editorHtml) {
    if (!window.JSZip) {
        throw new Error('JSZip not loaded — cannot generate DOCX.');
    }

    // Parse the editor HTML into a temp DOM so we can walk it
    const temp = document.createElement('div');
    temp.innerHTML = editorHtml || '';

    const bodyXml = buildDocumentBody(temp);

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
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
   SAVE AS — Format generators
   ========================================================= */
function buildHtmlBlob(title) {
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;}</style>
</head><body>${editorEl.innerHTML}</body></html>`;
    return new Blob([html], { type: 'text/html' });
}

function buildTxtBlob() {
    const text = editorEl.innerText || '';
    return new Blob([text], { type: 'text/plain' });
}

function buildMdBlob() {
    const html = editorEl.innerHTML || '';
    const md = htmlToMarkdown(html);
    return new Blob([md], { type: 'text/markdown' });
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
            case 'a': {
                const href = node.getAttribute('href') || '#';
                return `[${inner}](${href})`;
            }
            case 'code': return `\`${inner}\``;
            case 'pre': return `\n\`\`\`\n${node.textContent}\n\`\`\`\n\n`;
            case 'blockquote': return `\n> ${inner.trim().replace(/\n/g, '\n> ')}\n\n`;
            case 'ul': return '\n' + Array.from(node.children).map(li => `- ${walk(li).trim()}`).join('\n') + '\n\n';
            case 'ol': return '\n' + Array.from(node.children).map((li, i) => `${i + 1}. ${walk(li).trim()}`).join('\n') + '\n\n';
            case 'li': return inner;
            case 'hr': return `\n---\n\n`;
            case 'img': {
                const alt = node.getAttribute('alt') || 'image';
                const src = node.getAttribute('src') || '';
                return `![${alt}](${src})`;
            }
            case 'table': {
                const rows = Array.from(node.rows);
                if (!rows.length) return '';
                let md = '\n';
                rows.forEach((row, ri) => {
                    const cells = Array.from(row.cells).map(c => c.textContent.trim());
                    md += '| ' + cells.join(' | ') + ' |\n';
                    if (ri === 0) md += '|' + cells.map(() => ' --- ').join('|') + '|\n';
                });
                return md + '\n';
            }
            default: return inner;
        }
    }

    return walk(temp).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* =========================================================
   SAVE AS — File System Access + fallback
   ========================================================= */
async function getBlobForType(type, title) {
    switch (type) {
        case 'docx': return await generateDocxBlob(title, editorEl.innerHTML);
        case 'html': return buildHtmlBlob(title);
        case 'txt': return buildTxtBlob();
        case 'md': return buildMdBlob();
        default: throw new Error('Unknown format: ' + type);
    }
}

function getMimeAndExt(type) {
    switch (type) {
        case 'docx': return {
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ext: '.docx',
            description: 'Word Document'
        };
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
    try {
        blob = await getBlobForType(type, filename);
    } catch (err) {
        console.error('Save As failed to build file:', err);
        showToast('Could not generate the file. Please try a different format.');
        return;
    }

    // Try File System Access API first (Chrome / Edge)
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: finalName,
                types: [{
                    description,
                    accept: { [mime]: [ext] }
                }]
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();

            // Remember handle so next Save As points to same file
            if (currentDoc) fileHandles[currentDoc.id] = handle;

            showToast(`Saved as ${handle.name}`);
            return;
        } catch (err) {
            if (err.name === 'AbortError') return;   // user cancelled
            console.warn('showSaveFilePicker failed, falling back to download:', err);
        }
    }

    // Fallback: standard download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalName;
    a.click();
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
    const t = saveAsType.value;
    if (window.showSaveFilePicker) {
        saveAsHint.textContent = 'Your browser will open a Save dialog where you can pick the folder.';
    } else {
        saveAsHint.textContent = 'Your browser does not support folder selection — the file will be downloaded to your Downloads folder.';
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
   IMPORT (with plain-text fallback for broken round-trips)
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
        case 'html':
        case 'htm': return importHTML(file);
        case 'txt': return importTXT(file);
        case 'md':
        case 'markdown': return importMarkdown(file);
        default:
            alert('Unsupported file type: .' + ext);
    }
}

function importDOCX(file) {
    if (typeof window.mammoth === 'undefined') {
        alert('DOCX import library not loaded (offline?). Try again when online.');
        return;
    }
    const reader = new FileReader();
    reader.onload = async e => {
        const arrayBuffer = e.target.result;
        try {
            const result = await window.mammoth.convertToHtml(
                { arrayBuffer },
                {
                    styleMap: [
                        "p[style-name='Title'] => h1",
                        "p[style-name='Subtitle'] => h2",
                        "p[style-name='heading 1'] => h1",
                        "p[style-name='heading 2'] => h2",
                        "p[style-name='heading 3'] => h3",
                        "p[style-name='heading 4'] => h4",
                        "p[style-name='Quote'] => blockquote",
                        "p[style-name='Intense Quote'] => blockquote",
                        "p[style-name='Code'] => pre",
                        "b => strong",
                        "i => em",
                    ],
                    convertImage: window.mammoth.images.imgElement(img => {
                        return img.read('base64').then(b64 => ({
                            src: 'data:' + img.contentType + ';base64,' + b64
                        }));
                    })
                }
            );

            let html = (result.value || '').trim();

            // Fallback: Mammoth silently returned empty (common for our own exports)
            if (!html || /^<p>\s*<\/p>$/.test(html) || html === '<p></p>') {
                console.warn('Mammoth returned empty HTML. Trying raw text extraction…');
                html = await extractPlainTextFromDocx(arrayBuffer);
                if (html) {
                    showToast('Imported as plain text — some formatting may be lost.');
                }
            }

            if (!html) {
                alert('This DOCX file could not be read. It may be empty or corrupted.');
                return;
            }

            if (!/<\w+/.test(html)) {
                html = html.split(/\n{2,}/)
                    .map(p => `<p>${escapeHTML(p).replace(/\n/g, '<br>')}</p>`)
                    .join('');
            }

            await createImportedDoc(file.name, html);

            if (result.messages?.length) {
                console.info('Mammoth warnings:', result.messages);
            }
        } catch (err) {
            console.error('DOCX import failed:', err);
            alert('Failed to import DOCX. The file may be corrupted.');
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
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');
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
        return text.split(/\n{2,}/)
            .map(p => `<p>${escapeHTML(p).replace(/\n/g, '<br>')}</p>`)
            .join('');
    } catch (err) {
        console.error('Raw DOCX text extraction failed:', err);
        return '';
    }
}

function importHTML(file) {
    const reader = new FileReader();
    reader.onload = async e => {
        const text = e.target.result;
        const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const html = bodyMatch ? bodyMatch[1] : text;
        await createImportedDoc(file.name, html);
    };
    reader.readAsText(file);
}
function importTXT(file) {
    const reader = new FileReader();
    reader.onload = async e => {
        const text = e.target.result;
        const html = text.split(/\n{2,}/)
            .map(p => `<p>${escapeHTML(p).replace(/\n/g, '<br>')}</p>`)
            .join('') || '<p></p>';
        await createImportedDoc(file.name, html);
        showToast('TXT imported as plain paragraphs.');
    };
    reader.readAsText(file);
}
function importMarkdown(file) {
    const reader = new FileReader();
    reader.onload = async e => {
        const html = markdownToHTML(e.target.result);
        await createImportedDoc(file.name, html);
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
    html = html.replace(/^\*\*\*+$/gm, '<hr>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/(?:^|\n)((?:[-*+] .*(?:\n|$))+)/g, (m, b) => {
        const items = b.trim().split(/\n/).map(l => l.replace(/^[-*+] /, '').trim()).filter(Boolean).map(t => `<li>${t}</li>`).join('');
        return `\n<ul>${items}</ul>\n`;
    });
    html = html.replace(/(?:^|\n)((?:\d+\. .*(?:\n|$))+)/g, (m, b) => {
        const items = b.trim().split(/\n/).map(l => l.replace(/^\d+\. /, '').trim()).filter(Boolean).map(t => `<li>${t}</li>`).join('');
        return `\n<ol>${items}</ol>\n`;
    });
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

['dragenter', 'dragover'].forEach(ev => {
    docList.addEventListener(ev, e => { e.preventDefault(); docList.classList.add('drag-over'); });
});
['dragleave', 'drop'].forEach(ev => {
    docList.addEventListener(ev, e => { e.preventDefault(); docList.classList.remove('drag-over'); });
});
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
    w.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${titleInput.value || 'Untitled'}</title>
<style>
  @page { size: A4; margin: 1in; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; color: #1f2328; margin: 0; padding: 0; }
  h1 { font-size: 22pt; margin: 0 0 12pt; page-break-after: avoid; }
  h2 { font-size: 16pt; margin: 18pt 0 8pt; page-break-after: avoid; }
  h3 { font-size: 13pt; margin: 14pt 0 6pt; page-break-after: avoid; }
  p { margin: 0 0 10pt; orphans: 3; widows: 3; }
  ul, ol { margin: 0 0 10pt 22pt; }
  blockquote { border-left: 3pt solid #2b7fff; padding-left: 12pt; color: #4a5568; font-style: italic; }
  pre { background: #f3f4f6; padding: 10pt; border-radius: 4pt; font-family: 'Courier New', monospace; font-size: 10pt; white-space: pre-wrap; }
  a { color: #2b7fff; text-decoration: underline; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; }
  td { border: 1pt solid #cbd5e1; padding: 6pt 8pt; }
  hr { border: none; border-top: 1pt solid #cbd5e1; margin: 16pt 0; }
  hr.page-break { page-break-after: always; border: none; height: 0; margin: 0; }
</style>
</head><body>${editorEl.innerHTML}</body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => { w.print(); }, 400);
}

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
   RIBBON execCommand BUTTONS
   ========================================================= */
ribbon.addEventListener('click', e => {
    const btn = e.target.closest('button[data-cmd]');
    if (!btn) return;
    if (e.defaultPrevented) return;
    document.execCommand(btn.dataset.cmd, false, btn.dataset.value || null);
    editorEl.focus();
});

/* =========================================================
   FONT CONTROLS
   ========================================================= */
function applyFontName(family) {
    if (family === 'default') { document.execCommand('removeFormat'); return; }
    document.execCommand('fontName', false, family);
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
    if (fam) fam.addEventListener('change', e => { applyFontName(e.target.value); scheduleSave(); editorEl.focus(); });
    if (size) size.addEventListener('change', e => { applyFontSize(parseInt(e.target.value, 10)); scheduleSave(); editorEl.focus(); });
}
bindFontControls('font-family', 'font-size');
bindFontControls('font-family-compact', 'font-size-compact');

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
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(command, false, color);
    updateColorSwatches(command, color);
    scheduleSave();
    editorEl.focus();
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
        mainBtn?.addEventListener('click', e => {
            e.stopPropagation();
            const current = picker.querySelector('.color-letter').style.borderBottomColor || '#1f2328';
            applyColor(command, current);
        });
        caret?.addEventListener('click', e => {
            e.stopPropagation();
            const wasHidden = menu.classList.contains('hidden');
            closeAllColorMenus();
            if (wasHidden) menu.classList.remove('hidden');
        });
        customBtn?.addEventListener('click', e => { e.stopPropagation(); native.click(); });
        native?.addEventListener('input', e => { applyColor(command, e.target.value); closeAllColorMenus(); });
        menu?.addEventListener('click', e => e.stopPropagation());
    });
    document.addEventListener('click', () => closeAllColorMenus());
}
initColorPickers();

/* =========================================================
   CLEAR / LINE HEIGHT / getSelectedBlocks
   ========================================================= */
document.getElementById('clear-format')?.addEventListener('click', () => {
    document.execCommand('removeFormat'); scheduleSave(); editorEl.focus();
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
document.getElementById('insert-link')?.addEventListener('click', () => {
    const sel = window.getSelection();
    const existing = sel.toString();
    const url = prompt('Enter URL (https://...)', 'https://');
    if (!url) return;
    if (existing) document.execCommand('createLink', false, url);
    else {
        const label = prompt('Link text?', url);
        if (!label) return;
        document.execCommand('insertHTML', false, `<a href="${url}" target="_blank" rel="noopener">${label}</a>`);
    }
    scheduleSave(); editorEl.focus();
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
                    width = IMAGE_MAX_WIDTH;
                    height = Math.round(height * ratio);
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
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
document.getElementById('insert-image')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        try {
            const compressed = await compressImage(file);
            const dataUrl = await blobToDataURL(compressed);
            document.execCommand('insertImage', false, dataUrl);
            scheduleSave(); editorEl.focus();
            const saved = Math.max(0, file.size - compressed.size);
            if (saved > 1024) showToast(`Image compressed — saved ${(saved / 1024).toFixed(0)} KB`);
        } catch (err) {
            console.error('Image compression failed:', err);
            const reader = new FileReader();
            reader.onload = () => {
                document.execCommand('insertImage', false, reader.result);
                scheduleSave(); editorEl.focus();
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
});
document.getElementById('insert-hr')?.addEventListener('click', () => {
    document.execCommand('insertHorizontalRule'); scheduleSave(); editorEl.focus();
});
document.getElementById('insert-table')?.addEventListener('click', () => {
    const rows = parseInt(prompt('Rows?', '3'), 10);
    const cols = parseInt(prompt('Columns?', '3'), 10);
    if (!rows || !cols || rows < 1 || cols < 1) return;
    let html = '<table><tbody>';
    for (let r = 0; r < rows; r++) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) html += '<td><br></td>';
        html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    document.execCommand('insertHTML', false, html);
    scheduleSave(); editorEl.focus();
});
document.getElementById('insert-shape')?.addEventListener('click', () => {
    const shape = prompt('Shape? (rect, circle, triangle)', 'rect');
    if (!shape) return;
    const svg = shape === 'circle'
        ? '<svg width="80" height="80"><circle cx="40" cy="40" r="38" fill="#2b7fff"/></svg>'
        : shape === 'triangle'
            ? '<svg width="80" height="80"><polygon points="40,4 76,76 4,76" fill="#2b7fff"/></svg>'
            : '<svg width="100" height="60"><rect width="100" height="60" fill="#2b7fff"/></svg>';
    document.execCommand('insertHTML', false, svg);
    scheduleSave(); editorEl.focus();
});
document.getElementById('insert-emoji')?.addEventListener('click', () => {
    const e = prompt('Type or paste an emoji:', '😀');
    if (!e) return;
    document.execCommand('insertText', false, e);
    scheduleSave(); editorEl.focus();
});
document.getElementById('insert-symbol')?.addEventListener('click', () => {
    const s = prompt('Type or paste a symbol:', '©');
    if (!s) return;
    document.execCommand('insertText', false, s);
    scheduleSave(); editorEl.focus();
});
document.getElementById('insert-date')?.addEventListener('click', () => {
    const formatted = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    document.execCommand('insertText', false, formatted);
    scheduleSave(); editorEl.focus();
});
document.getElementById('insert-pagebreak')?.addEventListener('click', () => {
    document.execCommand('insertHTML', false, '<hr class="page-break"><p><br></p>');
    scheduleSave(); editorEl.focus();
});

/* =========================================================
   TABLE CONTEXT MENU
   ========================================================= */
editorEl.addEventListener('contextmenu', e => {
    const cell = e.target.closest('td');
    if (!cell || !editorEl.contains(cell)) return;
    e.preventDefault();
    tableMenuTargetCell = cell;
    tableMenu.classList.remove('hidden');
    tableMenu.style.left = Math.min(e.clientX, window.innerWidth - 240) + 'px';
    tableMenu.style.top = Math.min(e.clientY, window.innerHeight - 300) + 'px';
});
tableMenu.addEventListener('click', e => {
    const btn = e.target.closest('button[data-table-action]');
    if (!btn || !tableMenuTargetCell) return;
    const action = btn.dataset.tableAction;
    const cell = tableMenuTargetCell;
    const row = cell.parentElement;
    const table = cell.closest('table');
    if (!row || !table) return;
    const idx = Array.from(row.children).indexOf(cell);
    const newCell = () => { const td = document.createElement('td'); td.innerHTML = '<br>'; return td; };
    switch (action) {
        case 'row-above': {
            const nr = row.cloneNode(false);
            for (let i = 0; i < row.children.length; i++) nr.appendChild(newCell());
            row.parentNode.insertBefore(nr, row);
            break;
        }
        case 'row-below': {
            const nr = row.cloneNode(false);
            for (let i = 0; i < row.children.length; i++) nr.appendChild(newCell());
            row.parentNode.insertBefore(nr, row.nextSibling);
            break;
        }
        case 'col-left': {
            Array.from(table.rows).forEach(r => {
                const ref = r.children[idx];
                if (ref) r.insertBefore(newCell(), ref);
            });
            break;
        }
        case 'col-right': {
            Array.from(table.rows).forEach(r => {
                const ref = r.children[idx];
                if (ref) r.insertBefore(newCell(), ref.nextSibling);
            });
            break;
        }
        case 'row-delete': row.remove(); break;
        case 'col-delete': Array.from(table.rows).forEach(r => r.children[idx]?.remove()); break;
        case 'table-delete': table.remove(); break;
    }
    tableMenu.classList.add('hidden');
    scheduleSave(); editorEl.focus();
});

/* =========================================================
   FIND BAR
   ========================================================= */
const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const findCount = document.getElementById('find-count');

document.getElementById('find-btn')?.addEventListener('click', () => {
    findBar.classList.toggle('hidden');
    if (!findBar.classList.contains('hidden')) findInput.focus();
});
document.getElementById('find-close')?.addEventListener('click', () => {
    findBar.classList.add('hidden');
    window.getSelection().removeAllRanges();
});
findInput?.addEventListener('input', () => {
    const q = findInput.value;
    if (!q) { findCount.textContent = ''; return; }
    const text = editorEl.innerText.toLowerCase();
    const lower = q.toLowerCase();
    let count = 0, i = 0;
    while ((i = text.indexOf(lower, i)) !== -1) { count++; i += lower.length; }
    findCount.textContent = `${count} match${count === 1 ? '' : 'es'}`;
    const sel = window.getSelection();
    sel.removeAllRanges();
    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        const idx = node.textContent.toLowerCase().indexOf(lower);
        if (idx !== -1) {
            const r = document.createRange();
            r.setStart(node, idx); r.setEnd(node, idx + q.length);
            sel.addRange(r);
            node.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
            break;
        }
    }
});

/* =========================================================
   WORD COUNT
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
document.getElementById('wordcount-btn')?.addEventListener('click', showWordCount);
document.getElementById('wordcount-btn-2')?.addEventListener('click', showWordCount);
document.addEventListener('click', e => {
    if (wcPopup.classList.contains('hidden')) return;
    if (!wcPopup.contains(e.target) && !e.target.closest('#wordcount-btn, #wordcount-btn-2')) wcPopup.classList.add('hidden');
});

/* =========================================================
   REVIEW STUBS
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
document.getElementById('comment-btn')?.addEventListener('click', () => {
    const text = prompt('Comment:');
    if (!text) return;
    document.execCommand('insertHTML', false,
        ` <span class="doc-comment" title="${text.replace(/"/g, '&quot;')}" style="background:#fff8b8;border-bottom:2px solid #f0c000;">[💬]</span> `);
    scheduleSave(); editorEl.focus();
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
    { name: 'Bold', icon: 'B', run: () => document.execCommand('bold') },
    { name: 'Italic', icon: 'I', run: () => document.execCommand('italic') },
    { name: 'Underline', icon: 'U', run: () => document.execCommand('underline') },
    { name: 'Strikethrough', icon: 'S', run: () => document.execCommand('strikeThrough') },
    { name: 'Heading 1', icon: 'H1', run: () => document.execCommand('formatBlock', false, 'H1') },
    { name: 'Heading 2', icon: 'H2', run: () => document.execCommand('formatBlock', false, 'H2') },
    { name: 'Heading 3', icon: 'H3', run: () => document.execCommand('formatBlock', false, 'H3') },
    { name: 'Normal', icon: '¶', run: () => document.execCommand('formatBlock', false, 'P') },
    { name: 'Quote', icon: '❝', run: () => document.execCommand('formatBlock', false, 'BLOCKQUOTE') },
    { name: 'Code Block', icon: '{ }', run: () => document.execCommand('formatBlock', false, 'PRE') },
    { name: 'Bullet List', icon: '•', run: () => document.execCommand('insertUnorderedList') },
    { name: 'Numbered List', icon: '1.', run: () => document.execCommand('insertOrderedList') },
    { name: 'Align Left', icon: '⬅', run: () => document.execCommand('justifyLeft') },
    { name: 'Align Center', icon: '↔', run: () => document.execCommand('justifyCenter') },
    { name: 'Align Right', icon: '➡', run: () => document.execCommand('justifyRight') },
    { name: 'Insert Link', icon: '🔗', run: () => document.getElementById('insert-link')?.click() },
    { name: 'Insert Image', icon: '🖼', run: () => document.getElementById('insert-image')?.click() },
    { name: 'Insert Table', icon: '▦', run: () => document.getElementById('insert-table')?.click() },
    { name: 'Insert Horizontal Rule', icon: '―', run: () => document.execCommand('insertHorizontalRule') },
    { name: 'Insert Page Break', icon: '⎯', run: () => document.getElementById('insert-pagebreak')?.click() },
    { name: 'Insert Date', icon: '📅', run: () => document.getElementById('insert-date')?.click() },
    { name: 'Insert Emoji', icon: '😀', run: () => document.getElementById('insert-emoji')?.click() },
    { name: 'Find in document', icon: '🔍', run: () => { findBar.classList.remove('hidden'); findInput.focus(); } },
    { name: 'Word Count', icon: '#', run: showWordCount },
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
    const keepFocus = ['Save', 'Save As…', 'Back to Documents', 'New Document', 'Print / Save as PDF', 'Import File', 'Install App', 'Toggle Dark Mode', 'Search Documents'].includes(cmd.name);
    if (!keepFocus) editorEl.focus();
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
   TOOLBAR ACTIVE STATE
   ========================================================= */
function updateToolbarState() {
    ['bold', 'italic', 'underline', 'strikeThrough', 'superscript', 'subscript',
        'insertUnorderedList', 'insertOrderedList',
        'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'].forEach(cmd => {
            document.querySelectorAll(`[data-cmd="${cmd}"]`).forEach(btn => {
                try { btn.classList.toggle('active', document.queryCommandState(cmd)); } catch (_) { }
            });
        });
}
document.addEventListener('selectionchange', () => {
    if (!editorView.classList.contains('hidden')) updateToolbarState();
});

/* =========================================================
   GLOBAL KEYBOARD SHORTCUTS — capture phase, works everywhere
   ========================================================= */
document.addEventListener('keydown', e => {
    // Don't interfere when focus is in a text input / select / modal
    const target = e.target;
    const isTextInput = target && (
        (target.tagName === 'INPUT' && target.type !== 'color') ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
    );
    const inModal = target && target.closest && target.closest('#save-as-modal');
    if (isTextInput && !inModal) return;

    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (!mod) return;

    // Ctrl+Shift combos first
    if (e.shiftKey) {
        if (key === 'p') { e.preventDefault(); e.stopPropagation(); openPalette(); return; }
        if (key === 'd') { e.preventDefault(); e.stopPropagation(); toggleTheme(); return; }
        if (key === 's') { e.preventDefault(); e.stopPropagation(); openSaveAsModal(); return; }
        if (key === 'o') { e.preventDefault(); e.stopPropagation(); pickAndImport(); return; }
        return;
    }

    // Plain Ctrl combos
    switch (key) {
        case 's':
            e.preventDefault(); e.stopPropagation(); saveNow(); return;
        case 'b':
            e.preventDefault(); e.stopPropagation();
            document.execCommand('bold');
            updateToolbarState();
            return;
        case 'i':
            e.preventDefault(); e.stopPropagation();
            document.execCommand('italic');
            updateToolbarState();
            return;
        case 'u':
            e.preventDefault(); e.stopPropagation();
            document.execCommand('underline');
            updateToolbarState();
            return;
        case 'k':
            e.preventDefault(); e.stopPropagation();
            document.getElementById('insert-link')?.click();
            return;
        case 'p':
            e.preventDefault(); e.stopPropagation();
            printDoc();
            return;
        case 'f':
            e.preventDefault(); e.stopPropagation();
            if (editorView.classList.contains('hidden')) {
                searchInput?.focus();
            } else {
                findBar.classList.remove('hidden');
                findInput.focus();
            }
            return;
        case 'a':
            // Only intercept Ctrl+A inside the editor — let the browser handle it elsewhere
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
}, true);  // ← capture phase — this is the critical part

// Also intercept the browser's own "save page" hotkey when it fires
window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
    }
}, true);

/* =========================================================
   PASTE AS PLAIN TEXT
   ========================================================= */
editorEl.addEventListener('paste', e => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
});

/* =========================================================
   EVENTS
   ========================================================= */
newDocBtn.addEventListener('click', createDoc);
backBtn.addEventListener('click', async () => { await saveNow(); showList(); });
titleInput.addEventListener('input', scheduleSave);
editorEl.addEventListener('input', scheduleSave);

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