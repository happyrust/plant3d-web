#!/usr/bin/env bash
# 使用 sshpass 非交互同步 dist 并重载 Nginx（勿把密码写进仓库）。
# 用法:
#   export DEPLOY_SSH_PASS='你的密码' && bash scripts/deploy-ubuntu.sh
# 或（sshpass 惯例）:
#   export SSHPASS='你的密码' && bash scripts/deploy-ubuntu.sh
# 可选环境变量: DEPLOY_HOST DEPLOY_USER DEPLOY_REMOTE_PATH；加 --skip-build 可跳过构建。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEPLOY_HOST="${DEPLOY_HOST:-123.57.182.243}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_REMOTE_PATH="${DEPLOY_REMOTE_PATH:-/var/www/plant3d-web}"
SKIP_BUILD=0

for arg in "$@"; do
  if [[ "$arg" == "--skip-build" ]]; then
    SKIP_BUILD=1
  fi
done

if [[ -n "${DEPLOY_SSH_PASS:-}" ]]; then
  export SSHPASS="$DEPLOY_SSH_PASS"
fi

if [[ -z "${SSHPASS:-}" ]]; then
  echo "请先设置密码: export DEPLOY_SSH_PASS='...' 或 export SSHPASS='...'" >&2
  exit 1
fi

if ! command -v sshpass >/dev/null 2>&1; then
  echo "未找到 sshpass。macOS: brew install sshpass；Ubuntu: apt install sshpass" >&2
  exit 1
fi

SSH_BASE=(ssh -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password)
RSYNC_RSH="sshpass -e ssh -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password"

cd "$WEB_ROOT"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  npm run build
else
  [[ -d dist ]] || { echo "无 dist/ 且使用了 --skip-build" >&2; exit 1; }
fi

sshpass -e rsync -avz --delete -e "$RSYNC_RSH" dist/ "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_REMOTE_PATH}/"

sshpass -e "${SSH_BASE[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "chown -R www-data:www-data ${DEPLOY_REMOTE_PATH} && nginx -t && systemctl reload nginx"

echo "部署完成: http://${DEPLOY_HOST}/"
