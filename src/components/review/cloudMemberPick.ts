import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';

import { findNounByRefnoAcrossAllDbnos } from '@/composables/useDbnoInstancesDtxLoader';
import { useToolStore } from '@/composables/useToolStore';
import { emitToast } from '@/ribbon/toastBus';

/**
 * 从批注详情发起「添加关联元素」：复用三维点选拾取，Enter 确认后写成 member 绑定。
 *
 * 只增 member——锚点构件不可更换（ADR-0051），换锚点等于批注搬家，
 * 几何签名变化会改 annotationKey、破坏跨快照评论归并。
 * 保存链路是纯前端的：改动落在 store record 上，随既有校审记录整体保存。
 *
 * 校审面板与设计处理面板共用这一份，避免两块双胞胎面板各写一遍再各自漂移。
 */
export function startCloudMemberPick(item: AnnotationWorkspaceItem): void {
  if (item.type !== 'cloud') return;
  const store = useToolStore();
  store.startPickRefno([], (refnos) => {
    const added = store.addCloudAnnotationMembers(
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
