#!/bin/bash
# Plant3D-Web 部署脚本
# 使用方法: ./deploy.sh

set -e

# ============ 配置 ============
SERVER_IP="101.42.162.129"
SERVER_USER="ubuntu"
SERVER_PASSWORD="Happytest123_"
DEPLOY_PATH="/var/www/plant3d-web"
NGINX_CONF_PATH="/etc/nginx/sites-available/plant3d-web"

# 项目路径 (脚本所在目录的上级)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "  Plant3D-Web 部署脚本"
echo "========================================"
echo "项目目录: $PROJECT_DIR"
echo "目标服务器: $SERVER_USER@$SERVER_IP"
echo "部署路径: $DEPLOY_PATH"
echo "========================================"

# ============ 步骤 1: 本地构建 ============
echo ""
echo "[1/4] 构建项目..."
cd "$PROJECT_DIR"
npm install
npm run build

if [ ! -d "$PROJECT_DIR/dist" ]; then
    echo "❌ 构建失败: dist 目录不存在"
    exit 1
fi
echo "✅ 构建完成"

# ============ 步骤 2: 上传文件 ============
echo ""
echo "[2/4] 上传文件到服务器..."

# 使用 sshpass 自动输入密码 (需要先安装: brew install hudochenkov/sshpass/sshpass)
# 如果不想用 sshpass，可以配置 SSH 密钥认证

# 检查是否安装了 sshpass
if ! command -v sshpass &> /dev/null; then
    echo "⚠️  未安装 sshpass，将使用交互式密码输入"
    echo "   可通过以下命令安装: brew install hudochenkov/sshpass/sshpass"
    SSH_CMD="ssh"
    SCP_CMD="scp"
else
    SSH_CMD="sshpass -p '$SERVER_PASSWORD' ssh"
    SCP_CMD="sshpass -p '$SERVER_PASSWORD' scp"
fi

# 创建远程目录并上传文件
echo "创建远程目录..."
$SSH_CMD -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_IP "sudo mkdir -p $DEPLOY_PATH && sudo chown -R $SERVER_USER:$SERVER_USER $DEPLOY_PATH"

echo "上传 dist 目录..."
$SCP_CMD -o StrictHostKeyChecking=no -r "$PROJECT_DIR/dist/"* $SERVER_USER@$SERVER_IP:$DEPLOY_PATH/

echo "✅ 文件上传完成"

# ============ 步骤 3: 配置 Nginx ============
echo ""
echo "[3/4] 配置 Nginx..."

# 上传 Nginx 配置
$SCP_CMD -o StrictHostKeyChecking=no "$SCRIPT_DIR/nginx.conf" $SERVER_USER@$SERVER_IP:/tmp/plant3d-web.conf

# 在服务器上配置 Nginx
$SSH_CMD -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_IP << 'REMOTE_SCRIPT'
    # 移动配置文件
    sudo mv /tmp/plant3d-web.conf /etc/nginx/sites-available/plant3d-web
    
    # 启用站点
    sudo ln -sf /etc/nginx/sites-available/plant3d-web /etc/nginx/sites-enabled/plant3d-web
    
    # 测试配置
    sudo nginx -t
    
    # 重载 Nginx
    sudo systemctl reload nginx
REMOTE_SCRIPT

echo "✅ Nginx 配置完成"

# ============ 步骤 4: 验证 ============
echo ""
echo "[4/4] 验证部署..."
echo ""
echo "========================================"
echo "  🎉 部署完成!"
echo "========================================"
echo ""
echo "访问地址: http://$SERVER_IP/plant3d-web/"
echo ""
echo "如需手动验证:"
echo "  curl -I http://$SERVER_IP/plant3d-web/"
echo ""
