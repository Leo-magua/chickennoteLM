import json
import mimetypes
import os
import queue
import re
import select
import shutil
import sys
import threading
import uuid
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from flask import Flask, jsonify, request, session

try:
    import pty
    _PTY_AVAILABLE = True
except ImportError:
    _PTY_AVAILABLE = False


BASE_DIR = Path(__file__).resolve().parent
NOTE_DIR = BASE_DIR / "notefile"
CHAT_DIR = BASE_DIR / "chatdata"
EVENT_DIR = BASE_DIR / "eventdata"
UPLOAD_DIR = BASE_DIR / "uploads"
NOTE_INDEX_FILE = "notes_index.json"

def now_iso() -> str:
    return datetime.utcnow().isoformat()


def slugify(title: str) -> str:
    """把标题转成可做文件名的短串，保留中文等，去掉非法字符"""
    s = (title or "").strip() or "note"
    for c in r'\/:*?"<>|':
        s = s.replace(c, "_")
    s = re.sub(r"\s+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return (s[:80] or "note") if s else "note"


app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-in-production")


def _sanitize_user_id(raw: str) -> str:
    if not raw or not isinstance(raw, str):
        return ""
    return re.sub(r"[^a-zA-Z0-9_]", "", str(raw).strip())[:64] or "default"


def _sanitize_path_segment(raw: str, default: str = "default") -> str:
    if not raw or not isinstance(raw, str):
        return default
    return re.sub(r"[^a-zA-Z0-9_-]", "_", str(raw).strip())[:80] or default


def get_current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    return _sanitize_user_id(uid) or None


def get_user_dirs(user_id: str):
    n = BASE_DIR / "notefile" / user_id
    c = BASE_DIR / "chatdata" / user_id
    e = BASE_DIR / "eventdata" / user_id
    s = BASE_DIR / "sync_state" / user_id
    for d in (n, c, e, s):
        d.mkdir(parents=True, exist_ok=True)
    return n, c, e, s


def get_user_upload_dir(user_id: str, note_id: str):
    upload_dir = UPLOAD_DIR / _sanitize_user_id(user_id) / _sanitize_path_segment(note_id, "note")
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir


def get_note_index_path(note_dir: Path) -> Path:
    return note_dir / NOTE_INDEX_FILE


def save_note_index(note_dir: Path, index_map: dict):
    path = get_note_index_path(note_dir)
    payload = {
        "version": 1,
        "updatedAt": now_iso(),
        "notes": list(index_map.values()),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def rebuild_note_index(note_dir: Path) -> dict:
    """
    从磁盘文件重建索引，按 note id 去重（同 id 多份文件时保留最新修改时间）。
    """
    by_id = {}
    for meta_path in note_dir.glob("*.json"):
        if meta_path.name == NOTE_INDEX_FILE:
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            continue

        note_id = str(meta.get("id") or meta_path.stem)
        modified_at = int(meta_path.stat().st_mtime * 1000)
        base = meta_path.stem
        prev = by_id.get(note_id)
        if prev and prev.get("modified_at", 0) >= modified_at:
            continue
        by_id[note_id] = {
            "id": note_id,
            "title": meta.get("title", ""),
            "base": base,
            "updatedAt": meta.get("updatedAt", now_iso()),
            "modified_at": modified_at,
        }
    return by_id


def load_note_index(note_dir: Path) -> dict:
    path = get_note_index_path(note_dir)
    if path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            notes = raw.get("notes") or []
            by_id = {}
            for n in notes:
                note_id = str(n.get("id") or "")
                if not note_id:
                    continue
                by_id[note_id] = {
                    "id": note_id,
                    "title": n.get("title", ""),
                    "base": n.get("base") or "",
                    "updatedAt": n.get("updatedAt", now_iso()),
                    "modified_at": int(n.get("modified_at") or 0),
                }
            return by_id
        except Exception:
            pass

    # 索引缺失或损坏时自动重建并落盘
    rebuilt = rebuild_note_index(note_dir)
    save_note_index(note_dir, rebuilt)
    return rebuilt


def guess_image_extension(mimetype: str, filename: str = "") -> str:
    mapping = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
    }
    if mimetype in mapping:
        return mapping[mimetype]
    suffix = Path(filename or "").suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}:
        return ".jpg" if suffix == ".jpeg" else suffix
    guessed = mimetypes.guess_extension(mimetype or "") or ".png"
    return ".jpg" if guessed == ".jpe" else guessed


