# Plant3D-Web Ubuntu 部署指南

## 目标

将前端静态文件部署到 Ubuntu 服务器的 `/var/www/plant3d-web`，并由 Nginx 对外提供站点，同时把 `/api`、`/files` 反代到后端 `web_server`。

## 默认约定

- 服务器：`123.57.182.243`
- 用户：`root`
- 前端目录：`/var/www/plant3d-web`
- 后端反代：`http://127.0.0.1:3100`
- 站点入口：`http://123.57.182.243/`

## 自动化部署

推荐使用新的 bundle 脚本：

```bash
cd deploy
chmod +x deploy_frontend_bundle.sh
REMOTE_PASS='***' ./deploy_frontend_bundle.sh
```

可选环境变量：

```bash
REMOTE_HOST=123.57.182.243 \
REMOTE_USER=root \
REMOTE_PASS='***' \
SERVER_NAME=123.57.182.243 \
DEPLOY_PATH=/var/www/plant3d-web \
BACKEND_ORIGIN=http://127.0.0.1:3100 \
./deploy_frontend_bundle.sh
```

兼容入口 `deploy_remote.sh` 仍可使用，但其内部已转发到 `deploy_frontend_bundle.sh`。

## 与后端联动

若在 `plant-model-gen` 仓库执行：

```bash
./shells/deploy_all_with_frontend.sh
```

后端总控脚本会自动调用本仓 `deploy/deploy_frontend_bundle.sh`，因此此前缺失前端脚本导致的联动部署断点已被补齐。

## 服务器前置条件

Ubuntu 服务器至少需要安装：

- `nginx`
- `rsync`
- `sshpass`
- 已在 `127.0.0.1:3100` 监听的后端 `web_server`

安装 Nginx 示例：

```bash
sudo apt update
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

## 验证

脚本完成后会自动验证：

- `systemctl is-active nginx`
- `http://<REMOTE_HOST>/` 返回 `200`

可手工补充：

```bash
curl -I http://123.57.182.243/
curl -I http://123.57.182.243/api/health
curl -I http://123.57.182.243/files/
```

## 目录结构

```text
deploy/
├── README.md
├── deploy_frontend_bundle.sh
├── deploy_remote.sh
└── nginx_remote.conf
```
