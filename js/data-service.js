/**
 * Data Service - 离线优先数据服务层
 * 集成 IndexedDB 与现有 state 系统
 */

class DataService {
  constructor() {
    this.db = null;
    this.isOnline = navigator.onLine;
    this.syncInProgress = false;
    this.initPromise = null;
  }

  resetInit() {
    this.initPromise = null;
  }

  async init() {
    if (this.initPromise) return this.initPromise;

    const uid = window.state?.currentUser;
    if (!uid) {
      console.warn('[DataService] init skipped: no currentUser');
      return Promise.resolve();
    }

    this.initPromise = new Promise(async (resolve) => {
      if (typeof dbManager !== 'undefined') {
        try {
          await dbManager.initForUser(uid);
          this.db = dbManager;
          console.log('[DataService] IndexedDB ready for user');
        } catch (e) {
          console.error('[DataService] IndexedDB init failed:', e);
        }
      }
      
      // 监听网络状态
      this.setupNetworkListeners();
      
      // 启动后台同步
      this.startBackgroundSync();
      
      resolve();
    });
    
    return this.initPromise;
  }

  setupNetworkListeners() {
    window.addEventListener('online', () => {
      console.log('[DataService] Online');
      this.isOnline = true;
      this.triggerSync();
    });
    
    window.addEventListener('offline', () => {
      console.log('[DataService] Offline');
      this.isOnline = false;
    });
  }

  // ==================== 笔记 CRUD ====================

  async saveNote(note) {
    // 1. 保存到 IndexedDB
    if (this.db) {
      await this.db.addNote(note);
      await this.db.addToSyncQueue(note.id, note.id ? 'update' : 'create');
    }
    
    // 2. 如果在线，立即同步
    if (this.isOnline) {
      this.triggerSync();
    }
    
    return note;
  }

  async updateNote(id, updates) {
    // 1. 更新 IndexedDB
    if (this.db) {
      await this.db.updateNote(id, updates);
      await this.db.addToSyncQueue(id, 'update');
    }
    
    // 2. 触发同步
    if (this.isOnline) {
      this.triggerSync();
    }
  }

  async deleteNote(id) {
    // 1. 从 IndexedDB 删除
    if (this.db) {
      await this.db.deleteNote(id);
      await this.db.addToSyncQueue(id, 'delete');
    }
    
    // 2. 触发同步
    if (this.isOnline) {
      this.triggerSync();
    }
  }

  async getNote(id) {
    // 优先从 IndexedDB 读取
    if (this.db) {
      const note = await this.db.getNote(id);
      if (note) return note;
    }
    
    // 回退到 state
    return window.state?.notes?.find(n => n.id === id);
  }

  async getAllNotes() {
    // 优先从 IndexedDB 读取
    if (this.db) {
      const notes = await this.db.getAllNotes();
      if (notes && notes.length > 0) {
        return notes.map(n => ({
          id: n.id,
          title: n.title,
          content: n.content,
          updatedAt: new Date(n.modified_at).toISOString(),
          createdAt: new Date(n.created_at).toISOString()
        }));
      }
    }
    
    // 回退到 state
    return window.state?.notes || [];
  }

  // ==================== 本地存储兼容 ====================

  saveToLocalStorage() {
    if (typeof saveDataToLocalStorage === 'function') {
      saveDataToLocalStorage();
    }
  }

  // ==================== 增量同步机制 ====================

