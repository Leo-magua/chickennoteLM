// js/main.js - 应用入口（支持 IndexedDB 离线优先 + 登录鉴权）

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js")
        .then((reg) => console.log("[SW] Registered"))
        .catch((err) => console.log("[SW] Failed:", err));
    navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data.type === "SYNC_NOTES" && window.dataService) {
            window.dataService.triggerSync();
        }
    });
}

function enforceLoginPage() {
    const overlay = document.getElementById("loginOverlay");
    if (overlay) overlay.style.display = "flex";
    if (window.state) {
        state.currentUser = null;
        state.currentNoteId = null;
        const editor = document.getElementById("noteEditor");
        const titleInput = document.getElementById("currentNoteTitle");
        if (editor) editor.value = "";
        if (titleInput) titleInput.value = "未命名笔记";
        if (window.renderNoteList) renderNoteList();
    }
}

/**
 * @param {string} [userId] 登录用户名（与后端 session 一致）；省略时从 /api/auth/me 获取
 */
async function runAppInit(userId) {
    const overlay = document.getElementById("loginOverlay");
    if (overlay) overlay.style.display = "none";

    let uid = (userId && String(userId).trim()) || "";
    if (!uid) {
        try {
            const me = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
            if (me.ok) {
                const j = await me.json();
                uid = (j && j.user_id) || "";
            }
        } catch (e) { /* ignore */ }
    }
    if (!uid) {
        console.error("[runAppInit] 无有效 user_id");
        enforceLoginPage();
        return;
    }
    state.currentUser = uid.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 64) || uid;

    if (window.dataService && typeof window.dataService.resetInit === "function") {
        window.dataService.resetInit();
    }

    loadSettings();
    if (window.dataService) await window.dataService.init();

    window.__lastCloudAuth = null;
    let cloudAuth = { ok: false, useLocalFallback: true };
    if (typeof window.applyCloudAuthorityOnLogin === "function") {
        cloudAuth = await window.applyCloudAuthorityOnLogin();
        window.__lastCloudAuth = cloudAuth;
    }
    if (cloudAuth.useLocalFallback) {
        await loadDataFromLocalStorage();
    }

    if ("serviceWorker" in navigator && window.SyncManager) {
        navigator.serviceWorker.ready.then((reg) => reg.sync.register("sync-notes").catch(() => {}));
    }
    (function ensureNotes() {
        if (state.notes.length > 0) {
            renderNoteList();
            if (state.currentNoteId) loadNote(state.currentNoteId);
            return;
        }
        // 在线且云端已确认该账号无数据：保持空白，不注入演示笔记
        const auth = window.__lastCloudAuth;
        if (auth && auth.ok && !auth.useLocalFallback && auth.serverEmpty) {
            renderNoteList();
            return;
        }
        window.loadDataFromServerIfEmpty().then(function() {
            if (!state.notes.length) {
                // 仅回退本地/离线时仍无笔记，才注入演示数据
                if (auth && auth.useLocalFallback) {
                    state.notes = [
                        { id: "1", title: "项目规划会议", content: "# 会议记录\n\n- [ ] 确定UI卡片圆角风格（今天）\n- [ ] 实现拖拽修改列宽功能", updatedAt: new Date().toISOString() },
                        { id: "2", title: "学习计划", content: "本周重点：\n1. 深入学习 Tailwind\n2. 整理Flex布局的最佳实践\n*注意：下周一需要提交 Demo*。", updatedAt: new Date(Date.now() - 86400000).toISOString() }
                    ];
                    if (!state.currentNoteId) state.currentNoteId = state.notes[0].id;
                }
            }
            renderNoteList();
            if (state.currentNoteId) loadNote(state.currentNoteId);
        });
    })();
    if (window.loadChatHistoryList) window.loadChatHistoryList();
    if (window.innerWidth < 768) toggleSidebar();
    if (state.chatOpen) toggleAIChat();
    if (state.eventOpen) toggleEventModule();
    document.addEventListener("click", (e) => {
        const dropdown = document.getElementById("sortDropdown");
        const btn = document.getElementById("sortBtn");
        if (dropdown && !dropdown.classList.contains("hidden") && !dropdown.contains(e.target) && !(btn && btn.contains(e.target))) dropdown.classList.add("hidden");
    });
    document.addEventListener("input", (e) => {
        if (e.target.tagName === "TEXTAREA" && e.target.closest("#eventList")) {
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
        }
    });
    if (typeof initPreviewEditable === "function") initPreviewEditable();
}

window.handleLoginSubmit = async function(ev) {
    ev.preventDefault();
    const username = (document.getElementById("loginUsername") && document.getElementById("loginUsername").value || "").trim();
    if (!username) return false;
    try {
        const r = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ username: username })
        });
        if (!r.ok) { alert("登录失败"); return false; }
        const loginJson = await r.json().catch(function () { return {}; });
        const uid = loginJson.user_id || (document.getElementById("loginUsername") && document.getElementById("loginUsername").value || "").trim();
        await runAppInit(uid);
    } catch (e) {
        alert("登录请求失败");
        return false;
    }
    return false;
};

window.handleLogout = async function() {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } catch (e) {}
    location.reload();
};

document.addEventListener("DOMContentLoaded", async function() {
    try {
        const r = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
        if (r.status === 401) {
            enforceLoginPage();
            return;
        }
        const me = await r.json().catch(function () { return {}; });
        await runAppInit(me.user_id);
    } catch (e) {
        console.warn("Auth check failed", e);
        enforceLoginPage();
    }
});
