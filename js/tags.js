// js/tags.js - 笔记标签管理模块

/**
 * 标签管理器
 * 负责笔记标签的提取、展示、筛选和管理
 */
const TagManager = {
    
    /**
     * 从笔记内容中提取标签（调用后端 API）
     * @param {string} title - 笔记标题
     * @param {string} content - 笔记内容
     * @param {string[]} existingTags - 已识别的标签列表（用于批量识别时保持标签一致性）
     * @returns {Promise<string[]>} - 标签数组
     */
    async extractTags(title, content, existingTags = []) {
        const settings = window.state?.settings || {};
        const apiKey = settings.apiKey;
        
        if (!apiKey) {
            throw new Error('请先配置 API Key');
        }
        
        if (!content.trim()) {
            return [];
        }
        
        try {
            const response = await fetch(window.cnApi('api/notes/tags/extract'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    title: title || '',
                    content: content,
                    apiKey: apiKey,
                    baseUrl: settings.baseUrl,
                    model: settings.model,
                    prompt: settings.tagExtractPrompt || '',
                    existingTags: existingTags || []
                })
            });
            
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`API 错误: ${error}`);
            }
            
            const data = await response.json();
            return data.tags || [];
        } catch (error) {
            console.error('标签提取失败:', error);
            throw error;
        }
    },
    
    /**
     * 为指定笔记提取并保存标签
     * @param {string} noteId - 笔记ID
     * @param {boolean} showNotification - 是否显示通知
     */
    async extractAndSaveTags(noteId, showNotification = true) {
        const note = window.state.notes.find(n => n.id === noteId);
        if (!note) return;
        
        try {
            if (showNotification) {
                window.showToast('正在识别标签...');
            }
            
            const tags = await this.extractTags(note.title, note.content);
            
            if (tags.length > 0) {
                // 使用 await 确保保存完成
                await window.withAutoSave(() => {
                    note.tags = tags;
                    note.updatedAt = new Date().toISOString();
                });
                
                if (showNotification) {
                    window.showToast(`已识别 ${tags.length} 个标签: ${tags.join(', ')}`);
                }
                
                // 刷新UI
                if (window.renderNoteList) window.renderNoteList();
                if (window.renderNoteTags) window.renderNoteTags();
            } else {
                if (showNotification) {
                    window.showToast('未能识别到标签');
                }
            }
            
            return tags;
        } catch (error) {
            if (showNotification) {
                window.showToast(`标签识别失败: ${error.message}`);
            }
            throw error;
        }
    },
    
    /**
     * 为当前笔记提取标签
     */
    async extractTagsForCurrentNote() {
        if (!window.state.currentNoteId) {
            window.showToast('请先选择一个笔记');
            return;
        }
        try {
            await this.extractAndSaveTags(window.state.currentNoteId, true);
        } catch (error) {
            console.error('提取当前笔记标签失败:', error);
        }
    },
    
    /**
     * 批量为所有笔记提取标签
     * 每条笔记单独调用API，提示词中会包含已识别的标签
     */
    async extractTagsForAllNotes() {
        if (!window.state.notes.length) {
            window.showToast('没有笔记需要处理');
            return;
        }
        
        const settings = window.state?.settings || {};
        if (!settings.apiKey) {
            window.showToast('请先配置 API Key');
            if (window.toggleSettings) window.toggleSettings();
            return;
        }
        
        window.showToast('开始批量识别标签...');
        
        let successCount = 0;
        let failCount = 0;
        let skipCount = 0;
        
        // 收集所有已识别的标签（用于后续笔记的提示词）
        const allIdentifiedTags = new Set();
        
        for (const note of window.state.notes) {
            try {
                // 如果笔记已有标签且不为空，跳过
                if (note.tags && note.tags.length > 0) {
                    // 将已有标签加入已识别集合
                    note.tags.forEach(tag => allIdentifiedTags.add(tag));
                    skipCount++;
                    continue;
                }
                
                // 提取标签，传入已识别的标签列表（用于提示词中去重和保持一致性）
                const tags = await this.extractTags(note.title, note.content, Array.from(allIdentifiedTags));
                
                if (tags.length > 0) {
                    // 更新笔记标签
                    await window.withAutoSave(() => {
                        note.tags = tags;
                        note.updatedAt = new Date().toISOString();
                    });
                    
                    // 将新标签加入已识别集合
                    tags.forEach(tag => allIdentifiedTags.add(tag));
                    
                    successCount++;
                    
                    // 实时刷新UI显示进度
                    if (window.renderNoteList) window.renderNoteList();
                }
                
                // 添加小延迟避免请求过快
                await new Promise(resolve => setTimeout(resolve, 300));
            } catch (error) {
                console.error(`为笔记 "${note.title}" 提取标签失败:`, error);
                failCount++;
            }
        }
        
        // 保存所有变更
        if (successCount > 0) {
            await window.saveDataToStorage();
            if (window.renderNoteList) window.renderNoteList();
            if (window.renderNoteTags) window.renderNoteTags();
        }
        
        window.showToast(`批量识别完成: ${successCount} 个成功, ${skipCount} 个跳过, ${failCount} 个失败`);
    },
    
    /**
     * 为笔记添加标签
     * @param {string} noteId - 笔记ID
     * @param {string} tag - 标签
     */
    async addTagToNote(noteId, tag) {
        if (!tag || !tag.trim()) return;
        
        const note = window.state.notes.find(n => n.id === noteId);
        if (!note) return;
        
        const trimmedTag = tag.trim();
        if (!note.tags) note.tags = [];
        
        if (!note.tags.includes(trimmedTag)) {
            await window.withAutoSave(() => {
                note.tags.push(trimmedTag);
                note.updatedAt = new Date().toISOString();
            });
            
            if (window.renderNoteList) window.renderNoteList();
            if (window.renderNoteTags) window.renderNoteTags();
            window.showToast(`已添加标签: ${trimmedTag}`);
        }
    },
    
    /**
     * 从笔记中移除标签
     * @param {string} noteId - 笔记ID
     * @param {string} tag - 标签
     */
    async removeTagFromNote(noteId, tag) {
        const note = window.state.notes.find(n => n.id === noteId);
        if (!note || !note.tags) return;
        
        await window.withAutoSave(() => {
            note.tags = note.tags.filter(t => t !== tag);
            note.updatedAt = new Date().toISOString();
        });
        
        if (window.renderNoteList) window.renderNoteList();
        if (window.renderNoteTags) window.renderNoteTags();
        window.showToast(`已移除标签: ${tag}`);
    },
    
    /**
     * 获取所有笔记的标签集合
     * @returns {string[]} - 去重后的标签数组
     */
    getAllTags() {
        const tags = new Set();
        window.state.notes.forEach(note => {
            if (note.tags && Array.isArray(note.tags)) {
                note.tags.forEach(tag => tags.add(tag));
            }
        });
        return Array.from(tags).sort();
    },
    
    /**
     * 获取标签统计信息（使用次数）
     * @returns {Array<{tag: string, count: number}>} - 按使用次数降序排列的标签统计
     */
    getTagStats() {
        const stats = new Map();
        window.state.notes.forEach(note => {
            if (note.tags && Array.isArray(note.tags)) {
                note.tags.forEach(tag => {
                    stats.set(tag, (stats.get(tag) || 0) + 1);
                });
            }
        });
        return Array.from(stats.entries())
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    },
    
    /**
     * 按标签筛选笔记（支持单选/多选）
     * @param {string|null} tag - 标签，null表示显示全部
     */
    filterByTag(tag) {
        // 清空多选状态，切换到单选模式
        window.state.selectedNoteTags.clear();
        window.state.activeNoteTagFilter = tag;
        if (window.renderNoteList) window.renderNoteList();
        if (window.renderTagCloud) window.renderTagCloud();
        if (window.renderNoteTagFilter) window.renderNoteTagFilter();
    },
    
    /**
     * 切换标签多选状态
     * @param {string} tag - 标签
     */
    toggleTagSelection(tag) {
        // 单选模式切换为多选模式时，清空单选状态
        window.state.activeNoteTagFilter = null;
        
        if (window.state.selectedNoteTags.has(tag)) {
            window.state.selectedNoteTags.delete(tag);
        } else {
            window.state.selectedNoteTags.add(tag);
        }
        if (window.renderNoteList) window.renderNoteList();
        if (window.renderTagCloud) window.renderTagCloud();
        if (window.renderNoteTagFilter) window.renderNoteTagFilter();
    },
    
    /**
     * 清空所有标签筛选
     */
    clearTagFilter() {
        window.state.activeNoteTagFilter = null;
        window.state.selectedNoteTags.clear();
        if (window.renderNoteList) window.renderNoteList();
        if (window.renderTagCloud) window.renderTagCloud();
        if (window.renderNoteTagFilter) window.renderNoteTagFilter();
    },
    
    /**
     * 切换自动标签识别开关
     */
    toggleAutoTag() {
        window.state.autoTagEnabled = !window.state.autoTagEnabled;
        window.state.settings.autoTagEnabled = window.state.autoTagEnabled;
        
        // 保存设置
        const sk = typeof window.getSettingsStorageKey === 'function' ? window.getSettingsStorageKey() : null;
        if (sk) {
            localStorage.setItem(sk, JSON.stringify(window.state.settings));
        }
        
        window.showToast(window.state.autoTagEnabled ? '已开启自动标签识别' : '已关闭自动标签识别');
        if (window.renderAutoTagToggle) window.renderAutoTagToggle();
    },
    
    /**
     * 检查是否应该自动提取标签
     * @param {Object} note - 笔记对象
     * @returns {boolean}
     */
    shouldAutoExtract(note) {
        if (!window.state.autoTagEnabled) return false;
        if (!window.state.settings.apiKey) return false;
        if (!note.content || note.content.length < 50) return false;  // 内容太短不提取
        if (note.tags && note.tags.length > 0) return false;  // 已有标签不提取
        return true;
    },
    
    /**
     * 尝试为笔记自动提取标签（静默模式）
     * @param {string} noteId - 笔记ID
     */
    async tryAutoExtract(noteId) {
        const note = window.state.notes.find(n => n.id === noteId);
        if (!note || !this.shouldAutoExtract(note)) return;
        
        try {
            const tags = await this.extractTags(note.title, note.content);
            if (tags.length > 0) {
                // 使用 withAutoSave 确保数据持久化
                await window.withAutoSave(() => {
                    note.tags = tags;
                    note.updatedAt = new Date().toISOString();
                });
                
                // 只更新标签显示
                if (window.renderNoteTags) window.renderNoteTags();
                
                window.showToast(`自动识别标签: ${tags.join(', ')}`);
            }
        } catch (error) {
            console.error('自动标签提取失败:', error);
        }
    }
};

