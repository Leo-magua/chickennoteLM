// js/notes.js - 笔记列表与操作

/**
 * 高亮文本中的关键词
 * @param {string} text - 原始文本
 * @param {string} query - 搜索关键词
 * @param {number} maxLen - 最大返回长度
 * @returns {string} - 带高亮标记的HTML
 */
function highlightText(text, query, maxLen) {
    if (!text) return '';
    if (!query || !query.trim()) {
        return escapeHtml(text.substring(0, maxLen));
    }
    const q = query.trim().toLowerCase();
    const t = text;
    const lowerT = t.toLowerCase();
    const idx = lowerT.indexOf(q);
    
    // 计算截取范围：优先包含关键词位置
    let start = 0;
    let end = t.length;
    if (idx !== -1 && maxLen && t.length > maxLen) {
        // 让关键词尽量居中显示
        start = Math.max(0, idx - Math.floor(maxLen / 3));
        end = Math.min(t.length, start + maxLen);
        if (end - start < maxLen) {
            start = Math.max(0, end - maxLen);
        }
    } else if (maxLen && t.length > maxLen) {
        end = maxLen;
    }
    
    let snippet = t.substring(start, end);
    let prefix = start > 0 ? '...' : '';
    let suffix = end < t.length ? '...' : '';
    
    // 转义并高亮
    const escaped = escapeHtml(snippet);
    // 使用正则全局替换（忽略大小写）
    const regex = new RegExp('(' + escapeRegExp(query) + ')', 'gi');
    const highlighted = escaped.replace(regex, '<mark class="bg-yellow-200 text-yellow-900 rounded px-0.5">$1</mark>');
    
    return prefix + highlighted + suffix;
}

/**
 * 转义正则特殊字符
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 虚拟滚动配置
const VIRTUAL_SCROLL = {
    /** 每项预估高度（px），与实际 CSS 保持一致 */
    ITEM_ESTIMATED_HEIGHT: 72,
    /** 可视区域外上下各多渲染的缓冲项数 */
    BUFFER_COUNT: 5,
    /** 触发虚拟滚动的最小笔记数 */
    MIN_NOTES_FOR_VIRTUAL: 100
};

/** 当前虚拟滚动状态 */
let _virtualScrollState = {
    notesToRender: [],
    startIndex: 0,
    endIndex: 0,
    scrollTop: 0,
    containerHeight: 0,
    itemHeights: new Map(), // id -> measured height
    rafId: null
};

/**
 * 获取经过筛选后的笔记列表（标签 + 搜索）
 */
function getFilteredNotes() {
    let notes = state.notes;

    // 标签筛选（支持单选和多选）
    if (window.state.activeNoteTagFilter) {
        notes = notes.filter(note => note.tags && note.tags.includes(window.state.activeNoteTagFilter));
    } else if (window.state.selectedNoteTags && window.state.selectedNoteTags.size > 0) {
        const selectedTags = Array.from(window.state.selectedNoteTags);
        notes = notes.filter(note => note.tags && selectedTags.some(tag => note.tags.includes(tag)));
    }

    // 搜索筛选
    const searchQuery = (window.state.noteSearchQuery || '').trim();
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        notes = notes.filter(note => {
            const titleMatch = (note.title || '').toLowerCase().includes(q);
            const contentMatch = (note.content || '').toLowerCase().includes(q);
            return titleMatch || contentMatch;
        });
    }

    return notes;
}

/**
 * 渲染单条笔记的 HTML
 */
