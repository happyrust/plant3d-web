/**
 * overlay 宿主：工具层三维父节点挂到场景、overlay DOM 整体清理、拖框（marquee）DOM 的建 / 藏 / 样式 / 几何。
 * 不含业务状态；拖框的交互态 ctx.marqueeState 由 cloudCreationFlow 拥有，这里只在 hideMarquee 里复位。
 * 从 useDtxTools.ts 搬出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 6 步），实现未改；图钉聚合 DOM 的清理经 hooks.clearPinClusterDom 回到 cloudLod。
 */
import { ensureDiv } from '../overlayDom';

import type { DtxToolsContext } from '../context';

export type OverlayHostHooks = {
  clearPinClusterDom: () => void;
};

export function createOverlayHost(ctx: DtxToolsContext, hooks: OverlayHostHooks) {
  function ensureToolsGroupAttached() {
    const viewer = ctx.dtxViewerRef.value;
    if (!viewer) return;
    if (ctx.toolsGroup.parent !== viewer.scene) {
      try {
        ctx.toolsGroup.parent?.remove(ctx.toolsGroup);
      } catch {
        // ignore
      }
      viewer.scene.add(ctx.toolsGroup);
    }
  }

  function clearOverlayEls() {
    hooks.clearPinClusterDom();
    for (const it of ctx.overlays.labels.values()) {
      try { it.el.remove(); } catch { /* ignore */ }
    }
    ctx.overlays.labels.clear();
    for (const it of ctx.overlays.markers.values()) {
      try { it.el.remove(); } catch { /* ignore */ }
    }
    ctx.overlays.markers.clear();
    for (const it of ctx.overlays.cloudShapes.values()) {
      try { it.badgeEl?.remove(); } catch { /* ignore */ }
    }
    ctx.overlays.cloudShapes.clear();
    ctx.overlays.rectShapes.clear();
    ctx.overlays.obbShapes.clear();
  }

  function ensureMarqueeDiv() {
    const overlay = ctx.overlayContainerRef.value;
    if (!overlay) return null;
    if (ctx.marqueeDiv.value && ctx.marqueeDiv.value.parentElement === overlay) return ctx.marqueeDiv.value;

    if (ctx.marqueeDiv.value) {
      try { ctx.marqueeDiv.value.remove(); } catch { /* ignore */ }
    }

    ctx.marqueeDiv.value = ensureDiv(
      overlay,
      'dtx-marquee',
      [
        'position:absolute',
        'display:none',
        'left:0',
        'top:0',
        'width:0',
        'height:0',
        'pointer-events:none',
        'z-index:930',
      ].join(';')
    );
    return ctx.marqueeDiv.value;
  }

  function hideMarquee() {
    ctx.marqueeState.value = { active: false, pointerId: null, startClient: null, startCanvas: null, currentCanvas: null };
    const div = ctx.marqueeDiv.value;
    if (div) div.style.display = 'none';
  }

  function updateMarqueeStyle(mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box', dx: number) {
    const div = ensureMarqueeDiv();
    if (!div) return;
    div.style.display = 'block';
    if (mode === 'annotation_cloud') {
      div.style.border = '3px solid #dc2626';
      div.style.borderRadius = '8px';
      div.style.background = 'rgba(220, 38, 38, 0.08)';
      div.style.boxShadow = '0 0 0 2px rgba(220, 38, 38, 0.3), inset 0 0 8px rgba(220, 38, 38, 0.1)';
    } else {
      div.style.border = dx >= 0 ? '2px dashed #333' : '2px solid #333';
      div.style.borderRadius = '0';
      div.style.background = 'rgba(0,0,0,0.06)';
      div.style.boxShadow = 'none';
    }
  }

  function updateMarqueeRect(start: { x: number; y: number }, end: { x: number; y: number }) {
    const div = ensureMarqueeDiv();
    if (!div) return;
    const x1 = Math.min(start.x, end.x);
    const y1 = Math.min(start.y, end.y);
    const x2 = Math.max(start.x, end.x);
    const y2 = Math.max(start.y, end.y);
    div.style.left = `${x1}px`;
    div.style.top = `${y1}px`;
    div.style.width = `${x2 - x1}px`;
    div.style.height = `${y2 - y1}px`;
  }

  return {
    ensureToolsGroupAttached,
    clearOverlayEls,
    ensureMarqueeDiv,
    hideMarquee,
    updateMarqueeStyle,
    updateMarqueeRect,
  };
}
