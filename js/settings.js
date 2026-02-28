// js/settings.js - 设置模态框

function toggleSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        // 填充当前设置
        document.getElementById('settingApiKey').value = state.settings.apiKey || '';
        document.getElementById('settingBaseUrl').value = state.settings.baseUrl || 'https://api.openai.com/v1';
        document.getElementById('settingModel').value = state.settings.model || 'gpt-3.5-turbo';
        document.getElementById('settingPromptChat').value = state.settings.systemPromptChat || '';
        document.getElementById('settingPromptEvent').value = state.settings.systemPromptEvent || '';
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
    state.settings.systemPromptEvent = document.getElementById('settingPromptEvent').value;

    localStorage.setItem('notemind_settings', JSON.stringify(state.settings));
    toggleSettings();
    showToast('配置已更新');
}

function loadSettings() {
    const saved = localStorage.getItem('notemind_settings');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            state.settings = { ...state.settings, ...parsed };
        } catch (e) {
            console.error('解析设置失败', e);
        }
    }
}

// 导出
window.toggleSettings = toggleSettings;
window.saveSettings = saveSettings;
window.loadSettings = loadSettings;