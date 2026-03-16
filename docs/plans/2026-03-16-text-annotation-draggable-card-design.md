# 文字批注可拖动 Card 与折叠图钉设计

**日期：** 2026-03-16

**目标：**
让 DTX 文字批注具备“图钉锚点 + 可拖动 card + 联动引线 + 折叠/展开”交互。图钉固定在批注创建时命中的三维位置，文字 card 可被拖动到新的三维标签点，引线实时连接图钉与 card；折叠后只显示地图式 `location pin`，双击该图标可展开，标题/描述直接在批注框内联编辑，不再依赖弹窗。

## 背景

当前文字批注只保存 `worldPos`，viewer 中渲染为一个图钉字符和一个 overlay card。card 的位置默认跟随 `worldPos`，无法拖动，也没有独立的引线终点语义。虽然矩形/云线批注已经具备 `leaderEndWorldPos` 一类“引线终点”字段，但文字批注尚未进入同一套交互模型。

同时，用户希望文字批注在不打扰视图时可以折叠成仅显示图钉的状态，并且通过双击图钉快速恢复展开。

## 范围

本期只改“文字批注”：

- 为 `AnnotationRecord` 增加独立的标签锚点与折叠状态
- 让文字批注 card 支持拖拽，拖拽时实时更新引线
- 让双击图钉在“展开/折叠”之间切换
- 让标题/描述在批注框内联编辑并稳定回写
- 补齐单测、持久化回归与 Playwright 截图回归

本期不做：

- 不同步改造云线/矩形/OBB 的拖拽 card
- 不新增新的批注面板编辑模式
- 不把文字 card 改成 Troika/CSS2D 3D 文本系统，继续沿用 overlay card

## 设计决策

### 1. 数据模型

在 `src/composables/useToolStore.ts` 的 `AnnotationRecord` 中增加：

- `labelWorldPos?: Vec3`
- `collapsed?: boolean`

语义如下：

- `worldPos`：图钉锚点，始终指向模型命中点，不因拖拽 card 改变
- `labelWorldPos`：展开态 card 的世界锚点；若为空，则在渲染时按默认偏移推导并在创建时写入
- `collapsed`：是否折叠成仅图钉显示；默认 `false`

持久化继续走 `PersistedStateV4`，不再升版本号，因为只是扩展 `annotations[]` 中对象字段，旧数据可通过兜底默认值兼容。

### 2. 交互语义

- 单击图钉：激活当前文字批注
- 双击图钉：在展开/折叠之间切换
- 单击 card：激活当前文字批注
- 标题/描述直接在 card 内编辑，离开 card、拖拽前、点击图钉前都先提交草稿
- 拖动 card：实时更新 `labelWorldPos`

拖拽只作用在 card，不作用在图钉，因此引线语义始终明确：

- 起点 = `worldPos`（图钉）
- 终点 = `labelWorldPos`（card）

### 3. 渲染行为

展开态：

- 显示图钉 marker
- 显示 card label
- 显示图钉到 card 的 leader

折叠态：

- 仅显示地图式 `location pin` marker
- 不显示 card
- 不显示 leader

默认新建文字批注时应自动进入展开态，并把焦点放到 card 内标题输入框，便于立即输入标题/描述。

### 4. 拖拽坐标模型

拖拽过程继续基于 overlay 进行，但最终回写为世界坐标：

1. 拿到图钉 `worldPos` 对应的 `ndcZ`
2. 记录 card 当前屏幕中心坐标
3. 监听 pointer move，得到新的 overlay 坐标
4. 使用现有 `overlayToWorld()` 将新屏幕点投回世界坐标，写入 `labelWorldPos`

这里采用和云线批注相同的“overlay 坐标转世界坐标”思路，避免引入第二套坐标系。

### 5. 技术切入点

- `src/composables/useToolStore.ts`
  - 扩展 `AnnotationRecord`
  - 确保持久化/导入对新增字段兼容
- `src/composables/useDtxTools.ts`
  - 为文字批注增加默认 `labelWorldPos` 计算
  - 绘制文字批注 leader
  - 增加文字 card 拖拽状态机
  - 区分图钉双击折叠/展开 与 card 内联编辑
- `src/components/tools/AnnotationPanel.vue`
  - 移除文字批注弹窗，保留其它批注类型现有弹窗
- `e2e/dtx-annotation-visual.spec.ts`
  - 补文字批注创建、内联编辑、拖动、折叠、双击展开截图

## 验收标准

1. 创建文字批注后默认显示：图钉 + 引线 + card
2. 拖动 card 时，引线终点跟随更新，图钉位置不变
3. 刷新页面后，拖拽后的 card 位置仍能恢复
4. 双击图钉后，文字批注可在展开/折叠之间切换
5. 标题/描述直接在 card 内编辑并稳定回写，不弹出编辑框
6. 自动化截图能产出：
   - 展开态
   - 拖动后
   - 折叠态
   - 双击图钉重新展开
