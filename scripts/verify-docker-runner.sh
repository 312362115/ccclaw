#!/bin/bash
# Docker Runner 端到端验证脚本
# 验证：登录 → 创建 docker 工作区 → ensure-config → Runner 自动启动 → 资源限制 → 清理
#
# 前置条件：
#   1. Server 运行中：npx tsx packages/server/src/index.ts
#   2. Runner 镜像已构建：make docker-sandbox
#   3. Docker daemon 运行中
#
# 注意：使用 127.0.0.1 而非 localhost，避免被其他项目（如 vite）占据 localhost:3000

set -uo pipefail

BASE="${BASE_URL:-http://127.0.0.1:3100}"
ADMIN_EMAIL="admin@ccclaw.test"
ADMIN_PASSWORD="test1234pass"
PASS=0
FAIL=0

# check "label" "text" "grep_pattern"
check() {
  local label=$1 text=$2 pattern=$3
  if echo "$text" | grep -q "$pattern"; then
    echo "  PASS: $label"
    ((PASS++))
  else
    echo "  FAIL: $label"
    ((FAIL++))
  fi
}

# check_eq "label" "actual" "expected"
check_eq() {
  local label=$1 actual=$2 expected=$3
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $label"
    ((PASS++))
  else
    echo "  FAIL: $label (got=$actual, want=$expected)"
    ((FAIL++))
  fi
}

# check_nonempty "label" "value"
check_nonempty() {
  local label=$1 value=$2
  if [ -n "$value" ]; then
    echo "  PASS: $label"
    ((PASS++))
  else
    echo "  FAIL: $label (empty)"
    ((FAIL++))
  fi
}

# ---------- 1. 登录 ----------
echo "=== 1. 登录 ==="
LOGIN_RES=$(curl -sf -m 5 -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
TOKEN=$(echo "$LOGIN_RES" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).accessToken))")
AUTH="Authorization: Bearer $TOKEN"
check_nonempty "获取 token" "$TOKEN"

# ---------- 2. 创建 Docker 工作区 ----------
echo ""
echo "=== 2. 创建 Docker 工作区 ==="
WS_RES=$(curl -sf -m 5 -X POST "$BASE/api/workspaces" \
  -H "Content-Type: application/json" \
  -H "$AUTH" \
  -d '{"name":"docker-e2e-verify","settings":{"startMode":"docker"}}')
WS_ID=$(echo "$WS_RES" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).id))")
WS_SLUG=$(echo "$WS_RES" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).slug))")
echo "  Workspace: id=$WS_ID slug=$WS_SLUG"
check_nonempty "工作区创建成功" "$WS_ID"

# ---------- 3. ensure-config（触发容器启动）----------
echo ""
echo "=== 3. ensure-config (触发 Docker Runner 启动) ==="
ENSURE_RES=$(curl -sf -m 30 -X POST "$BASE/api/workspaces/$WS_ID/ensure-config" \
  -H "Content-Type: application/json" \
  -H "$AUTH")
echo "  Response: $ENSURE_RES"
check "ensure-config 返回 ok" "$ENSURE_RES" '"ok":true'

# ---------- 4. 容器运行 ----------
echo ""
echo "=== 4. 验证容器运行中 ==="
sleep 2
CID=$(docker ps -q --filter "label=ccclaw.workspace.slug=$WS_SLUG" | head -1)
if [ -n "$CID" ]; then
  STATUS=$(docker inspect "$CID" --format '{{.State.Status}}')
  echo "  Container: $CID, Status: $STATUS"
  check_eq "容器 running" "$STATUS" "running"
else
  echo "  FAIL: 没有找到容器"
  docker ps -a --filter "label=ccclaw.workspace=true" --format "{{.ID}} {{.Status}}" 2>/dev/null
  ((FAIL++))
fi

# ---------- 5. Runner 日志 ----------
echo ""
echo "=== 5. Runner 日志 ==="
if [ -n "${CID:-}" ]; then
  docker logs "$CID" 2>&1 | tail -10
  LOGS=$(docker logs "$CID" 2>&1)
  check "Runner 注册成功" "$LOGS" "注册成功"
  check "收到 config" "$LOGS" "收到 config"
fi

# ---------- 6. runner-info ----------
echo ""
echo "=== 6. runner-info ==="
RUNNER_INFO=$(curl -sf -m 5 "$BASE/api/workspaces/$WS_ID/runner-info" -H "$AUTH" || echo "")
echo "  $RUNNER_INFO"
check "runner-info 返回 directUrl" "$RUNNER_INFO" "directUrl"

# ---------- 7. 资源限制 ----------
echo ""
echo "=== 7. 资源限制 ==="
if [ -n "${CID:-}" ]; then
  MEM=$(docker inspect "$CID" --format '{{.HostConfig.Memory}}')
  CPU=$(docker inspect "$CID" --format '{{.HostConfig.CpuQuota}}')
  echo "  Memory: $MEM (expect 536870912=512MB)"
  echo "  CpuQuota: $CPU (expect 50000=50%)"
  check_eq "Memory 512MB" "$MEM" "536870912"
  check_eq "CpuQuota 50%" "$CPU" "50000"
fi

# ---------- 8. 清理 ----------
echo ""
echo "=== 8. 清理 ==="
[ -n "${CID:-}" ] && docker stop "$CID" >/dev/null 2>&1 && echo "  容器已停止"
curl -sf -m 5 -X DELETE "$BASE/api/workspaces/$WS_ID" -H "$AUTH" >/dev/null 2>&1 && echo "  工作区已删除"

# ---------- 汇总 ----------
echo ""
echo "==============================="
echo "  PASS: $PASS   FAIL: $FAIL"
echo "==============================="
[ "$FAIL" -eq 0 ] && echo "ALL PASS" || exit 1
