// js/ai-format.js - AI 文本转 Markdown 功能

/**
 * AI Markdown 转换管理器
 * 调用大模型 API 将纯文本转换为结构化 Markdown
 */
const AIMarkdownFormatter = {
    
    // 默认提示词
    defaultPrompt: `你是 Markdown 编辑专家。请把用户给出的纯文本整理为结构清晰、可读性强的 Markdown。要求：

1. 保留原始语义，不编造事实；
2. 自动识别主题并拆分为合适的标题与小节；
3. 将并列信息转为列表，将步骤转为有序列表；
4. 重要信息可用加粗、引用块强调；
5. 若出现时间/任务信息，可整理为 TODO 列表；
6. 仅输出最终 Markdown，不要额外解释。`,

    /**
     * 检查 API 配置是否完整
     */
    isConfigValid() {
        const settings = window.state?.settings || {};
        return !!(settings.apiKey && settings.baseUrl && settings.model);
    },

    /**
     * 显示 API 配置提示
     */
    showConfigPrompt() {
        if (confirm('使用 AI 格式化需要先配置 API Key。是否前往设置页面？')) {
            if (typeof toggleSettings === 'function') {
                toggleSettings();
            }
        }
    },

    /**
     * 将当前笔记转换为 Markdown
     */
    async formatCurrentNote() {
        if (!this.isConfigValid()) {
            this.showConfigPrompt();
            return;
        }

        const editor = document.getElementById('noteEditor');
        if (!editor) return;

        const content = editor.value || '';
        if (!content.trim()) {
            this.showToast('笔记内容为空，无需转换', 'warning');
            return;
        }

        // 显示加载状态
        const btn = document.getElementById('markdownConvertBtn') || document.getElementById('aiFormatBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 转换中...';
        }

        try {
            const formattedContent = await this.callAIAPI(content);
            
            if (formattedContent) {
                // 保存历史记录（用于撤销）
                this.saveFormatHistory(content);
                
                // 更新编辑器内容
                editor.value = formattedContent;
                
                // 触发自动保存
                if (typeof autoSave === 'function') {
                    autoSave();
                }
                
                // 更新预览
                if (typeof updateEditorPreview === 'function') {
                    updateEditorPreview();
                }
                
                this.showToast('Markdown 转换完成');
            }
        } catch (error) {
            console.error('Markdown 转换失败:', error);
            this.showToast(`转换失败: ${error.message}`, 'error');
        } finally {
            // 恢复按钮状态
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16M4 12h16M4 17h10"></path></svg> 转为Markdown`;
            }
        }
    },

    /**
     * 调用 AI API
     */
    async callAIAPI(content) {
        const settings = window.state?.settings || {};
        const apiKey = settings.apiKey;
        const baseUrl = settings.baseUrl || 'https://api.openai.com/v1';
        const model = settings.model || 'gpt-3.5-turbo';
        const customPrompt = settings.markdownConvertPrompt || settings.aiFormatPrompt || this.defaultPrompt;

        const url = `${baseUrl}/chat/completions`;
        
        const payload = {
            model: model,
            messages: [
                { role: 'system', content: customPrompt },
                { role: 'user', content: `请将以下内容整理为规范的 Markdown 文档：\n\n${content}` }
            ],
            temperature: 0.3,
            max_tokens: 4000
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `API 错误: ${response.status}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content?.trim();
    },

    /**
     * 保存格式化历史（用于撤销）
     */
    saveFormatHistory(content) {
        const history = JSON.parse(localStorage.getItem('ai_format_history') || '[]');
        history.push({
            timestamp: Date.now(),
            content: content
        });
        // 只保留最近 10 条
        if (history.length > 10) {
            history.shift();
        }
        localStorage.setItem('ai_format_history', JSON.stringify(history));
    },

    /**
     * 撤销上一次格式化
     */
    undoLastFormat() {
        const history = JSON.parse(localStorage.getItem('ai_format_history') || '[]');
        if (history.length === 0) {
            this.showToast('没有可撤销的操作', 'warning');
            return;
        }

        const lastState = history.pop();
        localStorage.setItem('ai_format_history', JSON.stringify(history));

        const editor = document.getElementById('noteEditor');
        if (editor) {
            editor.value = lastState.content;
            if (typeof autoSave === 'function') {
                autoSave();
            }
            if (typeof updateEditorPreview === 'function') {
                updateEditorPreview();
            }
            this.showToast('已撤销');
        }
    },

    /**
     * 显示 Toast 提示
     */
    showToast(message, type = 'success') {
        if (typeof window.showToast === 'function') {
            window.showToast(message);
        } else {
            const toast = document.createElement('div');
            toast.className = `fixed bottom-6 right-6 px-4 py-2.5 rounded-xl shadow-xl z-50 ${type === 'error' ? 'bg-red-600' : type === 'warning' ? 'bg-amber-600' : 'bg-slate-800'} text-white`;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }
    }
};

// 绑定到全局
window.AIMarkdownFormatter = AIMarkdownFormatter;

/**
 * 转换当前笔记（便捷函数）
 */
window.formatCurrentNoteWithAI = function() {
    AIMarkdownFormatter.formatCurrentNote();
};

window.convertCurrentNoteToMarkdown = function() {
    AIMarkdownFormatter.formatCurrentNote();
};

/**
 * 撤销 AI 格式化
 */
window.undoAIFormat = function() {
    AIMarkdownFormatter.undoLastFormat();
};
