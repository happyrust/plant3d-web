#!/bin/bash

# ==============================================================================
# Plant3D-Web Remote Deployment Script
# Targets: 123.57.182.243 (Ubuntu 22.04 x86_64)
# ==============================================================================

set -e

# --- Configuration ---
REMOTE_HOST="123.57.182.243"
REMOTE_USER="root"
REMOTE_PASS="Happytest123_"
DEPLOY_PATH="/var/www/plant3d-web"
SERVICE_NAME="nginx"

# 项目路径 (脚本所在目录的上级)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Remote Deployment to ${REMOTE_HOST}...${NC}"
echo "Project Directory: $PROJECT_DIR"
echo "Deploy Path: $DEPLOY_PATH"
echo "========================================"

# 1. Local Build
echo -e "${YELLOW}Step 1: Building project locally...${NC}"
cd "$PROJECT_DIR"
npm install
npm run build-only

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
echo -e "${GREEN}✅ Version metadata generated.${NC}"

if [ ! -d "$PROJECT_DIR/dist" ]; then
    echo -e "${RED}❌ Build failed: dist directory does not exist${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Build successful.${NC}"

# 2. Preparation on Remote
echo -e "${YELLOW}Step 2: Preparing remote server...${NC}"
sshpass -p "${REMOTE_PASS}" ssh -o StrictHostKeyChecking=no ${REMOTE_USER}@${REMOTE_HOST} "mkdir -p ${DEPLOY_PATH}"
echo -e "${GREEN}✅ Remote directory prepared.${NC}"

# 3. Transfer Files using rsync
echo -e "${YELLOW}Step 3: Syncing files to server using rsync...${NC}"
cd "$PROJECT_DIR"
sshpass -p "${REMOTE_PASS}" rsync -avz --delete \
    -e "ssh -o StrictHostKeyChecking=no" \
    dist/ ${REMOTE_USER}@${REMOTE_HOST}:${DEPLOY_PATH}/
echo -e "${GREEN}✅ Rsync completed.${NC}"

# 4. Set permissions on Remote
echo -e "${YELLOW}Step 4: Setting permissions on remote server...${NC}"
sshpass -p "${REMOTE_PASS}" ssh -o StrictHostKeyChecking=no ${REMOTE_USER}@${REMOTE_HOST} << 'REMOTE_SCRIPT'
    # 设置权限
    chown -R www-data:www-data /var/www/plant3d-web/ 2>/dev/null || chown -R nginx:nginx /var/www/plant3d-web/ 2>/dev/null || true
    chmod -R 755 /var/www/plant3d-web/
REMOTE_SCRIPT
echo -e "${GREEN}✅ Permissions set.${NC}"

# 5. Upload and Configure Nginx
echo -e "${YELLOW}Step 5: Configuring Nginx...${NC}"
sshpass -p "${REMOTE_PASS}" scp -o StrictHostKeyChecking=no "$SCRIPT_DIR/nginx_remote.conf" ${REMOTE_USER}@${REMOTE_HOST}:/tmp/plant3d-web.conf

sshpass -p "${REMOTE_PASS}" ssh -o StrictHostKeyChecking=no ${REMOTE_USER}@${REMOTE_HOST} << 'REMOTE_SCRIPT'
    # 判断 Nginx 配置目录结构
    if [ -d "/etc/nginx/sites-available" ]; then
        # Ubuntu/Debian 风格
        mv /tmp/plant3d-web.conf /etc/nginx/sites-available/plant3d-web
        ln -sf /etc/nginx/sites-available/plant3d-web /etc/nginx/sites-enabled/plant3d-web
    elif [ -d "/etc/nginx/conf.d" ]; then
        # CentOS/RHEL 风格
        mv /tmp/plant3d-web.conf /etc/nginx/conf.d/plant3d-web.conf
    fi
    
    # 测试配置
    nginx -t
    
    # 重载 Nginx
    systemctl reload nginx || nginx -s reload
REMOTE_SCRIPT
echo -e "${GREEN}✅ Nginx configured.${NC}"

# 6. Verification
echo -e "${YELLOW}Step 6: Verifying deployment...${NC}"
sleep 2

# 检查 Nginx 服务状态
sshpass -p "${REMOTE_PASS}" ssh -o StrictHostKeyChecking=no ${REMOTE_USER}@${REMOTE_HOST} "systemctl is-active nginx" && \
    echo -e "${GREEN}✅ Nginx is active.${NC}" || \
    echo -e "${RED}❌ Nginx is not active.${NC}"

# HTTP 验证
echo -e "${YELLOW}Testing HTTP access...${NC}"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://${REMOTE_HOST}/" || echo "000")
if [ "$HTTP_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ HTTP verification passed! Status: ${HTTP_STATUS}${NC}"
else
    echo -e "${RED}⚠️  HTTP status: ${HTTP_STATUS} (expected 200)${NC}"
    echo -e "${YELLOW}Checking detailed response...${NC}"
    curl -I "http://${REMOTE_HOST}/" 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}🎉 Done!${NC}"
echo "========================================"
echo -e "访问地址: ${GREEN}http://${REMOTE_HOST}/${NC}"
echo "========================================"
