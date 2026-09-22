# Plant3D-Web Ubuntu 部署指南

## 目标

将前端静态文件部署到 Ubuntu 服务器的 `/var/www/plant3d-web`，并由 Nginx 对外提供站点，同时把 `/api`（含 `/api/v1`）与 `/files/review_attachments` 反代到 gen-model（`aios-database`）。

2026-09-20 起前端只有这一个后端：旧后端 plant-model-gen `web_server`（`:3100`，parquet / GLB / SurrealDB 直连）已退役，`VITE_MODEL_SOURCE=legacy` 开关随之删除，构建不再需要任何 `VITE_*` 变量。

## 默认约定

- 服务器：`123.57.182.243`
- 用户：`root`
- 前端目录：`/var/www/plant3d-web`
- 后端反代：`http://127.0.0.1:8022`（gen-model / aios-database）
- 站点入口：`http://123.57.182.243/`；同一站点同时监听 `3100`（`http://123.57.182.243:3100/` 内容完全相同）——PowerPMS 配置里的模型中心端口历史上是 3100，为让 PMS 不改配置也能通，2026-09-21 起 nginx 模板 `listen 80; listen 3100;`

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
BACKEND_ORIGIN=http://127.0.0.1:8022 \
./deploy_frontend_bundle.sh
```

兼容入口 `deploy_remote.sh` 仍可使用，但其内部已转发到 `deploy_frontend_bundle.sh`。

## 用 GitHub Actions 部署（本机没有服务器密码 / sshpass / rsync 时的首选）

上面的本地脚本要 `REMOTE_PASS`（root 密码）+ `sshpass` + `rsync`；Windows 上三样通常都没有（Git Bash 没 rsync / sshpass，WSL 不一定起得来）。仓库的 `Deploy Frontend To Ubuntu` workflow 已把密码放在 secret 里，直接用 `gh` 触发即可，2026-09-21 / 09-22 两次上线都是这么部的：

```bash
gh auth status                                          # 已登录 github.com 即可
gh workflow run deploy-ubuntu.yml --ref main            # 也可 --ref deploy/<日期分支>
gh run list --workflow deploy-ubuntu.yml --limit 2      # 拿到 run id
gh run watch <run-id> --exit-status                     # 约 2 分钟：npm ci → build-only → 写 version.json → rsync → nginx 模板 → reload
```

验收：

```bash
curl -s https://123.57.182.243/version.json             # commit / buildDate 由部署脚本写入，应等于刚推的 HEAD
curl -sI https://123.57.182.243/ | grep -i last-modified
curl -s https://123.57.182.243/ | grep -o 'assets/index-[^"]*'   # bundle hash 应变
```

注意：

- 部的是**整个分支**（`--ref` 指到哪就部到哪），不能只挑某几笔；想只上一部分就先切一个 `deploy/<日期>` 分支再 `--ref` 它。
- 仓库 `production` environment 目前没有分支保护 / 审批规则，`main` 与任何分支都能直接触发。
- 部署脚本会用 `nginx_remote.conf`（只有 `listen 80; listen 3100;`）覆盖 `sites-available/plant3d-web`（先留 `.bak-<时间戳>`）。线上的 HTTPS（443）不在这个文件里，09-21 / 09-22 两次覆盖后 `https://` 照常，不用担心；但若日后把 443 合进这个站点文件，务必同步改模板。
- 上线后可用 `docs/verification/pms-3d-review-integration-e2e.md` §6.3.1 里的三个脚本 `MODE=online` 直接在线上包上复验。

### 仓库配置

仓库已提供可手动触发的 workflow：`Deploy Frontend To Ubuntu`（见 `.github/workflows/deploy-ubuntu.yml`）。

使用前先在 GitHub 仓库配置：

- Variables:
  - `DEPLOY_REMOTE_HOST`
  - `DEPLOY_REMOTE_USER`（可选，默认 `root`）
  - `DEPLOY_PATH`（可选，默认 `/var/www/plant3d-web`）
  - `SERVER_NAME`（可选，默认与 host 相同）
  - `BACKEND_ORIGIN`（可选，默认 `http://127.0.0.1:8022`）
- Secrets:
  - `DEPLOY_REMOTE_PASS`

触发方式：

- GitHub → Actions → `Deploy Frontend To Ubuntu` → Run workflow（可在表单里覆盖 remote_host / deploy_path 等）。

## 与后端联动

gen-model 的 `deploy/linux/install_backend.sh` 在服务器上维护 `/etc/nginx/snippets/aios-review-split*.conf`（校审域与附件的分流片段），本模板 `include` 它；两边都指向同一个 `:8022`，先部署哪一边都行。

## 服务器前置条件

Ubuntu 服务器至少需要安装：

- `nginx`
- `rsync`
- `sshpass`
- 已在 `127.0.0.1:8022` 监听的 gen-model `aios-database`（`/api/v1/health` 返回 200）

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
curl -I http://123.57.182.243/api/v1/health
curl -I http://123.57.182.243/api/review/health
```

## 目录结构

```text
deploy/
├── README.md
├── deploy_frontend_bundle.sh
├── deploy_remote.sh
└── nginx_remote.conf
```
