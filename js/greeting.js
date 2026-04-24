// js/greeting.js - 问候功能模块
// 提供简单的问候交互功能

/**
 * 显示问候消息
 * @param {string} [name] - 可选的用户名，默认使用当前登录用户
 */
function showGreeting(name) {
    const userName = name || (state && state.currentUser) || '用户';
    const hour = new Date().getHours();
    let timeGreeting = '你好';
    
    if (hour >= 5 && hour < 12) {
        timeGreeting = '早上好';
    } else if (hour >= 12 && hour < 14) {
        timeGreeting = '中午好';
    } else if (hour >= 14 && hour < 18) {
        timeGreeting = '下午好';
    } else if (hour >= 18 && hour < 22) {
        timeGreeting = '晚上好';
    } else {
        timeGreeting = '夜深了';
    }
    
    const message = `${timeGreeting}，${userName}！欢迎使用 ChickenNoteLM 🐔`;
    showToast(message, 4000);
}

/**
 * 初始化问候功能
 * 在页面加载完成后自动显示问候
 */
function initGreeting() {
    // 延迟显示问候，等待其他初始化完成
    setTimeout(() => {
        if (state && state.currentUser) {
            showGreeting();
        }
    }, 1000);
}

// 导出到全局
window.showGreeting = showGreeting;
window.initGreeting = initGreeting;
