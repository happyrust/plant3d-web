# Environment

环境变量、外部依赖和设置说明。

**What belongs here:** 必需的环境变量、外部 API 密钥/服务、依赖特性、平台特定说明。
**What does NOT belong here:** 服务端口/命令（使用 `.factory/services.yaml`）。

---

## 开发环境

- Node.js 18+
- npm 或 pnpm
- 现代浏览器（Chrome/Firefox/Safari 最新版本）

## 后端依赖

- 后端 API: http://127.0.0.1:3100
- WebSocket: ws://127.0.0.1:3100/ws/review
- 注意：后端必须运行才能完整测试功能

## 环境变量

项目使用 Vite 环境变量，参考 `.env.example`（如果存在）。

当前不需要额外的环境变量配置。

## Lint 命令说明

`package.json` 中的 `npm run lint` 脚本硬编码为 `eslint . --fix`，会扫描整个仓库。

- `npm run lint -- <files>` 仍会运行全仓库 lint（参数被忽略）
- 如需仅检查特定文件，使用：`npx eslint <files>`
