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

默认开启 `../gen-model` 打包发布联动（`--with-gen-model` 默认开启）：会先执行 `../gen-model/scripts/New-LocalRelease.ps1` 构建并打包 `gen-model` 后端与 `plant-ui`（`backend/web/`），再与 `plant3d-web` 前端及 nginx 一起打成整体离线包：

```bash
npm run build:offline
```

若 `deploy/offline` 正被运行中的服务使用，可指定一个新的空目录隔离组包，避免改写运行目录或带入 PID、日志和本机 `deploy.env`：

```powershell
npm run build:offline -- --staging-dir "$env:TEMP\plant3d-release-staging"
```

如果 `../gen-model/releases/` 下已有构建好的 `ams-local-*.zip`，可跳过重新构建直接复用合包：

```bash
npm run build:offline:reuse-gen-model
# 或显式指定某一个后端包：
npm run build:offline -- --backend-package ../gen-model/releases/ams-local-<version>.zip
```

兼容旧部署、关闭 `../gen-model` 合包（仅打包 `plant3d-web` 前端 + nginx）时：

```bash
npm run build:offline:frontend-only
# 或：
npm run build:offline -- --no-gen-model
```

输出位置：`../gen-model/releases/plant3d-web-offline-v<前端版本>-backend-v<后端版本>-<date>.zip`。默认拒绝覆盖同名发布物，确需覆盖时添加 `--force`。

## Windows Server 2012 R2 脚本兼容

运行脚本按 Windows PowerShell 4.0 / .NET Framework 4.5 编写，不依赖系统自带 `curl`。包内 `.ps1` 使用 UTF-8 BOM，避免中文系统按 ANSI 读取导致 `MissingCatchOrFinally` 等解析错误；不要用会移除 BOM 的编辑器重存脚本。

一体化启动在后端启动命令和独立 HTTP 健康检查均通过后才启动 nginx。脚本兼容检查不等于已完成旧系统原生 EXE 兼容验收；`aios-database.exe`、`surreal.exe`、nginx 与所需 VC++ 运行库仍需在目标系统实测。

## 启动

1. 解压 ZIP。
2. 运行 `start.bat`；默认 `BACKEND_MODE=integrated`、`STORE_MODE=rocksdb`，无需先运行 `config.bat`。
3. 脚本读取 `backend/DbOption.toml`，同步 nginx 配置；rocksdb 档先确保 `v_ip:v_port` 上有可连的 SurrealDB（指向回环且未监听时用包内 `bin\surreal.exe` 起一台），再启动后端与 nginx。
4. 首次启动自动打开后端 `/setup.html`，第①步填写 E3D 项目路径、主项目与 MDB；第③步统一设置后端监听地址、前端端口与兼容端口。
5. 点击「保存并重启」：配置写入 `backend/DbOption.toml` 并备份，校验并重载包内 nginx，自动重启后端。兼容端口填 `0` 可关闭；端口重复或已占用时会报错，不停止其他实例。
6. 完成初始化后可分别进入 plant-ui 和 plant3d-web。以后也可通过后端或前端的 `/setup.html` 修改配置；一体化模式不再从 `deploy.env` 读取端口。

访问地址：

- `http://localhost`：默认入口。
- `http://localhost:3100`：PowerPMS 兼容入口。
- `http://<服务器 IP>`：局域网入口。

运行 `stop.bat` 会按包内可执行文件路径停止 nginx、后端与包内 SurrealDB，包括向导重启后 PID 已变化的后端，不会按进程名误杀其他实例。

## 使用外部后端

运行 `config.bat`，将 backend mode 改为 `external`，再填写后端地址。外部后端必须提供 `/api`、`/api/v1` 和 `/files` 接口。此模式下 `start.bat` 不启动或停止后端。

## 数据持久化

默认以 `rocksdb`（external）模式启动，数据活过重启：`start.bat` 先确保 `DbOption.toml` 的 `v_ip:v_port` 上有可连的 SurrealDB——指向本机回环且未监听时自动用包内 `bin\surreal.exe` 起一台（数据落 `backend\.surreal\ams`），指向外机时只探测、由现场自己保证库在跑。包内 SurrealDB 必须是本仓 fork 的 2.1.x，不能用官方 3.x。

要临时回到内存库（库在进程里、重启即清空）：在 `config/deploy.env` 里写 `STORE_MODE=mem`，或不用 `deploy.env` 直接改 `start.bat` 顶部的默认值。现场数据目录不应覆盖在升级包内。

## 日志与排障

- 后端日志：`backend/logs/`
- nginx 日志：`nginx/logs/`
- 前后端版本：`release.json`
- 后端健康检查：`http://127.0.0.1:8022/api/v1/health`

端口默认使用 80、3100 和 8022。部署前应确认端口未占用并配置防火墙。
