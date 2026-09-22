# 查看器浮层被容器裁掉——空间查询抽屉 / 构件最近点测量抽屉 真机验收（2026-09-22）

对应 CHANGELOG「空间查询抽屉下半截不再被查看器容器裁掉…」条目；GitHub issue [#80](https://github.com/happyrust/plant3d-web/issues/80)。本目录同一份内容也推在证据分支 `evidence/viewer-overlay-container-clip-2026-09-22`（`5e83ef02`），issue 里的图链到那里。

## 根因一句话

`SpatialQueryDrawer.vue` 根节点 `absolute top-24 max-h-[82vh]`：`82vh` 按**浏览器视口**算，但面板挂在 `.viewer-panel-container`（`position: relative; height: 100%; overflow: hidden`）里，容器上有 Ribbon、下有控制台，比视口矮一大截。`top 96px + 82vh` 超出容器的那一截被 `overflow: hidden` 裁掉——内部滚动条按完整面板高算、`scrollTop` 已到底，最后几行却画在容器外面，看不见也点不到。`ObjectMeasureDrawer.vue`（`top-[120px]`）连 `max-h` 都没有、正文也不滚，矮容器里「重置选择 / 结束测量」两颗按钮直接掉出容器。

## 改法

| 文件 | 改前 | 改后 |
| --- | --- | --- |
| `src/components/spatial-query/SpatialQueryDrawer.vue` | `max-h-[82vh]` | `max-h-[calc(100%-7.5rem)]`（7.5rem = `top-24` 6rem + 1.5rem 底边距） |
| `src/components/tools/ObjectMeasureDrawer.vue` | 无 `max-h`，正文 `flex flex-col gap-3 px-4 py-4` | `max-h-[calc(100%-9rem)]`（9rem = `top-[120px]` 7.5rem + 1.5rem）+ 正文 `min-h-0 flex-1 overflow-y-auto` |

绝对定位元素的百分比 `max-height` 相对**包含块**（查看器容器）解析，面板仍按内容长高，只是上限改成「容器高 − 上下留白」，短内容时外观不变。

## 1. Playwright headless（1366×768 / 1280×1000，同页同视口回灌 82vh 对比）

范围查询 · 手输坐标 · 半径 3 m · 展开结果（`AvevaMarineSample` / `24381_145018`，dev `:3111` + gen-model `:8027`）。

| 视口 | 容器底 | 82vh 面板底 | 超出 | calc 面板底 | 滚到底最后一行 `elementFromPoint` |
| --- | --- | --- | --- | --- | --- |
| 1366×768 | 581 | 809 | **+228** | 557 | 82vh ✗ / calc ✓ |
| 1280×1000 | 810 | 999 | **+189** | 786 | 82vh ✗ / calc ✓ |

图：`spatial-01-before-82vh-1366x768.png`、`spatial-02-after-calc-1366x768.png`、`spatial-03-before-82vh-1280x1000.png`、`spatial-04-after-calc-1280x1000.png`。`pageerror` 0。

## 2. cua-driver 真机操作（Chrome 152，2560×1440 @1.5x，CSS 视口 1692×826，容器 83→499 = 416 px 高）

浏览器由 cua-driver `browser_prepare` 拉起（隔离 profile），点击 / 滚轮 / 截图全部走 cua-driver（背景 UIA Invoke 像素点击开菜单与抽屉；滚轮与「真点」用 `delivery_mode: foreground` 的 SendInput，即真实鼠标事件落在屏幕坐标上）；导航与几何读数用 CDP（`getBoundingClientRect`），不参与操作。「改前」是把文件临时 `git checkout` 回 HEAD 让 Vite HMR 热替换，同一页面同一容器对比。

### 2.1 构件最近点测量抽屉（`ObjectMeasureDrawer`）

| | 面板 top→bottom | 高 | 相对容器底 | 正文 | 「结束测量」 |
| --- | --- | --- | --- | --- | --- |
| 改前（无 max-h） | 203→654 | 451 | **超出 155 px** | 不滚 | 按钮底 637 > 容器底 499，`elementFromPoint` 命不中；**真点其屏幕位置 → 落在控制台，抽屉不关** |
| 改后 `calc(100%-9rem)` | 203→475 | 272 | 内缩 24 px | `clientHeight 204 / scrollHeight 383`，可滚 | 滚到底后按钮底 458 < 499；**真点 → 抽屉关闭、测量模式退出** |

图：`cua-object-measure-01-before-clipped.png`（改前，抽屉撞进容器底边，状态行与两颗按钮不见）、`cua-object-measure-02-after-scrolled-buttons.png`（改后滚到底，「重置选择 / 结束测量」完整在容器内）、`cua-object-measure-03-after-end-click-closed.png`（真点「结束测量」后抽屉已关）。

### 2.2 空间查询抽屉（`SpatialQueryDrawer`）

URL 直开：`spatial_refno=24381_145018&spatial_radius=3&spatial_radius_unit=m&spatial_autorun=1`（距离查询，3958 项），再点「查看结果」展开房间列表。

| | 面板 top→bottom | 高 | 相对容器底 | 最后可见行 |
| --- | --- | --- | --- | --- |
| 改前 82vh | 179→856 | 677 | **超出 357 px** | `elementFromPoint` 命不中 |
| 改后 `calc(100%-7.5rem)` | 179→475 | 296 | 内缩 24 px | 底部房间行「/1RX-RM07-R710」的「显示」**真点生效**：控制台 `[vis][event] showModelByRefnos refno=24381_36363` → `[model-load] … loaded_refnos=19`，三维出现该 FRMW、模型树定位到 `FRMW 1RX-RM07-R710` |

图：`cua-spatial-05-before-82vh-hmr.png`（改前）、`cua-spatial-06-after-open.png`（改后刚打开，有滚动条、圆角底边在容器内）、`cua-spatial-07-after-results-scrolled.png`（展开结果滚到房间列表底部）、`cua-spatial-08-after-bottom-row-click-loaded.png`（真点底部行「显示」后加载成功）。

### 2.3 顺手发现（本轮未改）

`cua-related-measure-menu-clipped.png`：左侧竖排工具栏（`top-1/2` 居中）的「测量」下拉菜单在 416 px 高的容器里同样被容器底边裁掉最后两项（「管-墙/柱」「管-管」只露半行）。同一根因（绝对定位子元素超出 `overflow: hidden` 的容器），菜单需要的是「向上翻 / 限高滚动」而非本轮的 `max-h` 方案，另开处理。

## 3. 单测 / lint

`npx vitest run src/components/spatial-query/SpatialQueryDrawer.test.ts src/composables/useDtxTools.objectMeasure.test.ts` → 2 文件 43 过；`npx eslint` 两个 `.vue` 0 问题；tailwindcss CLI 探针确认产出 `max-height: calc(100% - 7.5rem)` / `calc(100% - 9rem)`。

## 备注

- cua-driver 0.20.0 在本机的两个坑：`get_window_state` 落盘 PNG 为 1568 宽（`max_image_dimension`），像素点击的 x/y 用这张图的坐标系；`scroll` 的 x/y 却按物理窗口像素解释。隔离浏览器约 10 分钟后会随隐式会话结束被回收，验收分两次拉起完成。
- 未做：全量 `type-check`（只改 class 字串 / 容器 class，不涉及类型）；`wiki/**/raw/sources` 下的镜像未动。