function renderNoteItem(note, searchQuery) {
    const isSelected = state.selectedNotes.has(note.id);
    const isActive = note.id === state.currentNoteId;
    const date = new Date(note.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

    // 渲染标签
    const tagsHtml = (note.tags && note.tags.length > 0)
        ? `<div class="flex flex-wrap gap-1 mt-1.5">${note.tags.map(tag =>
            `<span class="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-full hover:bg-blue-100 hover:text-blue-600 transition-colors cursor-pointer" onclick="event.stopPropagation(); TagManager.toggleTagSelection('${escapeHtml(tag)}')">#${escapeHtml(tag)}</span>`
        ).join('')}</div>`
        : '';

    // 高亮标题和正文摘要
    const displayTitle = searchQuery
        ? highlightText(note.title || '未命名笔记', searchQuery, 60)
        : escapeHtml(note.title || '未命名笔记');
    const displayContent = searchQuery
        ? highlightText(note.content || '', searchQuery, 80)
        : escapeHtml((note.content || '').substring(0, 20).replace(/#|\*|\[|\]/g, '')) + '...';

    // 计算笔记中引用的事件数量
    const eventRefMatches = (note.content || '').match(/\[\[event:[a-zA-Z0-9_]+\]\]/g);
    const linkedEventCount = eventRefMatches ? eventRefMatches.length : 0;
    const linkedEventsHtml = linkedEventCount > 0
        ? `<span class="inline-flex items-center gap-0.5 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-100 flex-shrink-0" title="引用了 ${linkedEventCount} 个事件">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            ${linkedEventCount}
        </span>`
        : '';

    return `
        <div class="note-item group relative flex items-start gap-2 p-2.5 rounded-xl cursor-pointer transition-all ${isActive ? 'bg-blue-50 border border-blue-100' : 'hover:bg-slate-50 border border-transparent'} ${isSelected ? 'ring-2 ring-blue-400' : ''}"
             data-note-id="${note.id}"
             onclick="handleNoteClick('${note.id}', event)">
            <label class="checkbox-wrapper flex items-center cursor-pointer mt-0.5" onclick="event.stopPropagation()">
                <input type="checkbox" class="hidden" ${isSelected ? 'checked' : ''} onchange="toggleNoteSelection('${note.id}')">
                <div class="w-4 h-4 border-2 border-slate-300 rounded flex items-center justify-center transition-colors hover:border-blue-400">
                    <svg class="w-3 h-3 text-white hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
                </div>
            </label>
            <div class="flex-1 min-w-0">
                <div class="font-medium text-sm text-slate-800 truncate ${isActive ? 'text-blue-700' : ''}">${displayTitle}</div>
                <div class="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                    <span>${date}</span>
                    <span class="truncate opacity-70">${displayContent}</span>
                    ${linkedEventsHtml}
                </div>
                ${tagsHtml}
            </div>
        </div>
    `;
}

/**
 * 渲染笔记列表（支持虚拟滚动）
 */
function renderNoteList() {
    const container = document.getElementById('noteListContainer');
    const batchActions = document.getElementById('batchActions');
    batchActions.classList.toggle('hidden', state.selectedNotes.size === 0);

    const notesToRender = getFilteredNotes();
    const searchQuery = (window.state.noteSearchQuery || '').trim();

    // 空状态处理
    if (notesToRender.length === 0) {
        container.innerHTML = '';
        container.style.position = '';
        container.style.height = '';
        container.style.overflowY = '';
        container.classList.add('overflow-y-auto');

        if (state.notes.length === 0) {
            container.innerHTML = `<div class="text-center text-slate-400 text-sm py-8">暂无笔记<br><span class="text-xs">点击 + 新建笔记</span></div>`;
        } else if (window.state.noteSearchQuery) {
            container.innerHTML = `<div class="text-center text-slate-400 text-sm py-8">没有找到包含 "${escapeHtml(window.state.noteSearchQuery)}" 的笔记<br><button onclick="clearNoteSearch()" class="text-blue-500 hover:underline text-xs mt-1">清除搜索</button></div>`;
        } else if (window.state.activeNoteTagFilter) {
            container.innerHTML = `<div class="text-center text-slate-400 text-sm py-8">没有 "${escapeHtml(window.state.activeNoteTagFilter)}" 标签的笔记<br><button onclick="TagManager.clearTagFilter()" class="text-blue-500 hover:underline text-xs mt-1">显示全部</button></div>`;
        } else if (window.state.selectedNoteTags && window.state.selectedNoteTags.size > 0) {
            const tagsStr = Array.from(window.state.selectedNoteTags).map(t => `#${escapeHtml(t)}`).join('、');
            container.innerHTML = `<div class="text-center text-slate-400 text-sm py-8">没有匹配 ${tagsStr} 标签的笔记<br><button onclick="TagManager.clearTagFilter()" class="text-blue-500 hover:underline text-xs mt-1">显示全部</button></div>`;
        }
        return;
    }

    // 笔记数量较少时，直接渲染全部（避免虚拟滚动开销）
    if (notesToRender.length < VIRTUAL_SCROLL.MIN_NOTES_FOR_VIRTUAL) {
        container.style.position = '';
        container.style.height = '';
        container.classList.add('overflow-y-auto');
        container.innerHTML = notesToRender.map(note => renderNoteItem(note, searchQuery)).join('');
        _virtualScrollState.notesToRender = notesToRender;
        return;
    }

    // ===== 虚拟滚动模式 =====
    container.classList.remove('overflow-y-auto');
    container.style.overflowY = 'auto';
    container.style.position = 'relative';

    _virtualScrollState.notesToRender = notesToRender;
    _virtualScrollState.containerHeight = container.clientHeight;

    // 首次渲染：先以预估高度计算，然后测量实际高度
    _updateVirtualScroll(container, true);
}

