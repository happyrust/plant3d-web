# Plant3D-Web 一体化离线部署包（Windows）

本包包含 Plant3D-Web 前端、Windows nginx，以及 gen-model 官方发布包中的 `aios-database.exe`、运行资源和配置向导。默认不依赖已安装的 Node.js、Rust 或外部后端。

## 目录结构

```text
offline/
├── backend/                  # gen-model 官方 Windows 发布包
│   ├── aios-database.exe
│   ├── DbOption.toml
│   ├── Start-AMS.ps1
│   ├── resource/
│   ├── schema/
│   └── web/
├── nginx/                    # nginx Windows 便携版
├── www/                      # Plant3D-Web 前端构建产物
├── config/                   # 运行 config.bat 后生成 deploy.env
├── release.json              # 前后端版本清单
├── config.bat
├── start.bat
└── stop.bat
```

模型源文件、现场 workspace 和既有数据库数据不进入发布包。首次启动后通过后端配置向导选择现场 E3D 项目目录。

## 打包

默认从相邻 `gen-model/releases/` 自动选择修改时间最新的 `ams-local-*.zip`：

```bash
npm run build:offline
```

推荐在正式发版时显式指定经过验证的后端包：

```bash
npm run build:offline -- --backend-package ../gen-model/releases/ams-local-<version>.zip
```

兼容旧部署、只需要前端和 nginx 时：

```bash
npm run build:offline:frontend-only
```

输出位置：`../gen-model/releases/plant3d-web-offline-v<前端版本>-backend-v<后端版本>-<date>.zip`。默认拒绝覆盖同名发布物，确需覆盖时添加 `--force`。

## 启动

1. 解压 ZIP。
2. 可选运行 `config.bat`。默认 `BACKEND_MODE=integrated`，无需填写后端地址。
3. 运行 `start.bat`。
4. 脚本先启动包内后端并等待 `/api/v1/health`，再启动 nginx 和浏览器。
5. 首次运行按后端配置向导填写 E3D 项目路径；保存后按向导提示重启。

访问地址：

- `http://localhost`：默认入口。
- `http://localhost:3100`：PowerPMS 兼容入口。
- `http://<服务器 IP>`：局域网入口。

运行 `stop.bat` 会停止 nginx，并依据 `backend/process.json` 校验 PID 和可执行文件路径后停止包内后端，不会按进程名误杀其他实例。

## 使用外部后端

运行 `config.bat`，将 backend mode 改为 `external`，再填写后端地址。外部后端必须提供 `/api`、`/api/v1` 和 `/files` 接口。此模式下 `start.bat` 不启动或停止后端。

## 数据持久化

默认以 `mem` 模式启动，适合首次配置与验证，后端重启后数据库内容不会保留。需要持久化时，应按 `backend/README.md` 使用包内 `Start-Surreal.ps1` 启动 rocksdb，并以 `Start-AMS.ps1 -StoreMode rocksdb` 启动后端；现场数据目录不应覆盖在升级包内。

## 日志与排障

- 后端日志：`backend/logs/`
- nginx 日志：`nginx/logs/`
- 前后端版本：`release.json`
- 后端健康检查：`http://127.0.0.1:8022/api/v1/health`

端口默认使用 80、3100 和 8022。部署前应确认端口未占用并配置防火墙。
