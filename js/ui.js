// js/ui.js - 界面交互（拖拽、面板切换、toast）
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

// 面板开关
function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    const panel = document.getElementById('sidebar-panel');
    const resizer = document.getElementById('resizer-sidebar');
    panel.classList.toggle('hidden', !state.sidebarOpen);
    resizer.classList.toggle('hidden', !state.sidebarOpen);
}

function toggleAIChat() {
    state.chatOpen = !state.chatOpen;
    const panel = document.getElementById('chat-panel');
    const resizer = document.getElementById('resizer-chat');
    const btn = document.getElementById('chatToggleBtn');

    panel.classList.toggle('hidden', !state.chatOpen);
    resizer.classList.toggle('hidden', !state.chatOpen);

    if (state.chatOpen) {
        panel.classList.add('flex');
        btn.classList.add('bg-blue-100', 'text-blue-700');
    } else {
        panel.classList.remove('flex');
        btn.classList.remove('bg-blue-100', 'text-blue-700');
    }
    updateChatContextUI();
}

function toggleEventModule() {
    state.eventOpen = !state.eventOpen;
    const panel = document.getElementById('event-panel');
    const resizer = document.getElementById('resizer-event');
    const btn = document.getElementById('eventToggleBtn');

    panel.classList.toggle('hidden', !state.eventOpen);
    resizer.classList.toggle('hidden', !state.eventOpen);

    if (state.eventOpen) {
        panel.classList.add('flex');
        btn.classList.add('bg-amber-100', 'text-amber-700');
        renderEvents();
    } else {
        panel.classList.remove('flex');
        btn.classList.remove('bg-amber-100', 'text-amber-700');
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
window.showToast = showToast;