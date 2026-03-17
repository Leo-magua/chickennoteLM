// Paste Image Feature - 粘贴图片功能
// 允许用户从剪贴板粘贴图片到编辑器（上传为文件并插入 Markdown 路径）

(function() {
    'use strict';

    // 配置
    const CONFIG = {
        maxImageWidth: 1200,
        maxImageHeight: 1200,
        maxFileSize: 5 * 1024 * 1024, // 5MB
        quality: 0.8
    };

    const IMAGE_URL_RE = /^https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s<>"']*)?$/i;

    function getEditor() {
        return document.getElementById('noteEditor')
            || document.getElementById('noteContent')
            || document.querySelector('textarea[data-note-editor]')
            || document.querySelector('.note-editor')
            || document.querySelector('#editorArea textarea')
            || document.querySelector('.edit-area textarea')
            || Array.from(document.querySelectorAll('textarea')).find((t) => t.offsetParent != null && !t.disabled);
    }

    function getCurrentNoteId() {
        return String((window.state && window.state.currentNoteId) || 'draft');
    }

    function getClipboardText(clipboardData) {
        if (!clipboardData || typeof clipboardData.getData !== 'function') return '';
        return (clipboardData.getData('text/plain') || '').trim();
    }

    function isImageUrl(text) {
        return IMAGE_URL_RE.test((text || '').trim());
    }

    async function handlePaste(event) {
        if (!(event.target && (event.target.tagName === 'TEXTAREA' || event.target.isContentEditable))) return;
        const insertTarget = event.target.tagName === 'TEXTAREA' ? event.target : getEditor();
        if (!insertTarget || insertTarget.tagName !== 'TEXTAREA') return;
        await processPasteEvent(event, insertTarget);
    }

    function handlePasteWithTarget(event, textarea) {
        if (textarea && textarea.tagName === 'TEXTAREA') {
            processPasteEvent(event, textarea);
        }
    }

    function handlePasteDocument(event) {
        const clipboardData = event.clipboardData || window.clipboardData;
        const editor = getEditor();
        if (!editor || editor.tagName !== 'TEXTAREA') return;
        if (event.target === editor) return;
        const hasImage = getImageItems(clipboardData).length > 0;
        const text = getClipboardText(clipboardData);
        if (!hasImage && !isImageUrl(text)) return;
        event.preventDefault();
        handlePasteWithTarget(event, editor);
    }

    async function processPasteEvent(event, insertTarget) {
        const clipboardData = event.clipboardData || window.clipboardData;
        if (!clipboardData) return;

        const imageItems = getImageItems(clipboardData);
        const pastedText = getClipboardText(clipboardData);

        if (imageItems.length === 0) {
            if (!isImageUrl(pastedText)) return;
            event.preventDefault();
            insertExternalImageUrl(insertTarget, pastedText);
            ensureImageVisibleAfterPaste(insertTarget);
            showToast('图片链接已插入并显示', 'success');
            return;
        }

        event.preventDefault();

        for (const item of imageItems) {
            try {
                const imageData = await processImageItem(item);
                const uploaded = await uploadImage(imageData);
                insertImageAtCursor(insertTarget, {
                    alt: imageData.alt,
                    url: uploaded.url
                });
                ensureImageVisibleAfterPaste(insertTarget);
                showToast('图片已粘贴并显示', 'success');
            } catch (error) {
                console.error('[PasteImage] Failed:', error);
                showToast('粘贴失败: ' + error.message, 'error');
            }
        }
    }

    function getImageItems(clipboardData) {
        const imageItems = [];
        const items = clipboardData.items || [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type && items[i].type.startsWith('image/')) {
                imageItems.push(items[i]);
            }
        }
        if (imageItems.length === 0 && clipboardData.files) {
            for (let i = 0; i < clipboardData.files.length; i++) {
                const file = clipboardData.files[i];
                if (file.type && file.type.startsWith('image/')) {
                    imageItems.push(file);
                }
            }
        }
        return imageItems;
    }

    function processImageItem(item) {
        return new Promise((resolve, reject) => {
            const file = typeof item.getAsFile === 'function' ? item.getAsFile() : item;
            if (!file) return reject(new Error('无法获取图片'));

            if (file.size > CONFIG.maxFileSize) {
                return reject(new Error('图片超过5MB限制'));
            }

            if (!file.type || !file.type.startsWith('image/')) {
                return reject(new Error('不支持该图片格式'));
            }

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const result = await compressImage(e.target.result, file.type);
                    result.originalType = file.type;
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('读取失败'));
            reader.readAsDataURL(file);
        });
    }

    function compressImage(dataUrl, mimeType) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                if (width > CONFIG.maxImageWidth || height > CONFIG.maxImageHeight) {
                    const ratio = Math.min(
                        CONFIG.maxImageWidth / width,
                        CONFIG.maxImageHeight / height
                    );
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                let format = 'image/jpeg';
                let quality = CONFIG.quality;
                if (mimeType === 'image/png' || mimeType === 'image/webp') {
                    format = mimeType;
                    quality = 0.9;
                }

                if (canvas.toBlob) {
                    canvas.toBlob(function(blob) {
                        if (!blob) {
                            reject(new Error('图片压缩失败'));
                            return;
                        }
                        resolve({
                            blob,
                            mimeType: format,
                            width,
                            height,
                            alt: '粘贴的图片'
                        });
                    }, format, quality);
                } else {
                    const fallbackDataUrl = canvas.toDataURL(format, quality);
                    resolve({
                        blob: dataUrlToBlob(fallbackDataUrl),
                        mimeType: format,
                        width,
                        height,
                        alt: '粘贴的图片'
                    });
                }
            };
            img.onerror = () => reject(new Error('图片解析失败'));
            img.src = dataUrl;
        });
    }

    function dataUrlToBlob(dataUrl) {
        const parts = dataUrl.split(',');
        const mimeMatch = parts[0].match(/data:([^;]+);base64/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const binary = atob(parts[1] || '');
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            array[i] = binary.charCodeAt(i);
        }
        return new Blob([array], { type: mime });
    }

    async function uploadImage(imageData) {
        const ext = imageData.mimeType === 'image/png'
            ? 'png'
            : imageData.mimeType === 'image/webp'
                ? 'webp'
                : imageData.mimeType === 'image/gif'
                    ? 'gif'
                    : 'jpg';
        const formData = new FormData();
        formData.append('image', imageData.blob, `paste-${Date.now()}.${ext}`);
        formData.append('note_id', getCurrentNoteId());

        const response = await fetch('/api/uploads/image', {
            method: 'POST',
            credentials: 'include',
            body: formData
        });

        if (response.status === 401) {
            throw new Error('请先登录后再粘贴图片');
        }
        if (!response.ok) {
            throw new Error(`上传失败 (${response.status})`);
        }

        const data = await response.json();
        if (!data || !data.url) {
            throw new Error('服务器未返回图片地址');
        }
        return data;
    }

    function insertImageAtCursor(textarea, imageData) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const before = text.substring(0, start);
        const after = text.substring(end);

        const alt = imageData.alt || '图片';
        const markdown = '\n\n![' + alt + '](' + imageData.url + ')\n';

        textarea.value = before + markdown + after;
        const newPos = start + markdown.length;
        textarea.selectionStart = textarea.selectionEnd = newPos;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();
    }

    function insertExternalImageUrl(textarea, url) {
        insertImageAtCursor(textarea, {
            alt: '网络图片',
            url: url
        });
    }

    function ensureImageVisibleAfterPaste(insertTarget) {
        if (typeof window.updateEditorPreview === 'function') {
            window.updateEditorPreview();
        }
        if (window.state && window.state.editorView !== 'preview' && typeof window.toggleEditorView === 'function') {
            window.toggleEditorView();
            return;
        }
        if (window.state && window.state.editorView === 'preview' && typeof window.renderEditorView === 'function') {
            window.renderEditorView();
            const editor = getEditor();
            if (editor && insertTarget !== editor) {
                editor.focus();
            }
        }
    }

    function showToast(message, type) {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        } else {
            const toast = document.createElement('div');
            toast.textContent = message;
            var bg = type === 'error' ? '#fee' : '#efe';
            var color = type === 'error' ? '#c00' : '#060';
            var border = type === 'error' ? '#fcc' : '#cfc';
            toast.style.cssText = 'position: fixed; top: 20px; right: 20px; padding: 12px 20px; background: ' + bg + '; color: ' + color + '; border: 1px solid ' + border + '; border-radius: 8px; z-index: 9999; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }
    }

    let documentBound = false;
    function init() {
        if (!documentBound) {
            documentBound = true;
            document.addEventListener('paste', handlePasteDocument);
            console.log('[PasteImage] Document paste listener attached');
        }
        const editor = getEditor();
        if (editor && !editor.dataset.pasteImageBound) {
            editor.dataset.pasteImageBound = '1';
            editor.addEventListener('paste', handlePaste);
            console.log('[PasteImage] Bound to editor:', editor.id || editor.className || 'textarea');
        }
    }

    function runInit() {
        init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runInit);
    } else {
        runInit();
    }
    setTimeout(runInit, 150);
})();
