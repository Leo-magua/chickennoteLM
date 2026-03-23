// js/state.js - 全局状态与持久化

/** 与后端 _sanitize_user_id 一致，用于本地存储键名 */
function sanitizeStorageUserId(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return String(raw).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64) || '';
}

window.getNotesEventsStorageKey = function () {
    const u = sanitizeStorageUserId(window.state && window.state.currentUser);
    return u ? 'chickennotelm_notes_events__' + u : null;
};

window.getLastSyncAtStorageKey = function () {
    const u = sanitizeStorageUserId(window.state && window.state.currentUser);
    return u ? 'chickennotelm_last_sync_at__' + u : null;
};

window.getSettingsStorageKey = function () {
    const u = sanitizeStorageUserId(window.state && window.state.currentUser);
    return u ? 'chickennotelm_settings__' + u : null;
};

window.state = {
    /** 当前登录用户名（与 session 一致），未登录为 null */
    currentUser: null,
    notes: [],
    selectedNotes: new Set(),
    currentNoteId: null,
    chatContext: new Set(),
    chatSessions: [],
    currentChatId: null,
    currentChatMessages: [],
    events: [],
    eventSort: 'create_desc',
    activeTagFilter: null,
    editorView: 'edit',
    settings: {
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-3.5-turbo',
        systemPromptChat: '你是一个智能笔记助手，帮助用户整理思路、提取关键信息和规划任务。请基于提供的笔记内容给出有帮助的回答。',
        systemPromptEventExtract: '你是一个事件与任务抽取助手，请严格按照以下要求从给定的中文笔记中提取结构化数据：\\n\\n1. 只输出 JSON，格式为：{ "events": [ { "title": string, "context": string, "tags": string[], "time": string } ] }，不要包含任何多余文字。\\n2. 每个事件：\\n   - title：一句话概括事件或待办事项，简短且有可执行性。\\n   - context：从原文中提炼的详细说明，包含背景、目的、约束等。\\n   - tags：提取 1～5 个标签，例如：["工作", "学习", "会议", "重要", "待办"]。\\n   - time：如果原文中有明确时间（如“明天上午10点”“3月1日之前”），请标准化为自然语言短语；如果没有明确时间，请用空字符串 ""。\\n3. 忽略完全重复或无实际行动意义的描述（如泛泛的感受、无具体动作的感想）。\\n4. 若无法提取任何事件，请返回 { "events": [] }。',
        markdownConvertPrompt: '你是 Markdown 编辑专家。请把用户给出的纯文本整理为结构清晰、可读性强的 Markdown。要求：\\n1) 保留原始语义，不编造事实；\\n2) 自动识别主题并拆分为合适的标题与小节；\\n3) 将并列信息转为列表，将步骤转为有序列表；\\n4) 重要信息可用加粗、引用块强调；\\n5) 若出现时间/任务信息，可整理为 TODO 列表；\\n6) 仅输出最终 Markdown，不要额外解释。'
    },
    sidebarOpen: true,
    chatOpen: false,
    eventOpen: false,
    chatLoading: false,
    eventLoading: false
};

// 自动保存到 localStorage 和 IndexedDB
window.withAutoSave = async function(fn) {
    // 标记本地刚发生过变更，给后台增量同步一个短暂保护窗口，避免“删除后被旧数据立刻拉回”
    window.__lastLocalMutationAt = Date.now();
    fn();
    await saveDataToStorage();
    if (window.renderNoteList) renderNoteList();
    if (window.renderEvents && state.eventOpen) renderEvents();
    if (window.updateChatContextUI) updateChatContextUI();
};

