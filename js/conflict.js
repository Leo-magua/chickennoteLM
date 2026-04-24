/**
 * Conflict Resolution Module - 冲突对比与合并界面
 * 提供差异对比UI和手动合并功能
 */

(function () {
  'use strict';

  // 冲突队列（当用户正在处理一个冲突时，其他冲突排队等待）
  let pendingConflicts = [];
  let isConflictModalOpen = false;

  /**
   * 简单的行级diff算法
   * @param {string} localText - 本地版本文本
   * @param {string} serverText - 服务器版本文本
   * @returns {Array<{type: string, text: string}>} - diff结果数组
   */
  function computeLineDiff(localText, serverText) {
    const localLines = (localText || '').split('\n');
    const serverLines = (serverText || '').split('\n');
    const result = [];

    // 使用简单的LCS（最长公共子序列）变体
    const m = localLines.length;
    const n = serverLines.length;

    // 动态规划表
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (localLines[i] === serverLines[j]) {
          dp[i][j] = dp[i + 1][j + 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    // 回溯构建diff
    let i = 0, j = 0;
    while (i < m || j < n) {
      if (i < m && j < n && localLines[i] === serverLines[j]) {
        result.push({ type: 'same', text: localLines[i] });
        i++;
        j++;
      } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
        result.push({ type: 'add', text: serverLines[j] });
        j++;
      } else if (i < m) {
        result.push({ type: 'remove', text: localLines[i] });
        i++;
      } else {
        break;
      }
    }

    return result;
  }

  /**
   * 将diff结果渲染为HTML
   * @param {Array} diff - diff结果
   * @returns {string} HTML字符串
   */
  function renderDiffHtml(diff) {
    if (!diff || diff.length === 0) {
      return '<div class="text-slate-400 text-sm italic p-2">（空内容）</div>';
    }

    const html = diff.map(item => {
      const escaped = escapeHtml(item.text);
      if (item.type === 'same') {
        return `<div class="diff-line diff-same px-2 py-0.5 text-sm text-slate-700">${escaped || '&nbsp;'}</div>`;
      } else if (item.type === 'add') {
        return `<div class="diff-line diff-add px-2 py-0.5 text-sm bg-green-50 text-green-800 border-l-2 border-green-400">+ ${escaped || '&nbsp;'}</div>`;
      } else if (item.type === 'remove') {
        return `<div class="diff-line diff-remove px-2 py-0.5 text-sm bg-red-50 text-red-800 border-l-2 border-red-400">- ${escaped || '&nbsp;'}</div>`;
      }
      return '';
    }).join('');

    return html;
  }

  /**
   * 转义HTML特殊字符
   */
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 格式化时间戳
   */
  function formatTimestamp(ts) {
    if (!ts) return '未知';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '未知';
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  /**
   * 获取服务器端笔记内容
   */
  async function fetchServerNote(noteId) {
    try {
      const resp = await fetch(window.cnApi('api/sync/status'), {
        method: 'GET',
        credentials: 'same-origin'
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      const noteMeta = (data.notes || []).find(n => String(n.id) === String(noteId));
      if (!noteMeta) return null;

      // 通过pull获取完整内容
      const deviceId = (window.dbManager && window.dbManager.getDeviceId) ? window.dbManager.getDeviceId() : 'default';
      const pullResp = await fetch(window.cnApi('api/sync/pull'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          last_sync_at: 0,
          note_ids: [noteId]
        })
      });
      if (!pullResp.ok) return null;
      const pullData = await pullResp.json();
      const serverNote = (pullData.updated_notes || []).find(n => String(n.id) === String(noteId));
      return serverNote || null;
    } catch (e) {
      console.error('[Conflict] Failed to fetch server note:', e);
      return null;
    }
  }

  /**
   * 打开冲突解决模态框
   */
  async function openConflictModal(conflict) {
    const modal = document.getElementById('conflictModal');
    const overlay = document.getElementById('conflictModalOverlay');
    if (!modal) return;

    isConflictModalOpen = true;

    // 获取本地笔记
    let localNote = null;
    if (window.dbManager && window.dbManager.getNote) {
      try {
        localNote = await window.dbManager.getNote(conflict.id);
      } catch (e) {
        console.error('[Conflict] Failed to get local note:', e);
      }
    }

    // 如果没有本地笔记，从state中查找
    if (!localNote && window.state && window.state.notes) {
      const stateNote = window.state.notes.find(n => String(n.id) === String(conflict.id));
      if (stateNote) {
        localNote = {
          id: stateNote.id,
          title: stateNote.title || '',
          content: stateNote.content || '',
          tags: stateNote.tags || [],
          modified_at: stateNote.updatedAt ? new Date(stateNote.updatedAt).getTime() : conflict.client_modified_at
        };
      }
    }

    // 获取服务器笔记
    const serverNote = await fetchServerNote(conflict.id);

    if (!localNote && !serverNote) {
      showToast('无法获取冲突笔记内容', 3000);
      isConflictModalOpen = false;
      processNextConflict();
      return;
    }

    const localTitle = localNote ? (localNote.title || '') : '';
    const localContent = localNote ? (localNote.content || '') : '';
    const serverTitle = serverNote ? (serverNote.title || '') : '';
    const serverContent = serverNote ? (serverNote.content || '') : '';

    // 更新UI
    const titleEl = document.getElementById('conflictNoteTitle');
    if (titleEl) titleEl.textContent = localTitle || serverTitle || '未命名笔记';

    const localTimeEl = document.getElementById('conflictLocalTime');
    if (localTimeEl) localTimeEl.textContent = '本地版本：' + formatTimestamp(localNote ? localNote.modified_at : conflict.client_modified_at);

    const serverTimeEl = document.getElementById('conflictServerTime');
    if (serverTimeEl) serverTimeEl.textContent = '服务器版本：' + formatTimestamp(serverNote ? serverNote.modified_at : conflict.server_modified_at);

    // 渲染标题diff
    const titleDiffEl = document.getElementById('conflictTitleDiff');
    if (titleDiffEl) {
      if (localTitle !== serverTitle) {
        titleDiffEl.innerHTML = renderDiffHtml(computeLineDiff(localTitle, serverTitle));
        titleDiffEl.classList.remove('hidden');
      } else {
        titleDiffEl.classList.add('hidden');
      }
    }

    // 渲染内容diff
    const contentDiffEl = document.getElementById('conflictContentDiff');
    if (contentDiffEl) {
      contentDiffEl.innerHTML = renderDiffHtml(computeLineDiff(localContent, serverContent));
    }

    // 填充合并编辑器
    const mergeEditor = document.getElementById('conflictMergeEditor');
    if (mergeEditor) {
      mergeEditor.value = localContent || serverContent || '';
    }

    // 存储当前冲突数据到modal元素上
    modal.dataset.conflictId = conflict.id;
    modal.dataset.localTitle = localTitle;
    modal.dataset.localContent = localContent;
    modal.dataset.serverTitle = serverTitle;
    modal.dataset.serverContent = serverContent;
    modal.dataset.localModifiedAt = localNote ? localNote.modified_at : conflict.client_modified_at;
    modal.dataset.serverModifiedAt = serverNote ? serverNote.modified_at : conflict.server_modified_at;
    modal.dataset.localTags = JSON.stringify(localNote ? (localNote.tags || []) : []);
    modal.dataset.serverTags = JSON.stringify(serverNote ? (serverNote.tags || []) : []);

    // 默认显示diff视图
    showConflictView('diff');

    // 显示模态框
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (overlay) {
      overlay.classList.remove('hidden');
    }
  }

  /**
   * 关闭冲突解决模态框
   */
  function closeConflictModal() {
    const modal = document.getElementById('conflictModal');
    const overlay = document.getElementById('conflictModalOverlay');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      delete modal.dataset.conflictId;
    }
    if (overlay) {
      overlay.classList.add('hidden');
    }
    isConflictModalOpen = false;
    processNextConflict();
  }

  /**
   * 切换冲突视图（diff / merge）
   */
  function showConflictView(view) {
    const diffView = document.getElementById('conflictDiffView');
    const mergeView = document.getElementById('conflictMergeView');
    const diffBtn = document.getElementById('conflictViewDiffBtn');
    const mergeBtn = document.getElementById('conflictViewMergeBtn');

    if (view === 'diff') {
      if (diffView) diffView.classList.remove('hidden');
      if (mergeView) mergeView.classList.add('hidden');
      if (diffBtn) {
        diffBtn.classList.add('bg-blue-100', 'text-blue-700');
        diffBtn.classList.remove('text-slate-600', 'hover:bg-slate-100');
      }
      if (mergeBtn) {
        mergeBtn.classList.remove('bg-blue-100', 'text-blue-700');
        mergeBtn.classList.add('text-slate-600', 'hover:bg-slate-100');
      }
    } else {
      if (diffView) diffView.classList.add('hidden');
      if (mergeView) mergeView.classList.remove('hidden');
      if (diffBtn) {
        diffBtn.classList.remove('bg-blue-100', 'text-blue-700');
        diffBtn.classList.add('text-slate-600', 'hover:bg-slate-100');
      }
      if (mergeBtn) {
        mergeBtn.classList.add('bg-blue-100', 'text-blue-700');
        mergeBtn.classList.remove('text-slate-600', 'hover:bg-slate-100');
      }
    }
  }

  /**
   * 处理下一个冲突
   */
  function processNextConflict() {
    if (pendingConflicts.length === 0) return;
    const next = pendingConflicts.shift();
    openConflictModal(next);
  }

  /**
   * 将冲突添加到队列
   */
  function enqueueConflicts(conflicts) {
    if (!conflicts || conflicts.length === 0) return;
    pendingConflicts.push(...conflicts);
    if (!isConflictModalOpen) {
      processNextConflict();
    }
  }

  /**
   * 解决冲突（调用服务器API）
   */
  async function resolveConflict(strategy) {
    const modal = document.getElementById('conflictModal');
    if (!modal || !modal.dataset.conflictId) return;

    const noteId = modal.dataset.conflictId;
    const localTitle = modal.dataset.localTitle || '';
    const localContent = modal.dataset.localContent || '';
    const serverTitle = modal.dataset.serverTitle || '';
    const serverContent = modal.dataset.serverContent || '';
    const localTags = JSON.parse(modal.dataset.localTags || '[]');
    const serverTags = JSON.parse(modal.dataset.serverTags || '[]');

    let resolution = { id: noteId, resolution: strategy };

    if (strategy === 'client') {
      resolution.title = localTitle;
      resolution.content = localContent;
      resolution.updatedAt = new Date().toISOString();
      resolution.tags = localTags;
    } else if (strategy === 'server') {
      // 服务器版本：本地需要更新为服务器内容
      resolution.title = serverTitle;
      resolution.content = serverContent;
      resolution.updatedAt = new Date().toISOString();
      resolution.tags = serverTags;
    } else if (strategy === 'merge') {
      const mergeEditor = document.getElementById('conflictMergeEditor');
      const mergedContent = mergeEditor ? mergeEditor.value : (localContent || serverContent);
      // 合并标题：优先使用本地标题（用户更可能修改了标题）
      const mergedTitle = localTitle || serverTitle;
      // 合并标签：取并集
      const mergedTags = Array.from(new Set([...localTags, ...serverTags]));

      resolution.title = mergedTitle;
      resolution.content = mergedContent;
      resolution.updatedAt = new Date().toISOString();
      resolution.tags = mergedTags;
    }

    try {
      const resp = await fetch(window.cnApi('api/sync/resolve'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: (window.dbManager && window.dbManager.getDeviceId) ? window.dbManager.getDeviceId() : 'default',
          resolutions: [resolution]
        })
      });

      if (!resp.ok) {
        throw new Error('HTTP ' + resp.status);
      }

      const data = await resp.json();
      const result = (data.results || [])[0];

      if (result && result.success) {
        // 更新本地笔记
        if (strategy === 'server' || strategy === 'merge') {
          const updatedNote = {
            title: resolution.title,
            content: resolution.content,
            tags: resolution.tags,
            updatedAt: resolution.updatedAt,
            modified_at: Date.now()
          };

          // 更新state
          if (window.state && window.state.notes) {
            const idx = window.state.notes.findIndex(n => String(n.id) === String(noteId));
            if (idx >= 0) {
              window.state.notes[idx] = {
                ...window.state.notes[idx],
                ...updatedNote
              };
            }
          }

          // 更新IndexedDB
          if (window.dbManager && window.dbManager.updateNote) {
            try {
              await window.dbManager.updateNote(noteId, {
                title: resolution.title,
                content: resolution.content,
                tags: resolution.tags,
                sync_status: 'synced'
              });
            } catch (e) {
              console.warn('[Conflict] Failed to update local note:', e);
            }
          }

          // 如果当前正在编辑这篇笔记，更新编辑器
          if (window.state && String(window.state.currentNoteId) === String(noteId)) {
            const editorTitle = document.getElementById('editorTitle');
            const editorContent = document.getElementById('editorContent');
            if (editorTitle) editorTitle.value = resolution.title;
            if (editorContent) editorContent.value = resolution.content;
          }
        } else if (strategy === 'client') {
          // 客户端版本：重新加入同步队列
          if (window.dbManager && window.dbManager.addToSyncQueue) {
            try {
              await window.dbManager.addToSyncQueue(noteId, 'update');
            } catch (e) {
              console.warn('[Conflict] Failed to re-queue note:', e);
            }
          }
        }

        showToast(`已${strategy === 'client' ? '使用本地版本' : strategy === 'server' ? '使用服务器版本' : '合并'}解决冲突`, 3000);

        // 刷新笔记列表以更新冲突指示器
        if (typeof renderNoteList === 'function') {
          renderNoteList();
        }
      } else {
        throw new Error(result && result.error ? result.error : '未知错误');
      }
    } catch (e) {
      console.error('[Conflict] Resolution failed:', e);
      showToast('冲突解决失败: ' + e.message, 4000);
      return;
    }

    closeConflictModal();
  }

  /**
   * 检查笔记是否有未解决的冲突
   */
  async function checkNoteConflict(noteId) {
    // 简单检查：如果笔记在pendingConflicts队列中，则认为有冲突
    return pendingConflicts.some(c => String(c.id) === String(noteId));
  }

  /**
   * 获取当前待处理冲突数量
   */
  function getPendingConflictCount() {
    return pendingConflicts.length + (isConflictModalOpen ? 1 : 0);
  }

  // 导出到全局
  window.conflictManager = {
    enqueueConflicts,
    openConflictModal,
    closeConflictModal,
    showConflictView,
    resolveConflict,
    checkNoteConflict,
    getPendingConflictCount,
    computeLineDiff,
    renderDiffHtml
  };
})();
