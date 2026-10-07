import type { Ref } from 'vue';

import type { ReviewClearanceResolution } from './reviewClearanceSnapshot';

export function createReviewClearanceConflictActions(controls: {
  resolve: (action: ReviewClearanceResolution['action']) => boolean;
  undo: () => boolean;
  recompare: () => boolean;
}, restorer: { restoreError: Ref<string | null>; restoreConfirmedRecordsIntoScene: (force?: boolean) => Promise<void> }) {
  async function run(action: () => boolean) {
    try {
      if (!action()) throw new Error('净距冲突所属任务或模型已变化，请重试回放');
      await restorer.restoreConfirmedRecordsIntoScene(true);
    } catch (error) { restorer.restoreError.value = error instanceof Error ? error.message : '净距冲突处理失败'; }
  }
  return { resolve: (action: ReviewClearanceResolution['action']) => run(() => controls.resolve(action)), undo: () => run(controls.undo), recompare: () => run(controls.recompare) };
}
