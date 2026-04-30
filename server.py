"""
ChickenNoteLM · Local
=====================
本机笔记/项目浏览器。设计原则：
1. 项目 = 一个本地目录；文件 = 项目内的 .md / .csv / .json / .py / .sh / .txt
2. 磁盘是唯一权威源。Hermes 写盘，前端轮询拉变化即可
3. 单用户、无登录、无 IndexedDB、无增量同步状态机
4. 所有 IO 同步、文件 mtime 即版本号

Run: python3 server.py [--port 8082]
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import socket
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory, abort

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
APP_DIR = Path(__file__).resolve().parent
WEB_DIR = APP_DIR / "web"
CONFIG_DIR = Path.home() / ".chickennote"
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
PROJECTS_FILE = CONFIG_DIR / "projects.json"

EDITABLE_EXTS = {".md", ".markdown", ".txt"}
PREVIEW_EXTS = {".csv", ".json", ".py", ".sh", ".js", ".ts", ".yml", ".yaml", ".html", ".css"}
ALL_EXTS = EDITABLE_EXTS | PREVIEW_EXTS
IGNORE_DIRS = {".git", ".batches", "node_modules", "__pycache__", ".venv", "venv", ".DS_Store"}
IGNORE_FILES = {".DS_Store"}
MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB safety cap


# ---------------------------------------------------------------------------
# Project registry
# ---------------------------------------------------------------------------
def _default_projects() -> list[dict]:
    candidates = [
        ("clawphone-task", Path.home() / "Documents" / "clawphone-task"),
    ]
    out = []
    for name, path in candidates:
        if path.exists() and path.is_dir():
            out.append({"id": name, "name": name, "path": str(path)})
    return out


def load_projects() -> list[dict]:
    if PROJECTS_FILE.exists():
        try:
            data = json.loads(PROJECTS_FILE.read_text("utf-8"))
            if isinstance(data, list):
                return data
        except Exception:
            pass
    projs = _default_projects()
    save_projects(projs)
    return projs


def save_projects(projs: list[dict]) -> None:
    PROJECTS_FILE.write_text(
        json.dumps(projs, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def get_project(pid: str) -> dict | None:
    for p in load_projects():
        if p["id"] == pid:
            return p
    return None


# ---------------------------------------------------------------------------
# Path safety
# ---------------------------------------------------------------------------
def _resolve_safe(root: Path, rel: str) -> Path:
    """Resolve `rel` under `root`, refusing escapes."""
    rel = (rel or "").lstrip("/").replace("\\", "/")
    target = (root / rel).resolve()
    root_resolved = root.resolve()
    if target != root_resolved and root_resolved not in target.parents:
        abort(400, "path escape")
    return target


# ---------------------------------------------------------------------------
# File scanning
# ---------------------------------------------------------------------------
def scan_tree(root: Path) -> dict:
    """Return a nested dict tree of project files."""
    def walk(d: Path) -> dict:
        node = {
            "name": d.name,
            "path": str(d.relative_to(root)) if d != root else "",
            "type": "dir",
            "children": [],
        }
        try:
            entries = sorted(d.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        except PermissionError:
            return node
        for e in entries:
            if e.name in IGNORE_FILES or e.name.startswith("."):
                if e.name not in (".env.example",):  # allow some dotfiles later
                    continue
            if e.is_dir():
                if e.name in IGNORE_DIRS:
                    continue
                child = walk(e)
                # skip empty dirs
                if child["children"]:
                    node["children"].append(child)
            elif e.is_file():
                ext = e.suffix.lower()
                if ext not in ALL_EXTS:
                    continue
                try:
                    st = e.stat()
                except OSError:
                    continue
                node["children"].append({
                    "name": e.name,
                    "path": str(e.relative_to(root)),
                    "type": "file",
                    "ext": ext,
                    "editable": ext in EDITABLE_EXTS,
                    "size": st.st_size,
                    "mtime": int(st.st_mtime * 1000),
                })
        return node

    return walk(root)


def render_csv_preview(text: str, max_rows: int = 500) -> dict:
    rows = []
    try:
        reader = csv.reader(io.StringIO(text))
        for i, row in enumerate(reader):
            if i >= max_rows:
                break
            rows.append(row)
    except Exception as e:
        return {"error": str(e), "rows": []}
    return {"rows": rows, "truncated": i >= max_rows - 1 if rows else False}


# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
app = Flask(__name__, static_folder=None)


@app.after_request
def no_cache(resp):
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.errorhandler(400)
@app.errorhandler(404)
def _err(e):
    return jsonify({"ok": False, "error": str(e.description if hasattr(e, "description") else e)}), e.code


# Static
@app.get("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.get("/web/<path:fname>")
def static_files(fname):
    return send_from_directory(WEB_DIR, fname)


# Projects
@app.get("/api/projects")
def api_projects_list():
    return jsonify({"ok": True, "projects": load_projects()})


@app.post("/api/projects")
def api_projects_add():
    body = request.get_json(force=True, silent=True) or {}
    path = (body.get("path") or "").strip()
    name = (body.get("name") or "").strip()
    if not path:
        abort(400, "path required")
    p = Path(os.path.expanduser(path)).resolve()
    if not p.is_dir():
        abort(400, f"not a directory: {p}")
    name = name or p.name
    pid = name
    projs = load_projects()
    if any(x["id"] == pid for x in projs):
        return jsonify({"ok": False, "error": f"id exists: {pid}"}), 409
    projs.append({"id": pid, "name": name, "path": str(p)})
    save_projects(projs)
    return jsonify({"ok": True, "project": projs[-1]})


@app.delete("/api/projects/<pid>")
def api_projects_delete(pid):
    projs = [p for p in load_projects() if p["id"] != pid]
    save_projects(projs)
    return jsonify({"ok": True})


# Tree
@app.get("/api/projects/<pid>/tree")
def api_tree(pid):
    proj = get_project(pid)
    if not proj:
        abort(404, "project not found")
    root = Path(proj["path"])
    if not root.is_dir():
        abort(404, "project path missing")
    return jsonify({"ok": True, "tree": scan_tree(root), "scanned_at": int(datetime.now().timestamp() * 1000)})


# File content
@app.get("/api/projects/<pid>/file")
def api_file_get(pid):
    proj = get_project(pid)
    if not proj:
        abort(404, "project not found")
    rel = request.args.get("path", "")
    target = _resolve_safe(Path(proj["path"]), rel)
    if not target.is_file():
        abort(404, "file not found")
    if target.stat().st_size > MAX_FILE_BYTES:
        return jsonify({"ok": False, "error": "file too large"}), 413
    ext = target.suffix.lower()
    try:
        text = target.read_text("utf-8")
    except UnicodeDecodeError:
        return jsonify({"ok": False, "error": "not utf-8"}), 415

    payload: dict[str, Any] = {
        "ok": True,
        "path": rel,
        "ext": ext,
        "editable": ext in EDITABLE_EXTS,
        "content": text,
        "mtime": int(target.stat().st_mtime * 1000),
        "size": target.stat().st_size,
    }
    if ext == ".csv":
        payload["csv"] = render_csv_preview(text)
    elif ext == ".json":
        try:
            payload["json"] = json.loads(text)
        except Exception as e:
            payload["json_error"] = str(e)
    return jsonify(payload)


@app.put("/api/projects/<pid>/file")
def api_file_put(pid):
    proj = get_project(pid)
    if not proj:
        abort(404, "project not found")
    body = request.get_json(force=True, silent=True) or {}
    rel = body.get("path", "")
    content = body.get("content", "")
    expected_mtime = body.get("expected_mtime")
    if not rel:
        abort(400, "path required")
    target = _resolve_safe(Path(proj["path"]), rel)
    ext = target.suffix.lower()
    if ext not in EDITABLE_EXTS:
        abort(400, f"ext not editable: {ext}")
    target.parent.mkdir(parents=True, exist_ok=True)
    # Conflict check: warn if mtime mismatches
    conflict = None
    if target.exists() and expected_mtime is not None:
        actual = int(target.stat().st_mtime * 1000)
        # tolerate small drift
        if abs(actual - int(expected_mtime)) > 500:
            conflict = {"actual_mtime": actual, "expected_mtime": expected_mtime}
    # Write
    target.write_text(content, encoding="utf-8")
    return jsonify({
        "ok": True,
        "path": rel,
        "mtime": int(target.stat().st_mtime * 1000),
        "size": target.stat().st_size,
        "conflict": conflict,
    })


@app.post("/api/projects/<pid>/file/create")
def api_file_create(pid):
    proj = get_project(pid)
    if not proj:
        abort(404, "project not found")
    body = request.get_json(force=True, silent=True) or {}
    rel = body.get("path", "").strip()
    if not rel:
        abort(400, "path required")
    if "/" in rel or "\\" in rel:
        # allow nested
        pass
    target = _resolve_safe(Path(proj["path"]), rel)
    ext = target.suffix.lower()
    if ext not in EDITABLE_EXTS:
        abort(400, f"unsupported ext: {ext}")
    if target.exists():
        return jsonify({"ok": False, "error": "exists"}), 409
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body.get("content", "") or f"# {target.stem}\n\n", encoding="utf-8")
    return jsonify({"ok": True, "path": rel, "mtime": int(target.stat().st_mtime * 1000)})


@app.post("/api/projects/<pid>/file/rename")
def api_file_rename(pid):
    proj = get_project(pid)
    if not proj:
        abort(404, "project not found")
    body = request.get_json(force=True, silent=True) or {}
    src = body.get("from", "")
    dst = body.get("to", "")
    if not src or not dst:
        abort(400, "from/to required")
    s = _resolve_safe(Path(proj["path"]), src)
    d = _resolve_safe(Path(proj["path"]), dst)
    if not s.exists():
        abort(404, "source missing")
    if d.exists():
        return jsonify({"ok": False, "error": "target exists"}), 409
    d.parent.mkdir(parents=True, exist_ok=True)
    s.rename(d)
    return jsonify({"ok": True})


@app.delete("/api/projects/<pid>/file")
def api_file_delete(pid):
    proj = get_project(pid)
    if not proj:
        abort(404, "project not found")
    rel = request.args.get("path", "")
    if not rel:
        abort(400, "path required")
    target = _resolve_safe(Path(proj["path"]), rel)
    if not target.is_file():
        abort(404, "file not found")
    # soft delete: move to .trash/
    trash = Path(proj["path"]) / ".trash"
    trash.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    target.rename(trash / f"{ts}__{target.name}")
    return jsonify({"ok": True})


# Changes (poll)
@app.get("/api/projects/<pid>/changes")
def api_changes(pid):
    proj = get_project(pid)
    if not proj:
        abort(404, "project not found")
    since = int(request.args.get("since", "0"))
    root = Path(proj["path"])
    changed = []
    for dirpath, dirnames, filenames in os.walk(root):
        # in-place prune
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS and not d.startswith(".")]
        for f in filenames:
            ext = Path(f).suffix.lower()
            if ext not in ALL_EXTS:
                continue
            fp = Path(dirpath) / f
            try:
                m = int(fp.stat().st_mtime * 1000)
            except OSError:
                continue
            if m > since:
                changed.append({
                    "path": str(fp.relative_to(root)),
                    "mtime": m,
                    "ext": ext,
                })
    return jsonify({"ok": True, "changes": changed, "now": int(datetime.now().timestamp() * 1000)})


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
def find_free_port(start: int) -> int:
    for p in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("0.0.0.0", p))
                return p
            except OSError:
                continue
    raise RuntimeError("no free port")


def get_lan_ips() -> list[str]:
    ips = []
    try:
        for line in os.popen("ifconfig").read().split("\n"):
            line = line.strip()
            if line.startswith("inet ") and "127.0.0.1" not in line:
                ips.append(line.split()[1])
    except Exception:
        pass
    return ips


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8082)
    ap.add_argument("--host", default="0.0.0.0")
    args = ap.parse_args()
    port = find_free_port(args.port)
    if port != args.port:
        print(f"[chickennote] port {args.port} busy, using {port}", file=sys.stderr)
    print(f"[chickennote] listening on http://{args.host}:{port}")
    for ip in get_lan_ips():
        print(f"[chickennote]   → http://{ip}:{port}")
    print(f"[chickennote] config: {PROJECTS_FILE}")
    app.run(host=args.host, port=port, debug=False, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
