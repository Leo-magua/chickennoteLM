// js/chat.js - AI对话模块（真实API）

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || state.chatLoading) return;

    await ensureCurrentChatSession();

    // 添加用户消息
    addChatMessage('user', text);
    state.currentChatMessages.push({
        role: 'user',
        content: text,
        time: new Date().toISOString()
    });
    input.value = '';

    // 准备上下文笔记内容
    const contextNotes = Array.from(state.chatContext).map(id => {
        const note = state.notes.find(n => n.id === id);
        return note ? `【${note.title}】\n${note.content}` : '';
    }).filter(Boolean).join('\n\n---\n\n');

    const prompt = contextNotes
        ? `基于以下笔记内容：\n${contextNotes}\n\n请回答：${text}`
        : text;

    // 显示加载占位
    const loadingMsgId = 'loading-' + Date.now();
    addChatMessage('ai', '<span class="loading-dots">AI 思考中</span>', loadingMsgId);
    state.chatLoading = true;

    try {
        const response = await callChatAPI(prompt);
        // 替换加载消息为实际回复
        document.getElementById(loadingMsgId)?.remove();
        addChatMessage('ai', response);
        state.currentChatMessages.push({
            role: 'assistant',
            content: response,
            time: new Date().toISOString()
        });
        saveCurrentChatToServer();
    } catch (error) {
        document.getElementById(loadingMsgId)?.remove();
        addChatMessage('ai', '❌ 调用失败: ' + error.message);
    } finally {
        state.chatLoading = false;
    }
}

async function callChatAPI(prompt) {
    var apiKey = state.settings.apiKey;
    var baseUrl = (state.settings.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    var model = state.settings.model || 'gpt-3.5-turbo';
    var systemPromptChat = state.settings.systemPromptChat;
    if (!apiKey) throw new Error('请先配置 API Key');
    if (!baseUrl) throw new Error('请先配置 Base URL');

    var response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': apiKey ? ('Bearer ' + apiKey) : ''
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: systemPromptChat },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7
        })
    });

    if (!response.ok) {
        var err = await response.text();
        throw new Error('HTTP ' + response.status + ': ' + (err || response.statusText));
    }

    var data = await response.json();
    return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : (data.message || JSON.stringify(data));
}

