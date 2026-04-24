// js/events.js - 事件提取模块（真实API）

// 事件提醒相关状态
let _eventReminderInterval = null;
let _notifiedEventIds = new Set(); // 已提醒过的事件ID（本次会话）

// 事件状态定义
const EVENT_STATUS = {
    TODO: 'todo',
    IN_PROGRESS: 'in_progress',
    DONE: 'done'
};

const STATUS_CONFIG = {
    [EVENT_STATUS.TODO]: {
        label: '',
        bgClass: 'bg-slate-100',
        textClass: 'text-slate-600',
        borderClass: 'border-slate-200',
        dotClass: 'bg-slate-400',
        next: EVENT_STATUS.IN_PROGRESS
    },
    [EVENT_STATUS.IN_PROGRESS]: {
        label: '',
        bgClass: 'bg-blue-50',
        textClass: 'text-blue-700',
        borderClass: 'border-blue-200',
        dotClass: 'bg-blue-500',
        next: EVENT_STATUS.DONE
    },
    [EVENT_STATUS.DONE]: {
        label: '',
        bgClass: 'bg-green-50',
        textClass: 'text-green-700',
        borderClass: 'border-green-200',
        dotClass: 'bg-green-500',
        next: EVENT_STATUS.TODO
    }
};

// 当前事件面板视图模式: 'list' | 'kanban'
let _eventViewMode = 'list';

async function extractEventsFromNotes(notes) {
    if (state.eventLoading) return;

    const content = notes.map(n => `【${n.title}】\n${n.content}`).join('\n\n---\n\n');
    if (!content) return;

    state.eventLoading = true;
    showToast('正在提取事件...', 0); // 持续显示

    try {
        const eventsData = await callEventExtractAPI(content);
        withAutoSave(() => {
            eventsData.forEach(ev => {
                // 尝试从AI提取的time字段解析截止日期
                let dueDate = '';
                if (ev.time && typeof ev.time === 'string' && ev.time.trim()) {
                    const parsed = parseNaturalDate(ev.time.trim());
                    if (parsed) dueDate = parsed.toISOString();
                }
                state.events.unshift({
                    id: 'evt_' + Math.random().toString(36).substr(2, 9),
                    title: ev.title || '未命名事件',
                    context: ev.context || ev.description || '',
                    createTime: new Date().toISOString(),
                    lastTime: new Date().toISOString(),
                    tags: ev.tags || [],
                    expanded: false,
                    dueDate: dueDate,       // 截止日期 ISO 字符串
                    notified: false,        // 是否已发送过提醒
                    status: EVENT_STATUS.TODO  // 默认状态：待办
                });
            });
        });
        if (!state.eventOpen) toggleEventModule();
        showToast(`提取到 ${eventsData.length} 个事件`);
    } catch (error) {
        showToast('提取失败: ' + error.message);
        console.error('事件提取错误', error);
    } finally {
        state.eventLoading = false;
    }
}

/**
 * 尝试解析自然语言日期为 Date 对象
 * 支持：YYYY-MM-DD, YYYY/MM/DD, MM-DD, MM/DD, "明天", "后天", "下周X"
 */
function parseNaturalDate(str) {
    if (!str) return null;
    const now = new Date();
    const s = str.trim();

    // 今天
    if (s.includes('今天')) {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59);
    }
    // 明天
    if (s.includes('明天')) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59);
        return d;
    }
    // 后天
    if (s.includes('后天')) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 23, 59);
        return d;
    }
    // 下周
    const weekMap = { '日':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'天':0 };
    const weekMatch = s.match(/下周([日一二三四五六天])/);
    if (weekMatch) {
        const targetDay = weekMap[weekMatch[1]];
        if (targetDay !== undefined) {
            const daysUntil = (7 - now.getDay() + targetDay) % 7 || 7;
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntil, 23, 59);
            return d;
        }
    }
    // 标准日期格式
    const isoMatch = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (isoMatch) {
        const d = new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]), 23, 59);
        if (!isNaN(d.getTime())) return d;
    }
    const shortMatch = s.match(/(\d{1,2})[-\/](\d{1,2})/);
    if (shortMatch) {
        const month = parseInt(shortMatch[1]) - 1;
        const day = parseInt(shortMatch[2]);
        const d = new Date(now.getFullYear(), month, day, 23, 59);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
}