// 绑定到全局
window.TagManager = TagManager;

/**
 * 渲染笔记标签筛选栏（旧版水平标签栏，现已由标签云替代）
 * 保留此函数用于兼容其他调用方，实际渲染委托给 renderTagCloud
 */
function renderNoteTagFilter() {
    // 旧版容器已移除，标签云统一处理标签筛选 UI
    // 仅更新自动标签按钮状态
    renderAutoTagToggle();
    // 同步更新标签云
    if (window.renderTagCloud) window.renderTagCloud();
}

/**
 * 渲染自动标签开关按钮状态
 */
function renderAutoTagToggle() {
    const btn = document.getElementById('autoTagToggleBtn');
    if (!btn) return;
    
    if (window.state.autoTagEnabled) {
        btn.classList.add('text-blue-600', 'bg-blue-100');
        btn.classList.remove('text-slate-500');
        btn.title = '自动标签识别：已开启';
    } else {
        btn.classList.remove('text-blue-600', 'bg-blue-100');
        btn.classList.add('text-slate-500');
        btn.title = '自动标签识别：已关闭';
    }
}

/**
 * 渲染当前笔记的标签（在编辑器中显示）
 */
function renderNoteTags() {
    const container = document.getElementById('editorTagsList');
    if (!container) return;
    
    const note = window.state.notes.find(n => n.id === window.state.currentNoteId);
    
    if (!note || !note.tags || note.tags.length === 0) {
        container.innerHTML = '<span class="text-xs text-slate-400">暂无标签</span>';
    } else {
        container.innerHTML = note.tags.map(tag => `
            <span class="inline-flex items-center px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-200">
                #${escapeHtml(tag)}
                <button onclick="removeTagFromNote('${note.id}', '${escapeHtml(tag)}')" class="ml-1 hover:text-red-500 transition-colors" title="移除标签">×</button>
            </span>
        `).join('');
    }
    
    // 同时更新筛选栏
    renderNoteTagFilter();
}