// 保存数据到存储（IndexedDB + localStorage 双写）
async function saveDataToStorage() {
    try {
        const lsKey = typeof window.getNotesEventsStorageKey === 'function' ? window.getNotesEventsStorageKey() : null;
        if (!lsKey || !state.currentUser) {
            console.warn('[saveDataToStorage] 跳过：未登录或无法解析用户');
            return;
        }

        const data = {
            notes: state.notes,
            events: state.events.map(e => ({ ...e, expanded: false }))
        };
        
        // 1. 保存到 localStorage（按用户隔离）
        localStorage.setItem(lsKey, JSON.stringify(data));
        
        // 2. 同步到 IndexedDB（离线优先）
        // 注意：这里不要调用 dataService.saveNote()，否则会再次回调 saveDataToStorage 形成递归。
        if (window.dataService && window.dataService.db) {
            const db = window.dataService.db;
            const stateIds = new Set(state.notes.map(n => String(n.id)));
            const dbNotes = await db.getAllNotes();

            // 先删除 IndexedDB 中已不在当前 state 的笔记，避免“删除后回弹”
            for (const dbNote of dbNotes) {
                if (!stateIds.has(String(dbNote.id))) {
                    await db.deleteNote(dbNote.id);
                }
            }

            // 再写入当前 state 的最新内容
            for (const note of state.notes) {
                await db.addNote(note);
            }
        }
        
        // 3. 同步到服务器
        await syncNotesAndEventsToServer(data);
    } catch (e) {
        console.error('保存数据失败', e);
    }
}

// 兼容旧版函数名
function saveDataToLocalStorage() {
    const lsKey = typeof window.getNotesEventsStorageKey === 'function' ? window.getNotesEventsStorageKey() : null;
    if (!lsKey) return;
    const data = {
        notes: state.notes,
        events: state.events.map(e => ({ ...e, expanded: false }))
    };
    localStorage.setItem(lsKey, JSON.stringify(data));
}

async function syncNotesAndEventsToServer(data) {
    try {
        const overlay = document.getElementById('loginOverlay');
        if (overlay && overlay.style.display !== 'none') return;

        const response = await fetch('/api/sync/notes-events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                notes: data.notes || [],
                events: data.events || []
            })
        });
        if (response.status === 401) return;
    } catch (e) {
        console.error('同步到本地文件失败', e);
    }
}

/** 仅写入本机 localStorage + IndexedDB，不调用 /api/sync/notes-events */
async function persistNotesEventsToLocalOnly() {
    const lsKey = typeof window.getNotesEventsStorageKey === 'function' ? window.getNotesEventsStorageKey() : null;
    if (!lsKey || !state.currentUser) return;
    const data = {
        notes: state.notes,
        events: state.events.map(e => ({ ...e, expanded: false }))
    };
    localStorage.setItem(lsKey, JSON.stringify(data));
    if (window.dataService && window.dataService.db) {
        const db = window.dataService.db;
        const stateIds = new Set(state.notes.map(n => String(n.id)));
        const dbNotes = await db.getAllNotes();
        for (const dbNote of dbNotes) {
            if (!stateIds.has(String(dbNote.id))) {
                await db.deleteNote(dbNote.id);
            }
        }
        for (const note of state.notes) {
            await db.addNote(note);
        }
    }
}

/**
 * 登录后以云端为准：
 * - 成功拉取 API 时：云端笔记与事件均为空 → 清空本账号 IndexedDB / localStorage 相关缓存；
 * - 云端有数据 → 先清空本地库（含 sync 队列）再写入云端快照，避免脏队列误推；
 * - 仅当网络失败或 API 非成功时 useLocalFallback，由调用方再走本地缓存。
 */
