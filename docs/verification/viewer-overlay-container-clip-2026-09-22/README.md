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

左侧工具栏另一个弹层「查看工具设置」（`toolbarSettingsOpen`）同法接入 `resolveDropdownPlacement`（它挂在工具栏最底的齿轮上、内容 648 px 高，原来硬 `bottom-0` 没限高，矮容器里顶部溢出 ≈232 px）。cua 真机（容器 416 px 高，齿轮 anchor 372→408）：弹层判为向上（`bottom-0`），自然高 648 → 限高 399 + `overflow-y: auto`，落在容器内 8→408、末行「查询条件…已统一移…」`elementFromPoint` 命中。图 `cua-settings-popup-capped.png`。工具栏其余是显示 / 隐藏 / X-ray / 定位等单键（只有 hover 提示气泡、无弹层），不涉及。

顺手看到：`MeasurementWizard` 的向导卡在 825 px 宽的容器里左边被裁一截 → issue #82，见 §2.5。

### 2.5 `MeasurementWizard` 向导卡左半张被裁 + 与抽屉相撞（issue [#82](https://github.com/happyrust/plant3d-web/issues/82)）

**裁切**不是容器窄的问题，任何宽度都裁：组件 scoped CSS 是 `left: 50%; transform: translateX(-50%)`（居中），宿主 `ViewerPanel` 用内联 `style="left: 12px"` 把它改到左上角，却没覆盖 `transform`，于是卡向左平移了自身一半；又没有 `max-width`，「管-管」那句 70 字的 statusText 把卡撑到 650–750 px，左半张画在容器外面被 `overflow: hidden` 裁掉，同时压住左侧工具栏顶上的按钮。

**相撞**：本轮 cua 真机验收时发现，先按上面「顶部居中」修，卡在 825 px 宽的查看器里居中到 172→652，而空间查询抽屉在 433→769——两者重叠 219 px，卡右侧的按钮压在抽屉上点不到。所以最终不放顶部居中，改成贴左侧工具栏右边。

改法（位置只在组件里定，宿主删掉内联 `style`）：`top: 12px; left: 64px`（= 工具栏 left 12 + 宽 48 + 4 间隙，不压工具栏）`; right: 12px; width: fit-content`（永远在容器里）`; min-width: min(300px, calc(100% - 76px))`（超窄容器不越右边界）`; max-width: 360px`（360 宽从 64 起到 424，常规视口 ≳820 px 刚好落在工具栏与右上抽屉之间）`;` 正文 `overflow-wrap: anywhere; z-index: 940`。

Playwright headless（dev `:3111` + `:8027`，工具栏「测量」→「管-管」，无抽屉，改前用内联样式回灌 `left: 12px + translateX(-50%)`、无 max-width，同页同容器）：

| 视口 → 容器 | 改前 卡 left→right（宽） | 左边被裁 | 改后 卡 left→right（宽，容器内） | 文字行数 |
| --- | --- | --- | --- | --- |
| 1366×768 → 350→1016（666） | 35→689（654） | **315 px** | 414→774（360，✓） | 3 |
| 1024×700 → 350→674（324） | 206→518（312） | **144 px** | 414→662（248，✓，随窄容器缩） | 4 |

cua 真机（容器 825，空间查询抽屉同时开）：卡 64→424（360 宽）居中在工具栏右 57 与抽屉左 433 之间，`overlapsToolbar=false`、`overlapsDrawer=false`、「取消测量」`elementFromPoint` 命中。`pageerror` 0。图：`wizard-01-before-*.png`（改前左裁）/ `wizard-02-after-*.png`（改后无抽屉）/ `wizard-03-beside-open-drawer.png`（改后 + 抽屉并存，卡完整夹在中间）。

## 2.6 三个修复共处一屏的回归（cua 真机，2026-09-22 二次拉起）

同一台 Chromium、同一 1692×826 CSS 视口 / 825 px 查看器容器，一次连跑把 #80 / #81 / #82 串起来验证互不打架：

1. URL 直开空间查询抽屉（`spatial_autorun`）→ 抽屉 `max-h-[calc(100%-7.5rem)]`、结果可滚到底（#80）。
2. 点「测量」→ 菜单 `bottom-0` 向上翻、7 项全在容器内（#81 回归，图 `cua-menu-03-regression-flip-up.png`）。
3. 点「管-管」→ 向导卡在**抽屉仍开**时落在工具栏与抽屉之间、不裁不撞、「取消测量」可点（#82，图 `wizard-03-beside-open-drawer.png`）。
4. 点「构件最近点」→ `ObjectMeasureDrawer` `max-h-[calc(100%-9rem)]`、底边 475 < 容器底 499、正文可滚（#80，CDP 读数）。

`pageerror` 0。（`ObjectMeasureDrawer` 的「结束测量」在 §2.1 的专项里已真点验证过；本回归里 cua 的滚轮事件没能落到该抽屉正文——是 cua `scroll` 在此窗口的坐标落点问题，非产品问题，故该抽屉滚到底的真点未在本回归复跑。）

