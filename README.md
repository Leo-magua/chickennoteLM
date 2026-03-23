# ChickenNoteLM · 云端部署版

**智能笔记管理 + AI 辅助整理，支持多用户隔离与增量同步。**

---

## 功能特性

### 核心功能
- **智能笔记**：支持 Markdown 编辑、实时预览、自动保存
- **AI 对话**：基于选中笔记内容进行上下文问答
- **事件提取**：从笔记中自动提取待办事项和时间节点
- **图片上传**：支持粘贴/拖拽上传，自动关联到笔记
- **导入导出**：支持 JSON/Markdown/CSV 多格式数据迁移

### 云端特性
- **用户隔离**：每个用户拥有独立的数据空间（笔记/聊天/事件/图片）
- **Session 认证**：基于 Flask Session 的登录机制
- **增量同步**：支持多设备间的增量数据同步（pull/push/冲突解决）
- **离线优先**：IndexedDB 本地存储 + Service Worker 离线支持
- **生产部署**：基于 gevent + nginx 的高性能部署

### 前端多账号与「云端为准」（2026-03）

同一浏览器切换账号时，本地缓存必须与账号对应，且以服务器数据为权威来源。

| 机制 | 说明 |
|------|------|
| **按用户隔离的本地存储** | IndexedDB 库名 `chickennoteLM__{user_id}`；`localStorage` 使用 `chickennotelm_notes_events__{user_id}`、`chickennotelm_last_sync_at__{user_id}`、`chickennotelm_settings__{user_id}` 等后缀，避免账号 A 的缓存被账号 B 读到。 |
| **登录后云端为准** | `applyCloudAuthorityOnLogin()`：登录成功后并行请求 `/api/notes` 与 `/api/events`。若两者均成功且**云端笔记与事件均为空**，则清空当前账号在本机的 IndexedDB（含同步队列）、对应 `localStorage` 键，并清空界面状态——**即使本地曾有旧缓存也会清除**。若云端有数据，则先清空本地库再写入云端快照，避免脏同步队列误推到错误账号。 |
| **离线回退** | 仅当上述 API 因网络或 HTTP 错误失败时，才回退为 `loadDataFromLocalStorage()`；此时仍可使用本地缓存。演示用示例笔记仅在「未走通云端权威且最终仍无笔记」时注入；云端已确认空账号时**不会**自动注入演示笔记。 |

> **说明**：若某账号曾在旧版本下被误写入他人数据，需在服务器上手动清理该用户目录（如 `notefile/{user_id}/`）。浏览器中旧的未带 `__{user_id}` 后缀的全局 key / 旧库名 `chickennoteLM` 可在开发者工具中手动删除，减少干扰。

---

## 技术架构

```
前端: 纯 JavaScript + Tailwind CSS + Marked.js
后端: Flask + gevent-websocket
存储: 文件系统（按用户分目录）
部署: nginx 反向代理 + systemd 服务托管
```

### 数据存储结构
```
notefile/
  └── {user_id}/              # 用户笔记目录
      ├── notes_index.json    # 笔记索引
      ├── {title}_{id}.json   # 笔记元数据
      └── {title}_{id}.md     # 笔记内容
chatdata/
  └── {user_id}/              # 用户聊天记录
      └── {chat_id}.json      # 单个聊天会话
eventdata/
  └── {user_id}/              # 用户事件数据
      └── events.json         # 所有事件
sync_state/
  └── {user_id}/              # 同步状态
      └── sync_{device_id}.json
uploads/
  └── {user_id}/{note_id}/    # 图片上传目录
      └── {timestamp}_{uuid}.png
```

---

## 部署指南

### 环境要求
- Python 3.10+
- nginx
- Linux 服务器

### 安装依赖

```bash
pip install -r requirements.txt
# 生产环境必需
pip install gevent gevent-websocket
```

### 生产环境启动

```bash
python production_server.py
```

服务将监听 `0.0.0.0:5002`，配合 nginx 反向代理使用。

