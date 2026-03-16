// js/settings.js - 设置模态框

function toggleSettings() {
    const modal = document.getElementById('settingsModal');
    const promptEventEl = document.getElementById('settingPromptEvent');
    const promptMarkdownEl = document.getElementById('settingPromptAIFormat');
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        document.getElementById('settingApiKey').value = state.settings.apiKey || '';
        document.getElementById('settingBaseUrl').value = state.settings.baseUrl || 'https://api.openai.com/v1';
        document.getElementById('settingModel').value = state.settings.model || 'gpt-3.5-turbo';
        document.getElementById('settingPromptChat').value = state.settings.systemPromptChat || '';
        if (promptEventEl) {
            promptEventEl.value = state.settings.systemPromptEventExtract || state.settings.systemPromptEvent || '';
        }
        if (promptMarkdownEl) {
            promptMarkdownEl.value = state.settings.markdownConvertPrompt || state.settings.aiFormatPrompt || '';
        }
    } else {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function saveSettings() {
    state.settings.apiKey = document.getElementById('settingApiKey').value;
    state.settings.baseUrl = document.getElementById('settingBaseUrl').value.replace(/\/$/, '');
    state.settings.model = document.getElementById('settingModel').value;
    state.settings.systemPromptChat = document.getElementById('settingPromptChat').value;
    state.settings.systemPromptEventExtract = document.getElementById('settingPromptEvent').value;
    state.settings.markdownConvertPrompt = document.getElementById('settingPromptAIFormat').value;
    // 兼容旧字段
    state.settings.systemPromptEvent = state.settings.systemPromptEventExtract;
    state.settings.aiFormatPrompt = state.settings.markdownConvertPrompt;

    localStorage.setItem('chickennotelm_settings', JSON.stringify(state.settings));
    toggleSettings();
    showToast('配置已更新');
}

function loadSettings() {
    let saved = localStorage.getItem('chickennotelm_settings');
    if (!saved && localStorage.getItem('notemind_settings')) {
        saved = localStorage.getItem('notemind_settings');
        if (saved) localStorage.setItem('chickennotelm_settings', saved);
    }
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            state.settings = { ...state.settings, ...parsed };
            // 兼容旧配置键迁移
            if (!state.settings.systemPromptEventExtract && state.settings.systemPromptEvent) {
                state.settings.systemPromptEventExtract = state.settings.systemPromptEvent;
            }
            if (!state.settings.markdownConvertPrompt && state.settings.aiFormatPrompt) {
                state.settings.markdownConvertPrompt = state.settings.aiFormatPrompt;
            }
        } catch (e) {
            console.error('解析设置失败', e);
        }
    }
}

// 导出
window.toggleSettings = toggleSettings;
window.saveSettings = saveSettings;
window.loadSettings = loadSettings;