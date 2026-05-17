# 审核面板批注表格视图回填 · 实施计划 · 2026-05-17

> 本计划恢复 PR 8（`docs/plans/2026-04-23-reviewer-workbench-annotation-table-pr8-design.md`）在 reviewer 工作台（`ReviewPanel.vue`）落地的「卡片列表 ⇄ 批注表格」切换能力。该能力曾完整上线，后被一次反向 rebase 整段抹除，本计划重新接回去并补缺口防御。
>
> **执行者：** 任意熟悉本仓库 Vue 3 + Vitest 体系的工程师 / agent。每个 Task 内步骤≈ 5 分钟，TDD + 高频 commit。
> **范围：** 单仓 `plant3d-web`，**不**涉及 plant-model-gen 或 rs-core。

---

## 0. 背景

### 0.1 现象
打开 `校审 > 审核面板`（jh / sh 校核角色）后，批注区只剩内联的 v-for 卡片列表，**没有「批注表格」tab**。Ribbon 上的 `panel.annotationTable` 按钮还在，但点击对审核面板无响应（仅 `DesignerCommentHandlingPanel` 能响应）。

### 0.2 已诊断根因（详见配套 ADR）
- ccb8d08（2026-04-23）落地 PR 8，给 `ReviewPanel.vue` 接入 `AnnotationTableView` + tab bar + `reviewerWorkbenchViewModeBus`。
- a644ba3（2026-05-06）`feat(review): land review module refactor closure for CI build` 内 ReviewPanel.vue 仍含 PR 8 全部代码（`AnnotationTableView` 出现 2 次）。
- a644ba3 之后某次将 028de56（2026-04-25，发生在 PR 8 之前的批注重构）反向合入主线时，整段 PR 8 改动被覆盖；后续 merge `6ad374b` 又采用了「无 AT」的一侧。
- 当前 HEAD 的 ReviewPanel.vue **0 处** `AnnotationTableView`，但下列残留物完整存在：
  - `src/components/review/AnnotationTableView.vue` 组件本体
  - `src/components/review/reviewerWorkbenchViewModeBus.ts` + 同名 `.test.ts`
  - `src/ribbon/ribbonConfig.ts:219` 的 `panel.annotationTable` 按钮
  - `src/components/DockLayout.vue:29 / :1252` 的 import + command dispatch
  - `src/components/review/ReviewPanel.test.ts:1305 / 1340 / 1378 / 1440 / 1517 / 1553 / 1594` 共 6+ 条 PR 8/PR 9 测试用例
  - `src/components/onboarding/roleGuides/designerGuide.ts:120` 的 onboarding 引导步骤

### 0.3 故障链
```
Ribbon 按钮 (panel.annotationTable)
   → DockLayout.handleRibbonCommand:1252
      → requestReviewerWorkbenchViewMode('table')   // bus.requestRef = {...}
         → 【应当】ReviewPanel.vue watch(reviewerWorkbenchViewModeRequest)
            → annotationListViewMode.value = 'table'
               → <AnnotationTableView /> 渲染
                  ← 当前断点：ReviewPanel.vue 已不监听该 bus
                    → ref 堆积，UI 无反应
```

### 0.4 数据冲击
当前 ReviewPanel.vue 用的 `allAnnotationItems` 数据结构是本地定义的 `AnnotationListItem`（精简版，含 `id/type/title/description/createdAt/visible/commentCount/refno/reviewState`），而 `AnnotationTableView` 接受的 props.items 类型是 `AnnotationWorkspaceItem`（来自 `annotationWorkspaceModel.ts`，含 `severity / refnos[] / authorId / ...` 等更丰富字段）。

→ 必须新增 **类型适配** 这一步，否则直接传 items 会 TS 报错且表格列空缺。

---

## 1. 目标 / 非目标

### 1.1 目标
1. 审核面板批注区顶部恢复「卡片列表 / 批注表格」tab 切换（对齐 `DesignerCommentHandlingPanel` 体验）。
2. Ribbon `panel.annotationTable` 按钮点击后在审核面板生效。
3. 视图模式持久化到 localStorage，独立 key `plant3d-web-nav-state-reviewer-workbench-v1`（沿用 a644ba3）。
4. 表格视图为只读浏览：行单击=选中、行双击=飞到 3D + 自动切回卡片列表、右键=复制 feedback。
5. ReviewPanel.test.ts 中 6+ 条 PR 8/9 用例从「必死」回到 「全绿」。
6. 加 CI 守护：把 reviewer 表格视图 Vitest 用例纳入「不能跳过」清单，防止下次再丢。

### 1.2 非目标
- **不**改 confirm / submit / reject / drawer 工作流。
- **不**改 ribbon 按钮的可见性 / 权限规则（PR 10 已落地）。
- **不**重构当前 ReviewPanel.vue 的 `allAnnotationItems` 数据结构（重构留给后续 PR；本计划只增不改）。
- **不**触碰 `DesignerCommentHandlingPanel.vue`（设计师面板表格视图本来就正常）。
- **不**对 `AnnotationTableView.vue` 做任何修改。

---

## 2. 架构方案与决策

