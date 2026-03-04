@echo off
chcp 65001 >nul
title ChickenNoteLM
cd /d "%~dp0"

:: 检查 Python
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ChickenNoteLM] 未检测到 Python，正在为您打开官方下载页...
    start "" "https://www.python.org/downloads/"
    echo.
    echo 请安装 Python（安装时务必勾选 "Add Python to PATH"），
    echo 安装完成后再次双击 启动.bat 即可使用。
    echo.
    pause
    exit /b 1
)

:: 使用项目内虚拟环境，与 Mac 行为一致，且不污染系统 Python
set VENV_DIR=.venv
if not exist "%VENV_DIR%\Scripts\python.exe" (
    echo [ChickenNoteLM] 首次运行，正在创建虚拟环境...
    python -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo [ChickenNoteLM] 创建失败，请检查 Python 是否安装完整。
        pause
        exit /b 1
    )
)

echo [ChickenNoteLM] 正在检查依赖...
"%VENV_DIR%\Scripts\pip.exe" install -r requirements.txt -q
if errorlevel 1 (
    "%VENV_DIR%\Scripts\pip.exe" install flask -q
)
if errorlevel 1 (
    echo [ChickenNoteLM] 安装依赖失败，请检查网络或尝试："%VENV_DIR%\Scripts\pip.exe" install flask
    pause
    exit /b 1
)

echo [ChickenNoteLM] 正在启动，浏览器将自动打开...
echo 关闭本窗口即可停止 ChickenNoteLM。
echo.
"%VENV_DIR%\Scripts\python.exe" run.py
pause