window.applyCloudAuthorityOnLogin = async function() {
    const lsKey = typeof window.getNotesEventsStorageKey === 'function' ? window.getNotesEventsStorageKey() : null;
    const syncKey = typeof window.getLastSyncAtStorageKey === 'function' ? window.getLastSyncAtStorageKey() : null;
    if (!state.currentUser) {
        return { ok: false, useLocalFallback: true, reason: 'no_user' };
    }

    let notesRes;
    let eventsRes;
    try {
        [notesRes, eventsRes] = await Promise.all([
            fetch('/api/notes', { credentials: 'include' }),
            fetch('/api/events', { credentials: 'include' })
        ]);
    } catch (e) {
        console.warn('[CloudAuthority] 网络异常，回退本地缓存', e);
        return { ok: false, useLocalFallback: true, reason: 'network' };
    }

    if (notesRes.status === 401 || eventsRes.status === 401) {
        return { ok: false, useLocalFallback: true, reason: 'auth' };
    }
    if (!notesRes.ok || !eventsRes.ok) {
        console.warn('[CloudAuthority] API 状态异常，回退本地缓存', notesRes.status, eventsRes.status);
        return { ok: false, useLocalFallback: true, reason: 'http' };
    }

    let notesJson;
    let eventsJson;
    try {
        notesJson = await notesRes.json();
        eventsJson = await eventsRes.json();
    } catch (e) {
        return { ok: false, useLocalFallback: true, reason: 'parse' };
    }

    const serverNotes = Array.isArray(notesJson.notes) ? notesJson.notes : [];
    const serverEvents = Array.isArray(eventsJson.events) ? eventsJson.events : [];
    const serverEmpty = serverNotes.length === 0 && serverEvents.length === 0;

    const wipeIndexedDb = async () => {
        if (window.dataService && window.dataService.db && typeof window.dataService.db.clearAll === 'function') {
            await window.dataService.db.clearAll();
        }
    };

    if (syncKey) {
        try { localStorage.removeItem(syncKey); } catch (e) { /* ignore */ }
    }

    if (serverEmpty) {
        try {
            await wipeIndexedDb();
        } catch (e) {
            console.error('[CloudAuthority] 清空 IndexedDB 失败', e);
        }
        if (lsKey) {
            try { localStorage.removeItem(lsKey); } catch (e) { /* ignore */ }
        }
        state.notes = [];
        state.events = [];
        state.currentNoteId = null;
        console.log('[CloudAuthority] 云端无笔记/事件，已清除本账号本地缓存');
        return { ok: true, serverEmpty: true, useLocalFallback: false };
    }

    try {
        await wipeIndexedDb();
    } catch (e) {
        console.error('[CloudAuthority] 重置 IndexedDB 失败', e);
    }

    state.notes = serverNotes;
    state.events = serverEvents.map(e => ({ ...e, expanded: false }));
    state.currentNoteId = null;
    if (state.notes.length) {
        state.currentNoteId = state.notes[0].id;
    }

    try {
        await persistNotesEventsToLocalOnly();
    } catch (e) {
        console.error('[CloudAuthority] 写入本地镜像失败', e);
    }
    console.log('[CloudAuthority] 已用云端数据覆盖本地（笔记', serverNotes.length, '条，事件', serverEvents.length, '条）');
    return { ok: true, serverEmpty: false, useLocalFallback: false };
};

// 从 IndexedDB 加载数据（离线优先）
window.loadDataFromIndexedDB = async function() {
    try {
        if (window.dataService && window.dataService.db) {
            const notes = await window.dataService.getAllNotes();
            if (notes && notes.length > 0) {
                state.notes = notes;
                console.log('[IndexedDB] Loaded', notes.length, 'notes');
                return true;
            }
        }
    } catch (e) {
        console.error('[IndexedDB] Load failed:', e);
    }
    return false;
};

// 从 localStorage 加载数据（兼容旧版）
window.loadDataFromLocalStorage = async function() {
    const lsKey = typeof window.getNotesEventsStorageKey === 'function' ? window.getNotesEventsStorageKey() : null;
    if (!lsKey || !state.currentUser) {
        console.warn('[loadDataFromLocalStorage] 跳过：未登录');
        return;
    }

    // 1. 优先尝试从 IndexedDB 加载
    const loadedFromIndexedDB = await window.loadDataFromIndexedDB();
    if (loadedFromIndexedDB) {
        // 如果成功从 IndexedDB 加载，也同步到 localStorage
        saveDataToLocalStorage();
        if (!state.currentNoteId && state.notes.length) {
            state.currentNoteId = state.notes[0].id;
        }
        return;
    }
    
    // 2. 回退到 localStorage（仅当前用户 key；不再读取无用户后缀的全局 key，避免账号 B 继承账号 A 的缓存）
    let stored = localStorage.getItem(lsKey);
    if (stored) {
        try {
            const { notes, events } = JSON.parse(stored);
            if (Array.isArray(notes)) state.notes = notes;
            if (Array.isArray(events)) state.events = events.map(e => ({ ...e, expanded: false }));
            
            // 同步到 IndexedDB（全量镜像，含删除）
            if (window.dataService && window.dataService.db) {
                const db = window.dataService.db;
                const stateIds = new Set(state.notes.map(n => String(n.id)));
                const dbNotes = await db.getAllNotes();
                for (const dbNote of dbNotes) {
                    if (!stateIds.has(String(dbNote.id))) {
                        await db.deleteNote(dbNote.id);
                    }
                }
                for (const note of state.notes) {
                    await db.addNote(note);
                }
            }
        } catch (e) {
            console.error('解析localStorage数据失败', e);
        }
    }

    if (!state.currentNoteId && state.notes.length) {
        state.currentNoteId = state.notes[0].id;
    }
};

