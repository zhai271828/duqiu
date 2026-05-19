#!/bin/bash

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================"
echo "模拟赌球网站 - 启动脚本"
echo "========================================"
echo ""

echo "[1/3] 检查 Node.js 环境..."
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 Node.js，请先安装 Node.js 16+"
    exit 1
fi

echo "[2/3] 启动 Cloudflare Worker 后端..."
cd backend-worker
if [ ! -f ".dev.vars" ]; then
    echo "提示: 未找到 backend-worker/.dev.vars。"
    echo "请复制 backend-worker/.dev.vars.example 为 backend-worker/.dev.vars，并填写 Firebase/API Key 以启用完整认证和同步。"
fi
if [ ! -d "node_modules" ]; then
    echo "安装 backend-worker 依赖..."
    npm install
fi
npm run migrate:local
npm run dev &
BACKEND_PID=$!
cd ..

echo "[3/3] 启动前端服务..."
cd frontend
if [ ! -d "node_modules" ]; then
    echo "安装前端依赖..."
    npm install
fi
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "========================================"
echo "启动完成！"
echo ""
echo "前端地址: http://localhost:3000"
echo "Worker API 地址: http://localhost:8787"
echo ""
echo "说明: 前端 /api 默认代理到 http://localhost:8787。"
echo "请配置 backend-worker/.dev.vars 中的 Firebase、ODDS_API_KEY、FOOTBALL_DATA_API_KEY。"
echo "========================================"

# 等待用户按 Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
