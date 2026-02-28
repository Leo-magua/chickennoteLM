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
    const { apiKey, baseUrl, model, systemPromptChat } = state.settings;

    if (!apiKey) throw new Error('请先配置 API Key');
    if (!baseUrl) throw new Error('请先配置 Base URL');

    // 确保baseUrl末尾没有斜杠
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');

    const response = await fetch(`${cleanBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
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
        const err = await response.text();
        throw new Error(`HTTP ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

function addChatMessage(role, text, id = null) {
    const container = document.getElementById('chatMessages');
    const isAI = role === 'ai';
    const msgDiv = document.createElement('div');
    msgDiv.className = `flex ${isAI ? 'justify-start' : 'justify-end'} animate-fade-in`;

    let contentHtml;
    if (isAI) {
        // loading 消息保持原样 HTML
        if (id && typeof id === 'string' && id.startsWith('loading-')) {
            contentHtml = text;
        } else {
            contentHtml = renderMarkdown(text);
        }
    } else {
        contentHtml = escapeHtmlForChat(text).replace(/\n/g, '<br>');
    }

    const bubbleClass = isAI
        ? 'bg-white border border-slate-200 text-slate-800 markdown-body'
        : 'bg-blue-600 text-white';

    msgDiv.innerHTML = `<div class="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${bubbleClass}">${contentHtml}</div>`;
    if (id) msgDiv.id = id;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
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
        const res = await fetch('http://127.0.0.1:5002/api/chats', { method: 'GET' });
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
        await fetch(`http://127.0.0.1:5002/api/chats/${encodeURIComponent(state.currentChatId)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
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
        const res = await fetch('http://127.0.0.1:5002/api/chats', { method: 'GET' });
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
        const res = await fetch(`http://127.0.0.1:5002/api/chats/${encodeURIComponent(chatId)}`, { method: 'GET' });
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
        const res = await fetch('http://127.0.0.1:5002/api/chats', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
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
    const pills = Array.from(state.chatContext).map(id => {
        const note = state.notes.find(n => n.id === id);
        if (!note) return '';
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
            ${note.title} <button onclick="state.chatContext.delete('${id}'); updateChatContextUI()" class="ml-1 hover:text-red-500">×</button>
        </span>`;
    }).join('');
    container.innerHTML = pills || '<span class="text-xs text-slate-400">未选择上下文</span>';
}

// 导出函数
window.sendChatMessage = sendChatMessage;
window.handleChatKeydown = handleChatKeydown;
window.importCurrentNoteToChat = importCurrentNoteToChat;
window.updateChatContextUI = updateChatContextUI;
window.addChatMessage = addChatMessage;
