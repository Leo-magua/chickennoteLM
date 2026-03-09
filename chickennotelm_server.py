import json
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

from flask import Flask, jsonify, request

try:
    import pty
    _PTY_AVAILABLE = True
except ImportError:
    _PTY_AVAILABLE = False


BASE_DIR = Path(__file__).resolve().parent
NOTE_DIR = BASE_DIR / "notefile"
CHAT_DIR = BASE_DIR / "chatdata"
EVENT_DIR = BASE_DIR / "eventdata"

for d in (NOTE_DIR, CHAT_DIR, EVENT_DIR):
    d.mkdir(exist_ok=True)


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


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.get("/api/notes")
def get_notes():
    """返回所有笔记（从 notefile 中的 .json + .md 组合加载，文件名格式为 标题slug_id）"""
    notes = []
    for meta_path in NOTE_DIR.glob("*.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            note_id = meta.get("id") or meta_path.stem
            md_path = NOTE_DIR / f"{meta_path.stem}.md"
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
def sync_notes_events():
    """
    同步前端的 notes 和 events 到本地文件系统：
    - 每条笔记：notefile/<标题slug>_<id>.md 与 notefile/<标题slug>_<id>.json
    - 所有事件：eventdata/events.json
    """
    data = request.get_json(silent=True) or {}
    notes = data.get("notes") or []
    events = data.get("events") or []

    written_bases = set()
    for note in notes:
        note_id = str(note.get("id") or uuid.uuid4())
        title = note.get("title") or ""
        content = note.get("content") or ""
        updated_at = note.get("updatedAt") or now_iso()

        base = f"{slugify(title)}_{note_id}"
        written_bases.add(base)
        md_path = NOTE_DIR / f"{base}.md"
        meta_path = NOTE_DIR / f"{base}.json"

        md_path.write_text(content, encoding="utf-8")
        meta = {"id": note_id, "title": title, "updatedAt": updated_at}
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    # 删除同一笔记的旧文件名（标题改后留下的旧文件）
    for meta_path in NOTE_DIR.glob("*.json"):
        stem = meta_path.stem
        if stem in written_bases:
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            old_id = meta.get("id")
            if old_id and any(str(n.get("id")) == old_id for n in notes):
                meta_path.unlink(missing_ok=True)
                (NOTE_DIR / f"{stem}.md").unlink(missing_ok=True)
        except Exception:
            pass

    events_path = EVENT_DIR / "events.json"
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
def get_events():
    """返回 eventdata 中的事件列表（如果有的话）"""
    events_path = EVENT_DIR / "events.json"
    if not events_path.exists():
        return jsonify({"events": []})
    try:
        events = json.loads(events_path.read_text(encoding="utf-8"))
    except Exception:
        events = []
    return jsonify({"events": events})


@app.get("/api/chats")
def list_chats():
    """列出所有聊天会话的基本信息"""
    chats = []
    for path in CHAT_DIR.glob("*.json"):
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
def get_chat(chat_id: str):
    """获取单个会话的完整内容"""
    path = CHAT_DIR / f"{chat_id}.json"
    if not path.exists():
        return jsonify({"error": "not_found"}), 404
    try:
        chat = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return jsonify({"error": "invalid_chat_file"}), 500
    return jsonify(chat)


@app.post("/api/chats")
def create_chat():
    """创建新的聊天会话"""
    body = request.get_json(silent=True) or {}
    title = body.get("title") or f"会话 {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    chat_id = body.get("id") or uuid.uuid4().hex
    now = now_iso()
    chat = {"id": chat_id, "title": title, "createdAt": now, "updatedAt": now, "messages": []}
    path = CHAT_DIR / f"{chat_id}.json"
    path.write_text(json.dumps(chat, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify(chat)


@app.post("/api/chats/<chat_id>")
def save_chat(chat_id: str):
    """保存（覆盖）某个聊天会话"""
    body = request.get_json(silent=True) or {}
    title = body.get("title")
    messages = body.get("messages") or []

    path = CHAT_DIR / f"{chat_id}.json"
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


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5002, debug=True, threaded=True)
