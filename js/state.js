// js/state.js - 全局状态与持久化

window.state = {
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
        systemPromptEventExtract: '你是一个事件与任务抽取助手，请严格按照以下要求从给定的中文笔记中提取结构化数据：\\n\\n1. 只输出 JSON，格式为：{ "events": [ { "title": string, "context": string, "tags": string[], "time": string } ] }，不要包含任何多余文字。\\n2. 每个事件：\\n   - title：一句话概括事件或待办事项，简短且有可执行性。\\n   - context：从原文中提炼的详细说明，包含背景、目的、约束等。\\n   - tags：提取 1～5 个标签，例如：["工作", "学习", "会议", "重要", "待办"]。\\n   - time：如果原文中有明确时间（如“明天上午10点”“3月1日之前”），请标准化为自然语言短语；如果没有明确时间，请用空字符串 ""。\\n3. 忽略完全重复或无实际行动意义的描述（如泛泛的感受、无具体动作的感想）。\\n4. 若无法提取任何事件，请返回 { "events": [] }。'
    },
    sidebarOpen: true,
    chatOpen: false,
    eventOpen: false,
    chatLoading: false,
    eventLoading: false
};

// 自动保存到 localStorage
window.withAutoSave = function(fn) {
    fn();
    saveDataToLocalStorage();
    if (window.renderNoteList) renderNoteList();
    if (window.renderEvents && state.eventOpen) renderEvents();
    if (window.updateChatContextUI) updateChatContextUI();
};

function saveDataToLocalStorage() {
    try {
        const data = {
            notes: state.notes,
            events: state.events.map(e => ({ ...e, expanded: false }))
        };
        localStorage.setItem('notemind_notes_events', JSON.stringify(data));
        syncNotesAndEventsToServer(data);
    } catch (e) {
        console.error('保存到localStorage失败', e);
    }
}

async function syncNotesAndEventsToServer(data) {
    try {
        await fetch('http://127.0.0.1:5002/api/sync/notes-events', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                notes: data.notes || [],
                events: data.events || []
            })
        });
    } catch (e) {
        console.error('同步到本地文件失败', e);
    }
}

window.loadDataFromLocalStorage = function() {
    const stored = localStorage.getItem('notemind_notes_events');
    if (stored) {
        try {
            const { notes, events } = JSON.parse(stored);
            if (Array.isArray(notes)) state.notes = notes;
            if (Array.isArray(events)) state.events = events.map(e => ({ ...e, expanded: false }));
        } catch (e) {
            console.error('解析localStorage数据失败', e);
        }
    }

    // 如果没有笔记，添加示例笔记
    if (!state.notes.length) {
        state.notes = [
            { id: '1', title: '项目规划会议', content: '# 会议记录\n\n- [ ] 确定UI卡片圆角风格（今天）\n- [ ] 实现拖拽修改列宽功能', updatedAt: new Date().toISOString() },
            { id: '2', title: '学习计划', content: '本周重点：\n1. 深入学习 Tailwind\n2. 整理Flex布局的最佳实践\n*注意：下周一需要提交 Demo*。', updatedAt: new Date(Date.now() - 86400000).toISOString() }
        ];
    }

    if (!state.currentNoteId && state.notes.length) {
        state.currentNoteId = state.notes[0].id;
    }
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