/**
 * 更新虚拟滚动视口
 * @param {HTMLElement} container
 * @param {boolean} isInitial - 是否首次渲染
 */
function _updateVirtualScroll(container, isInitial) {
    const notes = _virtualScrollState.notesToRender;
    if (!notes.length) return;

    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;
    const estimatedH = VIRTUAL_SCROLL.ITEM_ESTIMATED_HEIGHT;
    const buffer = VIRTUAL_SCROLL.BUFFER_COUNT;

    // 基于已测量高度计算累计偏移
    let startIndex = 0;
    let accumulatedHeight = 0;
    let topPadding = 0;

    // 二分查找优化：找到 scrollTop 对应的起始索引
    // 先使用简单线性查找（因为大部分情况下高度接近预估）
    for (let i = 0; i < notes.length; i++) {
        const h = _virtualScrollState.itemHeights.get(notes[i].id) || estimatedH;
        if (accumulatedHeight + h > scrollTop) {
            startIndex = i;
            topPadding = accumulatedHeight;
            break;
        }
        accumulatedHeight += h;
    }

    // 计算结束索引
    let visibleHeight = 0;
    let endIndex = startIndex;
    for (let i = startIndex; i < notes.length && visibleHeight < clientHeight + estimatedH; i++) {
        visibleHeight += _virtualScrollState.itemHeights.get(notes[i].id) || estimatedH;
        endIndex = i;
    }

    // 扩展缓冲区
    startIndex = Math.max(0, startIndex - buffer);
    endIndex = Math.min(notes.length - 1, endIndex + buffer);

    _virtualScrollState.startIndex = startIndex;
    _virtualScrollState.endIndex = endIndex;

    // 计算底部占位高度
    let bottomPadding = 0;
    for (let i = endIndex + 1; i < notes.length; i++) {
        bottomPadding += _virtualScrollState.itemHeights.get(notes[i].id) || estimatedH;
    }

    // 重新计算顶部占位（精确值）
    topPadding = 0;
    for (let i = 0; i < startIndex; i++) {
        topPadding += _virtualScrollState.itemHeights.get(notes[i].id) || estimatedH;
    }

    const searchQuery = (window.state.noteSearchQuery || '').trim();
    const visibleHtml = notes.slice(startIndex, endIndex + 1).map(note => renderNoteItem(note, searchQuery)).join('');

    container.innerHTML = `
        <div style="height:${topPadding}px;flex-shrink:0;"></div>
        ${visibleHtml}
        <div style="height:${bottomPadding}px;flex-shrink:0;"></div>
    `;

    // 测量并缓存实际高度（首次渲染后异步执行，避免阻塞）
    if (isInitial || _virtualScrollState.itemHeights.size < notes.length) {
        requestAnimationFrame(() => {
            _measureItemHeights(container, notes);
        });
    }
}

/**
 * 测量已渲染项的实际高度并缓存
 */
