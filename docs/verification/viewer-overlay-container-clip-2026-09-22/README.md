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

### 2.3 顺手发现 → issue #81（同日修）

`cua-related-measure-menu-clipped.png`：左侧竖排工具栏（`top-1/2` 居中）的「测量」下拉菜单在 416 px 高的容器里同样被容器底边裁掉最后两项（「管-墙/柱」「管-管」只露半行）。同一根因（绝对定位子元素超出 `overflow: hidden` 的容器），但菜单挂在按钮的 `.relative` 包裹里，百分比 `max-h` 对它无效，改成按剩余空间落位——见 §2.4。

### 2.4 「测量」下拉菜单按剩余空间向上翻（issue [#81](https://github.com/happyrust/plant3d-web/issues/81)）

改法：新增纯函数 `src/utils/dropdownPlacement.ts` `resolveDropdownPlacement`（下方放得下向下开；否则上方放得下向上翻；两头都放不下选空间大的一侧限高滚动），`ViewerPanel.vue` 打开菜单时先按缺省渲染一帧量自然高度，`nextTick` 后按容器 / 按钮 `getBoundingClientRect` 落位，`top-0` ↔ `bottom-0` 切换、限高进 `:style`，菜单项加 `shrink-0`。

同一容器（83→499）、同一按钮（330→366）、菜单自然高 217 px：

| | 菜单 top→bottom | 落位 | 在容器内 | 「管-管」 |
| --- | --- | --- | --- | --- |
| 改前 `top-0` | 330→547 | 向下 | ✗ 超出 48 px，末两项被裁 | 只露半行，点不到 |
| 改后 | 149→366 | `bottom-0` 向上翻，不限高 | ✓ | 7 项 `elementFromPoint` 全命中；**真点「管-管」→ 进入「管-管 最近点测量」向导** |

图：`cua-menu-01-after-flip-up.png`（菜单向上翻、7 项全在容器内）、`cua-menu-02-after-pipe-to-pipe-click.png`（真点「管-管」后向导与底部提示条出现）。单测 `src/utils/dropdownPlacement.test.ts` 6 例（向下 / 翻上 / 边界差 1 px / 两头放不下限高两侧 / margin 与负空间钳位 / 缺省值）。

顺手看到：`MeasurementWizard` 的向导卡在 825 px 宽的容器里左边被裁一截 → issue #82，见 §2.5。

### 2.5 `MeasurementWizard` 向导卡左半张被裁（issue [#82](https://github.com/happyrust/plant3d-web/issues/82)）

不是容器窄的问题，任何宽度都裁：组件 scoped CSS 是 `left: 50%; transform: translateX(-50%)`（居中），宿主 `ViewerPanel` 用内联 `style="left: 12px"` 把它改到左上角，却没覆盖 `transform`，于是卡向左平移了自身一半；又没有 `max-width`，「管-管」那句 70 字的 statusText 把卡撑到 650–750 px，左半张画在容器外面被 `overflow: hidden` 裁掉，同时压住左侧工具栏顶上的按钮。

改法：位置只在组件里定——`top: 12px; left: 12px; right: 12px; width: fit-content; margin: 0 auto`（顶部居中，永远在容器里），`min-width: min(300px, 100%)`、`max-width: 480px`（再宽压到右上角导航立方）、正文 `overflow-wrap: anywhere`，`z-index: 940` 与其他浮层同层；宿主删掉内联 position / top / left / z-index。

Playwright headless（dev `:3111` + `:8027`，工具栏「测量」→「管-管」，改前用内联样式回灌 `left: 12px + translateX(-50%)`、无 max-width，同页同容器）：

| 视口 → 容器 | 改前 卡 left→right（宽） | 左边被裁 | 改后 卡 left→right（宽） | 居中偏差 | 文字行数 |
| --- | --- | --- | --- | --- | --- |
| 1366×768 → 350→1016（666） | 35→689（654） | **315 px** | 443→923（480） | 0 | 2 |
| 1024×700 → 350→674（324） | 206→518（312） | **144 px** | 362→662（300） | 0 | 3 |

`pageerror` 0；「取消测量」两种状态都可命中（它在卡的右侧，裁的是左半张的标题与正文开头）。图：`wizard-01-before-1366x768.png` / `wizard-02-after-1366x768.png`、`wizard-01-before-1024x700.png` / `wizard-02-after-1024x700.png`。cua 那张 `cua-menu-02-after-pipe-to-pipe-click.png` 左上角就是改前的样子（825 px 容器）。

## 3. 单测 / lint

`npx vitest run src/components/spatial-query/SpatialQueryDrawer.test.ts src/composables/useDtxTools.objectMeasure.test.ts` → 2 文件 43 过；`npx eslint` 两个 `.vue` 0 问题；tailwindcss CLI 探针确认产出 `max-height: calc(100% - 7.5rem)` / `calc(100% - 9rem)`。

## 备注

- cua-driver 0.20.0 在本机的两个坑：`get_window_state` 落盘 PNG 为 1568 宽（`max_image_dimension`），像素点击的 x/y 用这张图的坐标系；`scroll` 的 x/y 却按物理窗口像素解释。隔离浏览器约 10 分钟后会随隐式会话结束被回收，验收分两次拉起完成。
- 未做：全量 `type-check`（只改 class 字串 / 容器 class，不涉及类型）。
- `wiki/Plant3d-web/raw/sources/src/components/spatial-query/SpatialQueryDrawer.vue` 是 2026-09-07 基线快照的镜像（513 行 vs 当前 1695 行，根节点还是 `top-[120px] w-[440px]` 的旧版），不参与构建；同日只把它的 `max-h-[85vh]` 同步成与当前实现同值的 `max-h-[calc(100%-7.5rem)]`（用户拍板取字面同值；按它自己的 `top-[120px]` 算本该是 9rem）并在文件头标注「非当前实现」，其余未动。
