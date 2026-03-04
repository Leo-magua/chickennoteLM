#!/bin/bash
cd "$(dirname "$0")"

# 检查 Python（优先 python3）
if command -v python3 &>/dev/null; then
    PY=python3
elif command -v python &>/dev/null; then
    PY=python
else
    echo ""
    echo "[ChickenNoteLM] 未检测到 Python，正在为您打开官方下载页..."
    open "https://www.python.org/downloads/" 2>/dev/null || true
    echo ""
    echo "请安装 Python 后，再次双击 启动.command 即可使用。"
    echo "（Mac 也可在终端运行: brew install python3）"
    echo ""
    read -p "按回车键退出..."
    exit 1
fi

# 使用项目内虚拟环境，避免与系统 Python 冲突（如 Mac 上 externally-managed-environment）
VENV_DIR=".venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "[ChickenNoteLM] 首次运行，正在创建虚拟环境..."
    $PY -m venv "$VENV_DIR" 2>/dev/null || { echo "[ChickenNoteLM] 创建失败，请确保已安装: $PY -m ensurepip 或 brew install python-tk"; read -p "按回车键退出..."; exit 1; }
fi
source "$VENV_DIR/bin/activate"

echo "[ChickenNoteLM] 正在检查依赖..."
pip install -r requirements.txt -q 2>/dev/null || pip install flask -q
if [ $? -ne 0 ]; then
    echo "[ChickenNoteLM] 安装依赖失败，请检查网络。"
    read -p "按回车键退出..."
    exit 1
fi

echo "[ChickenNoteLM] 正在启动，浏览器将自动打开..."
echo "关闭本窗口即可停止 ChickenNoteLM。"
echo ""
python run.py
read -p "按回车键退出..."