  async triggerSync() {
    if (!this.isOnline || this.syncInProgress) return;
    // 本地刚有编辑/删除时，避免立即 pull 把旧服务器数据回灌到 UI
    const lastLocalMutationAt = Number(window.__lastLocalMutationAt || 0);
    if (Date.now() - lastLocalMutationAt < 5000) return;
    
    this.syncInProgress = true;
    
    try {
      // 1. 先推送本地变更，避免“先拉后推”导致删除回弹
      await this.pushToServer();
      
      // 2. 再拉取服务器变更
      await this.pullFromServer();
      
    } catch (e) {
      console.error('[DataService] Sync error:', e);
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * 从服务器拉取变更（增量同步）
   */
  async pullFromServer() {
    if (!this.db) return;
    
    // 获取上次同步时间
    const syncKey = typeof window.getLastSyncAtStorageKey === 'function'
      ? window.getLastSyncAtStorageKey()
      : 'last_sync_at';
    if (!syncKey) return;
    const lastSyncAt = parseInt(localStorage.getItem(syncKey) || '0');
    const clientNoteIds = (await this.db.getAllNotes()).map(n => n.id);
    
    try {
      const response = await fetch('/api/sync/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({
          device_id: this.db.deviceId,
          last_sync_at: lastSyncAt,
          note_ids: clientNoteIds
        })
      });
      
      if (response.status === 401) return;
      if (!response.ok) throw new Error('Pull failed');
      
      const data = await response.json();
      
      // 应用服务器变更到本地
      for (const note of data.updated_notes || []) {
        const existingNote = await this.db.getNote(note.id);
        
        if (existingNote) {
          // 更新现有笔记
          await this.db.updateNote(note.id, {
            title: note.title,
            content: note.content,
            modified_at: note.modified_at,
            sync_status: 'synced'
          });
        } else {
          // 新建笔记
          await this.db.addNote({
            id: note.id,
            title: note.title,
            content: note.content,
            modified_at: note.modified_at,
            created_at: note.modified_at,
            sync_status: 'synced'
          });
        }
        
        // 更新 UI
        this.updateStateNote(note);
      }
      
      // 处理服务器删除的笔记
      for (const deletedId of data.deleted_ids || []) {
        await this.db.deleteNote(deletedId);
        this.removeStateNote(deletedId);
      }
      
      // 保存同步时间
      if (data.server_time && syncKey) {
        localStorage.setItem(syncKey, data.server_time.toString());
      }
      
      console.log('[DataService] Pulled', data.updated_notes?.length || 0, 'updates');
      
    } catch (e) {
      console.error('[DataService] Pull error:', e);
      throw e;
    }
  }

  /**
   * 推送本地变更到服务器（增量同步）
   */
  async pushToServer() {
    if (!this.db) return;
    
    const pendingItems = await this.db.getPendingSyncItems();
    if (pendingItems.length === 0) return;
    
    const changes = [];
    for (const item of pendingItems) {
      // 删除动作在本地可能已经不存在对应 note，不能跳过
      if (item.action === 'delete') {
        changes.push({
          id: item.note_id,
          action: 'delete',
          modified_at: item.timestamp || Date.now()
        });
        continue;
      }

      const note = await this.db.getNote(item.note_id);
      if (!note) continue;
      
      changes.push({
        id: note.id,
        action: item.action,
        title: note.title,
        content: note.content,
        modified_at: note.modified_at,
        updatedAt: new Date(note.modified_at).toISOString()
      });
    }
    
    try {
      const response = await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({
          device_id: this.db.deviceId,
          changes: changes
        })
      });
      
      if (response.status === 401) return;
      if (!response.ok) throw new Error('Push failed');
      
      const data = await response.json();
      
      // 标记同步完成
      for (const item of pendingItems) {
        await this.db.markSyncCompleted(item.id);
      }
      
      // 更新笔记的同步状态和服务器时间戳
      for (const result of data.results || []) {
        if (result.success && result.server_modified_at) {
          await this.db.updateNote(result.id, {
            sync_status: 'synced',
            modified_at: result.server_modified_at
          });
        }
      }
      
      // 处理冲突
      if (data.conflicts && data.conflicts.length > 0) {
        console.warn('[DataService] Conflicts detected:', data.conflicts);
        this.handleConflicts(data.conflicts);
      }
      
      const pushSyncKey = typeof window.getLastSyncAtStorageKey === 'function'
        ? window.getLastSyncAtStorageKey()
        : 'last_sync_at';
      if (data.server_time && pushSyncKey) {
        localStorage.setItem(pushSyncKey, data.server_time.toString());
      }
      
      console.log('[DataService] Pushed', changes.length, 'changes');
      
    } catch (e) {
      console.error('[DataService] Push error:', e);
      throw e;
    }
  }

  /**
   * 处理同步冲突
   */
  async handleConflicts(conflicts) {
    for (const conflict of conflicts) {
      // 自动使用客户端版本（可以改为提示用户）
      console.log('[DataService] Resolving conflict for note:', conflict.id);
      
      const note = await this.db.getNote(conflict.id);
      if (note) {
        // 重新推送客户端版本
        await this.db.addToSyncQueue(conflict.id, 'update');
      }
    }
  }

  /**
   * 更新 state 中的笔记
   */
  updateStateNote(note) {
    const existingIndex = window.state?.notes?.findIndex(n => n.id === note.id);
    if (existingIndex >= 0) {
      window.state.notes[existingIndex] = {
        id: note.id,
        title: note.title,
        content: note.content,
        updatedAt: new Date(note.modified_at).toISOString()
      };
    } else {
      window.state.notes.push({
        id: note.id,
        title: note.title,
        content: note.content,
        updatedAt: new Date(note.modified_at).toISOString()
      });
    }
    
    // 刷新 UI
    if (typeof renderNoteList === 'function') {
      renderNoteList();
    }
  }

  /**
   * 从 state 中删除笔记
   */
  removeStateNote(noteId) {
    if (window.state?.notes) {
      window.state.notes = window.state.notes.filter(n => n.id !== noteId);
    }
    if (typeof renderNoteList === 'function') {
      renderNoteList();
    }
  }

  /**
   * 获取同步状态
   */
  async getSyncStatus() {
    try {
      const response = await fetch(`/api/sync/status?device_id=${this.db?.deviceId || 'default'}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to get sync status');
      return await response.json();
    } catch (e) {
      console.error('[DataService] Get sync status error:', e);
      return null;
    }
  }

  startBackgroundSync() {
    // 每 30 秒检查一次同步
    setInterval(() => {
      if (this.isOnline && !this.syncInProgress) {
        this.triggerSync();
      }
    }, 30000);
  }

  // ==================== 导入导出兼容 ====================

  async importNotes(notes) {
    for (const note of notes) {
      await this.saveNote(note);
    }
  }

  async exportNotes() {
    return this.getAllNotes();
  }

  // ==================== 冲突解决 ====================

  async resolveConflict(noteId, localNote, serverNote) {
    // 时间戳优先策略
    const localTime = new Date(localNote.modified_at || localNote.updatedAt).getTime();
    const serverTime = new Date(serverNote.modified_at || serverNote.updatedAt).getTime();
    
    if (localTime > serverTime) {
      // 本地更新，同步到服务器
      await this.db.updateNote(noteId, { conflict_resolved: true });
      return localNote;
    } else {
      // 服务器更新，应用到本地
      await this.db.updateNote(noteId, { 
        ...serverNote, 
        conflict_resolved: true 
      });
      return serverNote;
    }
  }
}

// 创建全局实例
const dataService = new DataService();

// 不在 DOMContentLoaded 自动 init；须在设置 state.currentUser 后由 main.runAppInit 调用

// 导出到全局
window.DataService = DataService;
window.dataService = dataService;
