// js/notes.js - 笔记列表与操作

function renderNoteList() {
    const container = document.getElementById('noteListContainer');
    const batchActions = document.getElementById('batchActions');
    batchActions.classList.toggle('hidden', state.selectedNotes.size === 0);

    container.innerHTML = state.notes.map(note => {
        const isSelected = state.selectedNotes.has(note.id);
        const isActive = note.id === state.currentNoteId;
        const date = new Date(note.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

        return `
            <div class="group relative flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all ${isActive ? 'bg-blue-50 border border-blue-100' : 'hover:bg-slate-50 border border-transparent'} ${isSelected ? 'ring-2 ring-blue-400' : ''}"
                 onclick="handleNoteClick('${note.id}', event)">
                <label class="checkbox-wrapper flex items-center cursor-pointer" onclick="event.stopPropagation()">
                    <input type="checkbox" class="hidden" ${isSelected ? 'checked' : ''} onchange="toggleNoteSelection('${note.id}')">
                    <div class="w-4 h-4 border-2 border-slate-300 rounded flex items-center justify-center transition-colors hover:border-blue-400">
                        <svg class="w-3 h-3 text-white hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                </label>
                <div class="flex-1 min-w-0">
                    <div class="font-medium text-sm text-slate-800 truncate ${isActive ? 'text-blue-700' : ''}">${note.title}</div>
                    <div class="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                        <span>${date}</span>
                        <span class="truncate opacity-70">${note.content.substring(0, 20).replace(/#|\*|\[|\]/g, '')}...</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function handleNoteClick(id, event) {
    if (event.target.closest('.checkbox-wrapper')) return;
    if (state.selectedNotes.size > 0) toggleNoteSelection(id);
    else loadNote(id);
}

function toggleNoteSelection(id) {
    withAutoSave(() => {
        state.selectedNotes.has(id) ? state.selectedNotes.delete(id) : state.selectedNotes.add(id);
    });
}

function selectAllNotes() {
    withAutoSave(() => {
        if (state.selectedNotes.size === state.notes.length) state.selectedNotes.clear();
        else state.notes.forEach(n => state.selectedNotes.add(n.id));
    });
}

function loadNote(id) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    state.currentNoteId = id;
    document.getElementById('currentNoteTitle').value = note.title;
    document.getElementById('noteEditor').value = note.content;
    updateWordCount();
    renderEditorView();
    renderNoteList();
    updateChatContextUI();
}

function createNewNote() {
    withAutoSave(() => {
        const newNote = {
            id: Date.now().toString(),
            title: '新笔记',
            content: '',
            updatedAt: new Date().toISOString()
        };
        state.notes.unshift(newNote);
        state.selectedNotes.clear();
        state.currentNoteId = newNote.id;
    });
    loadNote(state.currentNoteId);
}

function renameCurrentNote(val) {
    const note = state.notes.find(n => n.id === state.currentNoteId);
    if (note && val.trim()) {
        withAutoSave(() => {
            note.title = val.trim();
            note.updatedAt = new Date().toISOString();
        });
    }
}

function saveCurrentNote() {
    const note = state.notes.find(n => n.id === state.currentNoteId);
    if (note) {
        withAutoSave(() => {
            note.content = document.getElementById('noteEditor').value;
            note.updatedAt = new Date().toISOString();
        });
        const indicator = document.getElementById('saveIndicator');
        indicator.style.opacity = '1';
        setTimeout(() => indicator.style.opacity = '0', 2000);
        showToast('已保存');
    }
}

var _autoSaveDebounceTimer = null;
var AUTO_SAVE_DELAY_MS = 1500;

function autoSave() {
    updateWordCount();
    updateEditorPreview();
    if (_autoSaveDebounceTimer) clearTimeout(_autoSaveDebounceTimer);
    _autoSaveDebounceTimer = setTimeout(function () {
        _autoSaveDebounceTimer = null;
        saveCurrentNoteContentOnly();
    }, AUTO_SAVE_DELAY_MS);
}

function saveCurrentNoteContentOnly() {
    var note = state.notes.find(function (n) { return n.id === state.currentNoteId; });
    if (!note) return;
    var editor = document.getElementById('noteEditor');
    if (!editor) return;
    withAutoSave(function () {
        note.content = editor.value;
        note.updatedAt = new Date().toISOString();
    });
    var indicator = document.getElementById('saveIndicator');
    if (indicator) {
        indicator.textContent = '已保存';
        indicator.style.opacity = '1';
        setTimeout(function () { indicator.style.opacity = '0'; }, 1500);
    }
}

function updateWordCount() {
    document.getElementById('wordCount').textContent = `${document.getElementById('noteEditor').value.length} 字`;
}

function batchDelete() {
    withAutoSave(() => {
        state.notes = state.notes.filter(n => !state.selectedNotes.has(n.id));
        state.selectedNotes.clear();
        if(state.notes.length) state.currentNoteId = state.notes[0].id;
        else state.currentNoteId = null;
    });
    if (state.currentNoteId) loadNote(state.currentNoteId);
}

function batchDuplicate() {
    showToast('副本功能待实现');
}

function batchRename() {
    showToast('批量重命名待实现');
}

function batchImportToChat() {
    state.selectedNotes.forEach(id => state.chatContext.add(id));
    state.selectedNotes.clear();
    renderNoteList();
    if (!state.chatOpen) toggleAIChat();
    else updateChatContextUI();
}

function batchExtractEvents() {
    const notes = state.notes.filter(n => state.selectedNotes.has(n.id));
    extractEventsFromNotes(notes);
    state.selectedNotes.clear();
    renderNoteList();
}

// 导出函数到全局
window.renderNoteList = renderNoteList;
window.handleNoteClick = handleNoteClick;
window.toggleNoteSelection = toggleNoteSelection;
window.selectAllNotes = selectAllNotes;
window.loadNote = loadNote;
window.createNewNote = createNewNote;
window.renameCurrentNote = renameCurrentNote;
window.saveCurrentNote = saveCurrentNote;
window.autoSave = autoSave;
window.updateWordCount = updateWordCount;
window.batchDelete = batchDelete;
window.batchDuplicate = batchDuplicate;
window.batchRename = batchRename;
window.batchImportToChat = batchImportToChat;
window.batchExtractEvents = batchExtractEvents;

function renderEditorView() {
    const editor = document.getElementById('noteEditor');
    const preview = document.getElementById('notePreview');
    const btn = document.getElementById('editorModeToggle');
    if (!editor || !preview || !btn) return;

    if (state.editorView === 'preview') {
        editor.classList.add('hidden');
        preview.classList.remove('hidden');
        preview.innerHTML = window.marked ? window.marked.parse(editor.value || '') : (editor.value || '');
        btn.textContent = '预览模式：开';
    } else {
        editor.classList.remove('hidden');
        preview.classList.add('hidden');
        btn.textContent = '预览模式：关';
    }
}

function toggleEditorView() {
    state.editorView = state.editorView === 'edit' ? 'preview' : 'edit';
    renderEditorView();
}

function updateEditorPreview() {
    if (state.editorView !== 'preview') return;
    const editor = document.getElementById('noteEditor');
    const preview = document.getElementById('notePreview');
    if (!editor || !preview) return;
    preview.innerHTML = window.marked ? window.marked.parse(editor.value || '') : (editor.value || '');
}

window.renderEditorView = renderEditorView;
window.toggleEditorView = toggleEditorView;
window.updateEditorPreview = updateEditorPreview;