// 当本地无笔记时，从后端 notefile/ 拉取（兼容「只有磁盘文件、无 localStorage」的情况）
window.loadDataFromServerIfEmpty = function() {
    if (state.notes.length > 0) return Promise.resolve();
    var userLsKey = typeof window.getNotesEventsStorageKey === 'function' ? window.getNotesEventsStorageKey() : null;
    return fetch('/api/notes', { credentials: 'include' })
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
            if (data && Array.isArray(data.notes) && data.notes.length > 0) {
                state.notes = data.notes;
                if (!state.currentNoteId) state.currentNoteId = state.notes[0].id;
                var payload = { notes: state.notes, events: state.events.map(function(e) { return Object.assign({}, e, { expanded: false }); }) };
                if (userLsKey) localStorage.setItem(userLsKey, JSON.stringify(payload));
            }
        })
        .catch(function() {})
        .then(function() {
            return fetch('/api/events', { credentials: 'include' }).then(function(r) { return r.ok ? r.json() : null; }).then(function(data) {
                if (data && Array.isArray(data.events) && data.events.length > 0) {
                    state.events = (data.events || []).map(function(e) { return Object.assign({}, e, { expanded: false }); });
                    var payload = { notes: state.notes, events: state.events.map(function(e) { return Object.assign({}, e, { expanded: false }); }) };
                    if (userLsKey) localStorage.setItem(userLsKey, JSON.stringify(payload));
                }
            });
        })
        .catch(function() {});
};

// 导出/导入功能
window.exportNotes = function() {
    const dataStr = JSON.stringify(state.notes, null, 2);
    downloadJson(dataStr, 'notes.json');
};

// 导出所有笔记为一个 Markdown 文件
window.exportNotesAsMarkdown = function() {
    if (!state.notes.length) {
        showToast('没有可导出的笔记');
        return;
    }

    const content = state.notes.map(note => {
        const updated = note.updatedAt
            ? new Date(note.updatedAt).toLocaleString('zh-CN')
            : '';
        const meta = updated ? `> 最后更新：${updated}\n\n` : '';
        return `# ${note.title || '未命名笔记'}\n\n${meta}${note.content || ''}\n\n---\n`;
    }).join('\n');

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'notes.md';
    a.click();
    URL.revokeObjectURL(url);
    showToast('已导出 notes.md');
};

window.exportEvents = function() {
    const dataStr = JSON.stringify(state.events, null, 2);
    downloadJson(dataStr, 'events.json');
};

function downloadJson(content, filename) {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${filename}`);
}

window.importDataFromFile = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const json = JSON.parse(e.target.result);
            withAutoSave(() => {
                if (Array.isArray(json)) {
                    if (confirm('导入为笔记数组？点确定导入笔记，取消导入事件')) {
                        state.notes = json;
                    } else {
                        state.events = json;
                    }
                } else {
                    if (json.notes) state.notes = json.notes;
                    if (json.events) state.events = json.events;
                }
            });
            showToast('数据导入成功');
            if (state.notes.length) loadNote(state.notes[0].id);
        } catch (ex) {
            showToast('无效的JSON文件');
        }
        document.getElementById('importFile').value = '';
    };
    reader.readAsText(file);
};