### 2.1 候选方案
| 方案 | 描述 | 优势 | 劣势 |
|---|---|---|---|
| **A · Adapter 增量回填**（推荐） | 新增 `toAnnotationWorkspaceItems` 适配器（≤30 行纯函数），把 ReviewPanel 现有 `allAnnotationItems` 映射为 `AnnotationWorkspaceItem[]`；其余按 a644ba3 PR 8 形态回填 | 最小侵入；保留当前 ReviewPanel 现有 list 渲染；可独立 commit；可独立回滚 | 适配器需要测试覆盖；与 DCH 实现略有重复 |
| B · 重构对齐 a644ba3 | 直接把 `allAnnotationItems` 换成 `buildAnnotationWorkspaceItems` + `scopeAnnotationWorkspaceItemsByFormId` + 引入 `AnnotationWorkspace` 子组件作为 split view | 与 DCH 形态完全一致；消除适配器 | 当前内联 list 模板大幅重写；可能引入 confirm/submit/embed 等隐性回归；review 体积大 |
| C · 仅恢复 ribbon 按钮路由 | 不接 viewMode bus，按钮直接 ensurePanelAndActivate + alert toast | 改动最小 | 用户痛点没解 |

### 2.2 选定方案：A（Adapter 增量回填）
理由：
- 修复成本可控（≤ 1 个工作日）；
- ReviewPanel.vue 当前 list 结构刚在 028de56 后稳定，不冒大重构险；
- 适配器是纯函数，可单测；
- 后续若要走 B，本方案是 B 的子集，可平滑演进。

---

## 3. 文件级变更清单

| 文件 | 操作 | 估算行数 | 责任 |
|---|---|---|---|
| `src/components/review/reviewerAnnotationItemAdapter.ts` | 新增 | +40 | 把 ReviewPanel 的 `AnnotationListItem` → `AnnotationWorkspaceItem` |
| `src/components/review/reviewerAnnotationItemAdapter.test.ts` | 新增 | +90 | 适配器单测 |
| `src/components/review/ReviewPanel.vue` | 修改 | +85 / −5 | 接回 PR 8（imports / state / bus watch / template tab + table 分支） |
| `src/components/review/ReviewPanel.test.ts` | 修改 | +10 / −0 | 修补 mock，让既有 6 条 PR 8/9 用例从「必死」转「全绿」 |
| `开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` | 新增 | +180 | 事故复盘 ADR（含锁定根因 commit、防御规则） |
| `CHANGELOG.md` | 修改 | +6 | Unreleased 段加一条 fix |
| `AGENTS.md`（plant3d-web） | 修改 | +4 | 把「ReviewPanel + DCH 改动 PR 必须本地跑相关 vitest」写进 PR 流程 |

⚠ 不修改的文件（用以确认范围）：`AnnotationTableView.vue` / `reviewerWorkbenchViewModeBus.ts` / `DockLayout.vue` / `ribbonConfig.ts` / `designerGuide.ts` / `annotationWorkspaceModel.ts`。

---

## 4. 实施步骤（TDD · 每步可独立 commit）

### Task 1 · 类型适配器（最小可单测单元）

**Files:**
- Create: `src/components/review/reviewerAnnotationItemAdapter.ts`
- Create: `src/components/review/reviewerAnnotationItemAdapter.test.ts`
- Reference (read-only): `src/components/review/annotationWorkspaceModel.ts`（看 `AnnotationWorkspaceItem` 准确字段）

- [ ] **Step 1.1 · 写失败的单测**

```ts
import { describe, it, expect } from 'vitest';
import { toAnnotationWorkspaceItems } from './reviewerAnnotationItemAdapter';

describe('toAnnotationWorkspaceItems', () => {
  it('文字批注 → workspace item，标题/描述/severity/refnos 全部映射', () => {
    const items = toAnnotationWorkspaceItems({
      annotations: [
        {
          id: 't1', title: '管道与梁碰撞', description: '净距 50mm',
          createdAt: 1_700_000_000_000, visible: true,
          refno: 'BRAN-001', severity: 'principle',
          reviewState: { decisionStatus: 'pending' },
        } as any,
      ],
      cloudAnnotations: [], rectAnnotations: [], obbAnnotations: [],
      getCommentCount: () => 2,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 't1', type: 'text', title: '管道与梁碰撞',
      description: '净距 50mm', visible: true,
      refnos: ['BRAN-001'], severity: 'principle',
      commentCount: 2,
    });
  });

  it('云线/矩形/obb 标题为空时回退到「未命名 X 批注」', () => { /* 类似 ... */ });

  it('按 createdAt 降序排序', () => { /* 类似 ... */ });

  it('refno 为空字符串时不进 refnos 数组', () => { /* 类似 ... */ });

  it('getCommentCount 收到 (type, id) 用于按类型聚合', () => { /* 类似 ... */ });
});
```

- [ ] **Step 1.2 · 跑测试验证 FAIL**

```bash
npx vitest run src/components/review/reviewerAnnotationItemAdapter.test.ts
# 预期：Cannot find module './reviewerAnnotationItemAdapter'
```

- [ ] **Step 1.3 · 写最小实现**

