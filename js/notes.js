// js/notes.js - 笔记列表与操作

function renderNoteList() {
    const container = document.getElementById('noteListContainer');
    const batchActions = document.getElementById('batchActions');
    batchActions.classList.toggle('hidden', state.selectedNotes.size === 0);

    // 根据标签筛选笔记
    let notesToRender = state.notes;
    if (window.state.activeNoteTagFilter) {
        notesToRender = notesToRender.filter(note => 
            note.tags && note.tags.includes(window.state.activeNoteTagFilter)
        );
    }

    if (notesToRender.length === 0) {
        if (state.notes.length === 0) {
            container.innerHTML = `<div class="text-center text-slate-400 text-sm py-8">暂无笔记<br><span class="text-xs">点击 + 新建笔记</span></div>`;
        } else if (window.state.activeNoteTagFilter) {
            container.innerHTML = `<div class="text-center text-slate-400 text-sm py-8">没有 "${window.state.activeNoteTagFilter}" 标签的笔记<br><button onclick="filterNotesByTag(null)" class="text-blue-500 hover:underline text-xs mt-1">显示全部</button></div>`;
        }
        return;
    }

    container.innerHTML = notesToRender.map(note => {
        const isSelected = state.selectedNotes.has(note.id);
        const isActive = note.id === state.currentNoteId;
        const date = new Date(note.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        
        // 渲染标签
        const tagsHtml = (note.tags && note.tags.length > 0) 
            ? `<div class="flex flex-wrap gap-1 mt-1.5">${note.tags.map(tag => 
                `<span class="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-full hover:bg-blue-100 hover:text-blue-600 transition-colors" onclick="event.stopPropagation(); filterNotesByTag('${escapeHtml(tag)}')">#${escapeHtml(tag)}</span>`
            ).join('')}</div>`
            : '';

        return `
            <div class="group relative flex items-start gap-2 p-2.5 rounded-xl cursor-pointer transition-all ${isActive ? 'bg-blue-50 border border-blue-100' : 'hover:bg-slate-50 border border-transparent'} ${isSelected ? 'ring-2 ring-blue-400' : ''}"
                 onclick="handleNoteClick('${note.id}', event)">
                <label class="checkbox-wrapper flex items-center cursor-pointer mt-0.5" onclick="event.stopPropagation()">
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
                    ${tagsHtml}
                </div>
            </div>
        `;
    }).join('');
}

// HTML 转义辅助函数
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
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
    
    // 渲染笔记标签
    if (window.renderNoteTags) renderNoteTags();
    
    // 如果开启了自动标签识别且笔记没有标签，尝试自动提取
    if (window.TagManager && window.TagManager.shouldAutoExtract(note)) {
        // 延迟执行，避免影响加载速度
        setTimeout(() => {
            window.TagManager.tryAutoExtract(note.id);
        }, 1000);
    }
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
    
    // 如果开启了自动标签识别且笔记没有标签，尝试自动提取
    if (window.TagManager && window.TagManager.shouldAutoExtract(note)) {
        // 延迟执行，避免影响保存性能
        setTimeout(function() {
            window.TagManager.tryAutoExtract(note.id);
        }, 500);
    }
}

function updateWordCount() {
    document.getElementById('wordCount').textContent = `${document.getElementById('noteEditor').value.length} 字`;
}

async function batchDelete() {
    // 获取要删除的笔记ID列表
    const idsToDelete = Array.from(state.selectedNotes);
    
    // 1. 先从 IndexedDB 和同步队列中删除
    if (window.dataService && window.dataService.db) {
        for (const id of idsToDelete) {
            try {
                await window.dataService.deleteNote(id);
            } catch (e) {
                console.error('[batchDelete] Failed to delete note from IndexedDB:', id, e);
            }
        }
    }
    
    // 2. 更新 state
    withAutoSave(() => {
        state.notes = state.notes.filter(n => !state.selectedNotes.has(n.id));
        state.selectedNotes.clear();
        if(state.notes.length) state.currentNoteId = state.notes[0].id;
        else state.currentNoteId = null;
    });
    
    if (state.currentNoteId) loadNote(state.currentNoteId);
    else {
        // 如果没有笔记了，清空编辑器
        document.getElementById('currentNoteTitle').value = '';
        document.getElementById('noteEditor').value = '';
        renderNoteList();
    }
    
    showToast(`已删除 ${idsToDelete.length} 篇笔记`);
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

// 保存原始Markdown内容，用于预览模式切换回编辑模式时恢复
let _originalMarkdownContent = '';
let _lastEditorView = 'edit';
const IMAGE_URL_LINE_RE = /(^|\n)(https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s<>"']*)?)(?=\n|$)/gi;

function normalizeMarkdownForPreview(content) {
    return (content || '').replace(IMAGE_URL_LINE_RE, function(match, prefix, url) {
        return `${prefix}![](${url})`;
    });
}

function renderEditorView() {
    const editor = document.getElementById('noteEditor');
    const preview = document.getElementById('notePreview');
    const btn = document.getElementById('editorModeToggle');
    if (!editor || !preview || !btn) return;

    if (state.editorView === 'preview') {
        // 切换到预览模式 - 保存原始Markdown内容
        _originalMarkdownContent = editor.value || '';
        
        editor.classList.add('hidden');
        preview.classList.remove('hidden');
        preview.contentEditable = 'true';
        const previewSource = normalizeMarkdownForPreview(_originalMarkdownContent);
        preview.innerHTML = window.marked ? window.marked.parse(previewSource) : previewSource;
        btn.textContent = '编辑模式';
        btn.classList.add('text-blue-600');
        
        // 添加提示
        showToast('预览模式：所见即所得，切换回编辑模式保留原格式', 'info');
    } else {
        // 切换到编辑模式 - 恢复原始Markdown内容（保留格式标记）
        editor.classList.remove('hidden');
        preview.classList.add('hidden');
        preview.contentEditable = 'false';
        btn.textContent = '预览模式';
        btn.classList.remove('text-blue-600');
        
        // 仅在“刚从预览切回编辑”时恢复原始 Markdown，避免普通加载时把正文清空
        if (_lastEditorView === 'preview' && _originalMarkdownContent !== editor.value) {
            editor.value = _originalMarkdownContent;
            // 触发自动保存（如果内容有变化）
            if (typeof autoSave === 'function') {
                autoSave();
            }
        }
    }
    _lastEditorView = state.editorView;
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
    const previewSource = normalizeMarkdownForPreview(editor.value || '');
    preview.innerHTML = window.marked ? window.marked.parse(previewSource) : previewSource;
}

/**
 * 同步预览区内容到编辑器（保留原始Markdown格式）
 * 注意：此函数现在仅用于用户明确要求保存预览修改的场景
 */
function syncPreviewToEditor() {
    // 警告：此操作会丢失Markdown格式标记
    console.warn('syncPreviewToEditor: 此操作会将HTML转换为纯文本，可能丢失Markdown格式');
    
    const editor = document.getElementById('noteEditor');
    const preview = document.getElementById('notePreview');
    if (!editor || !preview) return;
    
    // 使用原始Markdown内容，而不是从预览区提取
    // 这样可以确保 # ** * 等格式标记不会丢失
    if (_originalMarkdownContent && _originalMarkdownContent !== editor.value) {
        editor.value = _originalMarkdownContent;
        autoSave();
    }
}

/**
 * 初始化预览区编辑功能
 * 
 * 重要说明：预览模式使用 contentEditable 实现所见即所得编辑
 * 但切换回编辑模式时，会恢复原始 Markdown 内容（保留 # ** * 等格式标记）
 * 而不是从预览区提取HTML内容（那样会丢失Markdown标记）
 */
function initPreviewEditable() {
    const preview = document.getElementById('notePreview');
    if (!preview) return;
    
    // 监听输入事件 - 仅更新字数统计，不直接同步到编辑器（避免丢失格式）
    preview.addEventListener('input', function() {
        if (state.editorView === 'preview') {
            // 仅更新字数显示，不改变原始Markdown内容
            const wordCount = (preview.innerText || preview.textContent || '').length;
            const wordCountEl = document.getElementById('wordCount');
            if (wordCountEl) {
                wordCountEl.textContent = `${wordCount} 字`;
            }
        }
    });
    
    // 监听失去焦点事件
    preview.addEventListener('blur', function() {
        if (state.editorView === 'preview') {
            // 在预览模式的编辑不自动保存到原始Markdown
            // 如需保存预览修改，需要使用专门的 "保存预览修改" 功能
            console.log('预览模式：编辑未自动保存，切换回编辑模式将保留原格式');
        }
    });
    
    // 阻止某些快捷键的默认行为
    preview.addEventListener('keydown', function(e) {
        // Ctrl/Cmd + S 切换到编辑模式并保存
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            // 切换回编辑模式（会自动保存）
            toggleEditorView();
        }
    });
}

window.renderEditorView = renderEditorView;
window.toggleEditorView = toggleEditorView;
window.updateEditorPreview = updateEditorPreview;
window.syncPreviewToEditor = syncPreviewToEditor;
window.initPreviewEditable = initPreviewEditable;