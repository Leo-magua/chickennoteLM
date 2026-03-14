/**
 * IndexedDB Database Module for chickennoteLM
 * Provides offline-first data storage with sync capabilities
 */

const DB_NAME = 'chickennoteLM';
const DB_VERSION = 1;
const STORES = {
  NOTES: 'notes',
  SYNC_QUEUE: 'sync_queue',
  SYNC_LOG: 'sync_logs',
  CHUNKS: 'chunks'
};

class IndexedDBManager {
  constructor() {
    this.db = null;
    this.deviceId = this.getOrCreateDeviceId();
  }

  getOrCreateDeviceId() {
    let deviceId = localStorage.getItem('device_id');
    if (!deviceId) {
      deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('device_id', deviceId);
    }
    return deviceId;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORES.NOTES)) {
          const notesStore = db.createObjectStore(STORES.NOTES, { keyPath: 'id' });
          notesStore.createIndex('modified_at', 'modified_at', { unique: false });
          notesStore.createIndex('sync_status', 'sync_status', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
          const queueStore = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
          queueStore.createIndex('timestamp', 'timestamp', { unique: false });
          queueStore.createIndex('status', 'status', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.SYNC_LOG)) {
          const logStore = db.createObjectStore(STORES.SYNC_LOG, { keyPath: 'id', autoIncrement: true });
          logStore.createIndex('created_at', 'created_at', { unique: false });
          logStore.createIndex('note_id', 'note_id', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.CHUNKS)) {
          const chunksStore = db.createObjectStore(STORES.CHUNKS, { keyPath: 'chunk_key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('[IndexedDB] Database initialized');
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('[IndexedDB] Error opening database:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async addNote(note) {
    const transaction = this.db.transaction([STORES.NOTES], 'readwrite');
    const store = transaction.objectStore(STORES.NOTES);

    const noteData = {
      id: note.id || this.generateId(),
      title: note.title || '',
      content: note.content || '',
      created_at: note.created_at || Date.now(),
      modified_at: note.modified_at || Date.now(),
      sync_status: 'pending',
      last_synced_at: null,
      device_id: this.deviceId,
      conflict_resolved: false
    };

    return new Promise((resolve, reject) => {
      const request = store.put(noteData);
      request.onsuccess = () => resolve(noteData);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getNote(id) {
    const transaction = this.db.transaction([STORES.NOTES], 'readonly');
    const store = transaction.objectStore(STORES.NOTES);

    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getAllNotes() {
    const transaction = this.db.transaction([STORES.NOTES], 'readonly');
    const store = transaction.objectStore(STORES.NOTES);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async updateNote(id, updates) {
    const transaction = this.db.transaction([STORES.NOTES], 'readwrite');
    const store = transaction.objectStore(STORES.NOTES);

    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const note = getRequest.result;
        if (!note) {
          reject(new Error('Note not found'));
          return;
        }

        const updatedNote = {
          ...note,
          ...updates,
          modified_at: Date.now(),
          sync_status: 'pending'
        };

        const putRequest = store.put(updatedNote);
        putRequest.onsuccess = () => resolve(updatedNote);
        putRequest.onerror = (e) => reject(e.target.error);
      };
      getRequest.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteNote(id) {
    const transaction = this.db.transaction([STORES.NOTES], 'readwrite');
    const store = transaction.objectStore(STORES.NOTES);

    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async addToSyncQueue(noteId, action = 'update') {
    const transaction = this.db.transaction([STORES.SYNC_QUEUE], 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);

    const queueItem = {
      note_id: noteId,
      action,
      device_id: this.deviceId,
      timestamp: Date.now(),
      retry_count: 0,
      status: 'pending'
    };

    return new Promise((resolve, reject) => {
      const request = store.add(queueItem);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getPendingSyncItems() {
    const transaction = this.db.transaction([STORES.SYNC_QUEUE], 'readonly');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    const index = store.index('status');

    return new Promise((resolve, reject) => {
      const request = index.getAll('pending');
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async markSyncCompleted(queueId) {
    const transaction = this.db.transaction([STORES.SYNC_QUEUE], 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);

    return new Promise((resolve, reject) => {
      const getRequest = store.get(queueId);
      getRequest.onsuccess = () => {
        const item = getRequest.result;
        item.status = 'completed';
        item.completed_at = Date.now();
        const updateRequest = store.put(item);
        updateRequest.onsuccess = () => resolve();
        updateRequest.onerror = (e) => reject(e.target.error);
      };
      getRequest.onerror = (e) => reject(e.target.error);
    });
  }

  async addSyncLog(noteId, action, status, details = null) {
    const transaction = this.db.transaction([STORES.SYNC_LOG], 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_LOG);

    const logEntry = {
      note_id: noteId,
      device_id: this.deviceId,
      action,
      status,
      details: details ? JSON.stringify(details) : null,
      created_at: Date.now()
    };

    return new Promise((resolve, reject) => {
      const request = store.add(logEntry);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async storeChunk(noteId, chunkIndex, totalChunks, chunkData) {
    const transaction = this.db.transaction([STORES.CHUNKS], 'readwrite');
    const store = transaction.objectStore(STORES.CHUNKS);

    const chunkKey = `${noteId}_${chunkIndex}`;
    const chunk = {
      chunk_key: chunkKey,
      note_id: noteId,
      chunk_index: chunkIndex,
      total_chunks: totalChunks,
      data: chunkData,
      received_at: Date.now()
    };

    return new Promise((resolve, reject) => {
      const request = store.put(chunk);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getChunks(noteId) {
    const transaction = this.db.transaction([STORES.CHUNKS], 'readonly');
    const store = transaction.objectStore(STORES.CHUNKS);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const noteChunks = request.result
          .filter(chunk => chunk.note_id === noteId)
          .sort((a, b) => a.chunk_index - b.chunk_index);
        resolve(noteChunks);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async clearChunks(noteId) {
    const transaction = this.db.transaction([STORES.CHUNKS], 'readwrite');
    const store = transaction.objectStore(STORES.CHUNKS);
    const chunks = await this.getChunks(noteId);

    return Promise.all(chunks.map(chunk => {
      return new Promise((resolve, reject) => {
        const request = store.delete(chunk.chunk_key);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
      });
    }));
  }

  generateId() {
    return 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  getDeviceId() {
    return this.deviceId;
  }

  async clearAll() {
    const stores = [STORES.NOTES, STORES.SYNC_QUEUE, STORES.SYNC_LOG, STORES.CHUNKS];
    for (const storeName of stores) {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      await new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
      });
    }
  }
}

const dbManager = new IndexedDBManager();

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    dbManager.init().catch(console.error);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { IndexedDBManager, dbManager };
}
