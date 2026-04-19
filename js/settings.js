// js/settings.js - 设置模态框

function toggleSettings() {
    const modal = document.getElementById('settingsModal');
    const promptEventEl = document.getElementById('settingPromptEvent');
    const promptMarkdownEl = document.getElementById('settingPromptAIFormat');
    const promptTagEl = document.getElementById('settingPromptTagExtract');
    const autoTagEl = document.getElementById('settingAutoTag');
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
        if (promptTagEl) {
            promptTagEl.value = state.settings.tagExtractPrompt || '';
        }
        if (autoTagEl) {
            autoTagEl.checked = state.settings.autoTagEnabled || false;
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
    
    // 标签相关设置
    const promptTagEl = document.getElementById('settingPromptTagExtract');
    if (promptTagEl) {
        state.settings.tagExtractPrompt = promptTagEl.value;
    }
    
    // 兼容旧字段
    state.settings.systemPromptEvent = state.settings.systemPromptEventExtract;
    state.settings.aiFormatPrompt = state.settings.markdownConvertPrompt;

    const sk = typeof window.getSettingsStorageKey === 'function' ? window.getSettingsStorageKey() : null;
    if (sk) localStorage.setItem(sk, JSON.stringify(state.settings));
    toggleSettings();
    showToast('配置已更新');
}

/**
 * 从设置面板切换自动标签开关
 */
function toggleAutoTagFromSettings() {
    const autoTagEl = document.getElementById('settingAutoTag');
    if (autoTagEl) {
        state.autoTagEnabled = autoTagEl.checked;
        state.settings.autoTagEnabled = autoTagEl.checked;
    }
}

function loadSettings() {
    const sk = typeof window.getSettingsStorageKey === 'function' ? window.getSettingsStorageKey() : null;
    let saved = sk ? localStorage.getItem(sk) : null;
    if (!saved && sk && localStorage.getItem('chickennotelm_settings')) {
        saved = localStorage.getItem('chickennotelm_settings');
        try {
            localStorage.setItem(sk, saved);
            localStorage.removeItem('chickennotelm_settings');
        } catch (e) { /* ignore */ }
    }
    if (!saved && sk && localStorage.getItem('notemind_settings')) {
        saved = localStorage.getItem('notemind_settings');
        if (saved) {
            try {
                localStorage.setItem(sk, saved);
            } catch (e) { /* ignore */ }
        }
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
window.toggleAutoTagFromSettings = toggleAutoTagFromSettings;