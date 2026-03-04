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

    # 直接导入并运行 Flask 应用，避免再起子进程
    import chickennotelm_server
    chickennotelm_server.app.run(host="127.0.0.1", port=5002, debug=True, use_reloader=False)

if __name__ == "__main__":
    main()