/**
 * 为当前笔记添加标签
 */
function addTagToCurrentNote() {
    const note = window.state.notes.find(n => n.id === window.state.currentNoteId);
    if (!note) {
        window.showToast('请先选择一个笔记');
        return;
    }
    
    const tag = prompt('输入新标签名:');
    if (tag && tag.trim()) {
        TagManager.addTagToNote(note.id, tag.trim());
    }
}

// 导出渲染函数
window.renderNoteTagFilter = renderNoteTagFilter;
window.renderAutoTagToggle = renderAutoTagToggle;
window.renderNoteTags = renderNoteTags;
window.addTagToCurrentNote = addTagToCurrentNote;

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

/**
 * 渲染标签云（侧边栏标签筛选面板）
 * 支持多选、显示标签使用次数、按频率调整大小
 */
function renderTagCloud() {
    const container = document.getElementById('tagCloudContainer');
    const headerCount = document.getElementById('tagCloudCount');
    if (!container) return;
    
    const tagStats = TagManager.getTagStats();
    
    if (headerCount) {
        headerCount.textContent = tagStats.length > 0 ? `${tagStats.length}` : '';
    }
    
    if (tagStats.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-400 py-2 text-center">暂无标签<br><span class="text-[10px]">点击 ⚡ 自动识别</span></div>';
        return;
    }
    
    // 计算最大/最小次数，用于动态调整标签大小
    const maxCount = tagStats[0].count;
    const minCount = tagStats[tagStats.length - 1].count;
    const range = maxCount - minCount || 1;
    
    // 生成标签云 HTML
    let html = '';
    
    // 添加"全部"按钮（当有多选标签时显示）
    const hasFilter = window.state.activeNoteTagFilter !== null || window.state.selectedNoteTags.size > 0;
    if (hasFilter) {
        html += `<button onclick="TagManager.clearTagFilter()" class="px-2 py-1 rounded-md border text-xs shadow-sm transition-colors focus:outline-none bg-red-50 border-red-200 text-red-600 hover:bg-red-100 whitespace-nowrap">清除筛选</button>`;
    }
    
    html += tagStats.map(({ tag, count }) => {
        const isActive = window.state.activeNoteTagFilter === tag || window.state.selectedNoteTags.has(tag);
        // 根据使用频率动态调整字体大小 (10px ~ 14px)
        const fontSize = minCount === maxCount 
            ? 12 
            : 10 + Math.round(((count - minCount) / range) * 4);
        const opacity = minCount === maxCount 
            ? 1 
            : 0.6 + ((count - minCount) / range) * 0.4;
        
        return `<button 
            onclick="TagManager.toggleTagSelection('${escapeHtml(tag)}')"
            class="group relative px-2 py-1 rounded-md border text-xs shadow-sm transition-all focus:outline-none whitespace-nowrap ${isActive ? 'bg-blue-100 border-blue-300 text-blue-800 font-medium' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'}"
            style="font-size: ${fontSize}px; opacity: ${opacity}"
            title="${escapeHtml(tag)} (${count} 篇笔记)">
            #${escapeHtml(tag)}
            <span class="ml-0.5 text-[10px] ${isActive ? 'text-blue-500' : 'text-slate-400'}">${count}</span>
        </button>`;
    }).join('');
    
    container.innerHTML = html;
}

