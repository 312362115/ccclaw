#!/bin/bash
set -e

echo "=== 安装依赖 ==="
pnpm install

echo "=== 数据库迁移 ==="
pnpm migrate 2>/dev/null || true

echo "=== 类型检查 ==="
pnpm typecheck

echo "=== 就绪 ==="