async function callEventExtractAPI(text) {
    const { apiKey, baseUrl, model, systemPromptEventExtract } = state.settings;
    if (!apiKey) throw new Error('请先配置 API Key');

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
                { role: 'system', content: systemPromptEventExtract },
                { role: 'user', content: text }
            ],
            temperature: 0.3
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`HTTP ${response.status}: ${err}`);
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;

    // 尝试解析JSON
    try {
        // 查找JSON块（可能被```json包裹）
        const jsonMatch = reply.match(/```json\s*([\s\S]*?)\s*```/) || reply.match(/```\s*([\s\S]*?)\s*```/);
        const jsonStr = jsonMatch ? jsonMatch[1] : reply;
        const parsed = JSON.parse(jsonStr);
        return parsed.events || [];
    } catch (e) {
        console.error('解析事件JSON失败', reply);
        throw new Error('AI返回格式错误，无法解析为事件列表');
    }
}

function extractEventsFromCurrent() {
    const currentNote = state.notes.find(n => n.id === state.currentNoteId);
    if (currentNote) extractEventsFromNotes([currentNote]);
}

function extractAllEvents() {
    extractEventsFromNotes(state.notes);
}

/**
 * 获取引用指定事件的所有笔记
 * @param {string} eventId - 事件ID
 * @returns {Array<{id: string, title: string}>} - 关联笔记列表
 */
function getLinkedNotesForEvent(eventId) {
    if (!eventId || !state.notes || !state.notes.length) return [];
    const eventRefPattern = new RegExp('\\[\\[event:' + escapeRegExp(eventId) + '\\]\\]', 'g');
    return state.notes
        .filter(note => eventRefPattern.test(note.content || ''))
        .map(note => ({ id: note.id, title: note.title || '未命名笔记' }));
}

