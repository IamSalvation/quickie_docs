/* =========================================================
   Quickie Docs — Phase 3
   Dark mode · Image compression · Better tables · Cross-doc search
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
const downloadBtn = document.getElementById('download-btn');
const saveStatus = document.getElementById('save-status');
const ribbon = document.getElementById('ribbon');
const compactTB = document.getElementById('compact-toolbar');
const toastEl = document.getElementById('toast');
const tableMenu = document.getElementById('table-menu');
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
const themeLabel = document.getElementById('theme-label');

// ---------- State ----------
let currentDoc = null;
let saveTimer = null;
let compactMode = false;
let previewMode = false;
let toastTimer = null;
let currentSearch = '';
let tableMenuTargetCell = null;

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
   THEME (dark mode)
   ========================================================= */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeIcon) themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (themeLabel) themeLabel.textContent = theme === 'dark' ? 'Light' : 'Dark';
    // Update theme-color meta for the browser UI
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

// Follow system preference changes if user hasn't manually chosen
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('quickie-theme')) {
        applyTheme(e.matches ? 'dark' : 'light');
    }
});

// Initial sync
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
   PWA — Install prompt
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
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log('[PWA] Install outcome:', outcome);
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

        // Show a snippet if searching and there's a content match
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

// Search wiring
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
   SAVE / DOWNLOAD
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

function downloadAsHTML() {
    if (!currentDoc) return;
    const title = (titleInput.value.trim() || 'Untitled').replace(/[^\w\-]+/g, '_');
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${titleInput.value}</title>
<style>body{font-family:sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;}</style>
</head><body>${editorEl.innerHTML}</body></html>`;
    saveBlob(new Blob([html], { type: 'text/html' }), title + '.html');
}

function downloadAsDOCX() {
    if (!currentDoc) return;
    if (typeof window.htmlDocx === 'undefined') {
        alert('DOCX library not loaded (offline?). Falling back to HTML.');
        return downloadAsHTML();
    }
    const title = (titleInput.value.trim() || 'Untitled').replace(/[^\w\-]+/g, '_');
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${titleInput.value}</title>
<style>
  body { font-family: Calibri, sans-serif; font-size: 11pt; line-height: 1.5; }
  h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 13pt; }
  blockquote { border-left: 3px solid #2b7fff; padding-left: 10px; color: #555; }
  table { border-collapse: collapse; width: 100%; }
  td { border: 1px solid #ccc; padding: 6px; }
</style>
</head><body>${editorEl.innerHTML}</body></html>`;

    try {
        const blob = window.htmlDocx.asBlob(html, {
            orientation: 'portrait',
            margins: { top: 720, right: 720, bottom: 720, left: 720 }
        });
        saveBlob(blob, title + '.docx');
    } catch (err) {
        console.error('DOCX export failed:', err);
        alert('DOCX export failed. Downloading as HTML instead.');
        downloadAsHTML();
    }
}

/* =========================================================
   IMPORT — router
   ========================================================= */
function pickAndImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx,.html,.htm,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html,text/plain,text/markdown';
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
            alert('Unsupported file type: .' + ext + '\n\nSupported: .docx, .html, .htm, .txt, .md');
    }
}

