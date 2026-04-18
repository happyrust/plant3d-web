# Repository Guidelines

## 项目结构与模块组织

- `src/`：主要业务代码（Vue 3 + TypeScript），入口 `src/main.ts`，根组件 `src/App.vue`  
- `src/components/`：页面与面板组件；`src/composables/`：组合式逻辑（以 `useXxx` 命名）  
- `src/utils/`、`src/viewer/`：通用工具与 3D/渲染相关逻辑；`src/assets/`：样式与静态资源（含 Tailwind）  
- `public/`：构建时原样拷贝的静态文件；`scripts/`：本地脚本；`docs/`：说明与工作文档  
- `e2e/`：Playwright 端到端测试；构建产物输出到 `dist/`

## 构建、测试与本地开发命令

建议使用 Node.js 20+；包管理器可用 `pnpm` 或 `npm`（CI 使用 `npm ci`）。

- `npm install`：安装依赖  
- （可选）`pnpm install`：本地更快的安装方式；尽量避免同时改动 `pnpm-lock.yaml` 与 `package-lock.json`，除非有明确原因（推荐做法）  
- `npm run dev`：启动 Vite 开发服务器（HMR）  
- `npm run build`：先 `type-check` 再 `vite build` 产出 `dist/`  
- `npm run preview`：本地预览生产构建  
- `npm run lint`：运行 ESLint 并自动修复可修复问题  
- `npm run type-check`：仅做类型检查（不产出文件）  
- `npm test` / `npm run test:watch`：运行 Vitest（一次性/监听）  
- `npm run test:e2e`：运行 Playwright（默认使用 `http://127.0.0.1:3101` 的 `webServer` 配置）

## 关键配置文件

- `vite.config.ts`：开发代理、构建与别名等配置  
- `tsconfig*.json`：TypeScript 工程配置（含 `vue-tsc` 类型检查）  
- `tailwind.config.ts`、`postcss.config.cjs`：样式与构建管线  
- `eslint.config.js`：代码规范与导入顺序规则（建议提交前执行 `npm run lint`）

## 编码风格与命名约定

- 缩进 2 空格；单引号；必须分号（由 `eslint.config.js` 强制）  
- 导入顺序使用 ESLint 规则自动约束；路径别名 `@/*` → `src/*`  
- Vue 组件文件用 PascalCase（如 `ModelTreePanel.vue`）；composable 用 `useXxx.ts`  

## 测试指南

- 单元/集成：Vitest（`happy-dom`），匹配 `src/**/*.{test,spec}.{js,ts}`  
- E2E：Playwright，测试文件放在 `e2e/**/*.spec.ts`  
- 默认优先使用 CLI + 真实命令 + 真实/样例数据做验证，尤其是跨仓联调、接口契约和 dashboard/workbench 这类功能；验证结果应记录具体命令、输入数据与返回结果
- 非必要不要为一次性联调验证新增独立 `*.test.ts` / `*.spec.ts` / Rust `#[cfg(test)]` 测试；只有当 CLI 验证无法覆盖关键逻辑，且已先沟通确认时，才补最小测试

## 提交与 Pull Request 规范

- 提交信息建议遵循 Conventional Commits：`feat(scope): ...`、`fix(scope): ...`、`chore(scope): ...`（scope 示例：`mbd`、`review`、`ci`、`lint`、`dtx`）  
- PR 需写清楚“做了什么/为什么/如何验证”，涉及 UI 或 3D 交互请附截图或录屏  
- 合并前本地至少跑：`npm run type-check`、`npm run lint`、`npm test`；改动 E2E 相关时再跑 `npm run test:e2e`

## 配置与安全

- 环境变量参考 `.env.example`；不要提交包含密钥的 `.env.*` 文件  
- 不要提交构建产物（如 `dist/`、`coverage/`、`test-results/`），除非 PR 明确说明用途  
- 如需复现线上问题，请在 PR 描述中注明对应环境与复现步骤（URL、数据样例、浏览器版本）

## PowerPMS 联调 / 自动化测试账号（内部）

用于 `http://pms.powerpms.net:1801/sysin.html` 登录及 `npm run test:pms:cdp` / `test:e2e:pms`：

- **用户名（大写简写）**：`SJ`、`JH`、`SH`、`PZ`（多角色可用 `PMS_E2E_ROLES=SJ,JH,SH,PZ`）
- **密码**：`Admin@1234`（联调环境；变更后请同步团队并更新本地 `PMS_E2E_PASSWORD`）

自动化示例：`export PMS_E2E_PASSWORD='Admin@1234'`；勿将含密码的命令写入公开 PR 描述。

发起编校审 CDP/E2E 默认注入测试 BRAN **`24381_145018`**（与 PMS 数据界面 RefNo 一致，便于核对同步）；覆盖方式：`PMS_TARGET_BRAN_REFNO=…`。

**端到端（PMS 入口 → 编校审 → PMS 可见 → JH 校核）**：`npm run test:pms:cdp:extended`（需 `PMS_E2E_PASSWORD`、`PMS_EMBEDDED_SITE_SUBSTRING`）。脚本顺序为 SJ 全流程发起编校审 → 回到「三维校审单」等待列表出现包名 → `clearCookies` 后以 **`PMS_CHECKER_USERNAME`（默认 `JH`）** 登录 → 尝试双击含包名行打开三维 → 在 plant3d 校核区点击「提交…」主按钮。可选：`PMS_MOCK_PACKAGE_NAME`（固定包名便于人工核对）、`PMS_INITIATE_CHECKER_SUBSTRING`（校核下拉按文案匹配，extended 未设时与 `JH` 同步）。详见 `docs/verification/pms-3d-review-integration-e2e.md`。

**用本机 Chrome + DevTools（CDP 附加，便于看 Network/断点）**：终端 1 执行 `chmod +x scripts/launch-chrome-cdp.sh && ./scripts/launch-chrome-cdp.sh`；终端 2 在设好 `PMS_E2E_PASSWORD`、`PMS_EMBEDDED_SITE_SUBSTRING` 后运行 `npm run test:pms:cdp:attach:full` 或 `test:pms:cdp:attach:extended`（已内置 `CHROME_CDP_URL=http://127.0.0.1:9222`）。非默认端口时用 `CHROME_DEBUG_PORT=9333` 启动 Chrome，并对 npm 命令设置 `CHROME_CDP_URL=http://127.0.0.1:9333`。

**PMS 数据接口可见性（默认开）**：`test:pms:cdp:full` 在 plant3d「编校审单创建成功」后，会再次进入「三维校审单」并监听 **PMS 域名** 上 `xhr`/`fetch` 的 **JSON** 响应，确认其中出现本次 **编校审包名** 或 **测试 BRAN**（`24381_145018` 及斜杠形式）。不需要时用 `PMS_CDP_VERIFY_PMS_API=0` 关闭；列表接口路径固定时可设 `PMS_API_URL_SUBSTRING` 缩小匹配范围。
