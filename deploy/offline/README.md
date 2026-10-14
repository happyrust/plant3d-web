# Plant3D-Web 离线部署包（Windows 内网版）

本目录是 Plant3D-Web 前端的**离线部署包**，适用于无法访问外网的内网 Windows 环境。包含 nginx（Windows 版）和前端构建产物，开箱即用。

## 目录结构

```
offline/
├── nginx/                    # nginx Windows 便携版
│   ├── nginx.exe             # nginx 主程序
│   ├── conf/
│   │   ├── nginx.conf        # 主配置文件
│   │   └── mime.types        # MIME 类型映射
│   ├── logs/                 # 日志目录
│   └── temp/                 # 临时文件目录
├── www/                      # 前端构建产物（dist 内容）
│   ├── index.html
│   ├── assets/
│   └── version.json          # 版本信息
├── config/                   # 配置目录
│   └── deploy.env            # 部署配置（后端地址、端口）
├── start.bat                 # 启动脚本
├── stop.bat                  # 停止脚本
├── config.bat                # 配置脚本（交互式修改后端地址和端口）
└── README.md                 # 本文件
```

## 快速开始

### 1. 配置后端地址（首次部署必做）

双击运行 `config.bat`，或手动编辑 `config\deploy.env`：

```ini
# gen-model (aios-database) 后端地址
BACKEND_ADDR=http://127.0.0.1:8022

# 前端监听端口（同时会监听 3100）
FRONTEND_PORT=80
```

- 如果后端（gen-model）和前端在**同一台机器**：保持 `http://127.0.0.1:8022` 不变
- 如果后端在**其他机器**：改为实际 IP，如 `http://192.168.1.100:8022`

### 2. 启动服务

双击运行 `start.bat`，会自动：
1. 检查环境
2. 更新 nginx 配置
3. 启动 nginx
4. 打开浏览器访问 `http://localhost`

### 3. 停止服务

双击运行 `stop.bat` 即可停止 nginx。

## 访问地址

| 地址 | 说明 |
|------|------|
| `http://localhost` | 本机访问（端口 80） |
| `http://localhost:3100` | 本机访问（端口 3100，兼容 PowerPMS） |
| `http://<本机IP>` | 局域网其他电脑访问 |
| `http://<本机IP>/version.json` | 查看版本信息 |

## 与 gen-model 后端配合

本前端需要配合 gen-model（aios-database）后端使用：

1. **后端**：运行 `aios-database.exe`（默认监听 8022 端口）
2. **前端**：运行本目录的 `start.bat`

nginx 会自动将以下请求反代到后端：
- `/api/*` → 后端 API（模型树、三维模型、校审等）
- `/files/*` → 后端附件下载

## PowerPMS 集成

PowerPMS 中的「模型中心」地址配置为：

```
http://<前端服务器IP>:3100
```

（3100 端口与 80 端口内容完全相同，专为兼容 PowerPMS 历史配置）

## 版本信息

查看 `www\version.json` 或访问 `http://<服务器地址>/version.json`：

```json
{
  "version": "0.2.0",
  "commit": "<git commit hash>",
  "buildDate": "<构建时间>"
}
```

## 常见问题

### Q: 启动时报端口被占用
**A**: 修改 `config\deploy.env` 中的 `FRONTEND_PORT`，或停止占用 80/3100 端口的程序。

### Q: 页面打不开/白屏
**A**: 检查：
1. 后端 `aios-database.exe` 是否已启动
2. `config\deploy.env` 中的 `BACKEND_ADDR` 是否正确
3. 查看 `nginx\logs\error.log` 日志

### Q: 如何更新前端版本
**A**: 重新运行打包脚本生成新的离线包，替换 `www` 目录即可。

## 技术说明

- **nginx 版本**: 1.30.5 (Windows x64 稳定版)
- **前端框架**: Vue 3 + TypeScript + Vite
- **构建产物**: 纯静态文件，无需 Node.js 运行时