function addChatMessage(role, text, id) {
    var container = document.getElementById('chatMessages');
    var isAI = role === 'ai';
    var msgDiv = document.createElement('div');
    msgDiv.className = 'flex ' + (isAI ? 'justify-start' : 'justify-end') + ' animate-fade-in';

    var contentHtml;
    if (isAI) {
        if (id && typeof id === 'string' && id.startsWith('loading-')) {
            contentHtml = text;
        } else {
            contentHtml = renderMarkdown(text);
        }
    } else {
        contentHtml = escapeHtmlForChat(text).replace(/\n/g, '<br>');
    }

    var bubbleClass = isAI
        ? 'bg-white border border-slate-200 text-slate-800 markdown-body'
        : 'bg-blue-600 text-white';

    var msgId = id || 'msg-' + Date.now();
    if (isAI && (!id || !id.startsWith('loading-'))) {
        msgDiv.id = msgId;
        msgDiv.setAttribute('data-raw-content', text);
        msgDiv.innerHTML =
            '<div class="max-w-[85%]">' +
            '<div class="rounded-2xl px-3.5 py-2.5 text-sm ' + bubbleClass + '">' + contentHtml + '</div>' +
            '<div class="flex items-center gap-1 mt-1.5 pl-1 text-slate-400">' +
            '<button type="button" class="p-1.5 rounded hover:bg-slate-100 hover:text-slate-600" title="保存到当前笔记" onclick="chatActionSaveToNote(this)">' + iconSave() + '</button>' +
            '<button type="button" class="p-1.5 rounded hover:bg-slate-100 hover:text-slate-600" title="重新生成" onclick="chatActionRegenerate(this)">' + iconRegenerate() + '</button>' +
            '<button type="button" class="p-1.5 rounded hover:bg-slate-100 hover:text-slate-600" title="插入当前笔记" onclick="chatActionInsertToNote(this)">' + iconInsert() + '</button>' +
            '<button type="button" class="p-1.5 rounded hover:bg-slate-100 hover:text-slate-600" title="创建为新笔记" onclick="chatActionCreateNote(this)">' + iconNewNote() + '</button>' +
            '</div></div>';
    } else {
        msgDiv.innerHTML = '<div class="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ' + bubbleClass + '">' + contentHtml + '</div>';
        if (id) msgDiv.id = id;
    }
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function iconSave() {
    return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>';
}
function iconRegenerate() {
    return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>';
}
function iconInsert() {
    return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>';
}
function iconNewNote() {
    return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>';
}

function getChatMessageContent(btn) {
    var wrap = btn.closest('[data-raw-content]');
    return wrap ? wrap.getAttribute('data-raw-content') || '' : '';
}

function chatActionSaveToNote(btn) {
    var content = getChatMessageContent(btn);
    if (!content) return;
    var note = state.notes.find(function (n) { return n.id === state.currentNoteId; });
    if (!note) {
        showToast('请先选择或新建一个笔记');
        return;
    }
    withAutoSave(function () {
        note.content = (note.content || '').trim() + (note.content ? '\n\n' : '') + content;
        note.updatedAt = new Date().toISOString();
    });
    var editor = document.getElementById('noteEditor');
    if (editor) editor.value = note.content;
    showToast('已追加到当前笔记');
}

function chatActionRegenerate(btn) {
    var content = getChatMessageContent(btn);
    var wrap = btn.closest('[data-raw-content]');
    if (!wrap) return;
    var msgIdx = -1;
    for (var i = 0; i < state.currentChatMessages.length; i++) {
        if (state.currentChatMessages[i].role === 'assistant' && state.currentChatMessages[i].content === content) {
            msgIdx = i;
            break;
        }
    }
    var lastUserContent = null;
    if (msgIdx > 0) {
        for (var j = msgIdx - 1; j >= 0; j--) {
            if (state.currentChatMessages[j].role === 'user') {
                lastUserContent = state.currentChatMessages[j].content;
                break;
            }
        }
    }
    if (!lastUserContent) {
        showToast('无法重新生成：未找到对应的用户消息');
        return;
    }
    wrap.remove();
    if (msgIdx !== -1) state.currentChatMessages.splice(msgIdx, 1);

    var loadingMsgId = 'loading-' + Date.now();
    addChatMessage('ai', '<span class="loading-dots">AI 思考中</span>', loadingMsgId);
    state.chatLoading = true;

    var contextNotes = Array.from(state.chatContext).map(function (id) {
        var n = state.notes.find(function (x) { return x.id === id; });
        return n ? '【' + n.title + '】\n' + n.content : '';
    }).filter(Boolean).join('\n\n---\n\n');
    var prompt = contextNotes
        ? '基于以下笔记内容：\n' + contextNotes + '\n\n请回答：' + lastUserContent
        : lastUserContent;

    callChatAPI(prompt).then(function (response) {
        document.getElementById(loadingMsgId) && document.getElementById(loadingMsgId).remove();
        addChatMessage('ai', response);
        state.currentChatMessages.push({ role: 'assistant', content: response, time: new Date().toISOString() });
        saveCurrentChatToServer();
        showToast('已重新生成');
    }).catch(function (err) {
        document.getElementById(loadingMsgId) && document.getElementById(loadingMsgId).remove();
        addChatMessage('ai', '❌ 调用失败: ' + err.message);
        showToast('重新生成失败');
    }).finally(function () {
        state.chatLoading = false;
    });
}

function chatActionInsertToNote(btn) {
    var content = getChatMessageContent(btn);
    if (!content) return;
    var note = state.notes.find(function (n) { return n.id === state.currentNoteId; });
    if (!note) {
        showToast('请先选择或新建一个笔记');
        return;
    }
    var editor = document.getElementById('noteEditor');
    var insertText = (note.content || '').trim() + (note.content ? '\n\n' : '') + content;
    withAutoSave(function () {
        note.content = insertText;
        note.updatedAt = new Date().toISOString();
    });
    if (editor) editor.value = insertText;
    showToast('已插入到当前笔记');
}

function chatActionCreateNote(btn) {
    var content = getChatMessageContent(btn);
    if (!content) return;
    withAutoSave(function () {
        var newNote = {
            id: Date.now().toString(),
            title: 'AI 生成笔记',
            content: content,
            updatedAt: new Date().toISOString()
        };
        state.notes.unshift(newNote);
        state.currentNoteId = newNote.id;
    });
    loadNote(state.currentNoteId);
    renderNoteList();
    showToast('已创建为新笔记');
}

function escapeHtmlForChat(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderMarkdown(text) {
    if (!text) return '';
    if (window.marked) {
        return window.marked.parse(text);
    }
    return escapeHtmlForChat(text).replace(/\n/g, '<br>');
}

async function ensureCurrentChatSession() {
    if (state.currentChatId) return;
    try {
        const res = await fetch(window.cnApi('api/chats'), { method: 'GET', credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            state.chatSessions = data.chats || [];
        }
    } catch (e) {
        console.error('加载会话列表失败', e);
    }

    if (!state.currentChatId) {
        await createNewChatSession(false);
    }
}

async function saveCurrentChatToServer() {
    if (!state.currentChatId) return;
    try {
        await fetch(window.cnApi(`api/chats/${encodeURIComponent(state.currentChatId)}`), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                messages: state.currentChatMessages
            })
        });
        await loadChatHistoryList();
    } catch (e) {
        console.error('保存会话失败', e);
    }
}

