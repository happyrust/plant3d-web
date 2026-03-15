---
name: ui-worker
description: 实现 Vue 3 UI 组件和页面，基于设计稿和 API 契约
---

# UI Worker

NOTE: Startup and cleanup are handled by `mission-worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

用于实现前端 UI 组件和页面的 features：
- 基础 UI 组件（Button、Input、Card、Dialog 等）
- 业务页面组件（发起面板、任务列表、工作台等）
- API 集成和数据绑定
- 表单验证和交互逻辑

## Work Procedure

### 1. 理解需求和设计

- 阅读 feature description、preconditions、expectedBehavior
- 如果涉及设计稿，查看 `/Volumes/DPC/work/plant-code/plant3d-web/ui/三维校审/*.pen` 文件
- 如果涉及 API，查看 `src/api/reviewApi.ts` 和 `src/types/auth.ts`
- 理解现有代码结构和模式

### 2. 编写测试（TDD - Red）

**对于新 UI 组件和功能，在实现前先写测试**，测试应该失败（red）：

```bash
# 创建测试文件
touch src/components/ui/Button.test.ts
```

测试内容：
- 组件渲染测试
- Props 测试
- 事件测试
- 边界情况测试

运行测试确认失败：
```bash
npm test -- Button.test.ts
```

**例外情况**：对于以下类型的 features，可以跳过新增测试，直接使用现有测试验证：
- 纯 lint/语法修复（如 import 方式调整）
- 配置文件修改
- 修复已失败的基线测试（测试已存在）
- Feature 的 verificationSteps 明确只要求静态检查（type-check/lint）

### 3. 实现组件（TDD - Green）

实现最小化代码使测试通过：

- 使用 `<script setup lang="ts">` 语法
- 使用 Tailwind CSS utility classes
- 遵循设计系统（颜色、间距、圆角）
- 保持代码简洁，避免冗余

运行测试确认通过：
```bash
npm test -- Button.test.ts
```

### 4. 类型检查和代码规范

```bash
npm run type-check
npm run lint
```

修复所有错误和警告。

### 5. 手动验证

**对于有 UI 交互的 features**，启动开发服务器（如果未运行）：
```bash
npm run dev
```

在浏览器中验证：
- 打开 http://127.0.0.1:3101
- 测试所有交互和边界情况
- 检查控制台无错误
- 验证样式符合设计稿
- 如果涉及 API，检查 Network 面板

**例外情况**：对于纯后端逻辑、lint 修复、配置调整等无 UI 变化的 features，可以跳过浏览器验证

### 6. 记录验证结果

在 handoff 中详细记录：
- 运行的命令和结果
- 手动验证的步骤和观察结果
- 遇到的问题和解决方案

## Example Handoff

```json
{
  "salientSummary": "实现了 Button 组件，支持 3 种变体（primary/secondary/danger）、3 种尺寸、禁用和加载状态。运行 npm test 通过 8 个测试用例，手动验证了所有变体和状态的视觉效果。",
  "whatWasImplemented": "创建 src/components/ui/Button.vue 组件，支持 variant（primary/secondary/danger）、size（sm/md/lg）、disabled、loading 属性。使用 Tailwind CSS 实现样式，primary 变体使用橙色 #FF6B00。创建 Button.test.ts 包含 8 个测试用例覆盖所有 props 组合。",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "npm test -- Button.test.ts",
        "exitCode": 0,
        "observation": "8 个测试用例全部通过，覆盖不同 variant、size、disabled、loading 状态"
      },
      {
        "command": "npm run type-check",
        "exitCode": 0,
        "observation": "无类型错误"
      },
      {
        "command": "npm run lint",
        "exitCode": 0,
        "observation": "无 lint 错误"
      }
    ],
    "interactiveChecks": [
      {
        "action": "打开 http://127.0.0.1:3101/test-button，验证 primary 变体",
        "observed": "按钮显示橙色背景 #FF6B00，白色文字，鼠标悬停时透明度降低，点击有按下效果"
      },
      {
        "action": "验证 loading 状态",
        "observed": "按钮显示加载图标，禁用点击，文字隐藏"
      },
      {
        "action": "验证 disabled 状态",
        "observed": "按钮灰色背景，鼠标指针为 not-allowed，无法点击"
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "src/components/ui/Button.test.ts",
        "cases": [
          { "name": "renders with default props", "verifies": "组件正常渲染" },
          { "name": "renders primary variant", "verifies": "primary 变体样式正确" },
          { "name": "renders secondary variant", "verifies": "secondary 变体样式正确" },
          { "name": "renders danger variant", "verifies": "danger 变体样式正确" },
          { "name": "renders different sizes", "verifies": "不同尺寸样式正确" },
          { "name": "disabled state", "verifies": "禁用状态正确" },
          { "name": "loading state", "verifies": "加载状态正确" },
          { "name": "emits click event", "verifies": "点击事件正确触发" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

除了标准情况外，以下情况返回 orchestrator：

- 设计稿不清晰或缺失关键信息
- API 契约与实际后端不一致
- 依赖的组件或 composable 不存在
- 后端 API 不可用且无法 mock
- 需要修改 API 契约（超出前端范围）