function renderEvents() {
    const container = document.getElementById('eventList');
    updateGlobalTags();

    if (state.events.length === 0) {
        container.innerHTML = `<div class="text-center text-slate-400 text-sm py-8">暂无事件</div>`;
        return;
    }

    // 过滤
    let displayEvents = state.events;
    if (state.activeTagFilter) {
        displayEvents = displayEvents.filter(e => e.tags.includes(state.activeTagFilter));
    }
    if (state.activeStatusFilter) {
        displayEvents = displayEvents.filter(e => e.status === state.activeStatusFilter);
    }

    // 看板视图
    if (_eventViewMode === 'kanban') {
        renderKanbanView(container, displayEvents);
        return;
    }

    // 排序
    let sortedEvents = [...displayEvents];
    sortedEvents.sort((a, b) => {
        // 支持按截止日期排序
        if (state.eventSort === 'due_asc' || state.eventSort === 'due_desc') {
            const timeA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
            const timeB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
            return state.eventSort === 'due_desc' ? timeB - timeA : timeA - timeB;
        }
        const timeA = new Date(state.eventSort.startsWith('create') ? a.createTime : a.lastTime).getTime();
        const timeB = new Date(state.eventSort.startsWith('create') ? b.createTime : b.lastTime).getTime();
        return state.eventSort.endsWith('desc') ? timeB - timeA : timeA - timeB;
    });

    container.innerHTML = sortedEvents.map(event => {
        const dueInfo = getDueInfo(event.dueDate);
        const dueBadge = dueInfo.text
            ? `<span class="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${dueInfo.class}">${dueInfo.text}</span>`
            : '';
        const statusCfg = STATUS_CONFIG[event.status] || STATUS_CONFIG[EVENT_STATUS.TODO];
        const statusBadge = `<span class="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${statusCfg.bgClass} ${statusCfg.textClass} border ${statusCfg.borderClass} flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity"
              onclick="cycleEventStatus('${event.id}', event)"
              title="点击切换状态">
            <span class="w-1.5 h-1.5 rounded-full ${statusCfg.dotClass}"></span>
            ${statusCfg.label}
        </span>`;
        // 获取关联笔记
        const linkedNotes = getLinkedNotesForEvent(event.id);
        const linkedNotesHtml = linkedNotes.length > 0
            ? `<div class="mt-2 pt-2 border-t border-amber-100">
                <div class="text-[10px] text-slate-500 mb-1 flex items-center gap-1">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    关联笔记 (${linkedNotes.length})
                </div>
                <div class="flex flex-wrap gap-1">
                    ${linkedNotes.map(n => `
                        <button onclick="loadNote('${n.id}')" class="text-[11px] px-2 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200 hover:bg-blue-100 transition-colors truncate max-w-[200px]" title="${escapeHtml(n.title)}">
                            ${escapeHtml(n.title)}
                        </button>
                    `).join('')}
                </div>
            </div>`
            : '';
        return `
        <div class="event-card bg-white border ${event.expanded ? 'border-amber-300 ring-4 ring-amber-50 shadow-md' : 'border-slate-200 hover:border-amber-200'} rounded-xl overflow-hidden cursor-pointer"
             onclick="toggleEventDetail('${event.id}', event)"
             draggable="true"
             ondragstart="handleEventDragStart(event, '${event.id}')">

            <!-- Collapsed View -->
            <div class="${event.expanded ? 'hidden' : 'block'} p-3">
                <div class="flex justify-between items-start gap-2">
                    <h4 class="font-medium text-slate-800 text-sm leading-tight line-clamp-2 flex-1">${escapeHtml(event.title)}</h4>
                    <div class="flex items-center gap-1.5 flex-shrink-0">
                        ${statusBadge}
                        ${dueBadge}
                        <span class="text-[10px] text-slate-400">${formatDateShort(event.createTime)}</span>
                    </div>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                    ${event.tags.map(tag => `<span class="text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">#${escapeHtml(tag)}</span>`).join('')}
                </div>
                ${linkedNotes.length > 0 ? `<div class="mt-1.5 flex items-center gap-1 text-[10px] text-blue-500">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    ${linkedNotes.length} 篇关联笔记
                </div>` : ''}
            </div>

            <!-- Expanded / Edit View -->
            <div class="${event.expanded ? 'block' : 'hidden'} p-3 bg-amber-50/20" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-[10px] text-slate-400">创建于: ${formatDateShort(event.createTime)}</span>
                    <div class="flex gap-1">
                        <button onclick="deleteEvent('${event.id}', event)" class="text-red-400 hover:text-red-600 transition-colors" title="删除事件">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                        <button onclick="toggleEventDetail('${event.id}', event)" class="text-slate-400 hover:text-slate-600" title="展开/折叠">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg>
                        </button>
                    </div>
                </div>

                <input type="text" value="${escapeHtml(event.title)}"
                       onchange="updateEventField('${event.id}', 'title', this.value)"
                       class="w-full font-semibold text-slate-800 bg-white border border-amber-200 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 rounded-md px-2 py-1.5 mb-2 text-sm outline-none transition-colors">

                <!-- 状态选择 -->
                <div class="mb-2 flex items-center gap-2">
                    <label class="text-xs text-slate-500 whitespace-nowrap">状态:</label>
                    <select onchange="updateEventStatus('${event.id}', this.value)"
                            class="flex-1 text-xs bg-white border border-amber-200 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 rounded-md px-2 py-1 outline-none transition-colors">
                        <option value="${EVENT_STATUS.TODO}" ${event.status === EVENT_STATUS.TODO ? 'selected' : ''}>📝 待办</option>
                        <option value="${EVENT_STATUS.IN_PROGRESS}" ${event.status === EVENT_STATUS.IN_PROGRESS ? 'selected' : ''}>🔄 进行中</option>
                        <option value="${EVENT_STATUS.DONE}" ${event.status === EVENT_STATUS.DONE ? 'selected' : ''}>✅ 已完成</option>
                    </select>
                </div>

                <!-- 截止日期设置 -->
                <div class="mb-2 flex items-center gap-2">
                    <label class="text-xs text-slate-500 whitespace-nowrap">截止日期:</label>
                    <input type="datetime-local"
                           value="${event.dueDate ? formatDateTimeLocal(event.dueDate) : ''}"
                           onchange="updateEventDueDate('${event.id}', this.value)"
                           class="flex-1 text-xs bg-white border border-amber-200 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 rounded-md px-2 py-1 outline-none transition-colors">
                    ${event.dueDate ? `<button onclick="clearEventDueDate('${event.id}')" class="text-xs text-slate-400 hover:text-red-500 transition-colors" title="清除截止日期">×</button>` : ''}
                </div>

                <textarea oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"
                          onchange="updateEventField('${event.id}', 'context', this.value)"
                          class="w-full text-sm text-slate-600 bg-white border border-amber-200 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 rounded-md px-2 py-1.5 mb-3 min-h-[80px] outline-none overflow-hidden resize-none transition-colors">${escapeHtml(event.context)}</textarea>

                <div class="flex flex-wrap items-center gap-1.5">
                    ${event.tags.map(tag => `
                        <span class="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded-full border border-amber-200 flex items-center gap-1">
                            ${escapeHtml(tag)}
                            <button onclick="removeTag('${event.id}', '${escapeHtml(tag)}', event)" class="hover:bg-amber-200 text-amber-600 rounded-full w-3.5 h-3.5 flex items-center justify-center transition-colors" title="移除标签">×</button>
                        </span>
                    `).join('')}
                    <button onclick="addTag('${event.id}', event)" class="px-2 py-0.5 bg-white border border-dashed border-amber-300 text-amber-600 text-xs rounded-full hover:bg-amber-50 transition-colors flex items-center" title="添加标签">
                        + 添加标签
                    </button>
                </div>
                ${linkedNotesHtml}
            </div>
        </div>
    `}).join('');
}

/**
 * 根据截止日期返回状态文本和样式类
 */
function getDueInfo(dueDate) {
    if (!dueDate) return { text: '', class: '' };
    const now = Date.now();
    const due = new Date(dueDate).getTime();
    const diffHours = (due - now) / (1000 * 60 * 60);
    const diffDays = diffHours / 24;

    if (diffHours < 0) {
        return { text: '已逾期', class: 'bg-red-100 text-red-700 border border-red-200' };
    }
    if (diffHours <= 24) {
        return { text: '即将到期', class: 'bg-orange-100 text-orange-700 border border-orange-200' };
    }
    if (diffDays <= 3) {
        return { text: diffDays <= 1 ? '1天内' : Math.ceil(diffDays) + '天内', class: 'bg-amber-100 text-amber-700 border border-amber-200' };
    }
    return { text: formatDateShort(dueDate), class: 'bg-slate-100 text-slate-500 border border-slate-200' };
}

/**
 * 将ISO日期转为 datetime-local 输入框格式: YYYY-MM-DDTHH:mm
 */
function formatDateTimeLocal(iso) {
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function updateEventDueDate(id, value) {
    withAutoSave(() => {
        const evt = state.events.find(e => e.id === id);
        if (evt) {
            evt.dueDate = value ? new Date(value).toISOString() : '';
            evt.lastTime = new Date().toISOString();
            evt.notified = false; // 重置提醒状态
        }
    });
}

function clearEventDueDate(id) {
    withAutoSave(() => {
        const evt = state.events.find(e => e.id === id);
        if (evt) {
            evt.dueDate = '';
            evt.lastTime = new Date().toISOString();
            evt.notified = false;
        }
    });
}

// 简单的HTML转义
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function toggleEventDetail(id, eventObj) {
    const evt = state.events.find(e => e.id === id);
    if (evt) {
        evt.expanded = !evt.expanded;
        renderEvents();
        if (evt.expanded) {
            setTimeout(() => {
                const textareas = document.querySelectorAll('#eventList textarea');
                textareas.forEach(ta => {
                    ta.style.height = 'auto';
                    ta.style.height = ta.scrollHeight + 'px';
                });
            }, 10);
        }
    }
}

function updateEventField(id, field, value) {
    withAutoSave(() => {
        const evt = state.events.find(e => e.id === id);
        if (evt) {
            evt[field] = value;
            evt.lastTime = new Date().toISOString();
        }
    });
}

function deleteEvent(id, e) {
    e.stopPropagation();
    withAutoSave(() => {
        state.events = state.events.filter(ev => ev.id !== id);
    });
}

function addTag(id, e) {
    e.stopPropagation();
    const tag = prompt('输入新标签名:');
    if (tag && tag.trim()) {
        withAutoSave(() => {
            const evt = state.events.find(ev => ev.id === id);
            if (evt && !evt.tags.includes(tag.trim())) {
                evt.tags.push(tag.trim());
                evt.lastTime = new Date().toISOString();
            }
        });
    }
}

function removeTag(id, tag, e) {
    e.stopPropagation();
    withAutoSave(() => {
        const evt = state.events.find(ev => ev.id === id);
        if (evt) {
            evt.tags = evt.tags.filter(t => t !== tag);
            evt.lastTime = new Date().toISOString();
        }
    });
}

function filterByTag(tag) {
    state.activeTagFilter = state.activeTagFilter === tag ? null : tag;
    renderEvents();
}

function updateGlobalTags() {
    const tags = new Set();
    state.events.forEach(e => e.tags.forEach(t => tags.add(t)));
    const container = document.getElementById('allTagsContainer');

    if (tags.size === 0) {
        container.innerHTML = '<span class="text-xs text-slate-400">暂无识别标签</span>';
    } else {
        let html = `<button onclick="filterByTag(null)" class="px-2.5 py-1 rounded-md border text-xs shadow-sm whitespace-nowrap transition-colors focus:outline-none ${state.activeTagFilter === null ? 'bg-amber-100 border-amber-300 text-amber-800 font-medium' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}" title="全部">∷</button>`;

        html += Array.from(tags).map(tag => {
            const isActive = state.activeTagFilter === tag;
            return `<button onclick="filterByTag('${tag}')" class="ml-1 px-2.5 py-1 rounded-md border text-xs shadow-sm whitespace-nowrap transition-colors focus:outline-none ${isActive ? 'bg-amber-100 border-amber-300 text-amber-800 font-medium' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}" title="筛选标签">#${escapeHtml(tag)}</button>`;
        }).join('');
        container.innerHTML = html;
    }

    // 更新状态筛选按钮样式
    updateStatusFilterUI();
    // 更新视图模式按钮
    updateViewModeUI();
}