/**
 * 切换标签云展开/收起
 */
function toggleTagCloud() {
    window.state.tagCloudExpanded = !window.state.tagCloudExpanded;
    const section = document.getElementById('tagCloudSection');
    const container = document.getElementById('tagCloudContainer');
    const icon = document.getElementById('tagCloudToggleIcon');
    
    if (section && container && icon) {
        if (window.state.tagCloudExpanded) {
            container.style.maxHeight = '160px';
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
            icon.style.transform = 'rotate(0deg)';
            section.classList.remove('opacity-70');
        } else {
            container.style.maxHeight = '0px';
            container.style.opacity = '0';
            container.style.pointerEvents = 'none';
            icon.style.transform = 'rotate(-90deg)';
            section.classList.add('opacity-70');
        }
    }
}

// 导出便捷函数
window.extractTagsForCurrentNote = () => TagManager.extractTagsForCurrentNote();
window.extractTagsForAllNotes = () => TagManager.extractTagsForAllNotes();
window.addTagToNote = async (noteId, tag) => await TagManager.addTagToNote(noteId, tag);
window.removeTagFromNote = async (noteId, tag) => await TagManager.removeTagFromNote(noteId, tag);
window.filterNotesByTag = (tag) => TagManager.filterByTag(tag);
window.toggleAutoTag = () => TagManager.toggleAutoTag();
window.toggleTagCloud = toggleTagCloud;
window.renderTagCloud = renderTagCloud;