```ts
// src/components/review/reviewerAnnotationItemAdapter.ts
import type {
  TextAnnotation, CloudAnnotation, RectAnnotation, ObbAnnotation,
  AnnotationType,
} from '@/composables/useToolStore';
import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';

export interface AdapterInput {
  annotations: TextAnnotation[];
  cloudAnnotations: CloudAnnotation[];
  rectAnnotations: RectAnnotation[];
  obbAnnotations: ObbAnnotation[];
  getCommentCount: (type: AnnotationType, id: string) => number;
}

const FALLBACK_TITLE: Record<AnnotationType, string> = {
  text: '未命名文字批注',
  cloud: '未命名云线批注',
  rect: '未命名矩形批注',
  obb: '未命名包围盒批注',
};

function refnosOf(raw?: string | null): string[] {
  const v = raw?.trim();
  return v ? [v] : [];
}

export function toAnnotationWorkspaceItems(input: AdapterInput): AnnotationWorkspaceItem[] {
  const out: AnnotationWorkspaceItem[] = [];
  const push = (type: AnnotationType, list: Array<{
    id: string; title?: string; description?: string; createdAt: number;
    visible: boolean; refno?: string; severity?: any; reviewState?: any;
    authorId?: string;
  }>) => {
    for (const a of list) {
      out.push({
        id: a.id,
        type,
        title: a.title?.trim() || FALLBACK_TITLE[type],
        description: a.description?.trim() || '',
        createdAt: a.createdAt,
        visible: a.visible,
        refnos: refnosOf(a.refno),
        severity: a.severity,
        reviewState: a.reviewState,
        authorId: a.authorId,
        commentCount: input.getCommentCount(type, a.id),
      });
    }
  };
  push('text', input.annotations);
  push('cloud', input.cloudAnnotations);
  push('rect', input.rectAnnotations);
  push('obb', input.obbAnnotations);
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
```

> ⚠ 如果 `AnnotationWorkspaceItem` 实际字段与上面不一致，先 Read `annotationWorkspaceModel.ts`，按实际字段裁剪。**不要**编造字段。

- [ ] **Step 1.4 · 跑测试验证 PASS**

```bash
npx vitest run src/components/review/reviewerAnnotationItemAdapter.test.ts
# 预期：5 passed
```

- [ ] **Step 1.5 · type-check + lint**

```bash
npx vue-tsc --noEmit -p tsconfig.app.json
npx eslint src/components/review/reviewerAnnotationItemAdapter.ts src/components/review/reviewerAnnotationItemAdapter.test.ts
```

- [ ] **Step 1.6 · commit**

```bash
git add src/components/review/reviewerAnnotationItemAdapter.ts \
        src/components/review/reviewerAnnotationItemAdapter.test.ts
git commit -m "feat(review): add reviewerAnnotationItemAdapter for ReviewPanel ↔ AnnotationTableView bridge"
```

---

### Task 2 · ReviewPanel.vue 接回 PR 8（script setup 部分）

**Files:**
- Modify: `src/components/review/ReviewPanel.vue`
- Reference: `git show a644ba3:src/components/review/ReviewPanel.vue` 第 32 / 55–60 / 92 / 925–948 行

- [ ] **Step 2.1 · 加 imports（在文件第 ~30–95 行的 import 区追加）**

具体插入位置：
- 在现有第 39 行 `import ReviewAuxData from './ReviewAuxData.vue';` 之前插入：
  ```ts
  import AnnotationTableView from './AnnotationTableView.vue';
  ```
- 在现有第 58 行 `import WorkflowReturnDialog ...` 之前插入：
  ```ts
  import {
    clearReviewerWorkbenchViewModeRequest,
    useReviewerWorkbenchViewModeRequest,
  } from './reviewerWorkbenchViewModeBus';
  ```
- 在现有第 69 行 `import { ensurePanelAndActivate } from '@/composables/useDockApi';` 之后插入：
  ```ts
  import { useNavigationStatePersistence } from '@/composables/useNavigationStatePersistence';
  ```
- 在现有 `import type { ... } from '@/types/auth';`（第 62 行）之后插入：
  ```ts
  import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';
  ```
- 在 ReviewPanel.vue 文件内引入适配器：
  ```ts
  import { toAnnotationWorkspaceItems } from './reviewerAnnotationItemAdapter';
  ```

- [ ] **Step 2.2 · 加视图模式 state（在现有 `confirmError = ref` 之后，约第 962 行）**

```ts
type AnnotationListViewMode = 'split' | 'table';
const annotationListViewMode = ref<AnnotationListViewMode>('split');

const reviewerNavigationState = useNavigationStatePersistence(
  'plant3d-web-nav-state-reviewer-workbench-v1',
);
reviewerNavigationState.bindRef<AnnotationListViewMode>(
  'annotationListViewMode',
  annotationListViewMode,
  'split',
);

const reviewerWorkbenchViewModeRequest = useReviewerWorkbenchViewModeRequest();
watch(reviewerWorkbenchViewModeRequest, (request) => {
  if (!request) return;
  annotationListViewMode.value = request.mode;
  clearReviewerWorkbenchViewModeRequest();
});
```