function updateStatusFilterUI() {
    const statuses = [
        { key: null, id: 'statusFilter-all' },
        { key: 'todo', id: 'statusFilter-todo' },
        { key: 'in_progress', id: 'statusFilter-in_progress' },
        { key: 'done', id: 'statusFilter-done' }
    ];
    statuses.forEach(s => {
        const btn = document.getElementById(s.id);
        if (!btn) return;
        const isActive = state.activeStatusFilter === s.key;
        if (isActive) {
            btn.className = 'text-[11px] px-2 py-0.5 rounded-md border transition-colors whitespace-nowrap bg-amber-100 border-amber-300 text-amber-800 font-medium';
        } else {
            btn.className = 'text-[11px] px-2 py-0.5 rounded-md border transition-colors whitespace-nowrap bg-white border-slate-200 text-slate-600 hover:bg-slate-50';
        }
    });
}

function updateViewModeUI() {
    const btn = document.getElementById('eventViewModeBtn');
    const label = document.getElementById('eventViewModeLabel');
    if (btn && label) {
        label.textContent = '';
        if (_eventViewMode === 'kanban') {
            btn.classList.add('bg-amber-50', 'border-amber-300', 'text-amber-700');
        } else {
            btn.classList.remove('bg-amber-50', 'border-amber-300', 'text-amber-700');
        }
    }
}

