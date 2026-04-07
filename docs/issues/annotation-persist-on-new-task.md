# Issue: 重新新建单据时仍显示上一个单据的批注

## 问题描述

在三维校审流程中，当用户在 `InitiateReviewPanel` 中完成提资单创建后，点击"新建提资单"按钮重新创建新单据时，场景中仍然显示上一个单据的批注和测量数据。

## 复现步骤

1. 在 `InitiateReviewPanel` 中创建一个提资单并提交
2. 提交成功后，点击"新建提资单"按钮
3. 观察场景，发现上一个单据的批注仍然显示在场景中

## 根本原因分析

### 代码位置

- **问题文件**: `src/components/review/InitiateReviewPanel.vue`
- **相关文件**: `src/components/review/confirmedRecordsRestore.ts`

### 问题根源

1. **`resetForNewTask()` 函数不完整** (第 665-671 行)
   - 该函数只重置了表单数据（submitted、lastCreatedTask、notification、hydratedRestoreTaskId、selectedComponentRefno）
   - 但没有清除场景中的批注和测量数据

2. **`skipClearOnEmpty: true` 配置** (第 60 行)
   - `confirmedRecordsRestorer` 创建时设置了 `skipClearOnEmpty: true`
   - 这导致当 taskId 为 null 或记录为空时，`restoreConfirmedRecordsIntoScene()` 不会调用 `clearAll()` 清除场景
   - 见 `confirmedRecordsRestore.ts` 第 71-77 行：
     ```typescript
     if (!taskId || records.length === 0) {
       if (!options.skipClearOnEmpty) {  // 由于 skipClearOnEmpty=true，这里不会执行
         options.toolStore.clearAll();
         tools.syncFromStore();
       }
       lastRestoredSceneKey.value = restoreKey;
       return;
     }
     ```

3. **自动恢复机制** (第 367-380 行)
   - 组件有一个 watch 监听 `reviewStore.currentTask.value?.id` 和确认记录的变化
   - 当变化时自动调用 `restoreConfirmedRecordsIntoScene()`
   - 但由于 `skipClearOnEmpty: true`，新建单据时场景不会被清除

## 解决方案

### 修复代码

在 `resetForNewTask()` 函数中添加场景清除逻辑：

```typescript
function resetForNewTask() {
  submitted.value = false;
  lastCreatedTask.value = null;
  notification.value = { type: null, message: '', details: '' };
  hydratedRestoreTaskId.value = null;
  selectedComponentRefno.value = null;
  // 清除场景中的批注和测量，避免新建单据时显示上一个单据的批注
  toolStore.clearAll();
  viewerContext.tools.value?.syncFromStore();
  // 重置恢复器的场景键，确保下次不会跳过清除
  confirmedRecordsRestorer.lastRestoredSceneKey.value = null;
}
```

### 修复说明

1. **`toolStore.clearAll()`**: 清除工具存储中的所有批注和测量数据
2. **`viewerContext.tools.value?.syncFromStore()`**: 同步清除后的状态到查看器
3. **`confirmedRecordsRestorer.lastRestoredSceneKey.value = null`**: 重置恢复器的场景键，确保下次恢复时不会因为场景键相同而跳过清除

### 影响范围

- 仅影响 `InitiateReviewPanel` 中的"新建提资单"功能
- 不影响其他场景恢复逻辑
- 修复后，新建单据时场景会被正确清除

## 相关文件

- `src/components/review/InitiateReviewPanel.vue` - 主要修复文件
- `src/components/review/confirmedRecordsRestore.ts` - 批注恢复逻辑
- `src/composables/useToolStore.ts` - 工具存储管理

## 验证方法

1. 创建一个提资单并添加批注
2. 提交成功后点击"新建提资单"
3. 确认场景中的批注已被清除
4. 创建新批注，确认功能正常

## 修复状态

✅ 已修复 - 2026-04-07