def require_auth(f):
    from functools import wraps
    @wraps(f)
    def wrapped(*args, **kwargs):
        if not get_current_user():
            return jsonify({"error": "unauthorized", "message": "请先登录"}), 401
        return f(*args, **kwargs)
    return wrapped


@app.route("/")
def index():
    """根路由 - 返回前端页面"""
    import os
    index_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'index.html')
    try:
        with open(index_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return "<h1>ChickenNoteLM</h1><p>index.html not found</p>", 404

@app.route("/js/<path:filename>")
def serve_js(filename):
    """服务 JS 文件"""
    import os
    from flask import send_from_directory
    js_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'js')
    return send_from_directory(js_dir, filename)

@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    user = get_current_user()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    return jsonify({"user_id": user})


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    if not username:
        return jsonify({"error": "username required"}), 400
    user_id = _sanitize_user_id(username)
    if not user_id:
        return jsonify({"error": "invalid username"}), 400
    session["user_id"] = user_id
    return jsonify({"user_id": user_id})


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.pop("user_id", None)
    return jsonify({"status": "ok"})


@app.route("/api/uploads/image", methods=["POST"])
@require_auth
def upload_image():
    image = request.files.get("image")
    if not image:
        return jsonify({"error": "image required"}), 400

    mimetype = (image.mimetype or "").lower()
    if not mimetype.startswith("image/"):
        return jsonify({"error": "invalid image type"}), 400

    user_id = get_current_user()
    note_id = request.form.get("note_id") or "draft"
    upload_dir = get_user_upload_dir(user_id, note_id)
    ext = guess_image_extension(mimetype, image.filename or "")
    filename = f"{datetime.utcnow().strftime('%Y%m%dT%H%M%S')}_{uuid.uuid4().hex[:8]}{ext}"
    target = upload_dir / filename

    image.save(target)
    os.chmod(target, 0o644)

    return jsonify(
        {
            "ok": True,
            "url": f"/uploads/{_sanitize_user_id(user_id)}/{_sanitize_path_segment(note_id, 'note')}/{filename}",
            "filename": filename,
            "mimetype": mimetype,
        }
    )


@app.after_request
def add_cors_headers(response):
    # 带 credentials 的跨域请求不能使用 ACAO: *；回显 Origin 并允许凭据，避免登录后 Cookie 无法随 API 提交
    origin = request.headers.get("Origin")
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        vary = response.headers.get("Vary")
        response.headers["Vary"] = (vary + ", Origin") if vary else "Origin"
    else:
        response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    # 避免浏览器把笔记/事件等 GET API 缓存在磁盘，刷新后误用旧 JSON
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response


@app.get("/api/notes")
@require_auth
def get_notes():
    """返回所有笔记（以 notes_index.json 为准，索引指向具体 md/json 文件）"""
    notes = []
    note_dir, _, _, _ = get_user_dirs(get_current_user())
    index_map = load_note_index(note_dir)
    for note_id, meta in index_map.items():
        base = meta.get("base") or f"{slugify(meta.get('title', ''))}_{note_id}"
        md_path = note_dir / f"{base}.md"
        meta_path = note_dir / f"{base}.json"
        content = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
        # 读取标签信息
        tags = []
        if meta_path.exists():
            try:
                meta_data = json.loads(meta_path.read_text(encoding="utf-8"))
                tags = meta_data.get("tags", [])
            except Exception:
                pass
        notes.append(
            {
                "id": note_id,
                "title": meta.get("title", ""),
                "content": content,
                "updatedAt": meta.get("updatedAt", now_iso()),
                "tags": tags,
            }
        )
    return jsonify({"notes": notes})