function _measureItemHeights(container, notes) {
    const items = container.querySelectorAll('.note-item');
    let hasNewMeasurement = false;
    items.forEach((el) => {
        const id = el.getAttribute('data-note-id');
        if (id) {
            const h = el.getBoundingClientRect().height;
            // 只有高度变化时才更新，避免无限重绘
            const prevH = _virtualScrollState.itemHeights.get(id);
            if (prevH === undefined || Math.abs(prevH - h) > 1) {
                _virtualScrollState.itemHeights.set(id, h);
                hasNewMeasurement = true;
            }
        }
    });

    // 如果有新的测量值，且导致整体布局变化较大，则重新计算一次
    if (hasNewMeasurement) {
        // 检查累计高度偏差是否超过阈值
        let totalEstimated = 0;
        let totalMeasured = 0;
        for (let i = 0; i < notes.length; i++) {
            const estimated = VIRTUAL_SCROLL.ITEM_ESTIMATED_HEIGHT;
            const measured = _virtualScrollState.itemHeights.get(notes[i].id);
            totalEstimated += estimated;
            totalMeasured += measured || estimated;
        }
        const deviation = Math.abs(totalMeasured - totalEstimated);
        // 如果总偏差超过一个屏幕高度，重新渲染
        if (deviation > container.clientHeight * 0.5) {
            _updateVirtualScroll(container, false);
        }
    }
}

/**
 * 滚动事件处理（使用 requestAnimationFrame 节流）
 */
function _onNoteListScroll() {
    const container = document.getElementById('noteListContainer');
    if (!container) return;

    // 只有虚拟滚动模式才处理
    const notes = _virtualScrollState.notesToRender;
    if (!notes || notes.length < VIRTUAL_SCROLL.MIN_NOTES_FOR_VIRTUAL) return;

    if (_virtualScrollState.rafId) {
        cancelAnimationFrame(_virtualScrollState.rafId);
    }
    _virtualScrollState.rafId = requestAnimationFrame(() => {
        _virtualScrollState.rafId = null;
        _updateVirtualScroll(container, false);
    });
}

// 绑定滚动事件（只绑定一次）
(function _initVirtualScrollListener() {
    const container = document.getElementById('noteListContainer');
    if (container) {
        container.addEventListener('scroll', _onNoteListScroll, { passive: true });
    } else {
        // DOM 可能还没加载完，延迟重试
        document.addEventListener('DOMContentLoaded', () => {
            const c = document.getElementById('noteListContainer');
            if (c) c.addEventListener('scroll', _onNoteListScroll, { passive: true });
        });
    }
})();

/**
 * 滚动到指定笔记（用于 loadNote 后保持当前笔记在视口内）
 */
