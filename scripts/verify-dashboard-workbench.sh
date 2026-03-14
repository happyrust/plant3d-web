#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_ROOT="$(cd "${WEB_ROOT}/../plant-model-gen" && pwd)"

PORT="${WEB_SERVER_PORT:-3310}"
CONFIG_PATH="${DASHBOARD_VERIFY_CONFIG:-db_options/DbOption-mac}"
CARGO_BUILD_JOBS_VALUE="${CARGO_BUILD_JOBS:-1}"
SKIP_BUILD=0
KEEP_SERVER=0
SKIP_INJECT=0

SERVER_PID=""
LOG_FILE=""
TASK_ID=""
INSERTED_ACTIVITY=0

usage() {
  cat <<'EOF'
用法:
  bash scripts/verify-dashboard-workbench.sh [options]

选项:
  --skip-build     跳过后端编译，直接使用现有二进制
  --keep-server    校验完成后保留临时启动的 web_server 进程
  --skip-inject    跳过 review_workflow_history 注入/清理验证
  -h, --help       显示帮助

环境变量:
  WEB_SERVER_PORT          临时 web_server 端口，默认 3310
  DASHBOARD_VERIFY_CONFIG  后端配置路径，默认 db_options/DbOption-mac
  CARGO_BUILD_JOBS         cargo build 并发度，默认 1
EOF
}

log() {
  printf '[dashboard-verify] %s\n' "$*"
}

fail() {
  printf '[dashboard-verify] 错误: %s\n' "$*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令: $1"
}