@app.post("/api/sync/notes-events")
@require_auth
def sync_notes_events():
    """
    同步前端的 notes 和 events 到本地文件系统：
    - 每条笔记：notefile/<标题slug>_<id>.md 与 notefile/<标题slug>_<id>.json
    - 所有事件：eventdata/events.json
    """
    data = request.get_json(silent=True) or {}
    notes = data.get("notes") or []
    events = data.get("events") or []

    note_dir, _, event_dir, _ = get_user_dirs(get_current_user())
    old_index = load_note_index(note_dir)
    new_index = {}
    now_ms = int(datetime.utcnow().timestamp() * 1000)

    for note in notes:
        note_id = str(note.get("id") or uuid.uuid4())
        title = note.get("title") or ""
        content = note.get("content") or ""
        updated_at = note.get("updatedAt") or now_iso()
        tags = note.get("tags") or []

        base = f"{slugify(title)}_{note_id}"
        md_path = note_dir / f"{base}.md"
        meta_path = note_dir / f"{base}.json"

        md_path.write_text(content, encoding="utf-8")
        meta = {"id": note_id, "title": title, "updatedAt": updated_at, "tags": tags}
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

        old_base = (old_index.get(note_id) or {}).get("base")
        if old_base and old_base != base:
            (note_dir / f"{old_base}.json").unlink(missing_ok=True)
            (note_dir / f"{old_base}.md").unlink(missing_ok=True)

        new_index[note_id] = {
            "id": note_id,
            "title": title,
            "base": base,
            "updatedAt": updated_at,
            "modified_at": now_ms,
        }

    # 删除索引里已不存在的笔记文件
    for old_id, old_meta in old_index.items():
        if old_id in new_index:
            continue
        old_base = old_meta.get("base")
        if old_base:
            (note_dir / f"{old_base}.json").unlink(missing_ok=True)
            (note_dir / f"{old_base}.md").unlink(missing_ok=True)

    save_note_index(note_dir, new_index)

    events_path = event_dir / "events.json"
    events_path.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")

    return jsonify({"status": "ok"})


@app.route("/api/openclaw/health", methods=["GET"])
def openclaw_health():
    """用于在浏览器中确认本服务已包含 OpenClaw 代理（避免 404 时误判为缺路由）"""
    return jsonify({"ok": True, "openclaw_proxy": True})


def get_all_existing_tags(note_dir: Path) -> list:
    """
    从所有笔记的元数据中提取已有的标签列表（去重）
    返回: 按字母排序的标签列表
    """
    existing_tags = set()
    for meta_path in note_dir.glob("*.json"):
        if meta_path.name == NOTE_INDEX_FILE:
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            tags = meta.get("tags", [])
            if isinstance(tags, list):
                for tag in tags:
                    if tag and isinstance(tag, str):
                        existing_tags.add(tag.strip())
        except Exception:
            continue
    return sorted(list(existing_tags))