- [ ] **Step 2.3 · 加表格视图数据源（紧跟 `allAnnotationItems` computed 之后，约第 1350 行后）**

```ts
const annotationWorkspaceItems = computed<AnnotationWorkspaceItem[]>(() =>
  toAnnotationWorkspaceItems({
    annotations: toolStore.annotations.value,
    cloudAnnotations: toolStore.cloudAnnotations.value,
    rectAnnotations: toolStore.rectAnnotations.value,
    obbAnnotations: toolStore.obbAnnotations.value,
    getCommentCount: (type, id) => toolStore.getAnnotationComments(type, id).length,
  }),
);
```

- [ ] **Step 2.4 · 加表格事件处理函数（与 a644ba3 L1152–1170 对齐，放在 `flyToAnnotationItem` 附近）**

```ts
function handleTableSelectAnnotation(item: AnnotationWorkspaceItem | null) {
  // 复用现有 annotation 选中逻辑（找到当前文件中已有的 setSelectedAnnotation /
  // expandedAnnotationId 或同等机制 — 若没有就只做 active id 同步）
  if (!item) return;
  const card = allAnnotationItems.value.find((it) => it.id === item.id && it.type === item.type);
  if (!card) return;
  // expandedAnnotationId 是当前 ReviewPanel.vue 已有 ref；如名字不同请按实际改
  expandedAnnotationId.value = card.id;
}

async function handleTableOpenAnnotation(item: AnnotationWorkspaceItem) {
  annotationListViewMode.value = 'split';
  await nextTick();
  handleTableSelectAnnotation(item);
  // 飞到 3D（沿用现有 flyToAnnotationItem，注意类型差异：传一个最小 AnnotationListItem）
  const card = allAnnotationItems.value.find((it) => it.id === item.id && it.type === item.type);
  if (card) flyToAnnotationItem(card);
}

function handleTableCopyFeedback(payload: { kind: 'refno' | 'row'; result: 'copied' | 'fallback' | 'failed' }) {
  const label = payload.kind === 'refno' ? 'RefNo' : '批注行';
  if (payload.result === 'failed') {
    emitToast({ message: `复制${label}失败，请重试`, level: 'warning' });
    return;
  }
  emitToast({
    message: payload.result === 'fallback' ? `已复制${label}（降级）` : `已复制${label}`,
    level: 'success',
  });
}
```

> ⚠ 若 ReviewPanel.vue 现有的 ref 名不是 `expandedAnnotationId`，先 Grep `expandedAnnotation\|selectedAnnotation` 找到准确变量名再改。`flyToAnnotationItem` 函数名同理。

- [ ] **Step 2.5 · type-check + lint（不跑 dev 服务器）**

```bash
npx vue-tsc --noEmit -p tsconfig.app.json
npx eslint src/components/review/ReviewPanel.vue
```

- [ ] **Step 2.6 · commit script 部分**

```bash
git add src/components/review/ReviewPanel.vue
git commit -m "feat(review): wire reviewerWorkbenchViewModeBus + AnnotationTableView state into ReviewPanel (script)"
```

---

### Task 3 · ReviewPanel.vue 接回 PR 8（template 部分）

**Files:**
- Modify: `src/components/review/ReviewPanel.vue`（第 1703–1850 行附近，「批注列表」区块）
- Reference: `git show a644ba3:src/components/review/ReviewPanel.vue` 第 1755–1910 行

- [ ] **Step 3.1 · 在当前 `<!-- ═══════ C2. 批注列表 ═══════ -->` 块（约第 1703 行）上方插入 Tab Bar**

```html
<!-- ═══════ C2. 批注列表 / 表格 切换 ═══════ -->
<div v-if="totalAnnotationItemCount > 0"
  class="mb-2 inline-flex items-center gap-1 self-start rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
  role="tablist"
  aria-label="批注视图切换"
  data-testid="reviewer-annotation-list-view-mode-tabs">
  <button type="button"
    role="tab"
    :aria-selected="annotationListViewMode === 'split'"
    class="inline-flex h-7 items-center rounded-lg px-2.5 text-xs font-semibold transition"
    :class="annotationListViewMode === 'split'
      ? 'bg-slate-900 text-white shadow-sm'
      : 'text-slate-600 hover:bg-slate-100'"
    data-testid="reviewer-annotation-list-view-mode-split"
    @click="annotationListViewMode = 'split'">
    卡片列表
  </button>
  <button type="button"
    role="tab"
    :aria-selected="annotationListViewMode === 'table'"
    class="inline-flex h-7 items-center rounded-lg px-2.5 text-xs font-semibold transition"
    :class="annotationListViewMode === 'table'
      ? 'bg-slate-900 text-white shadow-sm'
      : 'text-slate-600 hover:bg-slate-100'"
    data-testid="reviewer-annotation-list-view-mode-table"
    @click="annotationListViewMode = 'table'">
    批注表格
  </button>
</div>
```

- [ ] **Step 3.2 · 把现有「批注列表」整段 `<div v-if="totalAnnotationItemCount > 0"... data-guide="annotation-list-zone">` 用 `v-if="totalAnnotationItemCount > 0 && annotationListViewMode === 'split'"` 收口**

