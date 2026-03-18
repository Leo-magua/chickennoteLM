// js/main.js - 应用入口

document.addEventListener('DOMContentLoaded', function() {
    loadSettings();
    loadDataFromLocalStorage();

    // 本地无数据时从后端 notefile/ 拉取，再没有才用默认笔记
    (function ensureNotes() {
        if (state.notes.length > 0) {
            renderNoteList();
            if (state.currentNoteId) loadNote(state.currentNoteId);
            return;
        }
        window.loadDataFromServerIfEmpty().then(function() {
            if (!state.notes.length) {
                state.notes = [
                    { id: '1', title: '项目规划会议', content: '# 会议记录\n\n- [ ] 确定UI卡片圆角风格（今天）\n- [ ] 实现拖拽修改列宽功能', updatedAt: new Date().toISOString() },
                    { id: '2', title: '学习计划', content: '本周重点：\n1. 深入学习 Tailwind\n2. 整理Flex布局的最佳实践\n*注意：下周一需要提交 Demo*。', updatedAt: new Date(Date.now() - 86400000).toISOString() }
                ];
                if (!state.currentNoteId) state.currentNoteId = state.notes[0].id;
            }
            renderNoteList();
            if (state.currentNoteId) loadNote(state.currentNoteId);
        });
    })();

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

    // 恢复笔记列表侧边栏折叠状态
    try {
        var saved = localStorage.getItem('notemind_sidebarCollapsed');
        if (saved === '1') state.sidebarCollapsed = true;
    } catch (e) {}
    if (window.updateSidebarCollapsedUI) updateSidebarCollapsedUI();

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