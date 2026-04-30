// ChickenNote Local · single-file frontend
// State: currentProject, tree, openFile, mode

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = {
  projects: [],
  currentProjectId: null,
  tree: null,
  filter: '',
  openPath: null,
  openMtime: null,
  openContent: '',
  dirty: false,
  mode: 'split',  // edit | preview | split
  expanded: new Set([''])  // expanded dir paths
};

// ---------------- API ----------------
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({ ok: false, error: 'bad json' }));
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---------------- Project ----------------
async function loadProjects() {
  const j = await api('GET', '/api/projects');
  state.projects = j.projects;
  const sel = $('#projectSelect');
  sel.innerHTML = '';
  for (const p of state.projects) {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    sel.appendChild(o);
  }
  // auto-select last or first
  const last = localStorage.getItem('cn_last_project');
  if (last && state.projects.find(p => p.id === last)) {
    sel.value = last;
    state.currentProjectId = last;
  } else if (state.projects.length) {
    state.currentProjectId = state.projects[0].id;
    sel.value = state.currentProjectId;
  }
  if (state.currentProjectId) await loadTree();
}

async function loadTree() {
  if (!state.currentProjectId) return;
  setStatus('刷新中…');
  try {
    const j = await api('GET', `/api/projects/${state.currentProjectId}/tree`);
    state.tree = j.tree;
    renderTree();
    const proj = state.projects.find(p => p.id === state.currentProjectId);
    $('#projMeta').textContent = proj ? proj.path : '';
    setStatus(`刷新于 ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    setStatus('加载失败: ' + e.message, true);
  }
}

// ---------------- Tree render ----------------
function renderTree() {
  const pane = $('#treePane');
  pane.innerHTML = '';
  if (!state.tree) return;
  for (const child of state.tree.children || []) {
    pane.appendChild(renderNode(child, 0));
  }
}

function fileMatches(name) {
  if (!state.filter) return true;
  return name.toLowerCase().includes(state.filter.toLowerCase());
}

function renderNode(node, depth) {
  const wrap = document.createElement('div');
  wrap.className = 'tree-item';
  if (node.type === 'dir') {
    const expanded = state.expanded.has(node.path);
    // Determine if any descendant matches filter
    const hasMatch = state.filter ? subtreeHasMatch(node) : true;
    if (!hasMatch) return document.createDocumentFragment();
    const row = document.createElement('div');
    row.className = 'tree-row flex items-center gap-1 px-2 py-1 cursor-pointer text-slate-700';
    row.style.paddingLeft = (depth * 12 + 6) + 'px';
    row.innerHTML = `
      <svg class="w-3 h-3 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
      <svg class="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 24 24"><path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z"/></svg>
      <span class="truncate">${escapeHtml(node.name)}</span>
    `;
    row.addEventListener('click', () => {
      if (state.expanded.has(node.path)) state.expanded.delete(node.path);
      else state.expanded.add(node.path);
      renderTree();
    });
    wrap.appendChild(row);
    if (expanded || state.filter) {
      const kids = document.createElement('div');
      for (const c of node.children) kids.appendChild(renderNode(c, depth + 1));
      wrap.appendChild(kids);
    }
  } else {
    if (!fileMatches(node.name)) return document.createDocumentFragment();
    if (state.openPath === node.path) wrap.classList.add('active');
    const row = document.createElement('div');
    row.className = 'tree-row flex items-center gap-1.5 px-2 py-1 cursor-pointer text-slate-600';
    row.style.paddingLeft = (depth * 12 + 18) + 'px';
    row.innerHTML = `
      ${fileIcon(node.ext)}
      <span class="truncate flex-1">${escapeHtml(node.name)}</span>
    `;
    row.addEventListener('click', () => openFile(node.path));
    wrap.appendChild(row);
  }
  return wrap;
}

function subtreeHasMatch(node) {
  if (node.type === 'file') return fileMatches(node.name);
  for (const c of node.children) if (subtreeHasMatch(c)) return true;
  return false;
}

function fileIcon(ext) {
  const map = {
    '.md': 'text-blue-500', '.markdown': 'text-blue-500', '.txt': 'text-slate-500',
    '.csv': 'text-emerald-600', '.json': 'text-yellow-600',
    '.py': 'text-cyan-600', '.sh': 'text-slate-500', '.js': 'text-yellow-500', '.ts': 'text-blue-600',
    '.yml': 'text-rose-500', '.yaml': 'text-rose-500'
  };
  const cls = map[ext] || 'text-slate-400';
  return `<svg class="w-3.5 h-3.5 ${cls}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---------------- File open ----------------
async function openFile(path) {
  if (state.dirty) {
    if (!confirm('当前文件有未保存的修改，切换会丢弃。继续？')) return;
  }
  setStatus('加载中…');
  try {
    const j = await api('GET', `/api/projects/${state.currentProjectId}/file?path=${encodeURIComponent(path)}`);
    state.openPath = path;
    state.openMtime = j.mtime;
    state.openContent = j.content;
    state.dirty = false;
    $('#currentPath').textContent = path;
    $('#deleteBtn').classList.remove('hidden');
    $('#emptyState').classList.add('hidden');

    if (j.editable) {
      $('#modeToggle').classList.remove('hidden');
      $('#modeToggle').classList.add('flex');
      $('#saveBtn').classList.remove('hidden');
      showEditor(j.content);
      applyMode(state.mode);
    } else {
      $('#modeToggle').classList.add('hidden');
      $('#modeToggle').classList.remove('flex');
      $('#saveBtn').classList.add('hidden');
      showReadonly(j);
    }
    renderTree();
    setStatus('已加载');
  } catch (e) {
    setStatus('打开失败: ' + e.message, true);
  }
}

function showEditor(text) {
  $('#splitContainer').classList.remove('hidden');
  $('#splitContainer').classList.add('flex');
  $('#readonlyPane').classList.add('hidden');
  $('#editorTA').value = text;
  updatePreview();
}

function showReadonly(j) {
  $('#splitContainer').classList.add('hidden');
  $('#splitContainer').classList.remove('flex');
  const pane = $('#readonlyPane');
  pane.classList.remove('hidden');
  if (j.ext === '.csv' && j.csv) {
    pane.innerHTML = renderCsvTable(j.csv);
  } else if (j.ext === '.json' && j.json !== undefined) {
    pane.innerHTML = `<pre class="mono text-xs p-4 bg-slate-50 m-0 whitespace-pre overflow-auto">${escapeHtml(JSON.stringify(j.json, null, 2))}</pre>`;
  } else {
    pane.innerHTML = `<pre class="mono text-xs p-4 bg-slate-50 m-0 whitespace-pre overflow-auto">${escapeHtml(j.content)}</pre>`;
  }
}

function renderCsvTable(csv) {
  const rows = csv.rows || [];
  if (!rows.length) return '<div class="p-8 text-slate-400">空表</div>';
  const head = rows[0];
  const body = rows.slice(1);
  let html = '<div class="overflow-auto p-3"><table class="text-xs border-collapse w-full"><thead><tr>';
  for (const c of head) html += `<th class="border border-slate-300 px-2 py-1 bg-slate-100 text-left font-semibold">${escapeHtml(c)}</th>`;
  html += '</tr></thead><tbody>';
  for (const row of body) {
    html += '<tr>';
    for (const c of row) html += `<td class="border border-slate-200 px-2 py-1 align-top">${escapeHtml(c)}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  if (csv.truncated) html += '<div class="px-3 pb-3 text-xs text-amber-600">（已截断到 500 行）</div>';
  return html;
}

function updatePreview() {
  const ta = $('#editorTA');
  const pv = $('#previewPane');
  if (!ta || !pv) return;
  pv.innerHTML = marked.parse(ta.value || '');
}

function applyMode(mode) {
  state.mode = mode;
  $$('#modeToggle button').forEach(b => {
    if (b.dataset.mode === mode) {
      b.classList.add('bg-white', 'shadow-sm');
      b.classList.remove('text-slate-600');
      b.classList.add('text-slate-800');
    } else {
      b.classList.remove('bg-white', 'shadow-sm', 'text-slate-800');
      b.classList.add('text-slate-600');
    }
  });
  const ta = $('#editorTA');
  const pv = $('#previewPane');
  if (mode === 'edit') {
    ta.classList.remove('hidden'); pv.classList.add('hidden');
    ta.style.width = '100%'; ta.style.borderRight = 'none';
  } else if (mode === 'preview') {
    ta.classList.add('hidden'); pv.classList.remove('hidden');
    pv.style.width = '100%';
  } else { // split
    ta.classList.remove('hidden'); pv.classList.remove('hidden');
    ta.style.width = '50%'; ta.style.borderRight = '1px solid #f1f5f9';
    pv.style.width = '50%';
  }
}

// ---------------- Save ----------------
let saveTimer = null;
async function doSave() {
  if (!state.openPath) return;
  const content = $('#editorTA').value;
  $('#saveStatus').textContent = '保存中…';
  try {
    const j = await api('PUT', `/api/projects/${state.currentProjectId}/file`, {
      path: state.openPath,
      content,
      expected_mtime: state.openMtime
    });
    state.openMtime = j.mtime;
    state.openContent = content;
    state.dirty = false;
    $('#saveStatus').textContent = '已保存 ' + new Date().toLocaleTimeString();
    if (j.conflict) {
      $('#saveStatus').textContent = '⚠ 已覆盖外部修改';
    }
    // refresh tree mtime quietly
    loadTreeQuiet();
  } catch (e) {
    $('#saveStatus').textContent = '保存失败: ' + e.message;
  }
}

async function loadTreeQuiet() {
  try {
    const j = await api('GET', `/api/projects/${state.currentProjectId}/tree`);
    state.tree = j.tree;
    renderTree();
  } catch {}
}

// ---------------- New file ----------------
async function newFile() {
  const name = prompt('新文件名（含扩展名，如 notes.md，可带相对子目录）');
  if (!name) return;
  let path = name.trim();
  if (!/\.(md|markdown|txt)$/i.test(path)) path += '.md';
  try {
    await api('POST', `/api/projects/${state.currentProjectId}/file/create`, { path });
    await loadTree();
    await openFile(path);
  } catch (e) { alert('创建失败: ' + e.message); }
}

// ---------------- Delete ----------------
async function deleteCurrent() {
  if (!state.openPath) return;
  if (!confirm(`确认删除 ${state.openPath}？\n（移动到项目内 .trash/ 目录，不会真删）`)) return;
  try {
    await api('DELETE', `/api/projects/${state.currentProjectId}/file?path=${encodeURIComponent(state.openPath)}`);
    state.openPath = null;
    $('#currentPath').textContent = '未打开文件';
    $('#deleteBtn').classList.add('hidden');
    $('#saveBtn').classList.add('hidden');
    $('#modeToggle').classList.add('hidden');
    $('#splitContainer').classList.add('hidden');
    $('#readonlyPane').classList.add('hidden');
    $('#emptyState').classList.remove('hidden');
    await loadTree();
  } catch (e) { alert('删除失败: ' + e.message); }
}

// ---------------- Status / poll ----------------
function setStatus(msg, isErr) {
  const el = $('#statusIndicator');
  el.textContent = msg || '';
  el.className = 'text-xs min-w-[90px] text-right ' + (isErr ? 'text-red-500' : 'text-slate-400');
}

let lastPollAt = 0;
async function pollChanges() {
  if (!state.currentProjectId) return;
  try {
    const since = lastPollAt || Date.now() - 60000;
    const j = await api('GET', `/api/projects/${state.currentProjectId}/changes?since=${since}`);
    lastPollAt = j.now;
    if (j.changes && j.changes.length) {
      // refresh tree silently
      const j2 = await api('GET', `/api/projects/${state.currentProjectId}/tree`);
      state.tree = j2.tree;
      renderTree();
      // if currently open file changed externally and not dirty -> reload
      const cur = j.changes.find(c => c.path === state.openPath);
      if (cur && !state.dirty && cur.mtime > (state.openMtime || 0)) {
        const proj = state.currentProjectId;
        const path = state.openPath;
        const r = await api('GET', `/api/projects/${proj}/file?path=${encodeURIComponent(path)}`);
        state.openMtime = r.mtime;
        state.openContent = r.content;
        if (r.editable) { $('#editorTA').value = r.content; updatePreview(); }
        setStatus('外部更新已同步');
      }
    }
  } catch {}
}

// ---------------- Wire ----------------
function wire() {
  $('#projectSelect').addEventListener('change', async (e) => {
    state.currentProjectId = e.target.value;
    localStorage.setItem('cn_last_project', state.currentProjectId);
    state.openPath = null;
    state.expanded = new Set(['']);
    $('#emptyState').classList.remove('hidden');
    $('#splitContainer').classList.add('hidden');
    $('#readonlyPane').classList.add('hidden');
    $('#deleteBtn').classList.add('hidden');
    $('#saveBtn').classList.add('hidden');
    $('#modeToggle').classList.add('hidden');
    $('#currentPath').textContent = '未打开文件';
    await loadTree();
  });

  $('#refreshBtn').addEventListener('click', loadTree);

  $('#filterInput').addEventListener('input', (e) => {
    state.filter = e.target.value;
    renderTree();
  });

  $('#newFileBtn').addEventListener('click', newFile);
  $('#deleteBtn').addEventListener('click', deleteCurrent);
  $('#saveBtn').addEventListener('click', doSave);

  $('#editorTA').addEventListener('input', () => {
    state.dirty = true;
    $('#saveStatus').textContent = '未保存';
    if (state.mode !== 'edit') updatePreview();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 1500); // autosave 1.5s after stop
  });

  $$('#modeToggle button').forEach(b => {
    b.addEventListener('click', () => applyMode(b.dataset.mode));
  });

  // Add project modal
  $('#addProjectBtn').addEventListener('click', () => {
    $('#addProjModal').classList.remove('hidden');
    $('#addProjModal').classList.add('flex');
    $('#addProjPath').focus();
  });
  $('#addProjCancel').addEventListener('click', closeAddProj);
  $('#addProjOk').addEventListener('click', async () => {
    const path = $('#addProjPath').value.trim();
    const name = $('#addProjName').value.trim();
    if (!path) return;
    try {
      const j = await api('POST', '/api/projects', { path, name });
      closeAddProj();
      state.currentProjectId = j.project.id;
      localStorage.setItem('cn_last_project', state.currentProjectId);
      await loadProjects();
      $('#projectSelect').value = state.currentProjectId;
    } catch (e) { alert('添加失败: ' + e.message); }
  });

  // Hotkeys
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (state.openPath) doSave();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'r' && !e.shiftKey) {
      e.preventDefault();
      loadTree();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function closeAddProj() {
  $('#addProjModal').classList.add('hidden');
  $('#addProjModal').classList.remove('flex');
  $('#addProjPath').value = '';
  $('#addProjName').value = '';
}

// Boot
(async function init() {
  marked.setOptions({ breaks: true, gfm: true });
  wire();
  await loadProjects();
  setInterval(pollChanges, 5000);
})();