```html
<div v-if="totalAnnotationItemCount > 0 && annotationListViewMode === 'split'"
  class="rounded-lg border border-slate-200 bg-white"
  data-guide="annotation-list-zone"
  data-testid="reviewer-annotation-card-list">
  <!-- 现有内容原封不动 -->
  ...
</div>
```

- [ ] **Step 3.3 · 在上述 split 块之后插入 table 分支**

```html
<div v-else-if="totalAnnotationItemCount > 0 && annotationListViewMode === 'table'"
  data-testid="reviewer-annotation-table-view-container">
  <AnnotationTableView
    :items="annotationWorkspaceItems"
    :current-annotation-id="expandedAnnotationId"
    :current-annotation-type="null"
    :task-key="currentTask?.id ?? null"
    :subtitle="currentTask?.title ?? null"
    empty-title="当前任务下还没有可浏览的批注"
    empty-description="批注创建后会自动出现在这里。"
    data-testid="annotation-table-view"
    @select-annotation="handleTableSelectAnnotation"
    @open-annotation="(item) => void handleTableOpenAnnotation(item)"
    @locate-annotation="(item) => void handleTableOpenAnnotation(item)"
    @copy-feedback="handleTableCopyFeedback" />
</div>
```

> ⚠ `expandedAnnotationId` 是当前 ReviewPanel.vue 已经存在的 ref（或同等概念名）；按 Step 2.4 的核查结果保持一致。

- [ ] **Step 3.4 · type-check + lint**

```bash
npx vue-tsc --noEmit -p tsconfig.app.json
npx eslint src/components/review/ReviewPanel.vue
```

- [ ] **Step 3.5 · commit template 部分**

```bash
git add src/components/review/ReviewPanel.vue
git commit -m "feat(review): restore card/table tab + AnnotationTableView in ReviewPanel template"
```

---

### Task 4 · 修补既有测试 mock，让 PR 8/9 用例转绿

**Files:**
- Modify: `src/components/review/ReviewPanel.test.ts`

- [ ] **Step 4.1 · 跑一次现状测试，列出全部失败**

```bash
npx vitest run src/components/review/ReviewPanel.test.ts 2>&1 | tee /tmp/review_panel_before.log
```

预期：第 1305 / 1340 / 1378 / 1440 / 1468 / 1517 / 1553 / 1594 行附近的用例都 FAIL（找不到 `[data-testid="reviewer-annotation-list-view-mode-tabs"]` 或 `[data-testid="annotation-table-view"]`）。把失败列表写到 progress 留作 baseline。

- [ ] **Step 4.2 · 修复 mock 缺口**

可能需要补的：
- `useNavigationStatePersistence` mock（若现有测试没 mock，参照 `DesignerCommentHandlingPanel.test.ts` 里 `persistenceState` 的 stub）
- `useReviewerWorkbenchViewModeRequest` mock（直接复用 `import('./reviewerWorkbenchViewModeBus')` 中的 `requestReviewerWorkbenchViewMode` 真函数即可，因为它是 module-singleton ref，副作用可控）

具体动作：

```ts
// 在 ReviewPanel.test.ts 顶部 setup
const persistenceState = new Map<string, unknown>();
vi.mock('@/composables/useNavigationStatePersistence', () => ({
  useNavigationStatePersistence: () => ({
    bindRef<T>(key: string, ref: Ref<T>, fallback: T) {
      if (persistenceState.has(key)) ref.value = persistenceState.get(key) as T;
      else ref.value = fallback;
      watch(ref, (v) => persistenceState.set(key, v as unknown), { immediate: true });
    },
  }),
}));

beforeEach(() => { persistenceState.clear(); });
```

- [ ] **Step 4.3 · 跑测试验证 PASS**

```bash
npx vitest run src/components/review/ReviewPanel.test.ts 2>&1 | tee /tmp/review_panel_after.log
diff /tmp/review_panel_before.log /tmp/review_panel_after.log | head -40
```

预期：之前 FAIL 的 6+ 条用例全部通过；其余原有用例不受影响。

- [ ] **Step 4.4 · commit**

```bash
git add src/components/review/ReviewPanel.test.ts
git commit -m "test(review): repair PR 8/9 reviewer-table cases against restored ReviewPanel"
```

---

### Task 5 · 跨组件回归 & ribbon 端到端 smoke

- [ ] **Step 5.1 · 三组关联测试套件全绿**

```bash
npx vitest run \
  src/components/review/ReviewPanel.test.ts \
  src/components/review/DesignerCommentHandlingPanel.test.ts \
  src/components/review/AnnotationTableView.test.ts \
  src/components/review/reviewerWorkbenchViewModeBus.test.ts \
  src/components/review/reviewerAnnotationItemAdapter.test.ts
# 预期：全绿
```

- [ ] **Step 5.2 · type-check 全工程**

```bash
npm run type-check
# 预期：0 error
```

- [ ] **Step 5.3 · lint 全工程**

```bash
npm run lint
# 预期：0 error 0 warning（warning 不可新增）
```

- [ ] **Step 5.4 · 本地手测**

