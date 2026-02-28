// js/events.js - 事件提取模块（真实API）

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
                state.events.unshift({
                    id: 'evt_' + Math.random().toString(36).substr(2, 9),
                    title: ev.title || '未命名事件',
                    context: ev.context || ev.description || '',
                    createTime: new Date().toISOString(),
                    lastTime: new Date().toISOString(),
                    tags: ev.tags || [],
                    expanded: false
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

    // 排序
    let sortedEvents = [...displayEvents];
    sortedEvents.sort((a, b) => {
        const timeA = new Date(state.eventSort.startsWith('create') ? a.createTime : a.lastTime).getTime();
        const timeB = new Date(state.eventSort.startsWith('create') ? b.createTime : b.lastTime).getTime();
        return state.eventSort.endsWith('desc') ? timeB - timeA : timeA - timeB;
    });

    container.innerHTML = sortedEvents.map(event => `
        <div class="event-card bg-white border ${event.expanded ? 'border-amber-300 ring-4 ring-amber-50 shadow-md' : 'border-slate-200 hover:border-amber-200'} rounded-xl overflow-hidden cursor-pointer"
             onclick="toggleEventDetail('${event.id}', event)">

            <!-- Collapsed View -->
            <div class="${event.expanded ? 'hidden' : 'block'} p-3">
                <div class="flex justify-between items-start gap-2">
                    <h4 class="font-medium text-slate-800 text-sm leading-tight line-clamp-2">${escapeHtml(event.title)}</h4>
                    <span class="text-[10px] text-slate-400 flex-shrink-0">${formatDateShort(event.createTime)}</span>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                    ${event.tags.map(tag => `<span class="text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">#${escapeHtml(tag)}</span>`).join('')}
                </div>
            </div>

            <!-- Expanded / Edit View -->
            <div class="${event.expanded ? 'block' : 'hidden'} p-3 bg-amber-50/20" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-[10px] text-slate-400">创建于: ${formatDateShort(event.createTime)}</span>
                    <div class="flex gap-1">
                        <button onclick="deleteEvent('${event.id}', event)" class="text-red-400 hover:text-red-600 transition-colors" title="删除事件">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                        <button onclick="toggleEventDetail('${event.id}', event)" class="text-slate-400 hover:text-slate-600">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg>
                        </button>
                    </div>
                </div>

                <input type="text" value="${escapeHtml(event.title)}"
                       onchange="updateEventField('${event.id}', 'title', this.value)"
                       class="w-full font-semibold text-slate-800 bg-white border border-amber-200 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 rounded-md px-2 py-1.5 mb-2 text-sm outline-none transition-colors">

                <textarea oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"
                          onchange="updateEventField('${event.id}', 'context', this.value)"
                          class="w-full text-sm text-slate-600 bg-white border border-amber-200 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 rounded-md px-2 py-1.5 mb-3 min-h-[80px] outline-none overflow-hidden resize-none transition-colors">${escapeHtml(event.context)}</textarea>

                <div class="flex flex-wrap items-center gap-1.5">
                    ${event.tags.map(tag => `
                        <span class="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded-full border border-amber-200 flex items-center gap-1">
                            ${escapeHtml(tag)}
                            <button onclick="removeTag('${event.id}', '${escapeHtml(tag)}', event)" class="hover:bg-amber-200 text-amber-600 rounded-full w-3.5 h-3.5 flex items-center justify-center transition-colors">×</button>
                        </span>
                    `).join('')}
                    <button onclick="addTag('${event.id}', event)" class="px-2 py-0.5 bg-white border border-dashed border-amber-300 text-amber-600 text-xs rounded-full hover:bg-amber-50 transition-colors flex items-center">
                        + 添加标签
                    </button>
                </div>
            </div>
        </div>
    `).join('');
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
        let html = `<button onclick="filterByTag(null)" class="px-2.5 py-1 rounded-md border text-xs shadow-sm whitespace-nowrap transition-colors focus:outline-none ${state.activeTagFilter === null ? 'bg-amber-100 border-amber-300 text-amber-800 font-medium' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}">全部</button>`;

        html += Array.from(tags).map(tag => {
            const isActive = state.activeTagFilter === tag;
            return `<button onclick="filterByTag('${tag}')" class="ml-1 px-2.5 py-1 rounded-md border text-xs shadow-sm whitespace-nowrap transition-colors focus:outline-none ${isActive ? 'bg-amber-100 border-amber-300 text-amber-800 font-medium' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}">#${escapeHtml(tag)}</button>`;
        }).join('');
        container.innerHTML = html;
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

function formatDateShort(iso) {
    const d = new Date(iso);
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
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
