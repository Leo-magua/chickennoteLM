// js/ui.js - 界面交互（拖拽、面板切换、toast）
const UI_MODE_STORAGE_KEY = 'chickennotelm_ui_mode_preference';
const MOBILE_BREAKPOINT = 768;
let uiInitialized = false;
let mobileMediaQuery = null;

// 面板拖拽调整大小
let isResizing = false;
let currentResizer = null;
let startX, startWidth;
let targetPanel = null;
let resizeDir = 'right';

// 初始化拖拽监听
document.querySelectorAll('.resizer').forEach(resizer => {
    resizer.addEventListener('mousedown', function(e) {
        isResizing = true;
        currentResizer = resizer;
        targetPanel = document.getElementById(resizer.dataset.panel);
        resizeDir = resizer.dataset.dir;
        startX = e.clientX;
        startWidth = targetPanel.getBoundingClientRect().width;

        resizer.classList.add('resizing');
        document.body.classList.add('no-select');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    });
});

document.addEventListener('mousemove', function(e) {
    if (!isResizing || !targetPanel) return;
    let dx = e.clientX - startX;
    let newWidth = resizeDir === 'right' ? startWidth + dx : startWidth - dx;

    // 限制最小/最大宽度
    if (newWidth >= 240 && newWidth <= 600) {
        targetPanel.style.width = `${newWidth}px`;
        targetPanel.style.flex = 'none';
    }
});

document.addEventListener('mouseup', function() {
    if (isResizing) {
        isResizing = false;
        if(currentResizer) currentResizer.classList.remove('resizing');
        document.body.classList.remove('no-select');
        document.body.style.cursor = '';
    }
});

function loadUiModePreference() {
    try {
        const saved = localStorage.getItem(UI_MODE_STORAGE_KEY);
        if (saved === 'mobile' || saved === 'desktop' || saved === 'auto') {
            state.uiModePreference = saved;
        }
    } catch (error) {
        console.warn('读取 UI 模式偏好失败', error);
    }
}

function saveUiModePreference() {
    try {
        localStorage.setItem(UI_MODE_STORAGE_KEY, state.uiModePreference);
    } catch (error) {
        console.warn('保存 UI 模式偏好失败', error);
    }
}

function resolveUiMode() {
    if (state.uiModePreference === 'mobile' || state.uiModePreference === 'desktop') {
        return state.uiModePreference;
    }
    if (!mobileMediaQuery) {
        mobileMediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    }
    return mobileMediaQuery.matches ? 'mobile' : 'desktop';
}

function isMobileUi() {
    return state.resolvedUiMode === 'mobile';
}

function getAutoResolvedUiMode() {
    if (!mobileMediaQuery) {
        mobileMediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    }
    return mobileMediaQuery.matches ? 'mobile' : 'desktop';
}

function setUiModePreference(mode, options = {}) {
    const { showToastMessage = '' } = options;
    state.uiModePreference = mode;
    saveUiModePreference();
    applyResponsiveLayout();
    if (showToastMessage) {
        showToast(showToastMessage);
    }
}

function setButtonPressed(button, active, activeClasses) {
    if (!button) return;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    activeClasses.forEach((className) => button.classList.toggle(className, active));
}

function closeOtherMobilePanels(exceptPanel) {
    if (!isMobileUi()) return;
    if (exceptPanel !== 'sidebar') state.sidebarOpen = false;
    if (exceptPanel !== 'chat') state.chatOpen = false;
    if (exceptPanel !== 'event') state.eventOpen = false;
}

function closeAllMobilePanels() {
    if (!isMobileUi()) return;
    state.sidebarOpen = false;
    state.chatOpen = false;
    state.eventOpen = false;
}