cleanup() {
  local exit_code=$?

  if [[ "$INSERTED_ACTIVITY" -eq 1 && -n "$TASK_ID" ]] && command -v surreal >/dev/null 2>&1; then
    printf "%s\n" \
      "DELETE review_workflow_history WHERE task_id = '${TASK_ID}';" \
      | surreal sql \
          -e ws://127.0.0.1:8020 \
          -u root \
          -p root \
          --ns 1516 \
          --db AvevaMarineSample \
          --json \
          --hide-welcome >/dev/null 2>&1 || true
  fi

  if [[ -n "$SERVER_PID" && "$KEEP_SERVER" -eq 0 ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi

  if [[ $exit_code -ne 0 && -n "$LOG_FILE" && -f "$LOG_FILE" ]]; then
    log "校验失败，最近服务日志如下:"
    tail -n 60 "$LOG_FILE" || true
  fi

  if [[ -n "$LOG_FILE" && -f "$LOG_FILE" && "$KEEP_SERVER" -eq 0 ]]; then
    rm -f "$LOG_FILE"
  fi

  exit "$exit_code"
}

wait_for_http() {
  local url="$1"
  local max_attempts="${2:-60}"
  local attempt=1

  while (( attempt <= max_attempts )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  return 1
}

assert_json() {
  local label="$1"
  local json="$2"
  local js="$3"

  printf '%s' "$json" | node -e "
    const fs = require('fs');
    const input = fs.readFileSync(0, 'utf8');
    const data = JSON.parse(input);
    ${js}
  " || fail "${label} 校验失败"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=1
      ;;
    --keep-server)
      KEEP_SERVER=1
      ;;
    --skip-inject)
      SKIP_INJECT=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "未知参数: $1"
      ;;
  esac
  shift
done

trap cleanup EXIT

need_command curl
need_command node
need_command lsof

if [[ "$SKIP_INJECT" -eq 0 ]]; then
  need_command surreal
fi

[[ -d "$BACKEND_ROOT" ]] || fail "未找到后端仓库: $BACKEND_ROOT"

if lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  fail "端口 $PORT 已被占用，请先释放，或通过 WEB_SERVER_PORT 指定其他端口"
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  log "编译 web_server 二进制..."
  (
    cd "$BACKEND_ROOT"
    CARGO_BUILD_JOBS="$CARGO_BUILD_JOBS_VALUE" cargo build \
      --manifest-path Cargo.toml \
      --features web_server \
      --bin web_server
  )
else
  log "跳过编译，直接使用现有二进制"
fi

LOG_FILE="$(mktemp -t dashboard-workbench-verify.XXXXXX.log)"
log "启动临时 web_server，端口: $PORT"
(
  cd "$BACKEND_ROOT"
  WEB_SERVER_PORT="$PORT" ./target/debug/web_server --config "$CONFIG_PATH"
) >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

wait_for_http "http://127.0.0.1:${PORT}/api/status" 90 \
  || fail "web_server 未在预期时间内启动成功"

log "校验 /api/projects"
PROJECTS_JSON="$(curl -fsS "http://127.0.0.1:${PORT}/api/projects")"
assert_json "/api/projects" "$PROJECTS_JSON" "
  if (!Array.isArray(data.items) || data.items.length === 0) process.exit(1);
  if (!data.items.some((item) => Object.prototype.hasOwnProperty.call(item, 'show_dbnum'))) process.exit(1);
"

log "校验 /api/status"
STATUS_JSON="$(curl -fsS "http://127.0.0.1:${PORT}/api/status")"
assert_json "/api/status" "$STATUS_JSON" "
  if (!Object.prototype.hasOwnProperty.call(data, 'database_connected')) process.exit(1);
  if (!Object.prototype.hasOwnProperty.call(data, 'surrealdb_connected')) process.exit(1);
"

log "校验 /api/dashboard/activities 空结果契约"
ACTIVITIES_JSON="$(curl -fsS "http://127.0.0.1:${PORT}/api/dashboard/activities?limit=5")"
assert_json "/api/dashboard/activities" "$ACTIVITIES_JSON" "
  if (data.success !== true) process.exit(1);
  if (!Array.isArray(data.data)) process.exit(1);
"

if [[ "$SKIP_INJECT" -eq 0 ]]; then
  TASK_ID="dashboard-cli-check-$(date +%s)"

  log "注入一条 review_workflow_history 验证记录"
  printf "%s\n" \
    "CREATE review_workflow_history CONTENT { task_id: '${TASK_ID}', action: 'submit', node: 'sj', operator_id: 'cli-user', operator_name: 'CLI 验证', comment: '通过 CLI 注入的验证记录', timestamp: d'2026-03-13T17:56:30Z' };" \
    | surreal sql \
        -e ws://127.0.0.1:8020 \
        -u root \
        -p root \
        --ns 1516 \
        --db AvevaMarineSample \
        --json \
        --hide-welcome >/dev/null
  INSERTED_ACTIVITY=1

  ACTIVITIES_JSON="$(curl -fsS "http://127.0.0.1:${PORT}/api/dashboard/activities?limit=10")"
  assert_json "/api/dashboard/activities 注入后" "$ACTIVITIES_JSON" "
    if (data.success !== true || !Array.isArray(data.data)) process.exit(1);
    const item = data.data.find((entry) => entry.targetName === '${TASK_ID}');
    if (!item) process.exit(1);
    if (item.source !== 'review') process.exit(1);
    if (item.userId !== 'cli-user') process.exit(1);
    if (item.actionTitle !== '提交了校审任务') process.exit(1);
    if (item.actionDesc !== '通过 CLI 注入的验证记录') process.exit(1);
    if (!item.createdAt) process.exit(1);
  "

  log "清理注入数据并复查"
  printf "%s\n" \
    "DELETE review_workflow_history WHERE task_id = '${TASK_ID}';" \
    | surreal sql \
        -e ws://127.0.0.1:8020 \
        -u root \
        -p root \
        --ns 1516 \
        --db AvevaMarineSample \
        --json \
        --hide-welcome >/dev/null
  INSERTED_ACTIVITY=0

  sleep 1
  ACTIVITIES_JSON="$(curl -fsS "http://127.0.0.1:${PORT}/api/dashboard/activities?limit=10")"
  assert_json "/api/dashboard/activities 清理后" "$ACTIVITIES_JSON" "
    if (!Array.isArray(data.data)) process.exit(1);
    if (data.data.some((entry) => entry.targetName === '${TASK_ID}')) process.exit(1);
  "
fi

log "dashboard workbench CLI 校验通过"
if [[ "$KEEP_SERVER" -eq 1 ]]; then
  log "临时服务已保留，PID: $SERVER_PID，日志: $LOG_FILE"
fi