@app.route("/api/notes/tags/extract", methods=["POST"])
@require_auth
def extract_note_tags():
    """
    调用 AI API 从笔记内容中提取标签
    请求体: {"title": "笔记标题", "content": "笔记内容", "apiKey": "...", "baseUrl": "...", "model": "...", "prompt": "...", "existingTags": [...]}
    返回: {"tags": ["标签1", "标签2", ...]}
    """
    data = request.get_json(silent=True) or {}
    title = data.get("title", "")
    content = data.get("content", "")
    api_key = data.get("apiKey", "")
    base_url = (data.get("baseUrl") or "https://api.openai.com/v1").rstrip("/")
    model = data.get("model") or "gpt-3.5-turbo"
    custom_prompt = data.get("prompt", "")
    
    # 从前端传入的已识别标签（用于批量识别时保持标签一致性）
    client_existing_tags = data.get("existingTags", [])
    
    if not api_key:
        return jsonify({"error": "apiKey required"}), 400
    if not content.strip():
        return jsonify({"tags": []})
    
    # 获取已有的标签列表（用于提示AI优先复用）
    note_dir, _, _, _ = get_user_dirs(get_current_user())
    file_tags = get_all_existing_tags(note_dir)
    
    # 合并文件中的标签和前端传入的标签（去重）
    existing_tags = list(set(file_tags + client_existing_tags))
    existing_tags.sort()
    
    # 构建提示词（使用自定义提示词或默认提示词）
    if custom_prompt and custom_prompt.strip():
        system_prompt = custom_prompt
    else:
        # 构建已有标签的提示文本
        existing_tags_prompt = ""
        if existing_tags:
            existing_tags_prompt = f"""

【已有标签参考】
系统中已有的标签（按字母排序）：{', '.join(existing_tags)}

重要提示：
- 优先从上述已有标签中选择最匹配的标签
- 只有当已有标签完全不适用时，才创建新标签
- 这样可以保持标签体系的一致性，避免重复或近似的标签"""
        
        system_prompt = f"""你是一个智能标签提取助手。请从给定的笔记标题和内容中提取3-8个关键词标签。

要求：
1. 标签应该准确反映笔记的主题、类别或关键概念
2. 标签应该简洁，通常是1-4个中文词或英文单词
3. 优先提取：主题分类（如"技术","工作","学习"）、具体技术（如"Python","React"）、场景（如"会议","待办","想法"）
4. 只返回JSON格式：{{"tags": ["标签1", "标签2", ...]}}
5. 不要包含任何解释性文字，只返回JSON{existing_tags_prompt}"""

    user_content = f"标题：{title}\n\n内容：\n{content[:2000]}"  # 限制内容长度
    
    try:
        req = Request(
            f"{base_url}/chat/completions",
            data=json.dumps({
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ],
                "temperature": 0.3
            }).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            },
            method="POST"
        )
        
        with urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            reply = result["choices"][0]["message"]["content"]
            
            # 解析JSON
            try:
                # 查找JSON块
                json_match = re.search(r'\{[\s\S]*"tags"[\s\S]*\}', reply)
                if json_match:
                    parsed = json.loads(json_match.group())
                    tags = parsed.get("tags", [])
                else:
                    # 尝试直接解析
                    parsed = json.loads(reply)
                    tags = parsed.get("tags", [])
                
                # 清理标签
                tags = [str(t).strip() for t in tags if t and str(t).strip()]
                tags = tags[:10]  # 最多10个标签
                
                # 与已有标签进行匹配和去重
                # 优先使用已有的标签（避免创建重复或近似的标签）
                normalized_existing = {tag.lower(): tag for tag in existing_tags}
                final_tags = []
                for tag in tags:
                    tag_lower = tag.lower()
                    # 检查是否有完全匹配或近似的已有标签
                    matched = False
                    for existing_lower, existing_original in normalized_existing.items():
                        if tag_lower == existing_lower or tag_lower in existing_lower or existing_lower in tag_lower:
                            if existing_original not in final_tags:
                                final_tags.append(existing_original)
                            matched = True
                            break
                    if not matched:
                        # 没有匹配到已有标签，使用新标签
                        if tag not in final_tags:
                            final_tags.append(tag)
                
                return jsonify({"tags": final_tags})
            except json.JSONDecodeError:
                # 如果解析失败，尝试从文本中提取
                lines = reply.split('\n')
                tags = []
                for line in lines:
                    line = line.strip()
                    if line and not line.startswith('{') and not line.startswith('}'):
                        # 移除常见的列表标记
                        tag = re.sub(r'^[-*•\d.\s"\']+', '', line).strip()
                        if tag and len(tag) < 20:
                            tags.append(tag)
                tags = tags[:10]
                
                # 与已有标签进行匹配和去重
                normalized_existing = {tag.lower(): tag for tag in existing_tags}
                final_tags = []
                for tag in tags:
                    tag_lower = tag.lower()
                    matched = False
                    for existing_lower, existing_original in normalized_existing.items():
                        if tag_lower == existing_lower or tag_lower in existing_lower or existing_lower in tag_lower:
                            if existing_original not in final_tags:
                                final_tags.append(existing_original)
                            matched = True
                            break
                    if not matched:
                        if tag not in final_tags:
                            final_tags.append(tag)
                
                return jsonify({"tags": final_tags})
                
    except HTTPError as e:
        try:
            err_body = e.read().decode("utf-8")
            return jsonify({"error": err_body}), e.code
        except Exception:
            return jsonify({"error": str(e)}), e.code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/notes/tags", methods=["GET"])
@require_auth
def get_all_tags():
    """
    获取所有已有的标签列表（去重）
    返回: {"tags": ["标签1", "标签2", ...]}
    """
    note_dir, _, _, _ = get_user_dirs(get_current_user())
    existing_tags = get_all_existing_tags(note_dir)
    return jsonify({"tags": existing_tags})