async function loadChatHistoryList() {
    const select = document.getElementById('chatSessionSelect');
    if (!select) return;
    try {
        const res = await fetch(window.cnApi('api/chats'), { method: 'GET', credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        state.chatSessions = data.chats || [];
        renderChatSessionOptions();
    } catch (e) {
        console.error('加载会话历史失败', e);
    }
}

function renderChatSessionOptions() {
    const select = document.getElementById('chatSessionSelect');
    if (!select) return;
    const chats = state.chatSessions || [];
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = chats.length ? '选择历史对话...' : '暂无历史对话';
    select.appendChild(placeholder);

    chats.forEach(chat => {
        const opt = document.createElement('option');
        opt.value = chat.id;
        opt.textContent = chat.title || chat.id;
        if (chat.id === state.currentChatId) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
}

async function handleChatSessionChange(selectEl) {
    const chatId = selectEl.value;
    if (!chatId) return;
    try {
        const res = await fetch(window.cnApi(`api/chats/${encodeURIComponent(chatId)}`), { method: 'GET', credentials: 'include' });
        if (!res.ok) return;
        const chat = await res.json();
        state.currentChatId = chat.id;
        state.currentChatMessages = chat.messages || [];
        clearChatMessagesUI();
        (chat.messages || []).forEach(msg => {
            if (msg.role === 'user') {
                addChatMessage('user', msg.content);
            } else {
                addChatMessage('ai', msg.content);
            }
        });
    } catch (e) {
        console.error('加载会话失败', e);
    }
}

function clearChatMessagesUI() {
    const container = document.getElementById('chatMessages');
    if (container) {
        container.innerHTML = '<div class="text-center text-slate-400 text-sm py-8">开始对话，AI 将基于选中的笔记内容回答</div>';
    }
}

async function createNewChatSession(withPrompt = true) {
    let title = '';
    if (withPrompt) {
        title = prompt('请输入新对话标题（可留空自动生成）：') || '';
    }
    try {
        const res = await fetch(window.cnApi('api/chats'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ title: title })
        });
        if (!res.ok) return;
        const chat = await res.json();
        state.currentChatId = chat.id;
        state.currentChatMessages = [];
        await loadChatHistoryList();
        clearChatMessagesUI();
    } catch (e) {
        console.error('新建会话失败', e);
    }
}

window.loadChatHistoryList = loadChatHistoryList;
window.handleChatSessionChange = handleChatSessionChange;
window.createNewChatSession = createNewChatSession;

function handleChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
}

function importCurrentNoteToChat() {
    state.chatContext.add(state.currentNoteId);
    if (!state.chatOpen) toggleAIChat();
    updateChatContextUI();
}

function updateChatContextUI() {
    const container = document.getElementById('chatContext');
    if (!container) return;
    const pills = Array.from(state.chatContext).map(id => {
        const note = state.notes.find(n => n.id === id);
        if (!note) return '';
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
            ${escapeHtmlForChat(note.title)} <button type="button" onclick="state.chatContext.delete('${id}'); updateChatContextUI()" class="ml-1 hover:text-red-500" title="移除">×</button>
        </span>`;
    }).join('');
    container.innerHTML = pills || '<span class="text-xs text-slate-400">未选择上下文</span>';
}

function toggleAddNoteToChatMenu(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const el = document.getElementById('addNoteToChatDropdown');
    if (!el) return;
    if (el.classList.contains('hidden')) {
        renderAddNoteToChatMenu();
        el.classList.remove('hidden');
        setTimeout(function () {
            document.addEventListener('click', closeAddNoteToChatMenuOnClick);
        }, 0);
    } else {
        el.classList.add('hidden');
        document.removeEventListener('click', closeAddNoteToChatMenuOnClick);
    }
}

function closeAddNoteToChatMenuOnClick(e) {
    var dropdown = document.getElementById('addNoteToChatDropdown');
    var addBtn = document.getElementById('addNoteToChatBtn');
    if (dropdown && (dropdown.contains(e.target) || (addBtn && addBtn.contains(e.target)))) return;
    document.removeEventListener('click', closeAddNoteToChatMenuOnClick);
    if (dropdown) dropdown.classList.add('hidden');
}

function renderAddNoteToChatMenu() {
    const el = document.getElementById('addNoteToChatDropdown');
    if (!el) return;
    var html = '';
    (state.notes || []).forEach(function (note) {
        var inContext = state.chatContext.has(note.id);
        html += '<button type="button" class="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 flex items-center gap-2 ' + (inContext ? 'text-slate-400' : 'text-slate-700') + '" onclick="event.stopPropagation(); addNoteToChatContext(\'' + note.id + '\'); document.getElementById(\'addNoteToChatDropdown\').classList.add(\'hidden\'); document.removeEventListener(\'click\', closeAddNoteToChatMenuOnClick); updateChatContextUI();">' +
            (inContext ? '<span class="text-green-500">✓</span>' : '<span class="w-4"></span>') +
            escapeHtmlForChat(note.title || '未命名') + '</button>';
    });
    el.innerHTML = html || '<div class="px-3 py-2 text-sm text-slate-400">暂无笔记</div>';
}

function addNoteToChatContext(noteId) {
    state.chatContext.add(noteId);
}

// 导出函数
window.sendChatMessage = sendChatMessage;
window.handleChatKeydown = handleChatKeydown;
window.importCurrentNoteToChat = importCurrentNoteToChat;
window.updateChatContextUI = updateChatContextUI;
window.addChatMessage = addChatMessage;
window.toggleAddNoteToChatMenu = toggleAddNoteToChatMenu;
window.closeAddNoteToChatMenuOnClick = closeAddNoteToChatMenuOnClick;
window.addNoteToChatContext = addNoteToChatContext;
window.chatActionSaveToNote = chatActionSaveToNote;
window.chatActionRegenerate = chatActionRegenerate;
window.chatActionInsertToNote = chatActionInsertToNote;
window.chatActionCreateNote = chatActionCreateNote;
