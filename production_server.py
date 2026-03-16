#!/usr/bin/env python3
"""
ChickenNoteLM Production Server
Binds to 0.0.0.0:5002 with WebSocket support
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

# Production: bind to 0.0.0.0
server = WSGIServer(("0.0.0.0", 5002), app, handler_class=WebSocketHandler)
print("[ChickenNoteLM] Production server running on http://0.0.0.0:5002")
print("[ChickenNoteLM] API: http://0.0.0.0:5002/api/")
server.serve_forever()
