#!/usr/bin/env bash

set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-123.57.182.243}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PASS="${REMOTE_PASS:-}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/plant3d-web}"
SERVER_NAME="${SERVER_NAME:-$REMOTE_HOST}"
BACKEND_ORIGIN="${BACKEND_ORIGIN:-http://127.0.0.1:3100}"
SERVICE_NAME="${SERVICE_NAME:-nginx}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
NGINX_TEMPLATE="$SCRIPT_DIR/nginx_remote.conf"

SSH_OPTS=(
  -o PreferredAuthentications=password
  -o PubkeyAuthentication=no
  -o KbdInteractiveAuthentication=no
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
)

log() {
  printf '[deploy-frontend] %s\n' "$*"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'
}

run_remote() {
  sshpass -p "$REMOTE_PASS" ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "$@"
}

run_rsync() {
  sshpass -p "$REMOTE_PASS" rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "$@"
}

run_rsync_file() {
  sshpass -p "$REMOTE_PASS" rsync -az -e "ssh ${SSH_OPTS[*]}" "$@"
}

need_cmd npm
need_cmd node
need_cmd git
need_cmd sshpass
need_cmd rsync

[[ -n "$REMOTE_PASS" ]] || {
  printf 'REMOTE_PASS is required. Example: REMOTE_PASS=*** ./deploy/deploy_frontend_bundle.sh\n' >&2
  exit 1
}
[[ -f "$NGINX_TEMPLATE" ]] || {
  printf 'Missing nginx template: %s\n' "$NGINX_TEMPLATE" >&2
  exit 1
}

TMP_NGINX_CONF="$(mktemp)"
trap 'rm -f "$TMP_NGINX_CONF"' EXIT

BACKEND_ORIGIN_ESCAPED="$(escape_sed_replacement "$BACKEND_ORIGIN")"
SERVER_NAME_ESCAPED="$(escape_sed_replacement "$SERVER_NAME")"
sed \
  -e "s/server_name 123\\.57\\.182\\.243;/server_name ${SERVER_NAME_ESCAPED};/" \
  -e "s#http://127\\.0\\.0\\.1:3100#${BACKEND_ORIGIN_ESCAPED}#g" \
  "$NGINX_TEMPLATE" > "$TMP_NGINX_CONF"

log "Building frontend bundle in $PROJECT_DIR"
cd "$PROJECT_DIR"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

CURRENT_COMMIT="$(git rev-parse HEAD)"
CURRENT_VERSION="$(node -p "require('./package.json').version")"
CURRENT_BUILD_DATE="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
cat > "$PROJECT_DIR/dist/version.json" <<EOF
{
  "version": "${CURRENT_VERSION}",
  "commit": "${CURRENT_COMMIT}",
  "buildDate": "${CURRENT_BUILD_DATE}"
}
EOF

[[ -d "$PROJECT_DIR/dist" ]] || {
  printf 'Build failed: dist directory does not exist\n' >&2
  exit 1
}

log "Preparing remote directory $DEPLOY_PATH"
run_remote "mkdir -p '$DEPLOY_PATH'"

log "Uploading dist bundle"
run_rsync "$PROJECT_DIR/dist/" "$REMOTE_USER@$REMOTE_HOST:$DEPLOY_PATH/"

log "Setting remote permissions"
run_remote "set -e; \
  chown -R www-data:www-data '$DEPLOY_PATH' 2>/dev/null || chown -R nginx:nginx '$DEPLOY_PATH' 2>/dev/null || true; \
  chmod -R 755 '$DEPLOY_PATH'"

log "Uploading nginx configuration"
run_rsync_file "$TMP_NGINX_CONF" "$REMOTE_USER@$REMOTE_HOST:/tmp/plant3d-web.conf"
run_remote "set -e; \
  if [ -d /etc/nginx/sites-available ]; then \
    mv /tmp/plant3d-web.conf /etc/nginx/sites-available/plant3d-web; \
    ln -sf /etc/nginx/sites-available/plant3d-web /etc/nginx/sites-enabled/plant3d-web; \
  elif [ -d /etc/nginx/conf.d ]; then \
    mv /tmp/plant3d-web.conf /etc/nginx/conf.d/plant3d-web.conf; \
  else \
    echo 'Unsupported nginx layout' >&2; \
    exit 1; \
  fi; \
  nginx -t; \
  systemctl reload '$SERVICE_NAME' || nginx -s reload"

log "Verifying nginx and public entrypoint"
run_remote "systemctl is-active '$SERVICE_NAME' >/dev/null"
HTTP_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "http://$REMOTE_HOST/" || true)"
if [[ "$HTTP_STATUS" != "200" ]]; then
  printf 'Frontend public URL returned HTTP %s\n' "$HTTP_STATUS" >&2
  exit 1
fi

log "Deployment finished: http://$REMOTE_HOST/"
