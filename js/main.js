// js/main.js - 应用入口（支持 IndexedDB 离线优先 + 登录鉴权）

if ("serviceWorker" in navigator) {
    var swPath = typeof window.cnApi === "function" ? window.cnApi("sw.js") : "/sw.js";
    navigator.serviceWorker.register(swPath)
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

function initGlobalHoverTooltip() {
    if (window.__globalHoverTooltipInitialized) return;
    window.__globalHoverTooltipInitialized = true;

    const tooltip = document.getElementById("globalHoverTooltip");
    if (!tooltip) return;

    const scopeSelector = "#editorHeaderRight button, #editorFooterActions button";
    let activeElement = null;
    let showTimer = null;
    let hideTimer = null;

    function isDisabled(el) {
        return !!(el.disabled || el.getAttribute("aria-disabled") === "true" || el.dataset.tooltipSkip === "true");
    }

    function normalizeTooltipText(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
    }

    function extractTextFallback(el) {
        if (!el) return "";
        if (el.dataset && el.dataset.tooltip) return normalizeTooltipText(el.dataset.tooltip);
        if (el.dataset && el.dataset.cnTooltip) return normalizeTooltipText(el.dataset.cnTooltip);

        const title = el.getAttribute("title");
        if (title) {
            const normalizedTitle = normalizeTooltipText(title);
            el.dataset.cnTooltip = normalizedTitle;
            el.removeAttribute("title");
            if (!el.getAttribute("aria-label")) {
                el.setAttribute("aria-label", normalizedTitle);
            }
            return normalizedTitle;
        }

        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel) return normalizeTooltipText(ariaLabel);

        const placeholder = el.getAttribute("placeholder");
        if (placeholder) return normalizeTooltipText(placeholder);

        const text = normalizeTooltipText(el.innerText || el.textContent || "");
        if (text) return text.slice(0, 80);

        const name = el.getAttribute("name");
        return name ? normalizeTooltipText(name) : "";
    }

    function resolveInteractiveTarget(node) {
        if (!node || !node.closest) return null;
        const target = node.closest(scopeSelector);
        if (!target || isDisabled(target)) return null;
        return target;
    }

    function clearTimers() {
        if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
        }
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
    }

    function setTooltipPosition(target) {
        const margin = 12;
        const gap = 12;
        const targetRect = target.getBoundingClientRect();
        const rect = tooltip.getBoundingClientRect();
        let placement = "bottom";
        let left = targetRect.left + (targetRect.width / 2) - (rect.width / 2);
        let top = targetRect.bottom + gap;

        if (top + rect.height > window.innerHeight - margin) {
            top = targetRect.top - rect.height - gap;
            placement = "top";
        }

        if (top < margin) {
            top = Math.min(window.innerHeight - rect.height - margin, targetRect.bottom + gap);
            placement = "bottom";
        }

        if (left < margin) left = margin;
        if (left + rect.width > window.innerWidth - margin) {
            left = window.innerWidth - rect.width - margin;
        }

        tooltip.dataset.placement = placement;

        tooltip.style.left = left + "px";
        tooltip.style.top = top + "px";
    }

    function showTooltipForElement(el) {
        const message = extractTextFallback(el);
        if (!message) {
            hideTooltip();
            return;
        }

        clearTimers();
        activeElement = el;
        tooltip.textContent = message;
        tooltip.classList.add("is-visible");
        tooltip.setAttribute("aria-hidden", "false");
        setTooltipPosition(el);
    }

    function hideTooltip() {
        clearTimers();
        activeElement = null;
        tooltip.classList.remove("is-visible");
        tooltip.setAttribute("aria-hidden", "true");
    }

    function scheduleShow(target, immediate) {
        clearTimers();
        showTimer = setTimeout(function() {
            showTooltipForElement(target);
        }, immediate ? 0 : 140);
    }

    function scheduleHide() {
        clearTimers();
        hideTimer = setTimeout(function() {
            hideTooltip();
        }, 90);
    }

    document.addEventListener("mouseover", function(event) {
        const target = resolveInteractiveTarget(event.target);
        if (!target) {
            return;
        }
        if (target === activeElement) {
            clearTimers();
            return;
        }
        scheduleShow(target, false);
    });

    document.addEventListener("mouseout", function(event) {
        const target = resolveInteractiveTarget(event.target);
        if (!target) return;
        const related = event.relatedTarget;
        if (related && target.contains(related)) return;
        if (target === activeElement || target === resolveInteractiveTarget(event.target)) {
            scheduleHide();
        }
    });

    document.addEventListener("focusin", function(event) {
        const target = resolveInteractiveTarget(event.target);
        if (!target) return;
        scheduleShow(target, true);
    });

    document.addEventListener("focusout", function(event) {
        if (activeElement && event.target === activeElement) scheduleHide();
    });

    document.addEventListener("scroll", function() {
        if (activeElement) setTooltipPosition(activeElement);
    }, true);
    window.addEventListener("resize", function() {
        if (activeElement) setTooltipPosition(activeElement);
    });
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
            const me = await fetch(window.cnApi("api/auth/me"), { credentials: "include", cache: "no-store" });
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
    
    // 加载自动标签设置
    if (state.settings.autoTagEnabled !== undefined) {
        state.autoTagEnabled = state.settings.autoTagEnabled;
    }
    
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
            if (window.renderNoteTagFilter) window.renderNoteTagFilter();
            if (window.renderTagCloud) window.renderTagCloud();
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
            if (window.renderNoteTagFilter) window.renderNoteTagFilter();
            if (window.renderTagCloud) window.renderTagCloud();
            if (state.currentNoteId) loadNote(state.currentNoteId);
        });
    })();
    if (window.loadChatHistoryList) window.loadChatHistoryList();
    if (typeof window.initializeResponsiveUI === "function") {
        window.initializeResponsiveUI();
    } else if (typeof window.applyResponsiveLayout === "function") {
        window.applyResponsiveLayout();
    }
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
    
    // 初始化问候功能
    if (typeof initGreeting === "function") initGreeting();
}

window.handleLoginSubmit = async function(ev) {
    ev.preventDefault();
    const username = (document.getElementById("loginUsername") && document.getElementById("loginUsername").value || "").trim();
    if (!username) return false;
    try {
        const r = await fetch(window.cnApi("api/auth/login"), {
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
    try { await fetch(window.cnApi("api/auth/logout"), { method: "POST", credentials: "include" }); } catch (e) {}
    location.reload();
};

document.addEventListener("DOMContentLoaded", async function() {
    initGlobalHoverTooltip();
    if (typeof window.initializeResponsiveUI === "function") {
        window.initializeResponsiveUI();
    } else if (typeof window.applyResponsiveLayout === "function") {
        window.applyResponsiveLayout();
    }
    try {
        const r = await fetch(window.cnApi("api/auth/me"), { credentials: "include", cache: "no-store" });
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
