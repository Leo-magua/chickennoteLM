// js/main.js - 应用入口

document.addEventListener('DOMContentLoaded', () => {
    // 加载设置
    loadSettings();

    // 加载笔记和事件
    loadDataFromLocalStorage();

    // 渲染笔记列表
    renderNoteList();

    // 加载当前笔记
    if (state.currentNoteId) {
        loadNote(state.currentNoteId);
    }

    // 加载聊天历史
    if (window.loadChatHistoryList) {
        window.loadChatHistoryList();
    }

    // 移动端自动隐藏侧边栏
    if (window.innerWidth < 768) {
        toggleSidebar();
    }

    // 根据之前的状态恢复面板
    if (state.chatOpen) {
        toggleAIChat();
    }
    if (state.eventOpen) {
        toggleEventModule();
    }

    // 点击其他区域关闭排序下拉
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('sortDropdown');
        const btn = document.getElementById('sortBtn');
        if (dropdown && !dropdown.classList.contains('hidden')) {
            if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
                dropdown.classList.add('hidden');
            }
        }
    });

    // 自动调整事件卡片中文本域的高度
    document.addEventListener('input', (e) => {
        if (e.target.tagName === 'TEXTAREA' && e.target.closest('#eventList')) {
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
        }
    });
});