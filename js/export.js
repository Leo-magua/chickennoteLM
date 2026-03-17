// js/export.js - 上下文相关导出功能 (Markdown, ZIP, CSV)

/**
 * 导出管理器 - 上下文相关的导出功能
 * 
 * 使用场景:
 * 1. 笔记列表页: 导出所有笔记为ZIP (每篇独立.md)
 * 2. 编辑页: 导出当前笔记 (默认.md, 可选ZIP/CSV)
 */
const ExportManager = {
    // 导出格式配置（严格3种格式：Markdown、ZIP、CSV）
    formats: {
        markdown: {
            name: 'Markdown',
            ext: 'md',
            mime: 'text/markdown;charset=utf-8',
            icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
        },
        zip: {
            name: 'ZIP 备份',
            ext: 'zip',
            mime: 'application/zip',
            icon: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4'
        },
        csv: {
            name: 'CSV 表格',
            ext: 'csv',
            mime: 'text/csv;charset=utf-8',
            icon: 'M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z'
        }
    },

    // ==================== 笔记列表页: 导出所有笔记 ====================

    /**
     * 导出所有笔记为ZIP (每篇笔记独立的.md文件)
     * 用于笔记列表页的"导出所有笔记"按钮
     */
    async exportAllNotesAsZip() {
        const notes = window.state?.notes || [];
        
        if (notes.length === 0) {
            this.showToast('没有可导出的笔记', 'warning');
            return;
        }

        try {
            // 检查是否支持 JSZip
            if (typeof JSZip === 'undefined') {
                await this.loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
            }

            const zip = new JSZip();
            const timestamp = this.getTimestamp();

            // 创建笔记目录
            const notesFolder = zip.folder('notes');

            // 添加每篇笔记为独立 .md 文件
            notes.forEach(note => {
                const safeTitle = this.sanitizeFilename(note.title || 'untitled');
                const filename = `${safeTitle}_${note.id.substring(0, 8)}.md`;
                
                // Markdown 内容
                let content = `---\n`;
                content += `id: ${note.id}\n`;
                content += `title: ${note.title || ''}\n`;
                content += `updatedAt: ${note.updatedAt || ''}\n`;
                content += `---\n\n`;
                content += note.content || '';
                
                notesFolder.file(filename, content);
            });

            // 添加汇总索引文件
            const indexContent = this.generateAllNotesIndex(notes);
            zip.file('README.md', indexContent);

            // 添加元数据文件 (便于恢复)
            const metadata = {
                exportTime: new Date().toISOString(),
                version: '1.0',
                application: 'ChickenNoteLM',
                noteCount: notes.length,
                notes: notes.map(n => ({
                    id: n.id,
                    title: n.title,
                    updatedAt: n.updatedAt,
                    filename: `${this.sanitizeFilename(n.title || 'untitled')}_${n.id.substring(0, 8)}.md`
                }))
            };
            zip.file('metadata.json', JSON.stringify(metadata, null, 2));

            // 下载
            const blob = await zip.generateAsync({ type: 'blob' });
            this.downloadBlob(blob, `all_notes_${timestamp}.zip`);
            this.showToast(`已导出 ${notes.length} 篇笔记`);
        } catch (error) {
            console.error('导出失败:', error);
            this.showToast(`导出失败: ${error.message}`, 'error');
        }
    },

    /**
     * 生成所有笔记的索引文档
     */
    generateAllNotesIndex(notes) {
        const timestamp = new Date().toLocaleString('zh-CN');
        let content = `# 笔记导出索引\n\n`;
        content += `> 导出时间: ${timestamp}\n`;
        content += `> 笔记总数: ${notes.length} 篇\n\n`;
        content += `## 笔记列表\n\n`;

        notes.forEach((note, index) => {
            const updated = note.updatedAt 
                ? new Date(note.updatedAt).toLocaleString('zh-CN') 
                : '未知';
            const safeTitle = this.sanitizeFilename(note.title || 'untitled');
            const filename = `${safeTitle}_${note.id.substring(0, 8)}.md`;
            
            content += `${index + 1}. [${note.title || '未命名笔记'}](notes/${filename})\n`;
            content += `   - ID: ${note.id}\n`;
            content += `   - 更新时间: ${updated}\n\n`;
        });

        content += `## 文件说明\n\n`;
        content += `- \`notes/\` 目录: 包含所有笔记的 Markdown 文件\n`;
        content += `- \`metadata.json\`: 笔记元数据（可用于恢复）\n`;
        content += `- \`README.md\`: 本索引文件\n`;

        return content;
    },

    // ==================== 编辑页: 导出当前笔记 ====================

    /**
     * 显示当前笔记的导出菜单（编辑页使用）
     * 默认导出为.md，可选ZIP/CSV
     */
    showCurrentNoteExportMenu(event) {
        event.stopPropagation();
        
        const currentNote = this.getCurrentNote();
        if (!currentNote) {
            this.showToast('没有可导出的笔记', 'warning');
            return;
        }

        let menu = document.getElementById('currentNoteExportMenu');
        if (menu) {
            menu.remove();
        }

        // 创建菜单
        menu = document.createElement('div');
        menu.id = 'currentNoteExportMenu';
        menu.className = 'absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50 animate-fade-in';
        menu.style.top = '100%';
        
        const exportBtn = document.getElementById('exportCurrentNoteBtn');
        if (!exportBtn) return;
        
        exportBtn.style.position = 'relative';
        exportBtn.appendChild(menu);

        // 菜单项（当前笔记导出选项）
        const items = [
            { format: 'markdown', label: '导出为 Markdown', desc: '当前笔记 (.md)' },
            { format: 'zip', label: '导出为 ZIP', desc: '包含元数据' },
            { format: 'csv', label: '导出为 CSV', desc: '表格格式' }
        ];

        menu.innerHTML = items.map(item => `
            <button onclick="ExportManager.exportCurrentNote('${item.format}')" 
                    class="w-full px-4 py-2.5 text-left hover:bg-slate-50 transition-colors flex items-center gap-3">
                <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${this.formats[item.format].icon}"/>
                </svg>
                <div>
                    <div class="text-sm font-medium text-slate-700">${item.label}</div>
                    <div class="text-xs text-slate-400">${item.desc}</div>
                </div>
            </button>
        `).join('');

        // 点击外部关闭
        setTimeout(() => {
            document.addEventListener('click', this.closeCurrentNoteExportMenu, { once: true });
        }, 100);
    },

    /**
     * 关闭当前笔记导出菜单
     */
    closeCurrentNoteExportMenu() {
        const menu = document.getElementById('currentNoteExportMenu');
        if (menu) {
            menu.remove();
        }
    },

    /**
     * 导出当前笔记
     */
    async exportCurrentNote(format = 'markdown') {
        this.closeCurrentNoteExportMenu();
        
        const note = this.getCurrentNote();
        if (!note) {
            this.showToast('没有可导出的笔记', 'warning');
            return;
        }

        try {
            switch (format) {
                case 'markdown':
                    await this.exportSingleNoteAsMarkdown(note);
                    break;
                case 'zip':
                    await this.exportSingleNoteAsZip(note);
                    break;
                case 'csv':
                    await this.exportSingleNoteAsCsv(note);
                    break;
                default:
                    throw new Error(`不支持的格式: ${format}`);
            }
        } catch (error) {
            console.error('导出失败:', error);
            this.showToast(`导出失败: ${error.message}`, 'error');
        }
    },

    /**
     * 获取当前笔记
     */
    getCurrentNote() {
        const currentNoteId = window.state?.currentNoteId;
        if (!currentNoteId) return null;
        return window.state?.notes?.find(n => n.id === currentNoteId);
    },

    /**
     * 导出单篇笔记为 Markdown
     */
    async exportSingleNoteAsMarkdown(note) {
        const updated = note.updatedAt 
            ? new Date(note.updatedAt).toLocaleString('zh-CN') 
            : '';
        
        let content = `---\n`;
        content += `id: ${note.id}\n`;
        content += `title: ${note.title || ''}\n`;
        content += `updatedAt: ${note.updatedAt || ''}\n`;
        content += `---\n\n`;
        content += `# ${note.title || '未命名笔记'}\n\n`;
        if (updated) {
            content += `> 最后更新：${updated}\n\n`;
        }
        content += note.content || '';

        const safeTitle = this.sanitizeFilename(note.title || 'note');
        const filename = `${safeTitle}_${note.id.substring(0, 8)}.md`;
        this.downloadFile(content, filename, 'text/markdown;charset=utf-8');
        this.showToast(`已导出 ${filename}`);
    },

    /**
     * 导出单篇笔记为 ZIP
     */
    async exportSingleNoteAsZip(note) {
        if (typeof JSZip === 'undefined') {
            await this.loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
        }

        const zip = new JSZip();
        const safeTitle = this.sanitizeFilename(note.title || 'note');

        // Markdown 内容
        let mdContent = `---\n`;
        mdContent += `id: ${note.id}\n`;
        mdContent += `title: ${note.title || ''}\n`;
        mdContent += `updatedAt: ${note.updatedAt || ''}\n`;
        mdContent += `---\n\n`;
        mdContent += note.content || '';

        zip.file(`${safeTitle}.md`, mdContent);
        zip.file('metadata.json', JSON.stringify(note, null, 2));
        zip.file('README.txt', `笔记: ${note.title || '未命名'}\nID: ${note.id}\n导出时间: ${new Date().toLocaleString('zh-CN')}`);

        const blob = await zip.generateAsync({ type: 'blob' });
        const filename = `${safeTitle}_${note.id.substring(0, 8)}.zip`;
        this.downloadBlob(blob, filename);
        this.showToast(`已导出 ${filename}`);
    },

    /**
     * 导出单篇笔记为 CSV
     */
    async exportSingleNoteAsCsv(note) {
        const headers = ['ID', '标题', '内容', '字数', '更新时间'];
        const wordCount = (note.content || '').length;
        const updated = note.updatedAt 
            ? new Date(note.updatedAt).toLocaleString('zh-CN') 
            : '';
        
        const row = [
            this.escapeCsv(note.id),
            this.escapeCsv(note.title || ''),
            this.escapeCsv(note.content || ''),
            wordCount,
            this.escapeCsv(updated)
        ];

        const csv = [headers, row].map(r => r.join(',')).join('\n');
        const BOM = '\uFEFF';
        const safeTitle = this.sanitizeFilename(note.title || 'note');
        const filename = `${safeTitle}_${note.id.substring(0, 8)}.csv`;
        this.downloadFile(BOM + csv, filename, 'text/csv;charset=utf-8');
        this.showToast(`已导出 ${filename}`);
    },

    // ==================== 旧版兼容性方法（保留） ====================

    /**
     * 导出所有笔记为 Markdown（合并为一个文件）- 旧版兼容
     */
    async exportMarkdown(notes) {
        const timestamp = new Date().toLocaleString('zh-CN');
        let content = `# ChickenNoteLM 笔记导出\n\n`;
        content += `> 导出时间: ${timestamp}\n`;
        content += `> 笔记数量: ${notes.length} 篇\n\n`;
        content += `---\n\n`;

        notes.forEach((note, index) => {
            const updated = note.updatedAt 
                ? new Date(note.updatedAt).toLocaleString('zh-CN') 
                : '未知';
            
            content += `## ${index + 1}. ${note.title || '未命名笔记'}\n\n`;
            content += `**ID:** ${note.id}  \n`;
            content += `**更新时间:** ${updated}\n\n`;
            content += `${note.content || '(无内容)'}\n\n`;
            content += `---\n\n`;
        });

        const filename = `notes_${this.getTimestamp()}.md`;
        this.downloadFile(content, filename, 'text/markdown;charset=utf-8');
        this.showToast(`已导出 ${filename}`);
    },

    /**
     * 导出为 ZIP（完整备份）- 旧版兼容
     */
    async exportZip(notes, events) {
        if (typeof JSZip === 'undefined') {
            await this.loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
        }

        const zip = new JSZip();
        const timestamp = this.getTimestamp();

        const notesFolder = zip.folder('notes');
        const metadataFolder = zip.folder('metadata');

        notes.forEach(note => {
            const safeTitle = this.sanitizeFilename(note.title || 'untitled');
            const filename = `${safeTitle}_${note.id.substring(0, 8)}.md`;
            
            let content = `---\n`;
            content += `id: ${note.id}\n`;
            content += `title: ${note.title || ''}\n`;
            content += `updatedAt: ${note.updatedAt || ''}\n`;
            content += `---\n\n`;
            content += note.content || '';
            
            notesFolder.file(filename, content);
            metadataFolder.file(`${note.id}.json`, JSON.stringify(note, null, 2));
        });

        const fullBackup = {
            exportTime: new Date().toISOString(),
            version: '1.0',
            notes: notes,
            events: events
        };
        zip.file('backup.json', JSON.stringify(fullBackup, null, 2));

        if (events.length > 0) {
            zip.file('events.json', JSON.stringify(events, null, 2));
            const eventsCsv = this.convertEventsToCsv(events);
            zip.file('events.csv', eventsCsv);
        }

        const readme = this.generateReadme(notes.length, events.length);
        zip.file('README.txt', readme);

        const blob = await zip.generateAsync({ type: 'blob' });
        this.downloadBlob(blob, `chickennote_backup_${timestamp}.zip`);
        this.showToast('ZIP 备份已生成');
    },

    /**
     * 导出为 CSV - 旧版兼容
     */
    async exportCsv(notes) {
        const headers = ['ID', '标题', '内容摘要', '字数', '更新时间'];
        const rows = notes.map(note => {
            const contentPreview = (note.content || '')
                .replace(/[\n\r]/g, ' ')
                .substring(0, 100) + '...';
            const wordCount = (note.content || '').length;
            const updated = note.updatedAt 
                ? new Date(note.updatedAt).toLocaleString('zh-CN') 
                : '';
            
            return [
                this.escapeCsv(note.id),
                this.escapeCsv(note.title || ''),
                this.escapeCsv(contentPreview),
                wordCount,
                this.escapeCsv(updated)
            ];
        });

        const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
        const BOM = '\uFEFF';
        const filename = `notes_${this.getTimestamp()}.csv`;
        this.downloadFile(BOM + csv, filename, 'text/csv;charset=utf-8');
        this.showToast(`已导出 ${filename}`);
    },

    /**
     * 主导出函数 - 旧版兼容
     */
    async exportTo(format) {
        const notes = window.state?.notes || [];
        const events = window.state?.events || [];
        
        if (notes.length === 0 && events.length === 0) {
            this.showToast('没有可导出的数据', 'warning');
            return;
        }

        try {
            switch (format) {
                case 'markdown':
                    await this.exportMarkdown(notes);
                    break;
                case 'zip':
                    await this.exportZip(notes, events);
                    break;
                case 'csv':
                    await this.exportCsv(notes);
                    break;
                default:
                    throw new Error(`不支持的格式: ${format}`);
            }
        } catch (error) {
            console.error('导出失败:', error);
            this.showToast(`导出失败: ${error.message}`, 'error');
        }
    },

    // ==================== 辅助方法 ====================

    escapeCsv(value) {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    },

    convertEventsToCsv(events) {
        const headers = ['标题', '上下文', '标签', '时间'];
        const rows = events.map(e => [
            this.escapeCsv(e.title),
            this.escapeCsv(e.context),
            this.escapeCsv((e.tags || []).join('; ')),
            this.escapeCsv(e.time)
        ]);
        return [headers, ...rows].map(row => row.join(',')).join('\n');
    },

    generateReadme(noteCount, eventCount) {
        return `ChickenNoteLM 备份文件
========================

导出时间: ${new Date().toLocaleString('zh-CN')}
笔记数量: ${noteCount} 篇
事件数量: ${eventCount} 个

目录结构:
- notes/       : 每篇笔记的 Markdown 文件
- metadata/    : 每篇笔记的元数据 JSON
- backup.json  : 完整数据备份
- events.json  : 事件数据 (如有)
- events.csv   : 事件表格 (如有)

恢复方法:
1. 打开 ChickenNoteLM 应用
2. 使用导入功能选择 backup.json
3. 或单独导入 notes/ 下的 Markdown 文件

更多信息: https://github.com/Leo-magua/chickennoteLM
`;
    },

    sanitizeFilename(filename) {
        return filename
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 50) || 'untitled';
    },

    getTimestamp() {
        const now = new Date();
        return `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    },

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        this.downloadBlob(blob, filename);
    },

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

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
window.ExportManager = ExportManager;

// ==================== 全局导出函数 ====================

/**
 * 导出所有笔记为ZIP (笔记列表页使用)
 * 每篇笔记为独立的.md文件
 */
window.exportAllNotes = function() {
    ExportManager.exportAllNotesAsZip();
};

/**
 * 显示当前笔记导出菜单 (编辑页使用)
 */
window.showCurrentNoteExportMenu = function(event) {
    ExportManager.showCurrentNoteExportMenu(event);
};

/**
 * 导出当前笔记 (编辑页使用)
 */
window.exportCurrentNote = function(format) {
    ExportManager.exportCurrentNote(format);
};

// 旧版兼容
window.exportNotes = function() {
    ExportManager.exportAllNotesAsZip();
};

window.exportNotesAsMarkdown = function() {
    const note = ExportManager.getCurrentNote();
    if (note) {
        ExportManager.exportSingleNoteAsMarkdown(note);
    } else {
        ExportManager.showToast('没有可导出的笔记', 'warning');
    }
};

window.exportEvents = function() {
    const events = window.state?.events || [];
    if (events.length === 0) {
        ExportManager.showToast('没有可导出的事件', 'warning');
        return;
    }
    
    const csv = ExportManager.convertEventsToCsv(events);
    const BOM = '\uFEFF';
    const filename = `events_${ExportManager.getTimestamp()}.csv`;
    ExportManager.downloadFile(BOM + csv, filename, 'text/csv;charset=utf-8');
    ExportManager.showToast(`已导出 ${filename}`);
};

window.exportSelectedNotes = function(format = 'markdown') {
    const validFormats = ['markdown', 'zip', 'csv'];
    if (!validFormats.includes(format)) {
        console.error(`不支持的格式: ${format}`);
        return;
    }
    const selectedIds = window.state?.selectedNotes;
    if (!selectedIds || selectedIds.size === 0) {
        ExportManager.showToast('请先选择要导出的笔记', 'warning');
        return;
    }
    
    const selectedNotes = window.state.notes.filter(n => selectedIds.has(n.id));
    const originalNotes = window.state.notes;
    window.state.notes = selectedNotes;
    
    ExportManager.exportTo(format).finally(() => {
        window.state.notes = originalNotes;
    });
};
