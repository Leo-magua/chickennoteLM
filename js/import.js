// js/import.js - 增强导入功能 (JSON, Markdown, ZIP, CSV)

/**
 * 导入管理器 - 支持多种格式导入
 */
const ImportManager = {
    
    /**
     * 主导入函数 - 根据文件扩展名自动识别格式
     */
    async importFromFile(file) {
        if (!file) return;

        const filename = file.name.toLowerCase();
        const extension = filename.split('.').pop();

        try {
            switch (extension) {
                case 'json':
                    await this.importJson(file);
                    break;
                case 'md':
                case 'markdown':
                    await this.importMarkdown(file);
                    break;
                case 'zip':
                    await this.importZip(file);
                    break;
                case 'csv':
                    await this.importCsv(file);
                    break;
                default:
                    throw new Error(`不支持的文件格式: ${extension}`);
            }
        } catch (error) {
            console.error('导入失败:', error);
            this.showToast(`导入失败: ${error.message}`, 'error');
        }
    },

    /**
     * 导入 JSON 文件
     */
    async importJson(file) {
        const text = await this.readFileAsText(file);
        
        try {
            const data = JSON.parse(text);
            
            window.withAutoSave(() => {
                if (Array.isArray(data)) {
                    // 数组格式：笔记数组或事件数组
                    if (data.length > 0 && data[0].title !== undefined) {
                        // 可能是笔记数组
                        if (confirm('导入为笔记数组？点确定导入笔记，取消导入事件')) {
                            window.state.notes = this.mergeNotes(window.state.notes, data);
                        } else {
                            window.state.events = data;
                        }
                    } else {
                        window.state.events = data;
                    }
                } else if (data.notes || data.events) {
                    // 对象格式：包含 notes/events 属性
                    if (data.notes) {
                        window.state.notes = this.mergeNotes(window.state.notes, data.notes);
                    }
                    if (data.events) {
                        window.state.events = data.events;
                    }
                } else if (data.id && data.title !== undefined) {
                    // 单篇笔记对象
                    window.state.notes = this.mergeNotes(window.state.notes, [data]);
                } else {
                    throw new Error('无法识别的JSON格式');
                }
            });
            
            this.showToast('JSON 导入成功');
            if (window.state.notes.length) window.loadNote(window.state.notes[0].id);
        } catch (ex) {
            throw new Error('无效的 JSON 文件: ' + ex.message);
        }
    },

    /**
     * 导入 Markdown 文件
     * 支持单篇笔记 (.md) 或 frontmatter 格式
     */
    async importMarkdown(file) {
        const text = await this.readFileAsText(file);
        
        // 尝试解析 frontmatter
        const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        
        let note = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            title: file.name.replace(/\.md$/i, ''),
            content: text,
            updatedAt: new Date().toISOString()
        };

        if (frontmatterMatch) {
            // 解析 frontmatter
            const frontmatter = frontmatterMatch[1];
            const content = frontmatterMatch[2].trim();
            
            // 解析 YAML-like frontmatter
            const idMatch = frontmatter.match(/^id:\s*(.+)$/m);
            const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
            const updatedMatch = frontmatter.match(/^updatedAt:\s*(.+)$/m);
            
            if (idMatch) note.id = idMatch[1].trim();
            if (titleMatch) note.title = titleMatch[1].trim();
            if (updatedMatch) note.updatedAt = updatedMatch[1].trim();
            
            note.content = content;
        }

        window.withAutoSave(() => {
            window.state.notes = this.mergeNotes(window.state.notes, [note]);
        });
        
        this.showToast(`笔记 "${note.title}" 导入成功`);
        window.loadNote(note.id);
    },

    /**
     * 导入 ZIP 文件
     */
    async importZip(file) {
        // 检查是否支持 JSZip
        if (typeof JSZip === 'undefined') {
            await this.loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
        }

        const zip = await JSZip.loadAsync(file);
        const importedNotes = [];
        const importedEvents = [];

        // 1. 尝试读取 metadata.json (汇总数据)
        const metadataFile = zip.file('metadata.json') || zip.file('backup.json');
        if (metadataFile) {
            const metadataContent = await metadataFile.async('text');
            try {
                const metadata = JSON.parse(metadataContent);
                if (metadata.notes) {
                    importedNotes.push(...metadata.notes);
                }
                if (metadata.events) {
                    importedEvents.push(...metadata.events);
                }
            } catch (e) {
                console.warn('metadata.json 解析失败');
            }
        }

        // 2. 读取 notes/ 目录下的 .md 文件
        const noteFiles = zip.file(/^notes\/.*\.md$/i);
        for (const noteFile of noteFiles) {
            const content = await noteFile.async('text');
            const filename = noteFile.name.split('/').pop().replace(/\.md$/i, '');
            
            // 尝试从文件名解析 ID
            const idMatch = filename.match(/_([a-zA-Z0-9]+)$/);
            const noteId = idMatch ? idMatch[1] : Date.now().toString() + Math.random().toString(36).substr(2, 5);
            
            // 解析 frontmatter
            let note = {
                id: noteId,
                title: filename.replace(/_[a-zA-Z0-9]+$/, ''),
                content: content,
                updatedAt: new Date().toISOString()
            };

            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
            if (frontmatterMatch) {
                const frontmatter = frontmatterMatch[1];
                const body = frontmatterMatch[2].trim();
                
                const idMatch2 = frontmatter.match(/^id:\s*(.+)$/m);
                const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
                const updatedMatch = frontmatter.match(/^updatedAt:\s*(.+)$/m);
                
                if (idMatch2) note.id = idMatch2[1].trim();
                if (titleMatch) note.title = titleMatch[1].trim();
                if (updatedMatch) note.updatedAt = updatedMatch[1].trim();
                
                note.content = body;
            }

            // 检查是否已存在（避免重复）
            const existingIndex = importedNotes.findIndex(n => n.id === note.id);
            if (existingIndex >= 0) {
                importedNotes[existingIndex] = note;
            } else {
                importedNotes.push(note);
            }
        }

        // 3. 读取根目录下的 .md 文件
        const rootMdFiles = zip.file(/^(?!notes\/).*\.md$/i);
        for (const mdFile of rootMdFiles) {
            if (mdFile.name === 'README.md' || mdFile.name === 'README.txt') continue;
            
            const content = await mdFile.async('text');
            const filename = mdFile.name.replace(/\.md$/i, '');
            
            let note = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                title: filename,
                content: content,
                updatedAt: new Date().toISOString()
            };

            // 尝试解析 frontmatter
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
            if (frontmatterMatch) {
                const frontmatter = frontmatterMatch[1];
                const body = frontmatterMatch[2].trim();
                
                const idMatch = frontmatter.match(/^id:\s*(.+)$/m);
                const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
                const updatedMatch = frontmatter.match(/^updatedAt:\s*(.+)$/m);
                
                if (idMatch) note.id = idMatch[1].trim();
                if (titleMatch) note.title = titleMatch[1].trim();
                if (updatedMatch) note.updatedAt = updatedMatch[1].trim();
                
                note.content = body;
            }

            importedNotes.push(note);
        }

        // 4. 读取 events.json
        const eventsFile = zip.file('events.json');
        if (eventsFile) {
            const eventsContent = await eventsFile.async('text');
            try {
                const events = JSON.parse(eventsContent);
                if (Array.isArray(events)) {
                    importedEvents.push(...events);
                }
            } catch (e) {
                console.warn('events.json 解析失败');
            }
        }

        // 5. 应用导入的数据
        if (importedNotes.length === 0 && importedEvents.length === 0) {
            throw new Error('ZIP 文件中未找到可导入的笔记或事件');
        }

        window.withAutoSave(() => {
            if (importedNotes.length > 0) {
                window.state.notes = this.mergeNotes(window.state.notes, importedNotes);
            }
            if (importedEvents.length > 0) {
                window.state.events = importedEvents;
            }
        });

        this.showToast(`导入成功: ${importedNotes.length} 篇笔记, ${importedEvents.length} 个事件`);
        if (window.state.notes.length) window.loadNote(window.state.notes[0].id);
    },

    /**
     * 导入 CSV 文件
     */
    async importCsv(file) {
        const text = await this.readFileAsText(file);
        
        // 移除 BOM
        const cleanText = text.replace(/^\uFEFF/, '');
        const lines = cleanText.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
            throw new Error('CSV 文件格式不正确');
        }

        // 解析表头
        const headers = this.parseCsvLine(lines[0]);
        
        // 检查是笔记 CSV 还是事件 CSV
        const isEventCsv = headers.includes('上下文') || headers.includes('context');
        
        if (isEventCsv) {
            // 导入为事件
            const events = [];
            for (let i = 1; i < lines.length; i++) {
                const values = this.parseCsvLine(lines[i]);
                const event = {};
                headers.forEach((header, index) => {
                    const value = values[index] || '';
                    switch (header.trim()) {
                        case '标题':
                        case 'title':
                            event.title = value;
                            break;
                        case '上下文':
                        case 'context':
                            event.context = value;
                            break;
                        case '标签':
                        case 'tags':
                            event.tags = value.split(/;\s*/).filter(t => t);
                            break;
                        case '时间':
                        case 'time':
                            event.time = value;
                            break;
                    }
                });
                if (event.title) {
                    event.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
                    events.push(event);
                }
            }
            
            window.withAutoSave(() => {
                window.state.events = events;
            });
            this.showToast(`导入 ${events.length} 个事件`);
        } else {
            // 导入为笔记
            const notes = [];
            for (let i = 1; i < lines.length; i++) {
                const values = this.parseCsvLine(lines[i]);
                const note = {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                    title: '',
                    content: '',
                    updatedAt: new Date().toISOString()
                };
                
                headers.forEach((header, index) => {
                    const value = values[index] || '';
                    switch (header.trim()) {
                        case 'ID':
                        case 'id':
                            if (value) note.id = value;
                            break;
                        case '标题':
                        case 'title':
                            note.title = value;
                            break;
                        case '内容':
                        case 'content':
                        case '内容摘要':
                            note.content = value;
                            break;
                        case '更新时间':
                        case 'updatedAt':
                            if (value) note.updatedAt = value;
                            break;
                    }
                });
                
                if (note.title || note.content) {
                    notes.push(note);
                }
            }
            
            window.withAutoSave(() => {
                window.state.notes = this.mergeNotes(window.state.notes, notes);
            });
            this.showToast(`导入 ${notes.length} 篇笔记`);
            if (window.state.notes.length) window.loadNote(window.state.notes[0].id);
        }
    },

    /**
     * 解析 CSV 行（处理引号）
     */
    parseCsvLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];
            
            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    current += '"';
                    i++; // 跳过下一个引号
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    },

    /**
     * 合并笔记（避免重复 ID）
     */
    mergeNotes(existingNotes, newNotes) {
        const noteMap = new Map();
        
        // 添加现有笔记
        existingNotes.forEach(note => {
            noteMap.set(note.id, note);
        });
        
        // 添加新笔记（会覆盖相同 ID 的）
        newNotes.forEach(note => {
            if (noteMap.has(note.id)) {
                // 合并：保留更新时间较新的
                const existing = noteMap.get(note.id);
                const existingTime = new Date(existing.updatedAt || 0);
                const newTime = new Date(note.updatedAt || 0);
                if (newTime >= existingTime) {
                    noteMap.set(note.id, note);
                }
            } else {
                noteMap.set(note.id, note);
            }
        });
        
        return Array.from(noteMap.values());
    },

    /**
     * 读取文件为文本
     */
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('文件读取失败'));
            reader.readAsText(file);
        });
    },

    /**
     * 动态加载脚本
     */
    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

    /**
     * 显示 Toast 提示
     */
    showToast(message, type = 'success') {
        if (typeof window.showToast === 'function') {
            window.showToast(message);
        } else {
            const toast = document.createElement('div');
            toast.className = 'fixed bottom-6 right-6 bg-slate-800 text-white px-4 py-2.5 rounded-xl shadow-xl z-50';
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }
    }
};

// 绑定到全局
window.ImportManager = ImportManager;

/**
 * 文件导入处理函数（替换原有的 importDataFromFile）
 */
window.importDataFromFile = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    ImportManager.importFromFile(file).finally(() => {
        // 清空 input，允许重复选择同一文件
        const input = document.getElementById('importFile');
        if (input) input.value = '';
    });
};