### nginx 配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:5002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # WebSocket 支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # 静态图片资源直接由 nginx 提供
    location /uploads/ {
        alias /var/www/chickennoteLM/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### systemd 服务配置

创建 `/etc/systemd/system/chickennoteLM.service`：

```ini
[Unit]
Description=ChickenNoteLM Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/chickennoteLM
Environment="SECRET_KEY=your-secret-key-here-change-in-production"
ExecStart=/var/www/chickennoteLM/venv/bin/python production_server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

启用并启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable chickennoteLM
sudo systemctl start chickennoteLM
```

---

## API 文档

### 认证接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/auth/me` | GET | 获取当前登录用户 |
| `/api/auth/login` | POST | 用户登录（传入 username） |
| `/api/auth/logout` | POST | 用户登出 |

### 笔记接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/notes` | GET | 获取当前用户所有笔记 |
| `/api/sync/notes-events` | POST | 全量同步笔记和事件 |

### 事件接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/events` | GET | 获取事件列表 |

### 聊天接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/chats` | GET | 列出所有聊天会话 |
| `/api/chats/<id>` | GET | 获取单个会话 |
| `/api/chats` | POST | 创建新会话 |
| `/api/chats/<id>` | POST | 保存会话 |

### 同步接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/sync/status` | GET | 获取服务器同步状态 |
| `/api/sync/pull` | POST | 从服务器拉取变更 |
| `/api/sync/push` | POST | 推送变更到服务器 |
| `/api/sync/resolve` | POST | 解决同步冲突 |

### 上传接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/uploads/image` | POST | 上传图片（multipart/form-data，需登录） |

### OpenClaw 代理接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/openclaw/health` | GET | 健康检查 |
| `/api/openclaw/chat` | POST | 聊天代理 |
| `/api/openclaw/tui` | WebSocket | TUI 终端 |

---

## 配置说明

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `SECRET_KEY` | Flask Session 密钥（生产环境必须修改） | `dev-secret-change-in-production` |

### AI 配置

在网页端的「设置」面板中配置：
- **API Key**: OpenAI 或兼容服务的密钥
- **Base URL**: API 基础地址（如 `https://api.openai.com/v1`）
- **模型**: 如 `gpt-3.5-turbo`、`gpt-4`
- **系统提示词**: 可自定义对话、事件提取、格式化的提示词

---

## 文件说明

```
chickennotelm_server.py       # Flask 后端主文件
  - 用户隔离与 Session 认证
  - 笔记 CRUD 与索引管理
  - 增量同步（pull/push/resolve）
  - 图片上传处理
  - OpenClaw 代理

production_server.py          # 生产环境启动脚本（gevent + WebSocket）

index.html                    # 前端主页面（单页应用）

js/                           # 前端 JavaScript 模块
  ├── main.js                 # 应用入口，登录鉴权，初始化（含云端为准流程）
  ├── state.js                # 全局状态、持久化、applyCloudAuthorityOnLogin
  ├── db.js                   # IndexedDB（按用户库名 initForUser）
  ├── data-service.js         # 数据服务层（按用户的 last_sync_at、pull/push）
  ├── notes.js                # 笔记功能（CRUD、列表、编辑器）
  ├── chat.js                 # AI 对话（会话管理、消息、WebSocket）
  ├── events.js               # 事件提取与管理
  ├── import.js               # 数据导入（JSON）
  ├── export.js               # 数据导出（JSON/Markdown）
  ├── paste-image.js          # 图片粘贴/拖拽上传
  ├── ai-format.js            # AI 格式化（文本转 Markdown）
  ├── settings.js             # 设置面板（按用户 localStorage）
  └── ui.js                   # UI 工具函数

sw.js                         # Service Worker（离线缓存 v9）

FEATURE_LIST.md               # 功能清单（本文档）
```

---

## 分支说明

- `main`: 本地开发版本（单用户、无登录）
- `cloud-deployed`: 云端部署版本（多用户、Session 认证、增量同步）✅ 当前分支

---

## 许可证

MIT License
