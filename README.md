# ChickenNoteLM · 云端部署版

**智能笔记管理 + AI 辅助整理，支持多用户隔离与增量同步。**

---

## 功能特性

### 核心功能
- **智能笔记**：支持 Markdown 编辑、实时预览、自动保存
- **AI 对话**：基于选中笔记内容进行上下文问答
- **事件提取**：从笔记中自动提取待办事项和时间节点
- **图片上传**：支持粘贴/拖拽上传，自动压缩并关联到笔记
- **导入导出**：支持 JSON/Markdown 多格式数据迁移

### 云端特性
- **用户隔离**：每个用户拥有独立的数据空间（笔记/聊天/事件/上传）
- **Session 认证**：基于 Flask Session 的登录机制
- **增量同步**：支持多设备间的增量数据同步（先推后拉策略）
- **索引化存储**：服务端使用 `notes_index.json` 管理笔记元数据，解决文件名变更问题
- **生产部署**：基于 gevent + nginx 的高性能部署

---

## 技术架构

```
前端: 纯 JavaScript + Tailwind CSS + Marked.js
后端: Flask + gevent-websocket
存储: 文件系统（按用户分目录）+ 索引文件（notes_index.json）
部署: nginx 反向代理 + systemd 服务托管
```

### 数据存储结构
```
notefile/
  └── {user_id}/              # 用户笔记目录
      ├── notes_index.json    # 笔记索引（权威来源）
      ├── {title}_{id}.json   # 笔记元数据
      └── {title}_{id}.md     # 笔记内容
chatdata/
  └── {user_id}/              # 用户聊天记录
eventdata/
  └── {user_id}/              # 用户事件数据
sync_state/
  └── {user_id}/              # 同步状态
uploads/
  └── {user_id}/{note_id}/    # 图片上传目录
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
pip install gevent gevent-websocket  # 生产环境必需
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
    }

    location /uploads/ {
        alias /var/www/chickennoteLM/uploads/;
    }
}
```

### systemd 服务配置

```ini
[Unit]
Description=ChickenNoteLM Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/chickennoteLM
Environment="SECRET_KEY=your-secret-key-here"
ExecStart=/var/www/chickennoteLM/venv/bin/python production_server.py
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## API 文档

### 认证接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 用户登录（传入 username） |
| `/api/auth/logout` | POST | 用户登出 |
| `/api/auth/me` | GET | 获取当前登录用户 |

### 笔记接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/notes` | GET | 获取当前用户所有笔记（基于 notes_index.json） |
| `/api/sync/notes-events` | POST | 全量同步笔记和事件 |

### 同步接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/sync/status` | GET | 获取服务器同步状态（含笔记修改时间） |
| `/api/sync/pull` | POST | 从服务器拉取变更（基于 modified_at） |
| `/api/sync/push` | POST | 推送本地变更到服务器 |
| `/api/sync/resolve` | POST | 解决同步冲突 |

### 上传接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/uploads/image` | POST | 上传图片（需登录，返回 Markdown 路径） |

---

## 配置说明

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `SECRET_KEY` | Flask Session 密钥 | dev-secret-change-in-production |

### AI 配置

在网页端的「设置」中配置：
- **API Key**: OpenAI 或兼容服务的密钥
- **Base URL**: API 基础地址
- **模型**: 如 `gpt-3.5-turbo`

---

## 文件说明

```
chickennotelm_server.py      # Flask 后端主文件（含用户隔离、增量同步、notes_index）
production_server.py         # 生产环境启动脚本
index.html                   # 前端主页面
js/                          # 前端 JavaScript 模块
  ├── main.js               # 应用入口
  ├── state.js              # 状态管理（含本地变更保护窗口）
  ├── notes.js              # 笔记功能（含批量删除修复）
  ├── chat.js               # AI 对话
  ├── events.js             # 事件提取
  ├── import.js             # 数据导入
  ├── export.js             # 数据导出
  ├── paste-image.js        # 图片粘贴/拖拽上传
  ├── ai-format.js          # AI 格式化
  └── data-service.js       # 数据服务层（含增量同步逻辑）
sw.js                        # Service Worker（离线支持，cache v4）
FEATURE_LIST.md              # 功能清单
```

---

## 同步机制说明

### 增量同步流程
1. **本地变更时**：标记 `__lastLocalMutationAt` 时间戳
2. **同步触发条件**：在线状态、无进行中的同步、本地变更后超过 5 秒
3. **推送阶段（push）**：将本地 pending 变更（含删除）推送到服务器
4. **拉取阶段（pull）**：获取服务器上更新的笔记和已删除的笔记 ID
5. **本地应用**：更新 IndexedDB 和 state

### 删除回弹问题修复
- **问题**：删除笔记后，同步时会从服务器拉回旧数据，导致笔记"复活"
- **修复**：
  - 服务端引入 `notes_index.json` 作为笔记列表权威来源
  - 调整同步顺序为「先推后拉」，确保删除操作先送达服务器
  - 前端增加 5 秒本地变更保护窗口，防止旧数据回灌

---

## 分支说明

- `main`: 本地开发版本（单用户、无登录）
- `cloud-deployed`: 云端部署版本（多用户、Session 认证、增量同步）✅ 当前分支

---

## 最近更新

### 2026-03-17
- ✅ 修复笔记删除后回弹问题
- ✅ 引入 `notes_index.json` 索引化方案
- ✅ 优化增量同步顺序（先推后拉）
- ✅ 增加本地变更保护窗口机制

### 2026-03-14
- ✅ 修复保存链路递归触发问题
- ✅ 修复编辑区正文变空问题
- ✅ 修复 401 未登录时的同步噪音
- ✅ 升级 Service Worker 缓存策略

---

## 许可证

MIT License