> AGENTS.md 要求"web_server 用 post 测试"，但本改动是纯前端，按 `npm run dev` 走人工流程即可，记录在 progress.md。

1. `npm run dev`
2. 用 reviewer（jh 或 sh）角色登录，进入「校审」面板
3. 选一个已有批注的任务
4. 观察批注区顶部出现「卡片列表 / 批注表格」tab
5. 点 "批注表格"，看到 `AnnotationTableView` 渲染所有批注
6. 双击任意行 → 应当切回卡片列表 + 3D 飞到该批注 + 该批注高亮
7. 刷新页面，预期保持在 table 模式（持久化生效）
8. Ribbon 点击「批注表格」按钮 → 同样能切到 table

把第 5–7 步的截图存到 `docs/verification/2026-05-17-reviewer-table-restore-screenshots/`。

- [ ] **Step 5.5 · 验证 ribbon dispatch 路径**

```bash
# 在 dev 控制台
import { requestReviewerWorkbenchViewMode } from '/src/components/review/reviewerWorkbenchViewModeBus.ts';
requestReviewerWorkbenchViewMode('table');
# 预期：审核面板立即切到 table
```

---

### Task 6 · 文档 / CHANGELOG / 防退化规则

- [ ] **Step 6.1 · 落地事故 ADR**

按 `开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md` 文档落地（由本 PR 同步附带创建，内容见配套 ADR）。

- [ ] **Step 6.2 · CHANGELOG**

在 Unreleased 段加：

```markdown
### Fixed
- **review/reviewer-workbench:** restore card-list ⇄ table tab in audit panel (regression from 028de56 reverse-rebase). 修复 ribbon「批注表格」按钮在校核面板上无响应。([2026-05-17-reviewer-annotation-table-restore-plan])
```

- [ ] **Step 6.3 · AGENTS.md 防御规则（plant3d-web）**

在 plant3d-web/AGENTS.md 的「测试指南」或「提交与 Pull Request 规范」段加：

```markdown
- 任何改动 `src/components/review/ReviewPanel.vue` 或 `DesignerCommentHandlingPanel.vue` 的 PR，**本地必须**至少跑过：

  ```bash
  npx vitest run src/components/review/ReviewPanel.test.ts \
                 src/components/review/DesignerCommentHandlingPanel.test.ts \
                 src/components/review/AnnotationTableView.test.ts \
                 src/components/review/reviewerWorkbenchViewModeBus.test.ts \
                 src/components/review/reviewerAnnotationItemAdapter.test.ts
  ```

  rebase / cherry-pick 引发的「整段消失式回归」必须靠这些用例兜底，禁止跳过。
```

- [ ] **Step 6.4 · commit 文档**

```bash
git add "开发文档/三维校审/审核面板批注表格视图回归事故复盘-2026-05-17.md" \
        docs/plans/2026-05-17-reviewer-annotation-table-restore-plan.md \
        CHANGELOG.md AGENTS.md
git commit -m "docs(review): add ADR + plan for reviewer table view restore + AGENTS.md regression guard"
```

---

## 5. 验收清单（合并前必过）

- [ ] `npm run type-check` 0 error
- [ ] `npm run lint` 0 new warning
- [ ] 5 个相关测试套件全绿（Task 5.1 命令）
- [ ] 本地手测 8 步全部通过，截图归档
- [ ] CHANGELOG Unreleased 段已更新
- [ ] AGENTS.md 防御规则已写入
- [ ] ADR 已落入 `开发文档/三维校审/`
- [ ] Commit 历史清晰：6 条独立 commit（adapter / script / template / tests / docs / changelog）
- [ ] PR 描述包含「Fixes regression introduced near 028de56 / merge 6ad374b」+ ADR 链接

---

## 6. 风险与缓解

| 风险 | 影响 | 概率 | 缓解 |
|---|---|---|---|
| `AnnotationWorkspaceItem` 字段与适配器假设不一致 | 高（编译挂） | 中 | Task 1.3 之前**必须**先 Read `annotationWorkspaceModel.ts`，按实际字段裁剪；测试覆盖每个字段 |
| ReviewPanel 当前的 `expandedAnnotationId / flyToAnnotationItem` 名字与计划不符 | 中（行为不正确） | 中 | Task 2.4 / 3.3 之前用 Grep 查准确名字；不行就在 commit 前自测一下 |
| 双击切回 split 后 3D 没飞到 | 中（用户体验） | 中 | Step 2.4 用 `await nextTick()` 解决 split 渲染时机；保留 fallback：表格模式下也允许"locate-annotation"事件直接飞 |
| persistence mock 写法和 DCH 不一致导致测试间互相污染 | 低 | 低 | `beforeEach(() => persistenceState.clear())` 必带 |
| ribbon dispatch 路径里 `panel.annotationTable` 在 reviewer 角色下没被 ribbonItemVisibility 放行 | 低 | 低 | PR 10 已配 `[DESIGNER, PROOFREADER, REVIEWER, MANAGER, ADMIN]`，回归确认即可 |
| embed / passive workflow 模式下表格视图打开异常 | 中 | 低 | Step 2.2 加 `if (resolvePassiveWorkflowMode()) annotationListViewMode.value = 'split';` 强制 split（保险） |

