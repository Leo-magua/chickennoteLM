# ChickenNote · Local

本机运行的轻量项目/笔记浏览器。**磁盘即权威数据源**：Hermes 往项目目录写文件，前端自动刷新看到。

## 特性
- **项目即目录**：每个项目对应一个本地目录，支持 `~/Documents/clawphone-task` 这种多层结构
- **全文件支持**：
  - 编辑：`.md` `.markdown` `.txt`（带 markdown 实时预览）
  - 只读预览：`.csv`（表格）/ `.json`（树形）/ `.py/.sh/.js/.yaml` 等代码文件
- **自动保存**：编辑后停顿 1.5s 自动保存，Cmd/Ctrl+S 立即保存
- **外部更新感知**：每 5s 轮询变化，hermes 写入的新文件自动出现；当前打开文件被外部改动且无本地 dirty，自动加载新内容
- **多项目切换**：顶部下拉，设置持久化
- **无登录、无用户隔离**：本机单用户场景
- **软删除**：删除文件移动到项目内 `.trash/` 目录而非真删

## 启动
```bash
cd ~/Apps/chickennoteLM-local
python3 -m pip install -r requirements.txt   # 首次
python3 server.py --port 8082
```

端口被占会自动顺延到 8083/8084...

## 访问
- 本机：http://localhost:8082
- Tailscale（同 Tailnet）：http://<mac-tailscale-ip>:8082

## 配置
项目列表存 `~/.chickennote/projects.json`。默认会自动登记 `~/Documents/clawphone-task`（若存在）。

前端右上角"+"可添加新项目。

## Hermes 同步
Hermes 直接把 md/csv/json 等写到项目目录任意位置，前端 5s 内自动出现。
不需要调 API、不需要推送，**文件系统就是契约**。

## 数据流
```
hermes 写 ~/Documents/clawphone-task/prd-sections/x.md
  → server 扫描到 mtime 变化
  → 前端 /api/changes 轮询拿到
  → 前端静默刷新 tree；若当前打开即自动重载
```

## 目录结构
```
~/Apps/chickennoteLM-local/
├── server.py          # Flask 后端（~350 行）
├── requirements.txt
├── web/
│   ├── index.html     # 单页
│   └── app.js         # 前端逻辑（~450 行）
└── README.md
```

~/.chickennote/projects.json 示例：
```json
[
  {"id":"clawphone-task","name":"clawphone-task","path":"/Users/zhang.longqiang/Documents/clawphone-task"}
]
```

## 安全
- 所有文件路径经 `_resolve_safe` 校验，拒绝 `..` 逃逸
- 绑定 0.0.0.0 但 tailscale/LAN 外访问不到（依赖 tailnet ACL）

## 取舍
原 chickennoteLM 的下列功能**刻意去掉**，避免本机场景过度工程化：
- 登录/session/多用户隔离
- IndexedDB 缓存 + Service Worker
- 增量同步/冲突解决/push-pull
- AI 对话/事件抽取/标签系统

后续真有需要再加。
