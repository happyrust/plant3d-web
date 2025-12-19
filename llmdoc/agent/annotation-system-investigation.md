<!-- Investigation Report: Annotation System with Multi-Role Comments/Review Feature -->

### Code Sections (The Evidence)

#### 批注类型定义
- `src/composables/useToolStore.ts` (`AnnotationRecord`): 文字批注类型，包含 id, entityId, worldPos, visible, glyph, title, description, createdAt, refno 字段
- `src/composables/useToolStore.ts` (`CloudAnnotationRecord`): 云线批注类型，包含 id, objectIds, anchorWorldPos, visible, title, description, createdAt, refnos 字段
- `src/composables/useToolStore.ts` (`RectAnnotationRecord`): 矩形批注类型，包含 id, corners, visible, title, description, createdAt 字段
- `src/composables/useToolStore.ts` (`ObbAnnotationRecord`): OBB框选批注类型，包含 id, objectIds, obb, labelWorldPos, anchor, visible, title, description, createdAt, refnos 字段

#### 持久化数据结构
- `src/composables/useToolStore.ts` (`PersistedStateV3`): 第三版持久化状态，支持 measurements, annotations, obbAnnotations, cloudAnnotations, rectAnnotations
- `src/composables/useToolStore.ts` (`loadPersisted()` 函数): 从 localStorage 加载数据，支持 V1/V2/V3 向上兼容
- `src/composables/useToolStore.ts` (`normalizeV1/V2/V3` 函数): 数据版本兼容性处理

#### 批注管理函数
- `src/composables/useToolStore.ts` (`addAnnotation`, `updateAnnotation`, `removeAnnotation`): 文字批注的增删改操作
- `src/composables/useToolStore.ts` (`addObbAnnotation`, `updateObbAnnotation`, `removeObbAnnotation`): OBB批注的增删改操作
- `src/composables/useToolStore.ts` (`addCloudAnnotation`, `updateCloudAnnotation`, `removeCloudAnnotation`): 云线批注的增删改操作
- `src/composables/useToolStore.ts` (`addRectAnnotation`, `updateRectAnnotation`, `removeRectAnnotation`): 矩形批注的增删改操作
- `src/composables/useToolStore.ts` (`exportJSON`, `importJSON`): 批注导入导出函数

#### 审核系统存储
- `src/composables/useReviewStore.ts` (`ConfirmedRecord`): 审核确认记录类型，包含 annotations, cloudAnnotations, rectAnnotations, obbAnnotations, measurements
- `src/composables/useReviewStore.ts` (`addConfirmedRecord`): 添加确认记录，批量保存多种类型的批注

#### 批注创建流程
- `src/composables/useXeokitTools.ts` (`createAnnotation` 函数, 行1409): 创建文字批注，调用 xeokit AnnotationsPlugin，获取关联的 refno
- `src/composables/useXeokitTools.ts` (行1890): 调用 `store.addAnnotation(created)` 添加到批注列表
- `src/composables/useXeokitTools.ts` (行880-884): OBB批注创建，设置默认标题为 "OBB 批注 N"

#### 批注编辑和显示
- `src/components/tools/AnnotationPanel.vue` (`updateTitle`, `updateDescription`): 编辑批注标题和描述，自动同步到 store
- `src/components/tools/AnnotationPanel.vue` (行163-197): 支持编辑所有四种批注类型
- `src/components/tools/AnnotationPanel.vue` (行287-358): 创建后编辑对话框（OBB 和文字批注）
- `src/components/tools/AnnotationPanel.vue` (行265-281): 高亮关联对象功能（refno/refnos）

#### 用户角色定义
- `src/types/auth.ts` (`UserRole` 枚举): ADMIN, MANAGER, REVIEWER, PROOFREADER, DESIGNER, VIEWER 六个角色
- `src/types/auth.ts` (`User` 类型): 用户类型包含 id, username, email, name, avatar, role, department, phone, status, createdAt, updatedAt, lastLoginAt
- `src/types/auth.ts` (`hasRole`, `hasAnyRole` 函数): 角色检查工具函数
- `src/types/auth.ts` (`isReviewer` 函数): 检查是否为审核人员（包括 ADMIN, MANAGER, REVIEWER, PROOFREADER）

### Report (The Answers)

#### result

##### 1. 批注类型的完整定义和使用方式

所有四种批注类型的定义如下：

- **AnnotationRecord** (文字批注)：单个实体的批注，包含 entityId, worldPos, refno
- **CloudAnnotationRecord** (云线批注)：多对象云线，包含 objectIds, anchorWorldPos, refnos
- **RectAnnotationRecord** (矩形批注)：屏幕矩形区域，包含 corners 四个测量点
- **ObbAnnotationRecord** (OBB框选批注)：包围盒批注，包含 objectIds, obb 几何信息, refnos

共有字段：id, visible, title, description, createdAt

##### 2. 批注编辑和显示逻辑

