# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Plant3D-Web 是一个基于 Vue 3 + TypeScript + Vuetify + Three.js 的 3D 工厂可视化 Web 应用，用于工业设备模型的查看、标注、审查和管理。

## 核心技术栈

- **前端框架**: Vue 3 (Composition API) + TypeScript
- **UI 库**: Vuetify 3 + Tailwind CSS + dockview-vue (面板布局)
- **3D 渲染**: Three.js + troika-three-text (3D 文本)
- **数据处理**: Apache Arrow + Parquet + DuckDB WASM
- **状态管理**: Composables (useXxx 模式) + TanStack Query
- **测试**: Vitest (单元/集成) + Playwright (E2E)
- **构建工具**: Vite

## 常用开发命令

```bash
# 安装依赖
npm install              # 或 pnpm install (更快)

# 开发
npm run dev              # 启动开发服务器 (http://localhost:3101)

# 构建
npm run build            # 类型检查 + 生产构建
npm run preview          # 预览生产构建

# 代码质量
npm run lint             # ESLint 检查并自动修复
npm run type-check       # TypeScript 类型检查

# 测试
npm test                 # 运行所有单元测试 (一次性)
npm run test:watch       # 监听模式运行测试
npm run test:coverage    # 生成覆盖率报告
npm run test:e2e         # 运行 Playwright E2E 测试
npm run test:e2e:ui      # Playwright UI 模式
npm run test:e2e:headed  # 有头模式运行 E2E

# 性能测试
npm run perf:frustum-culling        # 视锥剔除性能测试
npm run perf:frustum-culling:scale  # 扩展性测试
npm run perf:frustum-culling:ui     # 可视化性能测试

# 验证脚本
npm run verify:dashboard            # 验证 dashboard/workbench 功能
```

## 项目架构

### 目录结构

```
src/
├── main.ts                 # 应用入口，注册全局组件和插件
├── App.vue                 # 根组件，包含 DockLayout
├── components/             # Vue 组件
│   ├── dock_panels/       # Dock 面板组件 (ViewerPanel, ModelTreePanel 等)
│   ├── review/            # 审查流程相关组件
│   ├── task/              # 任务管理组件
│   ├── tools/             # 工具面板 (测量、标注等)
│   ├── model-tree/        # 模型树组件
│   ├── dashboard/         # 仪表板组件
│   └── ...
├── composables/           # 组合式函数 (useXxx)
│   ├── useDbnoInstancesParquetLoader.ts  # Parquet 数据加载
│   ├── useDashboardWorkbench.ts          # Dashboard/Workbench 逻辑
│   ├── useAnnotationStyleStore.ts        # 标注样式状态
│   ├── useDimensionAnnotation.ts         # 尺寸标注逻辑
│   └── mbd/                              # MBD (Model-Based Definition) 相关
├── viewer/                # 3D 渲染相关
│   └── dtx/              # DTX (设计任务) 相关渲染逻辑
├── utils/                 # 通用工具函数
├── types/                 # TypeScript 类型定义
├── api/                   # API 调用封装
├── assets/                # 样式和静态资源
│   ├── tailwind.css
│   └── main.scss
└── plugins/               # Vue 插件配置
    └── vuetify.ts

docs/                      # 文档
├── notes/                # 技术笔记
├── plans/                # 实现计划
└── verification/         # 验证文档

e2e/                      # Playwright E2E 测试
scripts/                  # 构建和验证脚本
```

### 核心架构模式

1. **Dock 面板系统**: 使用 `dockview-vue` 实现可拖拽的面板布局，所有面板组件在 `main.ts` 中全局注册
2. **Composables 模式**: 业务逻辑封装在 `useXxx` composables 中，支持状态共享和逻辑复用
3. **数据加载**: 支持多种格式 (Parquet, JSON, Arrow)，通过 composables 统一管理
4. **3D 渲染**: Three.js 场景管理，支持模型加载、标注、测量、空间查询等功能
5. **审查工作流**: 完整的设计审查流程 (发起 → 审查 → 返工 → 重新提交)

## 关键配置文件

- `vite.config.ts`: Vite 配置，包含开发代理 (`/api`, `/files` 代理到后端 `localhost:3100`)
- `tsconfig*.json`: TypeScript 配置，使用 `vue-tsc` 进行类型检查
- `tailwind.config.ts` + `postcss.config.cjs`: Tailwind CSS 配置
- `eslint.config.js`: ESLint 规则，强制导入顺序和代码风格
- `.env.example`: 环境变量模板 (SurrealDB 连接配置)
- `playwright.config.ts`: E2E 测试配置

## 编码规范

- **缩进**: 2 空格
- **引号**: 单引号
- **分号**: 必须使用
- **导入顺序**: 由 ESLint 自动管理
- **路径别名**: `@/*` → `src/*`
- **组件命名**: PascalCase (如 `ModelTreePanel.vue`)
- **Composables**: `useXxx.ts` 格式

## 测试策略

- **单元/集成测试**: Vitest + happy-dom，测试文件匹配 `src/**/*.{test,spec}.{js,ts}`
- **E2E 测试**: Playwright，测试文件在 `e2e/**/*.spec.ts`
- **优先使用 CLI + 真实数据验证**，而非为一次性验证编写测试
- 只在 CLI 无法覆盖关键逻辑时才补充最小测试

## 提交规范

遵循 Conventional Commits:
- `feat(scope): ...` - 新功能
- `fix(scope): ...` - Bug 修复
- `chore(scope): ...` - 杂项更新
- 常用 scope: `mbd`, `review`, `ci`, `lint`, `dtx`, `viewer`, `ui`

## 环境配置

后端服务默认运行在 `localhost:3100`，前端开发服务器在 `localhost:3101`。

环境变量 (参考 `.env.example`):
- `VITE_SURREAL_URL`: SurrealDB WebSocket URL
- `VITE_SURREAL_NS`: 命名空间
- `VITE_SURREAL_DB`: 数据库名
- `VITE_SURREAL_USER` / `VITE_SURREAL_PASS`: 认证信息
- `VITE_BACKEND_PORT`: 后端端口 (默认 3100)

## 重要注意事项

1. **不要提交构建产物**: `dist/`, `coverage/`, `test-results/` 已在 `.gitignore`
2. **不要提交敏感信息**: `.env.*` 文件不应包含真实密钥
3. **合并前检查**: 至少运行 `npm run type-check` + `npm run lint` + `npm test`
4. **/files 路径**: 始终代理到后端，不使用本地 `public/files`
5. **Parquet/WASM**: `parquet-wasm` 已配置为外部依赖，需要特殊处理

## 文档资源

- 技术笔记索引: `docs/notes/README.md`
- SolveSpace 3D 尺寸数据流: `docs/notes/solvespace-dimension-dataflow.md`
- 实现计划: `docs/plans/`
- LLM 文档索引: `llmdoc/index.md`

## Business Context

<!-- Fill in your business details. The AI CEO reads this at every session. -->

- **Product:** [What you're building — 1 sentence]
- **Stage:** [idea | building | launched | growing]
- **Revenue:** [$0 | $X MRR | $X ARR]
- **Users:** [count or "pre-launch"]
- **Target audience:** [Who buys this]
- **Business model:** [SaaS | e-commerce | marketplace | freemium | ads | other]
- **Goal (90 days):** [What success looks like]
- **Biggest challenge:** [The #1 thing blocking progress]
- **Tech stack:** [Languages, frameworks, infra]
- **Deploy:** [How you ship — Vercel, AWS, Railway, etc.]