function toggleSortMenu(e) {
    e.stopPropagation();
    document.getElementById('sortDropdown').classList.toggle('hidden');
}

function changeSort(method) {
    state.eventSort = method;
    document.getElementById('sortDropdown').classList.add('hidden');
    renderEvents();
}

// ==================== 浏览器通知提醒 ====================

/**
 * 请求浏览器通知权限
 */
async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.warn('[Reminder] 浏览器不支持通知 API');
        return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
}

/**
 * 启动事件截止日提醒轮询（每30秒检查一次）
 */
function startEventReminder() {
    if (_eventReminderInterval) return;
    _eventReminderInterval = setInterval(checkEventReminders, 30000);
    // 立即执行一次
    checkEventReminders();
}

/**
 * 停止事件截止日提醒轮询
 */
function stopEventReminder() {
    if (_eventReminderInterval) {
        clearInterval(_eventReminderInterval);
        _eventReminderInterval = null;
    }
}

/**
 * 检查所有事件的截止日期，对即将到期或已到期的事件发送浏览器通知
 * 规则：
 * - 距离截止 <= 0（已逾期）且未提醒 → 立即通知
 * - 距离截止 <= 30分钟且未提醒 → 立即通知
 * - 每个事件只提醒一次（notified 字段 + 本次会话 _notifiedEventIds）
 */
