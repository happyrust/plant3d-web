# 面板视觉基线 harness（visual-baseline）

针对单个面板组件的「mock 数据 + Vite + Playwright 实浏览器截图」视觉回归装置（GitHub #45）。
用于在 pencil-new 设计系统迁移过程中，对真实组件（真实 Tailwind token、真实交互）产出可对比的
基线截图，而不依赖后端。

> 注意：这里只覆盖**单面板级**基线。整 app 连后端的运行时基线不在本目录范围内（受阻待后端）。

## 目录结构

```
harness/
  vt.html          VersionTimelinePanel 的 harness 页面
  vt.shots.mjs     其截图场景（mock 路由 + 交互步骤）
  mvc.html         ModelVersionComparePanel 的 harness 页面
  mvc.shots.mjs    其截图场景
  README.md        本文档
src/harness/
  vt.ts            vt.html 的入口：挂载真实组件
  mvc.ts           mvc.html 的入口
scripts/visual-baseline/
  shot.mjs         通用 runner：起 Vite → 开 Chromium → 应用 mock → 截图
```

## 运行（无 npm script，直接 node 调用）

`package.json` 处于他人 WIP 状态，因此**不加 npm script**，一律从仓库根目录直调：

```bash
# VersionTimelinePanel
node scripts/visual-baseline/shot.mjs harness/vt.html --port 5190 --out scripts/pen-preview/out-vt

# ModelVersionComparePanel
node scripts/visual-baseline/shot.mjs harness/mvc.html --port 5190 --out scripts/pen-preview/out-mvc
```

runner 参数：

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `<harness-html>` | harness 页面路径（相对仓库根），必填 | — |
| `--port <n>` | Vite dev server 端口 | `5190` |
| `--out <dir>` | PNG 输出目录 | `scripts/visual-baseline/out-<name>` |
| `--viewport WxH` | 视口覆盖（如 `1280x800`） | 场景里的 `viewport`，否则 `900x900` |
| `--scenario <file>` | 场景模块路径 | `<harness-html>` 同名 `.shots.mjs` |

runner 会自己用项目的 `vite.config.ts` 起 dev server（不需要预先 `npm run dev`），
结束后自动关闭；截图目标是页面里的 `.panel-host` 元素（不存在则整页截图）。

## 端口约定：5190–5199

视觉基线 harness 固定占用 **5190–5199**，避开 3101（开发 dev server）与 E2E 端口。
同时只跑一个 runner 用 5190 即可；并行跑多个时在该区间内各分配一个端口。

## 为新面板加一套 harness（三步）

以新面板 `FooPanel` 为例，约定短名 `foo`：

### 1. harness 页面 + 入口

`harness/foo.html`（可复制 `vt.html` 改）：核心是一个 `.panel-host` 容器 + `#app` 挂载点，
`<script type="module" src="/src/harness/foo.ts"></script>`。
`.panel-host` 的宽高按面板真实使用尺寸设置，截图即截该容器。

`src/harness/foo.ts`：挂载**真实组件**（不要复刻一个假的），并引入 Tailwind token：

```ts
import { createApp } from 'vue';

import '@/assets/tailwind.css';
import FooPanel from '@/components/foo/FooPanel.vue';

createApp(FooPanel, { /* 需要的 props，如禁用跳转的开关 */ }).mount('#app');
```

组件若依赖 URL 参数（`location.search`），在场景的 `query` 里给（见下）。

### 2. 截图场景（mock 数据放这里）

`harness/foo.shots.mjs`，四个导出全部可选：

```js
export const query = 'project=Demo&dbnum=1';            // 拼到 harness 页 URL 上
export const viewport = { width: 900, height: 900 };    // 默认视口

export async function routes(page) {
  // Playwright 网络 mock：组件发什么请求就 mock 什么，数据写死在本文件
  await page.route('**/api/foo/list**', (r) => r.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { items: [/* 测试数据 */] } }),
  }));
}

export async function run({ page, shot, outDir }) {
  await page.waitForSelector('[data-testid="foo-row"]', { timeout: 15000 });
  await shot('01-list');                                  // -> <out>/01-list.png（默认截第一个 .panel-host）
  await page.locator('[data-testid="foo-expand"]').click();
  await page.waitForTimeout(500);
  await shot('02-expanded', '#host-b');                   // 指定选择器：多宿主页面按元素截
  await shot('03-region', null, { clip: { x: 0, y: 0, width: 800, height: 400 } }); // 整页裁剪区
}
```

要点：
- 用组件自带的 `data-testid` 等稳定选择器等待渲染完成，别只靠 `waitForTimeout`；
- mock 数据要覆盖你想回归的视觉状态（正常 / 降级 / 隔离等），一个状态一张图；
- 没有 `.shots.mjs` 时 runner 也能跑：纯渲染 + 单张截图，适合纯静态面板。

### 踩坑经验（#44 运行时证据实测）

- **VueQueryPlugin 依赖**：链路里用了 `@tanstack/vue-query` 的组件
  （如 `SpatialQueryDrawer`、`PipeDistanceDrawer`）裸 `createApp(...).mount()`
  会白屏（`No 'queryClient' found in Vue context`，且可能被吞成静默空渲染）。
  入口一律 `createApp(...).use(VueQueryPlugin).mount(...)`；对模块级单例 store
  的 seeding 若会触发 `useQuery`，放进带插件的组件 `setup` 里做（幂等一次）。
- **Playwright 路由是逆序匹配**：`page.route()` 后注册的先命中。场景里若同时有
  精确 endpoint mock 和 `/api/` catch-all，**catch-all 必须最先注册**，否则会把
  所有精确 mock 全吞掉。另外别用 `'**/api/**'` glob 做 catch-all——它连
  `/src/api/*.ts` 模块请求都会拦（MIME 报错），用
  `(url) => url.pathname.startsWith('/api/')` 谓词。

### 3. 出图

```bash
node scripts/visual-baseline/shot.mjs harness/foo.html --port 5190 --out scripts/pen-preview/out-foo
```

产出的 PNG（deviceScaleFactor=2）与 `ui/pencil-new.pen` 设计稿对照评审；
输出目录在 `scripts/*` 的 gitignore 范围内，截图默认不入库。

## 与旧文件的对应关系

原型阶段的 `vt-harness.html`、`mvc-harness.html`、`src/_vtHarness.ts`、`src/_mvcHarness.ts`、
`scripts/pen-preview/vt-shot.mjs`、`scripts/pen-preview/mvc-shot.mjs` 已由本目录 +
`scripts/visual-baseline/shot.mjs` 取代并删除。