function scrollNoteIntoView(noteId) {
    const container = document.getElementById('noteListContainer');
    if (!container) return;

    const notes = _virtualScrollState.notesToRender;
    if (!notes || notes.length < VIRTUAL_SCROLL.MIN_NOTES_FOR_VIRTUAL) return;

    const index = notes.findIndex(n => n.id === noteId);
    if (index === -1) return;

    // 计算目标位置的累计高度
    let offsetTop = 0;
    for (let i = 0; i < index; i++) {
        offsetTop += _virtualScrollState.itemHeights.get(notes[i].id) || VIRTUAL_SCROLL.ITEM_ESTIMATED_HEIGHT;
    }

    container.scrollTop = offsetTop;
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
    scrollNoteIntoView(id);
    
    // 渲染笔记标签
    if (window.renderNoteTags) renderNoteTags();
    
    // 如果开启了自动标签识别且笔记没有标签，尝试自动提取
    if (window.TagManager && window.TagManager.shouldAutoExtract(note)) {
        // 延迟执行，避免影响加载速度
        setTimeout(() => {
            window.TagManager.tryAutoExtract(note.id);
        }, 1000);
    }

    if (typeof window.handleMobileNoteOpened === 'function') {
        window.handleMobileNoteOpened();
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

/**
 * 批量复制选中的笔记
 * 为每篇选中的笔记创建一个副本（标题加"-副本"后缀，内容相同）
 */
async function batchDuplicate() {
    const idsToDuplicate = Array.from(state.selectedNotes);
    if (idsToDuplicate.length === 0) {
        showToast('请先选择要复制的笔记');
        return;
    }

    const duplicatedNotes = [];
    const now = new Date().toISOString();

    for (const id of idsToDuplicate) {
        const original = state.notes.find(n => n.id === id);
        if (!original) continue;

        const newNote = {
            id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
            title: (original.title || '未命名笔记') + '-副本',
            content: original.content || '',
            updatedAt: now,
            createdAt: now,
            tags: original.tags ? [...original.tags] : []
        };

        // 保存到 IndexedDB（如果可用）
        if (window.dataService && window.dataService.db) {
            try {
                await window.dataService.saveNote(newNote);
            } catch (e) {
                console.error('[batchDuplicate] Failed to save note to IndexedDB:', newNote.id, e);
            }
        }

        duplicatedNotes.push(newNote);
    }

    // 更新 state
    withAutoSave(() => {
        state.notes.unshift(...duplicatedNotes);
        state.selectedNotes.clear();
    });

    renderNoteList();
    showToast(`已复制 ${duplicatedNotes.length} 篇笔记`);
}

/**
 * 批量重命名选中的笔记
 * 弹出对话框让用户输入命名规则，支持 {n} 作为序号占位符
 */
function batchRename() {
    const idsToRename = Array.from(state.selectedNotes);
    if (idsToRename.length === 0) {
        showToast('请先选择要重命名的笔记');
        return;
    }

    const defaultName = idsToRename.length === 1
        ? (state.notes.find(n => n.id === idsToRename[0])?.title || '未命名笔记')
        : '笔记-{n}';

    const newNamePattern = prompt(
        `批量重命名 ${idsToRename.length} 篇笔记\n\n使用 {n} 作为序号占位符（从1开始）\n例如：项目-{n}、笔记{n}、2024-04-{n}`,
        defaultName
    );

    if (!newNamePattern || !newNamePattern.trim()) {
        showToast('已取消重命名');
        return;
    }

    const pattern = newNamePattern.trim();
    let renamedCount = 0;
    const now = new Date().toISOString();

    // 按当前列表顺序对选中的笔记排序，保证序号顺序一致
    const selectedNotesOrdered = state.notes.filter(n => state.selectedNotes.has(n.id));

    for (let i = 0; i < selectedNotesOrdered.length; i++) {
        const note = selectedNotesOrdered[i];
        const newTitle = pattern.replace(/{n}/g, (i + 1).toString());

        note.title = newTitle;
        note.updatedAt = now;
        renamedCount++;

        // 同步更新到 IndexedDB（如果可用）
        if (window.dataService && window.dataService.db) {
            window.dataService.updateNote(note.id, {
                title: note.title,
                modified_at: new Date(now).getTime()
            }).catch(e => {
                console.error('[batchRename] Failed to update note in IndexedDB:', note.id, e);
            });
        }
    }

    // 触发 state 保存
    withAutoSave(() => {});

    renderNoteList();
    showToast(`已重命名 ${renamedCount} 篇笔记`);
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
window.scrollNoteIntoView = scrollNoteIntoView;

// 全文搜索相关函数
/**
 * 处理笔记搜索输入
 * @param {string} value - 搜索关键词
 */
function handleNoteSearch(value) {
    window.state.noteSearchQuery = value;
    // 显示/隐藏清除按钮
    const clearBtn = document.getElementById('noteSearchClearBtn');
    if (clearBtn) {
        clearBtn.classList.toggle('hidden', !value || !value.trim());
    }
    renderNoteList();
}

/**
 * 清除笔记搜索
 */
function clearNoteSearch() {
    const input = document.getElementById('noteSearchInput');
    if (input) input.value = '';
    window.state.noteSearchQuery = '';
    const clearBtn = document.getElementById('noteSearchClearBtn');
    if (clearBtn) clearBtn.classList.add('hidden');
    renderNoteList();
}

window.handleNoteSearch = handleNoteSearch;
window.clearNoteSearch = clearNoteSearch;

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
        btn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>';
        btn.title = '编辑模式';
        btn.classList.add('text-blue-600');
        
        // 添加提示
        showToast('预览模式：所见即所得，切换回编辑模式保留原格式', 'info');
    } else {
        // 切换到编辑模式 - 恢复原始Markdown内容（保留格式标记）
        editor.classList.remove('hidden');
        preview.classList.add('hidden');
        preview.contentEditable = 'false';
        btn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>';
        btn.title = '预览模式';
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
    let html = window.marked ? window.marked.parse(previewSource) : previewSource;
    // 渲染事件引用标签
    if (typeof window.renderEventRefsInContent === 'function') {
        html = window.renderEventRefsInContent(html);
    }
    preview.innerHTML = html;
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