function checkEventReminders() {
    if (!state.events || !state.events.length) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const now = Date.now();
    state.events.forEach(evt => {
        if (!evt.dueDate || evt.notified || _notifiedEventIds.has(evt.id)) return;
        const due = new Date(evt.dueDate).getTime();
        const diffMs = due - now;

        // 已逾期 或 30分钟内到期
        if (diffMs <= 0 || diffMs <= 30 * 60 * 1000) {
            sendEventNotification(evt, diffMs);
            evt.notified = true;
            _notifiedEventIds.add(evt.id);
            // 异步保存 notified 状态
            saveDataToStorage().catch(() => {});
        }
    });
}

function sendEventNotification(evt, diffMs) {
    const isOverdue = diffMs <= 0;
    const title = isOverdue ? `⏰ 事件已逾期: ${evt.title}` : `⏳ 事件即将到期: ${evt.title}`;
    const body = isOverdue
        ? `截止时间已过，请尽快处理。\n${evt.context ? evt.context.slice(0, 80) : ''}`
        : `还有不到30分钟就要截止了，请尽快处理。\n${evt.context ? evt.context.slice(0, 80) : ''}`;

    try {
        const notification = new Notification(title, {
            body: body,
            icon: '',
            badge: '',
            tag: evt.id, // 相同tag会替换旧通知
            requireInteraction: false
        });
        notification.onclick = () => {
            window.focus();
            // 打开事件面板并展开该事件
            if (!state.eventOpen) toggleEventModule();
            state.events.forEach(e => e.expanded = (e.id === evt.id));
            renderEvents();
            notification.close();
        };
    } catch (e) {
        console.error('[Reminder] 发送通知失败', e);
    }
}

// 页面加载后尝试请求通知权限并启动提醒
window.addEventListener('DOMContentLoaded', () => {
    requestNotificationPermission().then(granted => {
        if (granted) startEventReminder();
    });
});

function formatDateShort(iso) {
    const d = new Date(iso);
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

/**
 * 在笔记编辑器中插入事件引用
 * @param {string} eventId - 事件ID
 * @param {string} eventTitle - 事件标题（用于显示）
 */
function insertEventRefIntoEditor(eventId, eventTitle) {
    const editor = document.getElementById('noteEditor');
    if (!editor) return;
    const refText = `[[event:${eventId}]]`;
    const start = editor.selectionStart || 0;
    const end = editor.selectionEnd || 0;
    const before = editor.value.substring(0, start);
    const after = editor.value.substring(end);
    editor.value = before + refText + after;
    editor.selectionStart = editor.selectionEnd = start + refText.length;
    editor.focus();
    autoSave();
    showToast(`已引用事件: ${eventTitle || eventId}`);
}

/**
 * 将笔记内容中的事件引用渲染为可点击的标签
 * 支持 [[event:事件ID]] 语法
 * @param {string} content - Markdown 内容
 * @returns {string} - 渲染后的 HTML
 */
function renderEventRefsInContent(content) {
    if (!content) return '';
    // 匹配 [[event:事件ID]] 格式
    const EVENT_REF_RE = /\[\[event:([a-zA-Z0-9_]+)\]\]/g;
    return content.replace(EVENT_REF_RE, function(match, eventId) {
        const evt = state.events.find(e => e.id === eventId);
        const title = evt ? evt.title : eventId;
        const exists = !!evt;
        return `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 ${exists ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-400 border-slate-200'} border rounded text-xs font-medium cursor-pointer hover:${exists ? 'bg-amber-100' : 'bg-slate-200'} transition-colors event-ref-tag"
                      data-event-id="${eventId}" onclick="handleEventRefClick('${eventId}', event)"
                      title="${exists ? '点击跳转到事件' : '事件不存在'}">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            ${escapeHtml(title)}
        </span>`;
    });
}

/**
 * 点击事件引用标签时的处理
 */
function handleEventRefClick(eventId, e) {
    if (e) e.stopPropagation();
    const evt = state.events.find(ev => ev.id === eventId);
    if (!evt) {
        showToast('事件不存在或已被删除');
        return;
    }
    if (!state.eventOpen) toggleEventModule();
    state.events.forEach(e => e.expanded = (e.id === eventId));
    renderEvents();
    showToast(`已定位到事件: ${evt.title}`);
}

/**
 * 打开事件引用选择器（在笔记编辑器中）
 */
function openEventRefSelector() {
    if (!state.events || state.events.length === 0) {
        showToast('暂无事件可引用，请先提取事件');
        return;
    }
    // 创建一个下拉选择浮层
    let dropdown = document.getElementById('eventRefSelectorDropdown');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'eventRefSelectorDropdown';
        dropdown.className = 'absolute z-50 bg-white rounded-xl shadow-lg border border-slate-200 py-2 w-64 max-h-64 overflow-y-auto';
        document.body.appendChild(dropdown);
    }
    const editor = document.getElementById('noteEditor');
    const rect = editor ? editor.getBoundingClientRect() : { left: 100, top: 100 };
    dropdown.style.left = (rect.left + 20) + 'px';
    dropdown.style.top = (rect.top + 20) + 'px';
    dropdown.style.display = 'block';

    dropdown.innerHTML = `
        <div class="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between">
            <span class="text-xs font-medium text-slate-600">选择要引用的事件</span>
            <button onclick="closeEventRefSelector()" class="text-slate-400 hover:text-slate-600 text-xs" title="关闭">×</button>
        </div>
        <div class="py-1">
            ${state.events.map(evt => {
                const dueInfo = getDueInfo(evt.dueDate);
                return `<button onclick="insertEventRefIntoEditor('${evt.id}', '${escapeHtml(evt.title)}'); closeEventRefSelector();"
                               class="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors flex items-center gap-2" title="引用此事件">
                    <span class="text-xs font-medium text-slate-700 truncate flex-1">${escapeHtml(evt.title)}</span>
                    ${dueInfo.text ? `<span class="text-[10px] px-1 py-0.5 rounded ${dueInfo.class}">${dueInfo.text}</span>` : ''}
                </button>`;
            }).join('')}
        </div>
    `;

    // 点击外部关闭
    setTimeout(() => {
        const closeHandler = function(e) {
            if (!dropdown.contains(e.target)) {
                closeEventRefSelector();
                document.removeEventListener('click', closeHandler);
            }
        };
        document.addEventListener('click', closeHandler);
    }, 0);
}

