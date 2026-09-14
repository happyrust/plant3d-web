import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';

import { findNounByRefnoAcrossAllDbnos } from '@/composables/useDbnoInstancesDtxLoader';
import { useToolStore } from '@/composables/useToolStore';
import { emitToast } from '@/ribbon/toastBus';

/**
 * 从批注详情发起「添加关联元素」：复用三维点选拾取，Enter 确认后写成 member 绑定。
 * 四类批注（text / cloud / rect / obb）共用（ADR-0049 统一为带角色绑定）。
 *
 * 只增 member——锚点构件不可更换（ADR-0051），换锚点等于批注搬家，
 * 几何签名变化会改 annotationKey、破坏跨快照评论归并。
 * 保存链路是纯前端的：改动落在 store record 上，随既有校审记录整体保存。
 *
 * 校审面板与设计处理面板共用这一份，避免两块双胞胎面板各写一遍再各自漂移。
 */
export function startAnnotationMemberPick(item: AnnotationWorkspaceItem): void {
  const store = useToolStore();
  store.startPickRefno([], (refnos) => {
    const added = store.addAnnotationMembers(
      item.type,
      item.id,
      refnos,
      (refno) => findNounByRefnoAcrossAllDbnos(refno) ?? undefined,
    );
    if (added > 0) {
      emitToast({ message: `已添加 ${added} 个关联元素`, level: 'success' });
      return;
    }
    emitToast({ message: '没有新增关联元素：未选中构件，或都已在列表中', level: 'warning' });
  });
}

/** @deprecated 请改用 `startAnnotationMemberPick`；保留旧名给既有调用方过渡，行为已覆盖四类批注。 */
export const startCloudMemberPick = startAnnotationMemberPick;
