# 校审单流转到 JH / SH / PZ 后三维视口空白——线上复验（2026-09-24）

对应 CHANGELOG「校审单流转到 JH / SH / PZ 后三维视口不再空白…」条目；GitHub issue [#84](https://github.com/happyrust/plant3d-web/issues/84)；修复提交 `0dec493d`。

## 根因一句话

审核侧落点 `ReviewPanel` 装完模型自动「只显示任务构件」：`setObjectsVisible(全部, false)` 后只亮任务单元键 `24384_24935`（BRAN），而 BRAN 自己一个 DTX 对象都没有——几何在成员 BEND `24384_24936` / STRT `24384_24939` 名下（HVAC 支管没有隐含管子）→ 视口空白；模型树那份 `useModelGeneration` 再对同一 BRAN 报「1 个 refno 没有几何记录」。设计端（SJ）没有这一步，所以只在流转到后续人员后才看得见。

## 1. 部署

- `git push origin main`（`fe5a2786..0dec493d`）→ `gh workflow run deploy-ubuntu.yml --ref main` → run [35951124846](https://github.com/happyrust/plant3d-web/actions/runs/35951124846) `success`（03:21:43Z 起，03:23:28Z 完）。
- 验收：`http://123.57.182.243/version.json` → `commit 0dec493d…`，`buildDate 2026-09-24 03:22:55 UTC`；80 / 443 首页同为 `assets/index-DARS-7AE.js`。

## 2. 线上复验：单据 `FORM-C8049FC8F784`

token 直接向模型中心领（与 PMS 页面 `GetZyModeInfo` 同一条路，不必登 PMS）：

```powershell
Invoke-RestMethod -Uri http://123.57.182.243/api/auth/token -Method Post -ContentType application/json `
  -Body '{"username":"JH","project":"AvevaMarineSample","role":"jd","form_id":"FORM-C8049FC8F784"}'
# code=0 form_id=FORM-C8049FC8F784；SH 同法 role=sh
```

`POST /api/review/workflow/sync action=query`（JH）→ `formExists=true formStatus=active currentNode=jd taskStatus=submitted models=["24384_24935"] records=0`——单据仍停在校对节点，正是 issue 现场。

嵌入地址 `http://123.57.182.243/review/3d-view?form_id=FORM-C8049FC8F784&user_token=<jwt>&output_project=AvevaMarineSample`，headless Chrome 152（`--headless=new --use-angle=swiftshader`，CDP 9448）经 chrome-devtools-mcp 打开，JH / SH 各一个隔离 context。

| 读数（页内 `window.__xeokitViewer.scene`） | JH（jd） | SH（sh） |
| --- | --- | --- |
| 载入的包 | `index-DARS-7AE.js` | 同 |
| 状态表 `objectIds` 总数 | 47 | 47 |
| 有 DTX 对象的 refno | 仅 `24384_24936`(1) / `24384_24939`(1) | 同 |
| 其中可见 / 被藏 | 2 可见 / **0 被藏** | 同 |
| `getSubtreeRefnos(['24384_24935'])` | `['24384_24936','24384_24939']` | — |
| `getAABB([BRAN])` / `getSubtreeAABB([BRAN])` | `null` / `[-1.00,-1.18,-0.55, 1.00,1.18,0.55]` | — |
| 面板 | 「当前节点：校对 · 待处理」「任务详情 1 构件 · FORM-C8049FC8F784」 | 同 |
| 「没有几何记录 / 未绘制实例」文案 | 无 | 无 |
| console `error` / `warn` | 0 / 0 | — |

console 顺序（JH）：`[embed][form-restore] workflow snapshot resolved` → `task components replaced from workflow snapshot` → `[embed][viewer-restore] showModelByRefnos result` → `[ModelTreePanel] autoLocateRefno … 24384/24935` → `Node located in tree` → **`Model already loaded: 24384/24935`**（修前这一步是 `Auto-load failed` + 警告 toast）。

![JH 打开：BEND + STRT 亮着并飞到位](./01-jh-online-0dec493d-members-visible.png)

### 2.1 同一场景回放旧逻辑（证根因 ①）

在 JH 页面里按修前 `filterModelByTask` 的两步手动执行：`setObjectsVisible(objectIds, false)` → `setObjectsVisible(['24384_24935'], true)`，有几何且可见的 refno 立刻变成 `[]`（BRAN 自己 `_getDtxObjectIds` = 0），视口只剩隐藏几何的淡轮廓：

![旧逻辑回放：视口空白](./02-jh-online-old-filter-replay-blank.png)

再按新逻辑 `setObjectsVisible([BRAN, ...getSubtreeRefnos([BRAN])], true)` → 可见几何回到 `['24384_24936','24384_24939']`，画面与上图一致。

### 2.2 SH 打开同一单据

![SH 打开：同样只亮成员](./03-sh-online-0dec493d-members-visible.png)

## 3. 本地验证（提交前）

- vitest：`taskModelFilter.test.ts` 5 例、`DtxCompatScene.getSubtreeAABB.test.ts` 7 例（+3 `getSubtreeRefnos`）、`useModelGeneration.genModelV1.test.ts` 29 例（+2 #84）——3 文件 41 passed。
- AGENTS.md 双胞胎面板 5 套：`ReviewPanel` 49 / `DesignerCommentHandlingPanel` / `AnnotationTableView` / `AnnotationSheetWorkspace` / `ReviewCommentsTimeline` 共 125 passed，0 fail（无新增）。
- eslint 触及 8 文件 0 错误；`npm run type-check` 触及文件新增 0（基线外仅剩 `d0cd5971` 带进来的 `instanceMapping.test.ts` 3 条 TS2531，本条未碰）。

## 备注

- 验证用 Chrome profile（`%TEMP%\chrome-9448-profile-84`）用完即删；token 24 h 后自然失效。
- 修前线上包已被覆盖，「修前」证据以 §2.1 同场景回放 + issue 正文（09-23 现场）为准。
