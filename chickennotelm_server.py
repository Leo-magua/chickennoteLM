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
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.get("/api/notes")
@require_auth
def get_notes():
    """返回所有笔记（从 notefile 中的 .json + .md 组合加载，文件名格式为 标题slug_id）"""
    notes = []
    note_dir, _, _, _ = get_user_dirs(get_current_user())
    for meta_path in note_dir.glob("*.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            note_id = meta.get("id") or meta_path.stem
            md_path = note_dir / f"{meta_path.stem}.md"
            content = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
            notes.append(
                {
                    "id": note_id,
                    "title": meta.get("title", ""),
                    "content": content,
                    "updatedAt": meta.get("updatedAt", now_iso()),
                }
            )
        except Exception:
            continue
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
    written_bases = set()
    for note in notes:
        note_id = str(note.get("id") or uuid.uuid4())
        title = note.get("title") or ""
        content = note.get("content") or ""
        updated_at = note.get("updatedAt") or now_iso()

        base = f"{slugify(title)}_{note_id}"
        written_bases.add(base)
        md_path = note_dir / f"{base}.md"
        meta_path = note_dir / f"{base}.json"

        md_path.write_text(content, encoding="utf-8")
        meta = {"id": note_id, "title": title, "updatedAt": updated_at}
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    # 删除同一笔记的旧文件名（标题改后留下的旧文件）
    for meta_path in note_dir.glob("*.json"):
        stem = meta_path.stem
        if stem in written_bases:
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            old_id = meta.get("id")
            if old_id and any(str(n.get("id")) == old_id for n in notes):
                meta_path.unlink(missing_ok=True)
                (note_dir / f"{stem}.md").unlink(missing_ok=True)
        except Exception:
            pass

    events_path = event_dir / "events.json"
    events_path.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")

    return jsonify({"status": "ok"})


@app.route("/api/openclaw/health", methods=["GET"])
def openclaw_health():
    """用于在浏览器中确认本服务已包含 OpenClaw 代理（避免 404 时误判为缺路由）"""
    return jsonify({"ok": True, "openclaw_proxy": True})


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
    for meta_path in note_dir.glob("*.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            note_id = meta.get("id") or meta_path.stem
            modified_at = get_note_modified_at(note_dir, note_id)
            notes.append({
                "id": note_id,
                "modified_at": modified_at,
                "title": meta.get("title", "")
            })
        except Exception:
            continue
    
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
    server_note_ids = set()
    
    for meta_path in note_dir.glob("*.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            note_id = meta.get("id") or meta_path.stem
            server_note_ids.add(note_id)
            
            modified_at = get_note_modified_at(note_dir, note_id)
            
            # 如果笔记在服务器上比客户端新，则包含在响应中
            if modified_at > last_sync_at:
                md_path = note_dir / f"{meta_path.stem}.md"
                content = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
                
                updated_notes.append({
                    "id": note_id,
                    "title": meta.get("title", ""),
                    "content": content,
                    "updatedAt": meta.get("updatedAt", now_iso()),
                    "modified_at": modified_at,
                    "action": "update"
                })
        except Exception:
            continue
    
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
    
    for change in changes:
        note_id = change.get("id")
        action = change.get("action", "update")
        client_modified_at = change.get("modified_at", 0)
        
        try:
            if action == "delete":
                # 处理删除
                deleted = False
                for meta_path in list(note_dir.glob(f"*{note_id}*.json")):
                    md_path = note_dir / f"{meta_path.stem}.md"
                    meta_path.unlink(missing_ok=True)
                    md_path.unlink(missing_ok=True)
                    deleted = True
                
                results.append({"id": note_id, "action": "delete", "success": deleted})
                
            elif action in ("update", "create"):
                # 检查冲突
                server_modified_at = get_note_modified_at(note_dir, note_id)
                
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
                meta = {"id": note_id, "title": title, "updatedAt": updated_at}
                meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
                
                results.append({
                    "id": note_id,
                    "action": action,
                    "success": True,
                    "server_modified_at": get_note_modified_at(note_dir, note_id)
                })
                
        except Exception as e:
            results.append({
                "id": note_id,
                "action": action,
                "success": False,
                "error": str(e)
            })
    
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
                meta = {"id": note_id, "title": title, "updatedAt": updated_at}
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
                meta = {"id": note_id, "title": title, "updatedAt": updated_at}
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