function syncPanelVisibility() {
    const mobile = isMobileUi();
    const sidebar = document.getElementById('sidebar-panel');
    const chat = document.getElementById('chat-panel');
    const event = document.getElementById('event-panel');
    const sidebarResizer = document.getElementById('resizer-sidebar');
    const chatResizer = document.getElementById('resizer-chat');
    const eventResizer = document.getElementById('resizer-event');
    const sidebarBtn = document.getElementById('sidebarToggleBtn');
    const chatBtn = document.getElementById('chatToggleBtn');
    const eventBtn = document.getElementById('eventToggleBtn');
    const mobileSidebarBtn = document.getElementById('mobileSidebarBtn');
    const mobileChatBtn = document.getElementById('mobileChatBtn');
    const mobileEventBtn = document.getElementById('mobileEventBtn');
    const overlay = document.getElementById('mobilePanelOverlay');

    if (sidebar) sidebar.classList.toggle('hidden', !state.sidebarOpen);

    if (chat) {
        chat.classList.toggle('hidden', !state.chatOpen);
        chat.classList.toggle('flex', state.chatOpen);
    }

    if (event) {
        event.classList.toggle('hidden', !state.eventOpen);
        event.classList.toggle('flex', state.eventOpen);
    }

    if (sidebarResizer) sidebarResizer.classList.toggle('hidden', mobile || !state.sidebarOpen);
    if (chatResizer) chatResizer.classList.toggle('hidden', mobile || !state.chatOpen);
    if (eventResizer) eventResizer.classList.toggle('hidden', mobile || !state.eventOpen);

    setButtonPressed(sidebarBtn, state.sidebarOpen, ['bg-slate-100', 'text-slate-800']);
    setButtonPressed(chatBtn, state.chatOpen, ['bg-blue-100', 'text-blue-700']);
    setButtonPressed(eventBtn, state.eventOpen, ['bg-amber-100', 'text-amber-700']);

    if (mobileSidebarBtn) mobileSidebarBtn.dataset.active = state.sidebarOpen ? 'true' : 'false';
    if (mobileChatBtn) mobileChatBtn.dataset.active = state.chatOpen ? 'true' : 'false';
    if (mobileEventBtn) mobileEventBtn.dataset.active = state.eventOpen ? 'true' : 'false';

    if (overlay) {
        const shouldShowOverlay = mobile && (state.sidebarOpen || state.chatOpen || state.eventOpen);
        overlay.classList.toggle('hidden', !shouldShowOverlay);
    }

    updateChatContextUI();
}

function updateUiModeToggleButton() {
    const btn = document.getElementById('uiModeToggleBtn');
    const label = document.getElementById('uiModeToggleLabel');
    const hint = document.getElementById('uiModeStatus');
    const autoBtn = document.getElementById('uiModeAutoBtn');
    const mobileBtn = document.getElementById('mobileUiModeBtn');

    const mobile = isMobileUi();
    const manualMode = state.uiModePreference === 'mobile' || state.uiModePreference === 'desktop';
    const title = manualMode
        ? `当前手动锁定为${mobile ? '手机版' : 'PC版'}布局`
        : `当前按屏幕宽度自动使用${mobile ? '手机版' : 'PC版'}布局`;
    const statusText = state.uiModePreference === 'auto'
        ? `当前: ${mobile ? '手机版' : 'PC版'}（自动）`
        : `当前: ${mobile ? '手机版' : 'PC版'}（手动）`;

    if (label) {
        label.textContent = '';
    }
    if (hint) {
        hint.textContent = '';
    }
    if (btn) {
        btn.title = title;
    }
    if (autoBtn) {
        autoBtn.classList.toggle('hidden', !manualMode);
    }

    if (mobileBtn) {
        mobileBtn.dataset.active = manualMode ? 'true' : 'false';
        mobileBtn.title = manualMode ? `${title}，再次点击切换布局` : `${title}，可在顶部切回手动布局`;
        mobileBtn.setAttribute('aria-label', mobile ? '切换到 PC 版布局' : '切换到手机版布局');
    }
}

