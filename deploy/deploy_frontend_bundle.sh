#!/usr/bin/env bash

set -euo pipefail

# Build and deploy the current frontend bundle to nginx.

REMOTE_HOST="${REMOTE_HOST:-123.57.182.243}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PASS="${REMOTE_PASS:-Happytest123_}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/plant3d-web}"
SITE_CONF_PATH="${SITE_CONF_PATH:-/etc/nginx/sites-available/plant3d-web}"
SERVER_NAME="${SERVER_NAME:-123.57.182.243}"
BACKEND_ORIGIN="${BACKEND_ORIGIN:-http://127.0.0.1:3100}"

INSTALL_DEPS="${INSTALL_DEPS:-false}"
BUILD_COMMAND="${BUILD_COMMAND:-npm run build-only}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_DIR/dist"
ENV_FILE="$PROJECT_DIR/.env.production"
TMP_NGINX_CONF="$SCRIPT_DIR/.nginx_remote.generated.conf"

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

# Retry wrapper for transient SSH failures
retry_with_backoff() {
  local max_attempts=5
  local delay=2
  local attempt=1
  local exit_code=0

  while [[ $attempt -le $max_attempts ]]; do
    if "$@"; then
      return 0
    else
      exit_code=$?
      if [[ $attempt -lt $max_attempts ]]; then
        log "Attempt $attempt/$max_attempts failed (exit code $exit_code), retrying in ${delay}s..."
        sleep "$delay"
        delay=$((delay * 2))
        attempt=$((attempt + 1))
      else
        log "All $max_attempts attempts failed"
        return $exit_code
      fi
    fi
  done
}

run_remote() {
  local attempt=1
  local max_attempts=5
  local delay=2
  
  while [[ $attempt -le $max_attempts ]]; do
    if sshpass -p "$REMOTE_PASS" ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "$@"; then
      return 0
    else
      local exit_code=$?
      if [[ $attempt -lt $max_attempts ]]; then
        log "SSH attempt $attempt/$max_attempts failed (exit code $exit_code), retrying in ${delay}s..."
        sleep "$delay"
        delay=$((delay * 2))
        attempt=$((attempt + 1))
      else
        log "All $max_attempts SSH attempts failed"
        return $exit_code
      fi
    fi
  done
}

run_rsync() {
  local attempt=1
  local max_attempts=5
  local delay=2
  
  while [[ $attempt -le $max_attempts ]]; do
    if sshpass -p "$REMOTE_PASS" rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "$@"; then
      return 0
    else
      local exit_code=$?
      if [[ $attempt -lt $max_attempts ]]; then
        log "rsync attempt $attempt/$max_attempts failed (exit code $exit_code), retrying in ${delay}s..."
        sleep "$delay"
        delay=$((delay * 2))
        attempt=$((attempt + 1))
      else
        log "All $max_attempts rsync attempts failed"
        return $exit_code
      fi
    fi
  done
}

run_rsync_file() {
  local attempt=1
  local max_attempts=5
  local delay=2
  
  while [[ $attempt -le $max_attempts ]]; do
    if sshpass -p "$REMOTE_PASS" rsync -az -e "ssh ${SSH_OPTS[*]}" "$@"; then
      return 0
    else
      local exit_code=$?
      if [[ $attempt -lt $max_attempts ]]; then
        log "rsync attempt $attempt/$max_attempts failed (exit code $exit_code), retrying in ${delay}s..."
        sleep "$delay"
        delay=$((delay * 2))
        attempt=$((attempt + 1))
      else
        log "All $max_attempts rsync attempts failed"
        return $exit_code
      fi
    fi
  done
}

run_scp() {
  local attempt=1
  local max_attempts=5
  local delay=2
  
  while [[ $attempt -le $max_attempts ]]; do
    if sshpass -p "$REMOTE_PASS" scp "${SSH_OPTS[@]}" "$@"; then
      return 0
    else
      local exit_code=$?
      if [[ $attempt -lt $max_attempts ]]; then
        log "scp attempt $attempt/$max_attempts failed (exit code $exit_code), retrying in ${delay}s..."
        sleep "$delay"
        delay=$((delay * 2))
        attempt=$((attempt + 1))
      else
        log "All $max_attempts scp attempts failed"
        return $exit_code
      fi
    fi
  done
}

cleanup() {
  rm -f "$TMP_NGINX_CONF"
}

trap cleanup EXIT

need_cmd sshpass
need_cmd rsync
need_cmd npm

if [[ "$INSTALL_DEPS" == "true" ]]; then
  log "Installing dependencies"
  npm --prefix "$PROJECT_DIR" install
fi

if [[ -f "$ENV_FILE" ]]; then
  log "Using production env file: $ENV_FILE"
else
  log "No .env.production found, using current environment variables only"
fi

log "Building frontend bundle"
(cd "$PROJECT_DIR" && eval "$BUILD_COMMAND")

[[ -d "$DIST_DIR" ]] || { printf 'Missing dist directory: %s\n' "$DIST_DIR" >&2; exit 1; }

cat > "$TMP_NGINX_CONF" <<EOF
server {
    listen 80;
    server_name ${SERVER_NAME};

    root ${DEPLOY_PATH};
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|wasm)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass ${BACKEND_ORIGIN}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /files/ {
        proxy_pass ${BACKEND_ORIGIN}/files/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 100M;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript application/wasm;
    gzip_min_length 1000;
}
EOF

log "Preparing remote deploy directory"
run_remote "set -e; mkdir -p '$DEPLOY_PATH'; mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled; if [ -f /etc/nginx/conf.d/plant3d-web.conf ]; then mv /etc/nginx/conf.d/plant3d-web.conf /etc/nginx/conf.d/plant3d-web.conf.bak; fi"

log "Uploading dist/"
run_rsync "$DIST_DIR/" "$REMOTE_USER@$REMOTE_HOST:$DEPLOY_PATH/"

log "Uploading nginx config"
run_rsync_file "$TMP_NGINX_CONF" "$REMOTE_USER@$REMOTE_HOST:/tmp/plant3d-web.conf"

log "Reloading nginx"
run_remote "set -e; mv /tmp/plant3d-web.conf '$SITE_CONF_PATH'; ln -sfn '$SITE_CONF_PATH' /etc/nginx/sites-enabled/plant3d-web; nginx -t; systemctl reload nginx || nginx -s reload; systemctl is-active nginx"

log "Frontend deployment finished"
log "URL: http://$REMOTE_HOST/"