### 2.7 弹层开着时容器缩矮要重算落位（issue [#83](https://github.com/happyrust/plant3d-web/issues/83)，§4.2 顺手发现 ① 的修复）

根因：#81 的落位只在 toggle 打开那一刻算一次。修法：容器已有的 `ResizeObserver` 回调里 `replaceOpenLeftToolbarPopups()` 重跑开着的弹层的 place；量高度改用 `measureNaturalHeight(el)`（同步清掉上一轮内联 `max-height` / `overflow-y` 量自然高度再恢复），否则会拿已限高的高度越算越小。

Playwright headless 拦截换包 A/B（`pms-3d-review-integration-e2e.md` §6.3.1 做法：本地 `vite build` 的 dist 对线上后端 123.57.182.243；同页同 URL，视口 1692×839 → 容器 83→650（567）打开，再 `setViewportSize` 到 1692×659 → 容器 83→513（430），最后放大回去）：

| | 线上旧包 `index-Bq92dgMb.js`（改前） | 修后 build `index-BdRWNvCA.js` |
| --- | --- | --- |
| 「测量」下拉 高容器打开 | `top-0` 406→624，在容器内 | 同 |
| 缩矮后 | 仍 `top-0` 337→555，**超出容器底 42 px** | **`bottom-0` 翻上 155→373**，在容器内 |
| 放大回去 | `top-0` 406→624 | `top-0` 406→624（又向下开） |
| 「查看工具设置」高容器打开 | `bottom-0` + `max-height 475px`，92→567 | 同 |
| 缩矮后 | 仍 `max-height 475px`，23→498，**顶出容器 60 px**（标题与「场景背景」被裁） | **重算 `max-height 407px`**，91→498，在容器内 |
| 放大回去 | 92→567 | 92→567，`max-height` 回 475 |

`pageerror` 两侧 0。图：`resize-83-menu-online.png` / `resize-83-menu-local.png`（缩矮后的菜单）、`resize-83-settings-online.png` / `resize-83-settings-local.png`（缩矮后的弹层）。单测 `dropdownPlacement.test.ts` 6 → 8 例。脚本 `%TEMP%\overlay-clip-online\resize-check.mjs`（仓外，`MODE=online|local`）。

## 3. 单测 / lint

`npx vitest run src/components/spatial-query/SpatialQueryDrawer.test.ts src/composables/useDtxTools.objectMeasure.test.ts src/utils/dropdownPlacement.test.ts` → 3 文件 49 过；`npx eslint` 触及的 `.vue` / `.ts` 0 问题（`ViewerPanel.vue` 只剩第 28 行既有那条 import 分组）；tailwindcss CLI 探针确认产出 `max-height: calc(100% - 7.5rem)` / `calc(100% - 9rem)`。

## 4. 线上包验收（cua 真机，2026-09-22 20:53–21:12；main `a9358f09` 部署到 123.57.182.243）

三个修复随 main `a9358f09` 用 GitHub Actions `Deploy Frontend To Ubuntu`（run 35725606280，20:10，1 分 42 秒）上线，`https://123.57.182.243/version.json` = `{commit: a9358f09…, buildDate: 2026-09-22 12:11:46 UTC}`，bundle `index-Bq92dgMb.js`。在线上包上按 §2 同一套做法再验一遍：浏览器由 cua-driver `browser_prepare` 拉起隔离 Chromium（Chrome 152，2560×1440 @1.5x），`set_window_frame` 定窗口尺寸，点击全部走 cua `click`（背景 UIA / PostMessage，未换前台），滚轮走 cua `scroll`（背景对 Chrome 的 wheel 不可用，按驱动提示改 `delivery_mode: foreground` 的 SendInput），截图走 `get_desktop_state`（本页 UIA 树太大，`get_window_state` 4 s 超时）；几何读数与「在容器内」判定用 CDP（Playwright `connectOverCDP` 到驱动给的端口，`getBoundingClientRect`，脚本 `%TEMP%\overlay-clip-online\cdp-step.mjs`，仓外）。页面 URL：`/?show_refno=24381_145018&spatial_refno=24381_145018&spatial_radius=3&spatial_radius_unit=m&spatial_autorun=1`（BRAN 24381/145018 已装进三维，距离查询 3 m → 3952 项）。图在 `online-2026-09-22/`（桌面截图裁到浏览器窗口、缩到 1707 px 宽 = CSS 1x；右上角「要恢复页面吗？」是 Chrome 自己的气泡——第一轮隔离浏览器被驱动回收后重拉才有，不在查看器容器里）。

### 4.1 高容器（窗口 2560×1400 → CSS 视口 1692×839，容器 350→1342 × 83→651 = 568 px）