function applyResponsiveLayout() {
    const previousMode = state.resolvedUiMode;
    const nextMode = resolveUiMode();
    state.resolvedUiMode = nextMode;
    document.body.setAttribute('data-ui-mode', nextMode);
    document.body.setAttribute('data-ui-preference', state.uiModePreference);

    if (nextMode === 'mobile' && previousMode !== 'mobile') {
        closeAllMobilePanels();
    }

    if (nextMode === 'desktop' && previousMode === 'mobile' && !state.sidebarOpen && !state.chatOpen && !state.eventOpen) {
        state.sidebarOpen = true;
    }

    syncPanelVisibility();
    updateUiModeToggleButton();
}

function initializeResponsiveUI() {
    if (uiInitialized) {
        applyResponsiveLayout();
        return;
    }

    if (!mobileMediaQuery) {
        mobileMediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    }

    loadUiModePreference();
    applyResponsiveLayout();

    window.addEventListener('resize', function() {
        if (state.uiModePreference === 'auto') applyResponsiveLayout();
    });

    const handleMediaChange = function() {
        if (state.uiModePreference === 'auto') applyResponsiveLayout();
    };
    if (typeof mobileMediaQuery.addEventListener === 'function') {
        mobileMediaQuery.addEventListener('change', handleMediaChange);
    } else if (typeof mobileMediaQuery.addListener === 'function') {
        mobileMediaQuery.addListener(handleMediaChange);
    }

    const overlay = document.getElementById('mobilePanelOverlay');
    if (overlay) {
        overlay.addEventListener('click', function() {
            closeAllMobilePanels();
            syncPanelVisibility();
        });
    }

    uiInitialized = true;
}

function toggleUiMode() {
    const nextMode = isMobileUi() ? 'desktop' : 'mobile';
    setUiModePreference(nextMode, {
        showToastMessage: `已切换到${nextMode === 'mobile' ? '手机版' : 'PC版'}布局`
    });
}

function resetUiModePreference() {
    const autoMode = getAutoResolvedUiMode();
    setUiModePreference('auto', {
        showToastMessage: `已恢复自动布局，当前跟随为${autoMode === 'mobile' ? '手机版' : 'PC版'}`
    });
}

window.handleMobileNoteOpened = function() {
    if (!isMobileUi() || !state.sidebarOpen) return;
    state.sidebarOpen = false;
    syncPanelVisibility();
};

// 面板开关
function toggleSidebar() {
    const nextOpen = !state.sidebarOpen;
    if (nextOpen) closeOtherMobilePanels('sidebar');
    state.sidebarOpen = nextOpen;
    syncPanelVisibility();
}

function toggleAIChat() {
    const nextOpen = !state.chatOpen;
    if (nextOpen) closeOtherMobilePanels('chat');
    state.chatOpen = nextOpen;
    syncPanelVisibility();
}

function toggleEventModule() {
    const nextOpen = !state.eventOpen;
    if (nextOpen) closeOtherMobilePanels('event');
    state.eventOpen = nextOpen;
    syncPanelVisibility();
    if (state.eventOpen) {
        renderEvents();
    }
}

// Toast 提示
let toastTimer = null;

function showToast(msg, duration = 3000) {
    const toast = document.getElementById('toast');
    const messageEl = document.getElementById('toastMessage');

    if (!toast || !messageEl) return;

    messageEl.textContent = msg;
    toast.classList.remove('translate-y-20', 'opacity-0');

    if (toastTimer) clearTimeout(toastTimer);

    if (duration > 0) {
        toastTimer = setTimeout(() => {
            toast.classList.add('translate-y-20', 'opacity-0');
        }, duration);
    }
}

// 导出
window.toggleSidebar = toggleSidebar;
window.toggleAIChat = toggleAIChat;
window.toggleEventModule = toggleEventModule;
window.toggleUiMode = toggleUiMode;
window.resetUiModePreference = resetUiModePreference;
window.applyResponsiveLayout = applyResponsiveLayout;
window.initializeResponsiveUI = initializeResponsiveUI;
window.showToast = showToast;
