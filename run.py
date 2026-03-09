#!/usr/bin/env python3
"""
一键运行 ChickenNoteLM：启动后端 API 并打开前端页面。
用法：在项目目录下执行  python run.py
"""
import os
import sys
import webbrowser
import threading
import time

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(base_dir)

    index_path = os.path.join(base_dir, "index.html")
    if not os.path.isfile(index_path):
        print("错误：未找到 index.html")
        sys.exit(1)

    def open_browser():
        time.sleep(1.2)
        webbrowser.open("file://" + index_path)
        print("已在浏览器中打开 ChickenNoteLM 页面。关闭本窗口即可停止服务。")

    threading.Thread(target=open_browser, daemon=True).start()

    import chickennotelm_server
    app = chickennotelm_server.app
    try:
        from gevent import monkey
        monkey.patch_all()
        from gevent.pywsgi import WSGIServer
        from geventwebsocket.handler import WebSocketHandler
        server = WSGIServer(("127.0.0.1", 5002), app, handler_class=WebSocketHandler)
        print("ChickenNoteLM 后端 (含 WebSocket) http://127.0.0.1:5002")
        server.serve_forever()
    except ImportError as e:
        print("提示: 未安装 gevent/gevent-websocket，OpenClaw 终端面板将无法连接。可执行: pip install gevent gevent-websocket")
        app.run(host="127.0.0.1", port=5002, debug=True, use_reloader=False)

if __name__ == "__main__":
    main()