function importDOCX(file) {
    if (typeof window.mammoth === 'undefined') {
        alert('DOCX import library not loaded (offline?). Try again when online.');
        return;
    }
    const reader = new FileReader();
    reader.onload = async e => {
        try {
            const result = await window.mammoth.convertToHtml(
                { arrayBuffer: e.target.result },
                {
                    styleMap: [
                        "p[style-name='Title'] => h1.doc-title",
                        "p[style-name='Subtitle'] => h2.doc-subtitle",
                        "p[style-name='Quote'] => blockquote",
                        "p[style-name='Intense Quote'] => blockquote",
                        "p[style-name='Code'] => pre",
                    ],
                    convertImage: window.mammoth.images.imgElement(img => {
                        return img.read('base64').then(b64 => ({
                            src: 'data:' + img.contentType + ';base64,' + b64
                        }));
                    })
                }
            );
            const html = result.value || '<p></p>';
            await createImportedDoc(file.name, html);
            if (result.messages?.length) {
                showToast(`Imported with ${result.messages.length} warning(s). Some formatting may be lost.`);
            }
        } catch (err) {
            console.error('DOCX import failed:', err);
            alert('Failed to import DOCX. The file may be corrupted or use unsupported features.');
        }
    };
    reader.readAsArrayBuffer(file);
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
        const html = text
            .split(/\n{2,}/)
            .map(p => `<p>${escapeHTML(p).replace(/\n/g, '<br>')}</p>`)
            .join('') || '<p></p>';
        await createImportedDoc(file.name, html);
        showToast('TXT imported as plain paragraphs. Formatting is minimal by nature.');
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

    html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre>${code.trim()}</pre>`);
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

    html = html.replace(/(?:^|\n)((?:[-*+] .*(?:\n|$))+)/g, (match, block) => {
        const items = block.trim().split(/\n/)
            .map(line => line.replace(/^[-*+] /, '').trim())
            .filter(Boolean)
            .map(t => `<li>${t}</li>`).join('');
        return `\n<ul>${items}</ul>\n`;
    });
    html = html.replace(/(?:^|\n)((?:\d+\. .*(?:\n|$))+)/g, (match, block) => {
        const items = block.trim().split(/\n/)
            .map(line => line.replace(/^\d+\. /, '').trim())
            .filter(Boolean)
            .map(t => `<li>${t}</li>`).join('');
        return `\n<ol>${items}</ol>\n`;
    });

    const blocks = html.split(/\n{2,}/).map(b => {
        const trimmed = b.trim();
        if (!trimmed) return '';
        if (/^<(h[1-6]|ul|ol|pre|blockquote|hr|p|table)/i.test(trimmed)) return trimmed;
        return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    });

    return blocks.join('\n') || '<p></p>';
}

function escapeHTML(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function createImportedDoc(filename, html) {
    const now = Date.now();
    const baseName = filename.replace(/\.[^.]+$/, '').slice(0, 60) || 'Imported';
    const doc = {
        id: uid(),
        title: baseName,
        content: html || '<p></p>',
        createdAt: now,
        updatedAt: now
    };
    await dbPut(doc);
    await openDoc(doc.id);
    flashStatus('Imported ✓');
}

importBtn?.addEventListener('click', pickAndImport);

['dragenter', 'dragover'].forEach(ev => {
    docList.addEventListener(ev, e => {
        e.preventDefault();
        docList.classList.add('drag-over');
    });
});
['dragleave', 'drop'].forEach(ev => {
    docList.addEventListener(ev, e => {
        e.preventDefault();
        docList.classList.remove('drag-over');
    });
});
docList.addEventListener('drop', e => {
    const file = e.dataTransfer.files?.[0];
    if (file) importFile(file);
});

/* =========================================================
   PRINT / SAVE AS PDF
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
  h4 { font-size: 12pt; margin: 12pt 0 4pt; page-break-after: avoid; }
  p  { margin: 0 0 10pt; orphans: 3; widows: 3; }
  ul, ol { margin: 0 0 10pt 22pt; padding: 0; }
  li { margin-bottom: 4pt; }
  blockquote { border-left: 3pt solid #2b7fff; padding: 0 0 0 12pt; margin: 12pt 0; color: #4a5568; font-style: italic; page-break-inside: avoid; }
  pre { background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 4pt; padding: 10pt 12pt; margin: 12pt 0; font-family: 'Courier New', monospace; font-size: 10pt; white-space: pre-wrap; page-break-inside: avoid; }
  a { color: #2b7fff; text-decoration: underline; }
  img { max-width: 100%; height: auto; page-break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 12pt 0; page-break-inside: avoid; }
  td { border: 1pt solid #cbd5e1; padding: 6pt 8pt; vertical-align: top; }
  hr { border: none; border-top: 1pt solid #cbd5e1; margin: 16pt 0; }
  hr.page-break { page-break-after: always; border: none; height: 0; margin: 0; }
  .doc-comment { background: #fff8b8; border-bottom: 2pt solid #f0c000; }
</style>
</head>
<body>${editorEl.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
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
        document.querySelector(`.ribbon-panel[data-panel="${tab.dataset.tab}"]`)
            ?.classList.add('active');
        requestAnimationFrame(updateCollapse);
    });
});

/* =========================================================
   GENERIC execCommand
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
    if (family === 'default') {
        document.execCommand('removeFormat');
        return;
    }
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
    if (fam) fam.addEventListener('change', e => {
        applyFontName(e.target.value);
        scheduleSave(); editorEl.focus();
    });
    if (size) size.addEventListener('change', e => {
        applyFontSize(parseInt(e.target.value, 10));
        scheduleSave(); editorEl.focus();
    });
}
bindFontControls('font-family', 'font-size');
bindFontControls('font-family-compact', 'font-size-compact');

/* =========================================================
   COLOR PICKERS
   ========================================================= */
const PRESET_TEXT_COLORS = [
    '#000000', '#1f2328', '#6b7280', '#9ca3af', '#d1d5db',
    '#dc2626', '#ea580c', '#eab308', '#16a34a', '#0891b2',
    '#2563eb', '#2b7fff', '#7c3aed', '#db2777', '#f472b6',
    '#92400e', '#0f766e', '#1e3a8a', '#701a75', '#ffffff'
];
const PRESET_HIGHLIGHT_COLORS = [
    '#ffff00', '#fef08a', '#fde047', '#bbf7d0', '#86efac',
    '#a5f3fc', '#bae6fd', '#c7d2fe', '#e9d5ff', '#fbcfe8',
    '#fecaca', '#fed7aa', '#fef3c7', '#dcfce7', '#dbeafe',
    '#e0e7ff', '#f3e8ff', '#fce7f3', '#ffe4e6', '#ffffff'
];

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
        command === 'foreColor'
            ? '.color-picker[data-color-target="foreColor"]'
            : '.color-picker[data-color-target="hiliteColor"]'
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
        customBtn?.addEventListener('click', e => {
            e.stopPropagation();
            native.click();
        });
        native?.addEventListener('input', e => {
            applyColor(command, e.target.value);
            closeAllColorMenus();
        });
        menu?.addEventListener('click', e => e.stopPropagation());
    });
    document.addEventListener('click', () => closeAllColorMenus());
}
initColorPickers();

/* =========================================================
   CLEAR / LINE HEIGHT
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
        if (node.nodeType === 1 && /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE)$/.test(node.tagName))
            blocks.add(node);
        node = node.parentNode;
    }
    if (!blocks.size) blocks.add(editorEl);
    return [...blocks];
}

/* =========================================================
   IMAGE COMPRESSION
   ========================================================= */
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
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Choose output format: keep PNG for transparent images, else JPEG
                const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
                const quality = type === 'image/jpeg' ? IMAGE_QUALITY : undefined;

                canvas.toBlob(blob => {
                    if (!blob) return reject(new Error('Canvas encode failed'));
                    // If compression made it bigger, keep the original
                    if (blob.size > file.size) resolve(file);
                    else resolve(blob);
                }, type, quality);
            };
            img.onerror = reject;
            img.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
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
            scheduleSave();
            editorEl.focus();
            const saved = Math.max(0, file.size - compressed.size);
            if (saved > 1024) {
                showToast(`Image compressed — saved ${(saved / 1024).toFixed(0)} KB`);
            }
        } catch (err) {
            console.error('Image compression failed:', err);
            // Fallback: insert original
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
        document.execCommand('insertHTML', false,
            `<a href="${url}" target="_blank" rel="noopener">${label}</a>`);
    }
    scheduleSave(); editorEl.focus();
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
    const emoji = prompt('Type or paste an emoji:', '😀');
    if (!emoji) return;
    document.execCommand('insertText', false, emoji);
    scheduleSave(); editorEl.focus();
});
document.getElementById('insert-symbol')?.addEventListener('click', () => {
    const sym = prompt('Type or paste a symbol (©, →, √, π, …):', '©');
    if (!sym) return;
    document.execCommand('insertText', false, sym);
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
    // Position near cursor
    const x = Math.min(e.clientX, window.innerWidth - 240);
    const y = Math.min(e.clientY, window.innerHeight - 300);
    tableMenu.style.left = x + 'px';
    tableMenu.style.top = y + 'px';
});

tableMenu.addEventListener('click', e => {
    const btn = e.target.closest('button[data-table-action]');
    if (!btn || !tableMenuTargetCell) return;
    const action = btn.dataset.tableAction;
    const cell = tableMenuTargetCell;
    const row = cell.parentElement;
    const table = cell.closest('table');
    if (!row || !table) return;

    const cellIndex = Array.from(row.children).indexOf(cell);

    switch (action) {
        case 'row-above': {
            const newRow = row.cloneNode(false);
            const cols = row.children.length;
            for (let i = 0; i < cols; i++) {
                const td = document.createElement('td');
                td.innerHTML = '<br>';
                newRow.appendChild(td);
            }
            row.parentNode.insertBefore(newRow, row);
            break;
        }
        case 'row-below': {
            const newRow = row.cloneNode(false);
            const cols = row.children.length;
            for (let i = 0; i < cols; i++) {
                const td = document.createElement('td');
                td.innerHTML = '<br>';
                newRow.appendChild(td);
            }
            row.parentNode.insertBefore(newRow, row.nextSibling);
            break;
        }
        case 'col-left': {
            Array.from(table.rows).forEach(r => {
                const td = document.createElement('td');
                td.innerHTML = '<br>';
                const ref = r.children[cellIndex];
                if (ref) r.insertBefore(td, ref);
            });
            break;
        }
        case 'col-right': {
            Array.from(table.rows).forEach(r => {
                const td = document.createElement('td');
                td.innerHTML = '<br>';
                const ref = r.children[cellIndex];
                if (ref) r.insertBefore(td, ref.nextSibling);
            });
            break;
        }
        case 'row-delete': {
            row.remove();
            break;
        }
        case 'col-delete': {
            Array.from(table.rows).forEach(r => {
                if (r.children[cellIndex]) r.children[cellIndex].remove();
            });
            break;
        }
        case 'table-delete': {
            table.remove();
            break;
        }
    }
    tableMenu.classList.add('hidden');
    scheduleSave();
    editorEl.focus();
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
    if (!wcPopup.contains(e.target) && !e.target.closest('#wordcount-btn, #wordcount-btn-2'))
        wcPopup.classList.add('hidden');
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
    if (action === 'import') pickAndImport();
    if (action === 'download-html') downloadAsHTML();
    if (action === 'download-docx') downloadAsDOCX();
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
    { name: 'Import File', icon: '📂', run: pickAndImport },
    { name: 'Download as DOCX', icon: '📝', run: downloadAsDOCX },
    { name: 'Export HTML (backup)', icon: '⬇', run: downloadAsHTML },
    { name: 'New Document', icon: '📄', run: createDoc },
    { name: 'Back to Documents', icon: '←', run: () => saveNow().then(showList) },
    {
        name: 'Search Documents', icon: '🔎', run: () => {
            if (!editorView.classList.contains('hidden')) {
                saveNow().then(() => { showList(); searchInput.focus(); });
            } else {
                searchInput.focus();
            }
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
        li.addEventListener('click', () => { runPaletteSelection(); });
        paletteList.appendChild(li);
    });
}
function updatePaletteSelection() {
    [...paletteList.children].forEach((li, i) =>
        li.classList.toggle('selected', i === paletteSelection));
}
function runPaletteSelection() {
    const cmd = paletteFiltered[paletteSelection];
    if (!cmd) return;
    closePalette();
    cmd.run();
    const keepFocus = ['Save', 'Download as DOCX', 'Export HTML (backup)', 'Back to Documents', 'New Document', 'Print / Save as PDF', 'Import File', 'Install App', 'Toggle Dark Mode', 'Search Documents'].includes(cmd.name);
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
    } else if (e.key === 'Escape') {
        closePalette();
    }
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
   EVENTS / SHORTCUTS
   ========================================================= */
newDocBtn.addEventListener('click', createDoc);
backBtn.addEventListener('click', async () => { await saveNow(); showList(); });
downloadBtn.addEventListener('click', downloadAsDOCX);
titleInput.addEventListener('input', scheduleSave);
editorEl.addEventListener('input', scheduleSave);

document.addEventListener('keydown', e => {
    if (editorView.classList.contains('hidden')) {
        // Allow Ctrl+F search from list view
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            searchInput?.focus();
        }
        return;
    }
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); openPalette(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); toggleTheme(); return; }
    if (mod && e.key === 'p') { e.preventDefault(); printDoc(); }
    if (mod && e.key === 's') { e.preventDefault(); saveNow(); }
    if (mod && e.key === 'b') { e.preventDefault(); document.execCommand('bold'); }
    if (mod && e.key === 'i') { e.preventDefault(); document.execCommand('italic'); }
    if (mod && e.key === 'u') { e.preventDefault(); document.execCommand('underline'); }
    if (mod && e.key === 'k') { e.preventDefault(); document.getElementById('insert-link')?.click(); }
    if (mod && e.key === 'f') { e.preventDefault(); findBar.classList.remove('hidden'); findInput.focus(); }
    if (mod && e.key === 'o' && e.shiftKey) { e.preventDefault(); pickAndImport(); }
});

editorEl.addEventListener('paste', e => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
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
})();