function closeEventRefSelector() {
    const dropdown = document.getElementById('eventRefSelectorDropdown');
    if (dropdown) dropdown.style.display = 'none';
}

// ==================== 事件状态与看板视图 ====================

/**
 * 渲染看板视图
 */
function renderKanbanView(container, events) {
    const columns = [
        { key: EVENT_STATUS.TODO, title: '', icon: '📝' },
        { key: EVENT_STATUS.IN_PROGRESS, title: '', icon: '🔄' },
        { key: EVENT_STATUS.DONE, title: '', icon: '✅' }
    ];

    container.innerHTML = `
        <div class="flex gap-3 h-full overflow-x-auto pb-2">
            ${columns.map(col => {
                const colEvents = events.filter(e => e.status === col.key);
                const statusCfg = STATUS_CONFIG[col.key];
                return `
                <div class="flex-shrink-0 w-[200px] flex flex-col rounded-xl bg-slate-50 border ${statusCfg.borderClass}">
                    <div class="px-3 py-2 rounded-t-xl ${statusCfg.bgClass} border-b ${statusCfg.borderClass} flex items-center justify-between">
                        <span class="text-xs font-semibold ${statusCfg.textClass} flex items-center gap-1">${col.icon} ${col.title}</span>
                        <span class="text-[10px] ${statusCfg.textClass} opacity-70 px-1.5 py-0.5 bg-white/60 rounded-full">${colEvents.length}</span>
                    </div>
                    <div class="flex-1 p-2 space-y-2 overflow-y-auto min-h-[100px]"
                         ondragover="handleEventDragOver(event)"
                         ondrop="handleEventDrop(event, '${col.key}')"
                         ondragenter="handleEventDragEnter(event)"
                         ondragleave="handleEventDragLeave(event)">
                        ${colEvents.map(event => renderKanbanCard(event)).join('')}
                    </div>
                </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderKanbanCard(event) {
    const dueInfo = getDueInfo(event.dueDate);
    const dueBadge = dueInfo.text
        ? `<span class="text-[10px] px-1 py-0.5 rounded ${dueInfo.class}">${dueInfo.text}</span>`
        : '';
    return `
    <div class="bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm cursor-pointer hover:shadow-md hover:border-amber-200 transition-all"
         draggable="true"
         ondragstart="handleEventDragStart(event, '${event.id}')"
         onclick="toggleEventDetail('${event.id}', event)">
        <h4 class="font-medium text-slate-800 text-xs leading-tight line-clamp-2 mb-1.5">${escapeHtml(event.title)}</h4>
        <div class="flex items-center justify-between">
            <div class="flex flex-wrap gap-1">
                ${event.tags.slice(0, 2).map(tag => `<span class="text-[10px] text-slate-500 bg-slate-100 px-1 py-0.5 rounded">#${escapeHtml(tag)}</span>`).join('')}
                ${event.tags.length > 2 ? `<span class="text-[10px] text-slate-400">+${event.tags.length - 2}</span>` : ''}
            </div>
            ${dueBadge}
        </div>
    </div>
    `;
}

// ========== 拖拽相关 ==========

function handleEventDragStart(e, eventId) {
    e.dataTransfer.setData('text/event-id', eventId);
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
}

function handleEventDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleEventDragEnter(e) {
    e.preventDefault();
    const dropZone = e.currentTarget;
    dropZone.classList.add('bg-amber-50', 'ring-1', 'ring-amber-200', 'ring-inset');
}

function handleEventDragLeave(e) {
    const dropZone = e.currentTarget;
    dropZone.classList.remove('bg-amber-50', 'ring-1', 'ring-amber-200', 'ring-inset');
}

function handleEventDrop(e, targetStatus) {
    e.preventDefault();
    const dropZone = e.currentTarget;
    dropZone.classList.remove('bg-amber-50', 'ring-1', 'ring-amber-200', 'ring-inset');
    const eventId = e.dataTransfer.getData('text/event-id');
    if (eventId) {
        updateEventStatus(eventId, targetStatus);
    }
    // 恢复透明度
    document.querySelectorAll('.event-card, [draggable="true"]').forEach(el => el.style.opacity = '');
}

// ========== 状态操作 ==========

function cycleEventStatus(id, e) {
    if (e) e.stopPropagation();
    const evt = state.events.find(ev => ev.id === id);
    if (!evt) return;
    const currentStatus = evt.status || EVENT_STATUS.TODO;
    const nextStatus = STATUS_CONFIG[currentStatus].next;
    updateEventStatus(id, nextStatus);
}

function updateEventStatus(id, newStatus) {
    if (!STATUS_CONFIG[newStatus]) return;
    withAutoSave(() => {
        const evt = state.events.find(ev => ev.id === id);
        if (evt) {
            evt.status = newStatus;
            evt.lastTime = new Date().toISOString();
        }
    });
}

function toggleEventViewMode() {
    _eventViewMode = _eventViewMode === 'list' ? 'kanban' : 'list';
    renderEvents();
}

function filterByStatus(status) {
    state.activeStatusFilter = state.activeStatusFilter === status ? null : status;
    renderEvents();
}

// 导出函数
window.extractEventsFromCurrent = extractEventsFromCurrent;
window.extractAllEvents = extractAllEvents;
window.renderEvents = renderEvents;
window.toggleEventDetail = toggleEventDetail;
window.updateEventField = updateEventField;
window.deleteEvent = deleteEvent;
window.addTag = addTag;
window.removeTag = removeTag;
window.filterByTag = filterByTag;
window.toggleSortMenu = toggleSortMenu;
window.changeSort = changeSort;
window.formatDateShort = formatDateShort;
window.updateEventDueDate = updateEventDueDate;
window.clearEventDueDate = clearEventDueDate;
window.requestNotificationPermission = requestNotificationPermission;
window.startEventReminder = startEventReminder;
window.stopEventReminder = stopEventReminder;
window.cycleEventStatus = cycleEventStatus;
window.updateEventStatus = updateEventStatus;
window.toggleEventViewMode = toggleEventViewMode;
window.filterByStatus = filterByStatus;
window.handleEventDragStart = handleEventDragStart;
window.handleEventDragOver = handleEventDragOver;
window.handleEventDragEnter = handleEventDragEnter;
window.handleEventDragLeave = handleEventDragLeave;
window.handleEventDrop = handleEventDrop;
window.insertEventRefIntoEditor = insertEventRefIntoEditor;
window.renderEventRefsInContent = renderEventRefsInContent;
window.handleEventRefClick = handleEventRefClick;
window.openEventRefSelector = openEventRefSelector;
window.closeEventRefSelector = closeEventRefSelector;
window.getLinkedNotesForEvent = getLinkedNotesForEvent;
