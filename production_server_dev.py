#!/usr/bin/env python3
"""
ChickenNoteLM Development Server
Binds to 0.0.0.0:5003 with WebSocket support
"""
import os
import sys

base_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(base_dir)

# Ensure data directories exist
from pathlib import Path
for d in (Path(base_dir) / "notefile", Path(base_dir) / "chatdata", Path(base_dir) / "eventdata"):
    d.mkdir(exist_ok=True)

# Import and start server
from gevent import monkey
monkey.patch_all()

from gevent.pywsgi import WSGIServer
from geventwebsocket.handler import WebSocketHandler
import chickennotelm_server

app = chickennotelm_server.app

# Development: bind to 0.0.0.0:5003
server = WSGIServer(("0.0.0.0", 5003), app, handler_class=WebSocketHandler)
print("[ChickenNoteLM] Development server running on http://0.0.0.0:5003")
print("[ChickenNoteLM] API: http://0.0.0.0:5003/api/")
server.serve_forever()
