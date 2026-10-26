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

默认拒绝 dirty 后端出包：联动构建时先查 `../gen-model` 工作区是否干净（只看已跟踪文件），复用现成包 / `--backend-package` 时在整合前看包内 `release.json` 的 `backend_git_dirty`；联调确需如此时加 `--allow-dirty`，产物会在 `release.json` 里保留 dirty 标记。前端已跟踪文件有未提交改动时不会阻断，但会在 `release.json` 的 `frontend.dirty` 记录（未跟踪文件不计）。

输出位置：`../gen-model/releases/plant3d-web-offline-v<前端版本>-backend-v<后端版本>-<date>.zip`。默认拒绝覆盖同名发布物，确需覆盖时添加 `--force`。打包时同步生成同名 `.sha256` 校验文件；整合后的 `backend/release.json` 会按最终磁盘内容重建并自检，打 zip 前还会检查最终包布局与前后端版本一致性，清单里出现缺失文件或哈希不符会直接中止出包。

## 可执行升级补丁

可由两个一体化 ZIP 生成一个自带差异文件的 EXE，目标为 .NET Framework 4.5 / Windows x64；运行补丁不需要安装 Node.js 或 Rust，服务启停仍使用包内兼容 PowerShell 脚本。

```powershell
npm run build:offline:patch -- -SourceZip "旧版.zip" -TargetZip "新版.zip" -Output "升级补丁.exe"
```

构建机需有 .NET Framework C# 编译器。输出 EXE 与 `.sha256` 校验文件已存在时拒绝覆盖。

也可以用补丁生成器直接从两个解压目录出包（无需先打 ZIP）。`plant3d-web-patch-maker.exe` 双击打开图形界面，选择旧版目录（现场基线）、新版目录和输出路径即可；命令行：

```text
plant3d-web-patch-maker.exe --source 旧版目录 --target 新版目录 [--output 补丁.exe] [--force]
```

省略 `--output` 时只对比差异不产出。两侧目录里的现场配置/数据（`DbOption.toml`、`deploy.env`、数据库、日志、`.patch-backups` 等）按保护规则自动排除；白名单外路径出现差异时拒绝打包。生成补丁需要本机 .NET Framework 4.x 自带的 `csc.exe`。规则清单与补丁运行器共用 `scripts/OfflinePatchRules.cs`，单点维护。

双击补丁后选择旧包解压后的实际安装目录，不是 ZIP 文件或 ZIP 所在目录。可先点「只检查」；基线发布文件被手工修改时会拒绝覆盖。`backend/DbOption.toml`、`config/deploy.env`、初始化标记、Web 配置、数据库、workspace、assets 和日志等现场内容不纳入替换。

「完成后启动服务」默认不勾选。应用前会停止所选目录内的 nginx 和后端，mem 模式状态不持久化；勾选自动启动时会提前检查端口及占用 PID，不会停止其它目录的实例。备份位于安装目录的 `.patch-backups`，失败会尝试恢复本次已修改的文件；也可使用同一个补丁的「恢复备份」入口。恢复失败时应保留备份和日志，不要手工清理。

补丁尚未做代码签名；部署策略要求签名时，应使用正式证书签署后发布。补丁及其随包原生程序仍需在目标 Server 2012 R2 环境验收。

## Windows Server 2012 R2 脚本兼容

运行脚本按 Windows PowerShell 4.0 / .NET Framework 4.5 编写，不依赖系统自带 `curl`。包内 `.ps1` 使用 UTF-8 BOM，避免中文系统按 ANSI 读取导致 `MissingCatchOrFinally` 等解析错误；不要用会移除 BOM 的编辑器重存脚本。

一体化启动在后端启动命令和独立 HTTP 健康检查均通过后才启动 nginx。脚本兼容检查不等于已完成旧系统原生 EXE 兼容验收；`aios-database.exe`、`surreal.exe`、nginx 与所需 VC++ 运行库仍需在目标系统实测。

## 启动

1. 解压 ZIP。
2. 运行 `start.bat`；默认 `BACKEND_MODE=integrated`，介质出厂为 `rocksdb`（external，写在 `backend/DbOption.toml` 的 `store_mode`），无需先运行 `config.bat`。
3. 脚本读取 `backend/DbOption.toml`，同步 nginx 配置；external 档先检查 `v_ip:v_port` 上的服务版本是 SurrealDB 2.x 才放行，再启动后端与 nginx。
4. 首次启动自动打开后端 `/setup.html`，第①步填写 E3D 项目路径、主项目与 MDB；第②步可选存储介质（外部库 external / 内存库 memory，默认 external）；第③步统一设置后端监听地址、前端端口与兼容端口。
5. 点击「保存并重启」：配置写入 `backend/DbOption.toml` 并备份，校验并重载包内 nginx，自动重启后端。兼容端口填 `0` 可关闭；端口重复或已占用时会报错，不停止其他实例。
6. 完成初始化后可分别进入 plant-ui 和 plant3d-web。以后也可通过后端或前端的 `/setup.html` 修改配置；一体化模式不再从 `deploy.env` 读取端口。

访问地址：

- `http://localhost`：默认入口。
- `http://localhost:3100`：PowerPMS 兼容入口。
- `http://<服务器 IP>`：局域网入口。

运行 `stop.bat` 会按包内可执行文件路径停止 nginx、后端，并按 `backend\surreal-process.json` 停掉由本包拉起的 SurrealDB（现场自管的库不动）；包括向导重启后 PID 已变化的后端，不会按进程名误杀其他实例。

## 使用外部后端

运行 `config.bat`，将 backend mode 改为 `external`，再填写后端地址。外部后端必须提供 `/api`、`/api/v1` 和 `/files` 接口。此模式下 `start.bat` 不启动或停止后端。

## 数据持久化

介质分两档，分层裁决：`config/deploy.env` 的 `STORE_MODE`（运维 pin）> `backend/DbOption.toml` 的 `store_mode`（向导第②步持久化的选择）> 默认 `rocksdb`。

- **外部库 external（`rocksdb`，出厂默认）**：数据活过重启。`start.bat` 先检查 `v_ip:v_port` 上是否有可连的 SurrealDB——对已监听的服务只做版本检查（`/version` 主版本须为 2，即本仓 fork 2.1.x；官方 3.x 拒绝），版本 OK 即放行，不强求是哪个路径下的 exe。指向本机回环且未监听时，脚本找自报 2.x 的 `surreal.exe`（`--with-surreal` 变体的 `bin\surreal.exe` 或 PATH）自动起一台，数据落 `backend\.surreal\ams`；找不到则报错，需现场先起库或把 `v_ip:v_port` 指向已在跑的实例。指向外机时只探测、由现场自己保证库在跑。
- **内存库 memory（`mem`，嵌入进程）**：库在后端进程里，重启即清空。向导第②步选它即写入 `store_mode`；或在 `deploy.env` 里写 `STORE_MODE=mem` 作运维 pin。mem 档不需要 SurrealDB，地址两格不用填。

包默认不含 SurrealDB 二进制。现场数据目录不应覆盖在升级包内。

## 日志与排障

- 后端日志：`backend/logs/`
- nginx 日志：`nginx/logs/`
- 前后端版本：`release.json`
- 后端健康检查：`http://127.0.0.1:8022/api/v1/health`

端口默认使用 80、3100 和 8022。部署前应确认端口未占用并配置防火墙。
