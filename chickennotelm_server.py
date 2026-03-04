import json
import re
import uuid
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request


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


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5002, debug=True)