@app.route("/api/openclaw/chat", methods=["POST", "OPTIONS"])
def openclaw_chat_proxy():
    """代理前端请求到 OpenClaw 网关，避免浏览器 CORS（file:// 直连 18789 会跨域）"""
    if request.method == "OPTIONS":
        return "", 204
    body = request.get_json(silent=True) or {}
    base_url = (body.get("openclawBaseUrl") or "http://127.0.0.1:18789/v1").rstrip("/")
    token = body.get("openclawToken") or ""
    messages = body.get("messages") or []
    if not messages:
        return jsonify({"error": "messages required"}), 400
    url = base_url + "/chat/completions"
    payload = {
        "model": body.get("model") or "openclaw",
        "messages": messages,
        "temperature": body.get("temperature", 0.7),
    }
    req = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": ("Bearer " + token) if token else "",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return jsonify(result)
    except HTTPError as e:
        try:
            err_body = e.read().decode("utf-8")
        except Exception:
            err_body = str(e)
        return jsonify({"error": err_body}), e.code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/events")
@require_auth
def get_events():
    """返回 eventdata 中的事件列表（如果有的话）"""
    _, _, event_dir, _ = get_user_dirs(get_current_user())
    events_path = event_dir / "events.json"
    if not events_path.exists():
        return jsonify({"events": []})
    try:
        events = json.loads(events_path.read_text(encoding="utf-8"))
    except Exception:
        events = []
    return jsonify({"events": events})


@app.get("/api/chats")
@require_auth
def list_chats():
    _, chat_dir, _, _ = get_user_dirs(get_current_user())
    """列出所有聊天会话的基本信息"""
    chats = []
    for path in chat_dir.glob("*.json"):
        try:
            chat = json.loads(path.read_text(encoding="utf-8"))
            chats.append(
                {
                    "id": chat.get("id") or path.stem,
                    "title": chat.get("title") or path.stem,
                    "createdAt": chat.get("createdAt"),
                    "updatedAt": chat.get("updatedAt"),
                }
            )
        except Exception:
            continue
    # 按更新时间倒序
    chats.sort(key=lambda c: c.get("updatedAt") or "", reverse=True)
    return jsonify({"chats": chats})


@app.get("/api/chats/<chat_id>")
@require_auth
def get_chat(chat_id: str):
    _, chat_dir, _, _ = get_user_dirs(get_current_user())
    """获取单个会话的完整内容"""
    path = chat_dir / f"{chat_id}.json"
    if not path.exists():
        return jsonify({"error": "not_found"}), 404
    try:
        chat = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return jsonify({"error": "invalid_chat_file"}), 500
    return jsonify(chat)


