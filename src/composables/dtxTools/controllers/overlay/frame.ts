/**
 * syncFromStore 一趟重建里各种类（文字 / 云线 / 矩形 / OBB）共用的输入：overlay 容器、画布分辨率、ADR-0050 降级查询。
 * 由 overlaySync 算一次传给 textOverlay / cloudOverlay / boxOverlay。
 */
import type { AnnotationOverlayKind } from '../../types';
import type { AnnotationDegrade } from '@/review/domain/bindingResolve';

export type OverlaySyncFrame = {
  overlay: HTMLElement;
  resolution: { width: number; height: number };
  degradeOf: (kind: AnnotationOverlayKind, id: string) => AnnotationDegrade | null;
};
