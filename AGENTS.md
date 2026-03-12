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
- 新增功能优先补 `src/` 下的 `*.test.ts`/`*.spec.ts`，避免把测试放到根目录散落脚本中

## 提交与 Pull Request 规范

- 提交信息建议遵循 Conventional Commits：`feat(scope): ...`、`fix(scope): ...`、`chore(scope): ...`（scope 示例：`mbd`、`review`、`ci`、`lint`、`dtx`）  
- PR 需写清楚“做了什么/为什么/如何验证”，涉及 UI 或 3D 交互请附截图或录屏  
- 合并前本地至少跑：`npm run type-check`、`npm run lint`、`npm test`；改动 E2E 相关时再跑 `npm run test:e2e`

## 配置与安全

- 环境变量参考 `.env.example`；不要提交包含密钥的 `.env.*` 文件  
- 不要提交构建产物（如 `dist/`、`coverage/`、`test-results/`），除非 PR 明确说明用途  
- 如需复现线上问题，请在 PR 描述中注明对应环境与复现步骤（URL、数据样例、浏览器版本）