---

## 7. 回滚预案

每条 commit 都独立、可单独 revert。最坏情况：

```bash
# 全部回滚（按 commit 倒序）
git revert <commit-6-docs> <commit-5-smoke> <commit-4-tests> \
           <commit-3-template> <commit-2-script> <commit-1-adapter>
```

回滚后审核面板回到「只有卡片列表」的当前状态，不影响 designer 面板表格视图，不影响 ribbon 其他按钮。

---

## 8. 后续建议（不在本计划范围）

- **下一 PR · 数据源对齐：** 把当前 ReviewPanel 的本地 `AnnotationListItem` 整体迁到 `AnnotationWorkspaceItem`，消除 adapter；同时把 ReviewPanel 的卡片列表渲染抽出复用 `AnnotationWorkspace`（对齐 a644ba3 / DCH）。
- **下下 PR · 抽 viewMode switcher：** `AnnotationListModeSwitcher.vue`（接收 viewMode bus + persistence key 作为 props），DCH / ReviewPanel 共用，消灭"双胞胎组件"。
- **CI 升级：** plant3d-web 的 GitHub Actions 必跑 `src/components/review/**.test.ts` 子集，并在 PR check 上 enforce。
- **历史归档：** 加 `开发文档/三维校审/index.md` 把回归 commit、复盘 ADR、PR 8/9 设计文档串成一条线，便于新人理解上下文。

---

## 9. 关键文件锚点速查

| 用途 | 文件:行 |
|---|---|
| 故障组件（要改） | `src/components/review/ReviewPanel.vue` (~1993 行) |
| 表格视图组件（不动） | `src/components/review/AnnotationTableView.vue` |
| 视图模式 bus（不动） | `src/components/review/reviewerWorkbenchViewModeBus.ts` |
| Ribbon 按钮配置（不动） | `src/ribbon/ribbonConfig.ts:219` |
| DockLayout dispatch（不动） | `src/components/DockLayout.vue:29 / :1252` |
| 必死测试用例（要修） | `src/components/review/ReviewPanel.test.ts:1305 / 1340 / 1378 / 1440 / 1468 / 1517 / 1553 / 1594` |
| Onboarding 引导（不动） | `src/components/onboarding/roleGuides/designerGuide.ts:120` |
| 持久化 composable | `src/composables/useNavigationStatePersistence.ts` |
| Workspace item 类型 | `src/components/review/annotationWorkspaceModel.ts`（适配器实现前**必读**） |
| 原版完整实现参考 | `git show a644ba3:src/components/review/ReviewPanel.vue` |

---

## 10. 时间估算

| Task | 时间 |
|---|---|
| 1 · 适配器 + 单测 | 40 min |
| 2 · ReviewPanel script | 30 min |
| 3 · ReviewPanel template | 25 min |
| 4 · 测试 mock 修补 | 30 min |
| 5 · 跨套件回归 + 手测 + 截图 | 40 min |
| 6 · 文档 / CHANGELOG / AGENTS.md | 25 min |
| **合计** | **~3 小时**（含 review buffer） |

---

## 11. 执行记录（2026-05-17 实测，更新）

### 11.1 发现：Task 1 适配器**不必要**

执行 Task 1 时阅读 `src/components/review/annotationWorkspaceModel.ts` 与 `src/composables/useToolStore.ts` 后确认：

- `toolStore.annotations.value` 实际类型为 `AnnotationRecord[]`（与 `cloudAnnotations / rectAnnotations / obbAnnotations` 同），**可直接传给** `buildAnnotationWorkspaceItems({...})`。
- `AnnotationWorkspaceItem` 含 `statusKey / statusLabel / statusTone / priority / priorityLabel / priorityTone / activityAt` 等非平凡字段，由 `resolveWorkspaceStatus` + `getAnnotationWorkspacePriorityDisplay` 计算。手写适配器会重复 model 内部逻辑，且容易漂移。

→ **Task 1 取消**；改为在 `ReviewPanel.vue` 中直接：

```ts
const annotationWorkspaceItems = computed<AnnotationWorkspaceItem[]>(() =>
  buildAnnotationWorkspaceItems({
    annotations: toolStore.annotations.value,
    cloudAnnotations: toolStore.cloudAnnotations.value,
    rectAnnotations: toolStore.rectAnnotations.value,
    obbAnnotations: toolStore.obbAnnotations.value,
    getCommentCount: (type, id) => toolStore.getAnnotationComments(type, id).length,
  }),
);
```

文件变更清单（§3）相应调整：删除 `reviewerAnnotationItemAdapter.ts` 与 `.test.ts` 两项；`ReviewPanel.vue` 改动估算从 +85 升为 +95（含 computed + 3 个 handler）。

### 11.2 实际落地（Task 2 + Task 3 已完成）