| 浮层 | 读数 | 在容器内 | 图 |
| --- | --- | --- | --- |
| 空间查询抽屉（#80） | 179→627（448），`max-height: calc(100% - 120px)`，正文 `clientHeight 392 / scrollHeight 709` 可滚 | ✓（底边距容器底 24 px） | `online-01-tall-spatial-drawer.png` |
| 「测量」下拉（#81） | 按钮 406→442；菜单 406→623，下方放得下 → `top-0` 向下开、不限高；7 项 `elementFromPoint` 全命中；**真点「管-管」→ 进向导** | ✓（距容器底 28 px） | `online-02-tall-measure-menu-down.png` |
| 向导卡（#82，抽屉同开、模型已装、70 字提示） | 95→264，`left 414 → right 774`（360 = max-width）；`overlapsToolbar=false`（工具栏右 403）、`overlapsDrawer=false`（抽屉左 950）；「取消测量」命中，**真点 → 卡关闭、菜单关闭** | ✓ | `online-03-tall-wizard-beside-drawer.png` |
| 构件最近点抽屉（#80） | 203→627（424），`max-height: calc(100% - 144px)`，正文 `356 / 383` 可滚 | ✓（距容器底 24 px） | `online-04-tall-object-measure-drawer.png` |
| 「查看工具设置」弹层（#81 收尾） | 齿轮在工具栏底（531→567）；弹层判向上 `bottom-0`，自然高 648 → `max-height 476px` + `overflow-y: auto`，91→567 | ✓（顶距容器顶 8 px） | `online-05-tall-settings-popup-capped.png` |

### 4.2 矮容器（`set_window_frame` 2560×1130 → CSS 视口 1692×659，容器 83→514 = 431 px）

| 浮层 | 读数 | 在容器内 | 图 |
| --- | --- | --- | --- |
| 「测量」下拉（#81） | 按钮 338→374，下方只剩 140 px < 217 → **`bottom-0` 向上翻** 156→374，不限高，7 项全在 | ✓ | `online-06-short-measure-menu-flip-up.png` |
| 「查看工具设置」弹层（#81 收尾） | 重新打开后判向上，`max-height 407px`（648 → 407）+ 滚动，92→499 | ✓ | `online-07-short-settings-popup-capped.png` |
| 构件最近点抽屉（#80） | 窗口缩小后随容器重排 203→490（287），正文 `219 / 383` 可滚 | ✓ | （同 06 / 07 图右侧） |
| 空间查询抽屉（#80） | 重载 URL：179→490（311），正文 `255 / 709`；cua 前台滚轮 20 + 40 tick → `scrollTop 454` 到底；**真点「查看结果」** → 结果展开（`scrollHeight 1213`），再滚 100 tick 到底（958）；底部行 `24381_36035 PANE` 的「飞行定位」`elementFromPoint` 命中，**真点 → 属性面板 `REFNO =24381/36035`（选中生效）** | ✓（底边距容器底 24 px） | `online-08-short-spatial-drawer.png`、`online-09-short-spatial-results-bottom-flyto.png` |

注入后 `pageerror` / `console.error` 0；`document.scripts` 只有 `/assets/index-Bq92dgMb.js`。

顺手看到（不属于 #80–#82）：① 弹层落位只在打开那一刻算，窗口随后缩小不会重算——矮容器一节里先前在高容器打开的「查看工具设置」弹层缩窗后仍是 23→499 / `max-height 476`，顶出容器 60 px，关掉重开才按新容器落位 → issue [#83](https://github.com/happyrust/plant3d-web/issues/83)（同日修，见 §2.7）；② 结果列表滚到底时最末一行（`24381_36083 PANE`）动作按钮中心点 `elementFromPoint` 未命中，上一行命中并真点成功，未深究。

## 备注

- cua-driver 像素点击的坐标系随「本窗口是否拍过 `get_window_state` 截图」而变：拍过 → 用那张 1567/1568 宽的截图坐标；没拍过 → 直接按物理窗口像素（本轮 §4 全程用 `get_desktop_state` 截图、`click` 按物理像素，窗口放在 (0,0) 所以物理像素 = 屏幕像素）。

- cua-driver 0.20.0 在本机的两个坑：`get_window_state` 落盘 PNG 为 1568 宽（`max_image_dimension`），像素点击的 x/y 用这张图的坐标系；`scroll` 的 x/y 却按物理窗口像素解释。隔离浏览器约 10 分钟后会随隐式会话结束被回收，验收分两次拉起完成。
- 未做：全量 `type-check`（只改 class 字串 / 容器 class，不涉及类型）。
- `wiki/Plant3d-web/raw/sources/src/components/spatial-query/SpatialQueryDrawer.vue` 是 2026-09-07 基线快照的镜像（513 行 vs 当前 1695 行，根节点还是 `top-[120px] w-[440px]` 的旧版），不参与构建；同日只把它的 `max-h-[85vh]` 同步成与当前实现同值的 `max-h-[calc(100%-7.5rem)]`（用户拍板取字面同值；按它自己的 `top-[120px]` 算本该是 9rem）并在文件头标注「非当前实现」，其余未动。