@app.post("/api/chats")
@require_auth
@require_auth
def create_chat():
    _, chat_dir, _, _ = get_user_dirs(get_current_user())
    body = request.get_json(silent=True) or {}
    title = body.get("title") or f"会话 {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    chat_id = body.get("id") or uuid.uuid4().hex
    now = now_iso()
    chat = {"id": chat_id, "title": title, "createdAt": now, "updatedAt": now, "messages": []}
    path = chat_dir / f"{chat_id}.json"
    path.write_text(json.dumps(chat, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify(chat)


@app.post("/api/chats/<chat_id>")
@require_auth
def save_chat(chat_id: str):
    _, chat_dir, _, _ = get_user_dirs(get_current_user())
    """保存（覆盖）某个聊天会话"""
    body = request.get_json(silent=True) or {}
    title = body.get("title")
    messages = body.get("messages") or []

    path = chat_dir / f"{chat_id}.json"
    existing = {}
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            existing = {}

    now = now_iso()
    chat = {
        "id": chat_id,
        "title": title or existing.get("title") or chat_id,
        "createdAt": existing.get("createdAt") or now,
        "updatedAt": now,
        "messages": messages,
    }
    path.write_text(json.dumps(chat, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify(chat)


def _ws_receive(ws, timeout=0.1):
    """从 WebSocket 收一条消息，支持 simple_websocket(timeout) 与 gevent-websocket(阻塞)。"""
    if getattr(ws, "receive", None):
        try:
            return ws.receive(timeout=timeout)
        except TypeError:
            pass
    # gevent-websocket 等只有阻塞 receive()，用队列+线程模拟超时
    if not hasattr(ws, "_recv_queue"):
        ws._recv_queue = queue.Queue()
        def _recv_thread():
            try:
                while True:
                    msg = ws.receive()
                    ws._recv_queue.put(msg)
                    if msg is None:
                        break
            except Exception:
                ws._recv_queue.put(None)
        t = threading.Thread(target=_recv_thread, daemon=True)
        t.start()
    try:
        return ws._recv_queue.get(timeout=timeout)
    except queue.Empty:
        return None


def _run_openclaw_tui_ws(ws):
    """在 PTY 中运行 openclaw tui，与 WebSocket 双向桥接。仅 Unix（Mac/Linux）可用。"""
    if not _PTY_AVAILABLE:
        try:
            ws.send("PTY 不可用（当前可能为 Windows），无法在此运行 openclaw tui。\r\n")
        except Exception:
            pass
        return
    openclaw_cmd = shutil.which("openclaw")
    if not openclaw_cmd:
        try:
            ws.send("未在 PATH 中找到 openclaw 命令，请先安装 OpenClaw。\r\n")
        except Exception:
            pass
        return
    master, slave = pty.openpty()
    pid = os.fork()
    if pid == 0:
        os.close(master)
        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)
        if slave > 2:
            os.close(slave)
        os.execvp(openclaw_cmd, [openclaw_cmd, "tui"])
        os._exit(127)
    os.close(slave)
    out_queue = queue.Queue()

    def read_pty():
        try:
            while True:
                try:
                    r, _, _ = select.select([master], [], [], 0.2)
                    if not r:
                        continue
                    data = os.read(master, 4096)
                    if not data:
                        break
                    try:
                        text = data.decode("utf-8", errors="replace")
                        out_queue.put(("text", text))
                    except Exception:
                        out_queue.put(("text", data.decode("utf-8", errors="replace")))
                except (OSError, ValueError):
                    break
        except Exception:
            pass
        out_queue.put(("done", None))

    t = threading.Thread(target=read_pty, daemon=True)
    t.start()
    try:
        while True:
            try:
                msg = out_queue.get(timeout=0.2)
            except queue.Empty:
                msg = None
            if msg:
                kind, payload = msg
                if kind == "done":
                    break
                if kind == "text":
                    ws.send(payload)
            try:
                data = _ws_receive(ws, timeout=0.1)
                if data:
                    if isinstance(data, str):
                        data = data.encode("utf-8")
                    os.write(master, data)
            except Exception:
                pass
    except Exception:
        pass
    try:
        os.close(master)
    except Exception:
        pass
    try:
        os.waitpid(pid, 0)
    except Exception:
        pass


@app.route("/api/openclaw/tui")
def openclaw_tui_ws():
    """WebSocket：在页面内模拟运行 openclaw tui。需用 gevent-websocket 启动时才能握手成功。"""
    ws = None
    if "wsgi.websocket" in request.environ:
        ws = request.environ["wsgi.websocket"]
    if ws is None:
        try:
            from simple_websocket import Server, ConnectionClosed
            ws = Server.accept(request.environ)
        except ImportError:
            return "需要安装 simple-websocket: pip install simple-websocket", 501
        except Exception:
            return (
                "WebSocket 升级失败。请先安装 gevent 与 gevent-websocket，再重新启动后端："
                " pip install gevent gevent-websocket",
                400,
            )
    try:
        _run_openclaw_tui_ws(ws)
    except Exception:
        pass
    try:
        if hasattr(ws, "close"):
            ws.close()
    except Exception:
        pass
    return ""


# ==================== 增量同步 API ====================


def get_sync_state_path(user_id: str, device_id: str) -> Path:
    """获取设备同步状态文件路径"""
    return BASE_DIR / "sync_state" / user_id / f"sync_{device_id}.json"

def load_sync_state(user_id: str, device_id: str) -> dict:
    """加载设备同步状态"""
    path = get_sync_state_path(user_id, device_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"last_sync_at": None, "note_versions": {}}

def save_sync_state(user_id: str, device_id: str, state: dict):
    """保存设备同步状态"""
    path = get_sync_state_path(user_id, device_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

def get_note_modified_at(note_dir, note_id: str) -> int:
    """获取笔记的修改时间戳（毫秒）"""
    meta_path = note_dir / f"*{note_id}.json"
    import glob
    files = glob.glob(str(meta_path))
    if files:
        try:
            return int(Path(files[0]).stat().st_mtime * 1000)
        except Exception:
            pass
    return 0

@app.route("/api/sync/status", methods=["GET"])
@require_auth
def sync_status():
    """获取服务器同步状态 - 返回服务器上所有笔记的最新修改时间"""
    note_dir, _, _, _ = get_user_dirs(get_current_user())
    user_id = get_current_user()
    device_id = request.args.get("device_id", "default")
    
    notes = []
    index_map = load_note_index(note_dir)
    for note_id, meta in index_map.items():
        notes.append({
            "id": note_id,
            "modified_at": int(meta.get("modified_at") or 0),
            "title": meta.get("title", "")
        })
    
    sync_state = load_sync_state(user_id, device_id)
    
    return jsonify({
        "server_time": int(datetime.utcnow().timestamp() * 1000),
        "notes": notes,
        "last_sync_at": sync_state.get("last_sync_at")
    })

@app.route("/api/sync/pull", methods=["POST"])
@require_auth
def sync_pull():
    """
    客户端从服务器拉取变更
    请求体: {"device_id": "...", "last_sync_at": timestamp, "note_ids": ["id1", "id2"]}
    返回: 服务器上比客户端更新的笔记
    """
    note_dir, _, _, _ = get_user_dirs(get_current_user())
    user_id = get_current_user()
    data = request.get_json(silent=True) or {}
    device_id = data.get("device_id", "default")
    last_sync_at = data.get("last_sync_at", 0)
    client_note_ids = set(data.get("note_ids", []))
    
    updated_notes = []
    index_map = load_note_index(note_dir)
    server_note_ids = set(index_map.keys())

    for note_id, meta in index_map.items():
        modified_at = int(meta.get("modified_at") or 0)
        # 如果笔记在服务器上比客户端新，则包含在响应中
        if modified_at > last_sync_at:
            base = meta.get("base") or f"{slugify(meta.get('title', ''))}_{note_id}"
            md_path = note_dir / f"{base}.md"
            meta_path = note_dir / f"{base}.json"
            content = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
            
            # 读取标签信息
            tags = []
            if meta_path.exists():
                try:
                    meta_data = json.loads(meta_path.read_text(encoding="utf-8"))
                    tags = meta_data.get("tags", [])
                except Exception:
                    pass

            updated_notes.append({
                "id": note_id,
                "title": meta.get("title", ""),
                "content": content,
                "updatedAt": meta.get("updatedAt", now_iso()),
                "modified_at": modified_at,
                "action": "update",
                "tags": tags
            })
    
    # 检测服务器上已删除的笔记（在客户端存在但在服务器不存在）
    deleted_ids = list(client_note_ids - server_note_ids)
    
    return jsonify({
        "updated_notes": updated_notes,
        "deleted_ids": deleted_ids,
        "server_time": int(datetime.utcnow().timestamp() * 1000)
    })

@app.route("/api/sync/push", methods=["POST"])
@require_auth
def sync_push():
    """
    客户端推送变更到服务器
    请求体: {"device_id": "...", "changes": [{"id": "...", "action": "update|delete", ...}]}
    返回: 同步结果和冲突信息
    """
    note_dir, _, _, _ = get_user_dirs(get_current_user())
    user_id = get_current_user()
    data = request.get_json(silent=True) or {}
    device_id = data.get("device_id", "default")
    changes = data.get("changes", [])
    
    results = []
    conflicts = []
    index_map = load_note_index(note_dir)
    index_changed = False
    
    for change in changes:
        note_id = change.get("id")
        action = change.get("action", "update")
        client_modified_at = change.get("modified_at", 0)
        
        try:
            if action == "delete":
                # 处理删除
                deleted = False
                old_meta = index_map.pop(str(note_id), None)
                if old_meta:
                    old_base = old_meta.get("base")
                    if old_base:
                        (note_dir / f"{old_base}.json").unlink(missing_ok=True)
                        (note_dir / f"{old_base}.md").unlink(missing_ok=True)
                    deleted = True
                    index_changed = True
                else:
                    # 兼容旧数据：兜底按 id 模糊删除
                    for meta_path in list(note_dir.glob(f"*{note_id}*.json")):
                        md_path = note_dir / f"{meta_path.stem}.md"
                        meta_path.unlink(missing_ok=True)
                        md_path.unlink(missing_ok=True)
                        deleted = True
                
                results.append({"id": note_id, "action": "delete", "success": deleted})
                
            elif action in ("update", "create"):
                # 检查冲突
                current_meta = index_map.get(str(note_id)) or {}
                server_modified_at = int(current_meta.get("modified_at") or 0)
                
                # 如果服务器版本比客户端新，标记为冲突
                if server_modified_at > client_modified_at:
                    conflicts.append({
                        "id": note_id,
                        "server_modified_at": server_modified_at,
                        "client_modified_at": client_modified_at,
                        "message": "服务器版本较新"
                    })
                    continue
                
                # 保存笔记
                title = change.get("title", "")
                content = change.get("content", "")
                updated_at = change.get("updatedAt", now_iso())
                
                base = f"{slugify(title)}_{note_id}"
                md_path = note_dir / f"{base}.md"
                meta_path = note_dir / f"{base}.json"
                
                md_path.write_text(content, encoding="utf-8")
                meta = {"id": note_id, "title": title, "updatedAt": updated_at, "tags": change.get("tags", [])}
                meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

                old_base = current_meta.get("base")
                if old_base and old_base != base:
                    (note_dir / f"{old_base}.json").unlink(missing_ok=True)
                    (note_dir / f"{old_base}.md").unlink(missing_ok=True)

                current_ms = int(datetime.utcnow().timestamp() * 1000)
                index_map[str(note_id)] = {
                    "id": str(note_id),
                    "title": title,
                    "base": base,
                    "updatedAt": updated_at,
                    "modified_at": current_ms,
                }
                index_changed = True
                
                results.append({
                    "id": note_id,
                    "action": action,
                    "success": True,
                    "server_modified_at": current_ms
                })
                
        except Exception as e:
            results.append({
                "id": note_id,
                "action": action,
                "success": False,
                "error": str(e)
            })
    
    if index_changed:
        save_note_index(note_dir, index_map)

    # 更新同步状态
    sync_state = load_sync_state(user_id, device_id)
    sync_state["last_sync_at"] = int(datetime.utcnow().timestamp() * 1000)
    for result in results:
        if result.get("success"):
            sync_state["note_versions"][result["id"]] = result.get("server_modified_at", 0)
    save_sync_state(user_id, device_id, sync_state)
    
    return jsonify({
        "results": results,
        "conflicts": conflicts,
        "server_time": sync_state["last_sync_at"]
    })

@app.route("/api/sync/resolve", methods=["POST"])
@require_auth
def sync_resolve_conflict():
    """
    解决同步冲突
    请求体: {"device_id": "...", "resolutions": [{"id": "...", "resolution": "server|client|merge", ...}]}
    """
    data = request.get_json(silent=True) or {}
    note_dir, _, _, _ = get_user_dirs(get_current_user())
    resolutions = data.get("resolutions", [])
    
    results = []
    for resolution in resolutions:
        note_id = resolution.get("id")
        strategy = resolution.get("resolution", "server")  # server, client, or merge
        
        try:
            if strategy == "client":
                # 使用客户端版本（重新执行 push）
                title = resolution.get("title", "")
                content = resolution.get("content", "")
                updated_at = resolution.get("updatedAt", now_iso())
                
                base = f"{slugify(title)}_{note_id}"
                md_path = note_dir / f"{base}.md"
                meta_path = note_dir / f"{base}.json"
                
                md_path.write_text(content, encoding="utf-8")
                meta = {"id": note_id, "title": title, "updatedAt": updated_at, "tags": resolution.get("tags", [])}
                meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
                
                results.append({"id": note_id, "resolution": "client", "success": True})
                
            elif strategy == "server":
                # 使用服务器版本（无需操作）
                results.append({"id": note_id, "resolution": "server", "success": True})
                
            elif strategy == "merge":
                # 合并版本（简单实现：使用客户端内容）
                title = resolution.get("title", "")
                content = resolution.get("content", "")
                updated_at = now_iso()
                
                base = f"{slugify(title)}_{note_id}"
                md_path = note_dir / f"{base}.md"
                meta_path = note_dir / f"{base}.json"
                
                md_path.write_text(content, encoding="utf-8")
                meta = {"id": note_id, "title": title, "updatedAt": updated_at, "tags": resolution.get("tags", [])}
                meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
                
                results.append({"id": note_id, "resolution": "merge", "success": True})
                
        except Exception as e:
            results.append({
                "id": note_id,
                "resolution": strategy,
                "success": False,
                "error": str(e)
            })
    
    return jsonify({"results": results})

# ==================== 程序入口 ====================

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5002, debug=True, threaded=True)