- ✅ imports：`AnnotationTableView` + `buildAnnotationWorkspaceItems / AnnotationWorkspaceItem` + `clearReviewerWorkbenchViewModeRequest / useReviewerWorkbenchViewModeRequest` + `useNavigationStatePersistence` 全部按 §4-Step 2.1 加好
- ✅ state：`annotationListViewMode` ref + persistence key `plant3d-web-nav-state-reviewer-workbench-v1` + bus watch 全部就位
- ✅ computed：`annotationWorkspaceItems` 直接复用 `buildAnnotationWorkspaceItems`
- ✅ handlers：`handleTableSelectAnnotation` / `handleTableOpenAnnotation` / `handleTableCopyFeedback`
- ✅ template：在 `<!-- C2. 批注列表 -->` 之上插入 `data-testid="reviewer-annotation-list-view-mode-tabs"` 切换栏；卡片列表块加 `&& annotationListViewMode === 'split'` 收口；之后插入 `v-else-if="... === 'table'"` 分支 `<AnnotationTableView />`

### 11.3 验证结果

| 检查 | 命令 | 结果 |
|---|---|---|
| Type-check | `npm run type-check` | **0 error**（25s） |
| ESLint | `npx eslint src/components/review/ReviewPanel.vue` | **0 error 0 warn**（118s） |
| ReviewPanel.test.ts | `npx vitest run src/components/review/ReviewPanel.test.ts` | **15 fail / 19 pass**（baseline 19 fail / 15 pass，本次**转绿 5 条 · 引入 0 新 fail**） |
| AnnotationTableView.test.ts | 同上 | **0 fail**（baseline 即全绿） |
| reviewerWorkbenchViewModeBus.test.ts | 同上 | **0 fail**（baseline 即全绿） |
| DesignerCommentHandlingPanel.test.ts | 同上 | 17 fail（baseline 同样 17 fail；为 vue parser 解析存量问题，**与本次无关**） |

### 11.4 转绿用例明细（5 条）

| # | 用例 | 类别 |
|---|---|---|
| 1 | `Reviewer 表格持久化 viewMode：预置 table 后首屏即表格视图 · PR 8` | ★ 目标核心 |
| 2 | `Reviewer 响应 reviewerWorkbenchViewModeBus.request("table") · PR 9` | ★ 目标核心 |
| 3 | `Reviewer 表格 copy-feedback 事件正确分发 toast · PR 8` | ★ 目标核心 |
| 4 | `在 passive 模式下点击刷新会重新拉取可信快照并刷新模型显示` | 副产物（persistence 接入后联动恢复） |
| 5 | `keeps the core zones visible even when optional module storage is empty` | 副产物（同上） |

### 11.5 仍 fail 的 PR 8 用例（5 条 · 需走方案 B 才能转绿）

| 用例 | 阻塞点 |
|---|---|
| `Reviewer 工作台默认显示卡片列表，tab 切换到批注表格后渲染 AnnotationTableView · PR 8` | 期望 split 视图含 `[data-testid="annotation-workspace-root"]`，需要把 split 视图换成 `<AnnotationWorkspace>` 子组件 |
| `Reviewer 表格行双击 → 飞到 3D + 自动切回卡片列表 · PR 8` | 期望 `showModelByRefnosWithAck` 被调用；当前 `flyToAnnotationItem` 不走 showModel 路径 |
| `Reviewer 卡片筛选为待处理时，表格打开已修改批注仍定位该批注` | 需要 `<AnnotationWorkspace>` + filter pill |
| `Reviewer 表格内修改错误标记时，保存会带当前 formId 和 taskId` | `<AnnotationTableView>` 需启用编辑模式，传 `canEditItem` props 与编辑保存回调 |
| `Reviewer 表格内修改标题时，保存会带当前 formId 和 taskId` | 同上 |

这 5 条**超出本计划方案 A 范围**，属于「下一 PR · 数据源对齐」工作（详见 §8）。在 §8 已显式留出。

### 11.6 其余 8 条与本次无关的存量 fail

`confirmed record counts only canonical reviewer annotations` / `renders the workbench sections and normalized context fields` / `Dock 紧凑模式...` / `Dock 批注列表批量收起...` / `后端有确认记录但批注列表为空...` / `后端有 1 条确认记录和 1 条批注...` / `hides internal workflow actions in passive workflow mode` / `exposes automation hook to create new-shape text annotations for reviewer e2e` / `automation hook refreshes a persisted comment thread with formal review context`

→ baseline 已 fail，与本次目标无关。建议下个 sprint 单独立项「ReviewPanel.test.ts 存量 fail 清理」。

### 11.7 待办（移交用户）

- [ ] 用户决定是否 commit（AGENTS.md 要求只在用户明确请求时 commit）
- [ ] 本地手测 8 步流程（§4-Task 5.4）+ 截图归档
- [ ] CHANGELOG Unreleased 段添加 Fixed 条目（已起草，见 PR 描述模板）
- [ ] AGENTS.md 防御规则段添加（已起草，见 §4-Task 6.3）

---

> **执行结束后：** 主控 / 用户应当看到 reviewer 在审核面板里能自由切换「卡片列表 ↔ 批注表格」，ribbon 按钮也能联动；3 条目标 PR 8/9 测试转绿；AGENTS.md 写入了防御规则；事故 ADR 落库可追溯。剩余 5 条 PR 8 用例归属「下一 PR · 数据源对齐」追踪。
