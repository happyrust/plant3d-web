# Plant3D-Web 部署指南

## 服务器信息
- **IP**: 101.42.162.129
- **用户**: ubuntu
- **部署路径**: /var/www/plant3d-web

## 快速部署

### 方式一：自动化脚本
```bash
cd deploy
chmod +x deploy.sh
./deploy.sh
```

### 方式二：手动部署

#### 1. 本地构建
```bash
cd /Volumes/DPC/work/plant-code/plant3d-web
npm install
npm run build
```

#### 2. 上传文件
```bash
scp -r dist/* ubuntu@101.42.162.129:/var/www/plant3d-web/
```

#### 3. 配置 Nginx
```bash
# SSH 到服务器
ssh ubuntu@101.42.162.129

# 复制 Nginx 配置
sudo cp nginx.conf /etc/nginx/sites-available/plant3d-web

# 启用站点
sudo ln -sf /etc/nginx/sites-available/plant3d-web /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

## 验证

访问: http://101.42.162.129/plant3d-web/

## 前置条件

服务器需要安装:
- Nginx
- 后端 API 服务运行在 8080 端口

### 安装 Nginx (如未安装)
```bash
sudo apt update
sudo apt install nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

## 目录结构
```
deploy/
├── README.md      # 本指南
├── deploy.sh      # 自动化部署脚本
└── nginx.conf     # Nginx 配置文件
```