编辑在 AnnotationPanel.vue 中通过以下方式实现：
- `updateTitle()` 和 `updateDescription()` 函数直接调用 `store.updateAnnotation/CloudAnnotation/RectAnnotation/ObbAnnotation()`
- 编辑后自动同步到 Vue reactive store，进而通过 watch 保存到 localStorage
- 支持创建后立即弹出编辑对话框（pendingTextAnnotationEditId 和 pendingObbEditId）

##### 3. ConfirmedRecord 如何存储批注数据

ConfirmedRecord 是 useReviewStore 中的核心数据结构，用于批量存储审核确认的数据：
```
{
  id: string,
  type: 'batch',
  annotations: AnnotationRecord[],
  cloudAnnotations: CloudAnnotationRecord[],
  rectAnnotations: RectAnnotationRecord[],
  obbAnnotations: ObbAnnotationRecord[],
  measurements: MeasurementRecord[],
  confirmedAt: number,
  note: string
}
```
每个 ConfirmedRecord 包含一份完整的批注快照，用于审核流程中的版本管理。

##### 4. 批注类型的使用位置详细映射

**批注创建流程:**
- 用户在 ViewerPanel 中选择批注模式（annotation/annotation_cloud/annotation_rect/annotation_obb）
- 调用 useXeokitTools 中的事件处理函数
- createAnnotation() 创建批注对象并调用 store.addAnnotation()
- 系统生成唯一 ID、名称和 timestamp，自动获取关联 refno

**批注更新流程:**
- 用户在 AnnotationPanel 中编辑标题/描述
- 触发 updateTitle/updateDescription 函数
- 调用对应的 store.update*Annotation() 方法
- watch 监听 store 变化自动保存到 localStorage

**批注导入导出:**
- exportJSON() 导出 PersistedStateV3 格式（包含所有四种批注类型）
- importJSON() 支持 V1/V2/V3 版本的导入，自动做数据版本兼容转换
- normalizeV1/V2/V3 函数处理版本迁移

**批注持久化存储:**
- V3 格式：version=3 + measurements + annotations + obbAnnotations + cloudAnnotations + rectAnnotations
- 使用 localStorage 的 STORAGE_KEY_V3 = 'plant3d-web-tools-v3'
- 采用深层 watch 监听，保证每次修改都自动持久化

##### 5. 添加 comments 字段的实现方案

为支持多角色意见/评论功能，需要：

1. **定义评论数据类型** - 在 src/types/auth.ts 中添加：
```typescript
export type AnnotationComment = {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  content: string;
  createdAt: number;
  updatedAt?: number;
  isResolved?: boolean;
};
```

2. **扩展四个批注类型** - 在 src/composables/useToolStore.ts 中添加字段：
```typescript
export type AnnotationRecord = {
  // ... 现有字段
  comments?: AnnotationComment[];
};
```
同样扩展 CloudAnnotationRecord, RectAnnotationRecord, ObbAnnotationRecord

3. **更新持久化格式** - 需要创建 PersistedStateV4 以支持新的评论字段
- 修改 normalizeV3() 在转换时初始化 comments: [] 数组
- 实现 PersistedStateV4 向后兼容

4. **扩展 ConfirmedRecord** - 评论应该被冻结在确认记录中

5. **添加评论管理函数** - 在 useToolStore.ts 中：
```typescript
function addCommentToAnnotation(annotationId: string, comment: AnnotationComment)
function removeCommentFromAnnotation(annotationId: string, commentId: string)
function updateCommentInAnnotation(annotationId: string, commentId: string, patch: Partial<AnnotationComment>)
```

6. **UI 组件** - 在 AnnotationPanel.vue 中添加评论显示区域和输入框

#### conclusions

- 批注系统已经完全抽象为类型安全的 TypeScript 接口，支持四种不同的批注几何类型
- 所有批注类型共享通用的生命周期管理（创建、更新、删除、显示/隐藏）
- 持久化采用版本化设计，确保向后兼容性
- 审核系统通过 ConfirmedRecord 实现快照式的版本管理
- 用户角色系统已在 auth.ts 中定义，支持 REVIEWER, PROOFREADER 等审核角色
- 关联对象功能已通过 refno/refnos 字段实现，可用于权限控制和审核流程

#### relations

- `useToolStore.ts` 定义所有批注类型和生命周期管理函数
- `AnnotationPanel.vue` 调用 useToolStore 的 update* 函数执行编辑操作
- `useXeokitTools.ts` 中的 createAnnotation 创建新批注并调用 store.addAnnotation
- `useReviewStore.ts` 的 ConfirmedRecord 聚合所有四种批注类型进行批量存储
- `auth.ts` 定义用户角色，可用于权限控制和评论权限管理
- localStorage 通过 watch 监听 store 变化自动持久化所有四种批注类型
- 批注导入导出通过 V3 格式统一处理四种类型，支持版本兼容
