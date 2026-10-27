/**
 * 矩形 / OBB 批注的 overlay：syncFromStore 的 Rect / OBB 段与视口降级的线框段。从 overlaySync.ts 按种类拆出（拆分计划第 8 步 b），语句未改。
 */
import { Vector3 } from 'three';

import { shouldRenderTextAnnotationCard, toggleTextAnnotationCollapsed } from '../../annotationRecords';
import { makeInlineAnnotationCardEl, makeTextAnnotationMarkerEl } from '../../overlayDom';
import { applyBoxOverlayDegrade, createObbAnnotationVisual, createRectAnnotationVisual, resolveObbAnnotationAnchorWorldPos } from '../../visuals';

import type { OverlaySyncFrame } from './frame';
import type { DtxToolsContext } from '../../context';
import type { ObbOverlayEl, RectOverlayEl } from '../../types';
import type { createAnnotationInteraction } from '../annotationInteraction';
import type { AnnotationDegrade } from '@/review/domain/bindingResolve';

import { sameDegrade } from '@/composables/annotationDegradeViewport';
import { buildRecordDegradeKey } from '@/composables/useAnnotationBindingResolve';

export type BoxOverlayDeps = { annotation: ReturnType<typeof createAnnotationInteraction> };

export function createBoxOverlay(ctx: DtxToolsContext, deps: BoxOverlayDeps) {
  const { annotation } = deps;

  /** 矩形批注：线框 + 小针 +（展开时）引线与内联文字框。原 syncFromStore 的 Rect 段。 */
  function syncRectAnnotations(frame: OverlaySyncFrame): void {
    const { overlay, resolution, degradeOf } = frame;
    // ---------------- Rect annotations (OBB rectangle) ----------------
    for (const r of ctx.store.rectAnnotations.value) {
      if (!r.visible) continue;

      const visual = createRectAnnotationVisual(r, resolution);
      if (!visual) continue;
      // box + pin 始终加入；leader 随 collapsed 控制（与文字 / 云线一致）。
      ctx.toolsGroup.add(visual.box, visual.pin);
      if (shouldRenderTextAnnotationCard(r.collapsed)) {
        ctx.toolsGroup.add(visual.leader.root);
      }

      const rectAnchor = new Vector3(...r.anchorWorldPos);
      const rectDegrade = degradeOf('rect', r.id);
      const rectEntry: RectOverlayEl = {
        id: `rect:${r.id}`,
        worldPos: rectAnchor,
        labelWorldPos: (r.leaderEndWorldPos ? new Vector3(...r.leaderEndWorldPos) : visual.labelWorldPos).clone(),
        leader: visual.leader,
        box: visual.box,
        pin: visual.pin,
        lineColor: visual.lineColor,
        boxDashSize: visual.boxDashSize,
        pinDashSize: visual.pinDashSize,
        degrade: null,
      };
      // ADR-0050：成员 missing 时线框 / 小针 / 引线灰虚线（与云线同一套）
      applyBoxOverlayDegrade(rectEntry, 'rect', rectDegrade);
      ctx.overlays.rectShapes.set(rectEntry.id, rectEntry);

      // 新增 DOM marker：与 cloud 一致，提供「双击图钉收起 / 展开」入口。
      const rectMarker = makeTextAnnotationMarkerEl(overlay, 'R', r.collapsed === true, { degrade: rectDegrade, badge: true });
      ctx.overlays.markers.set(`rect:${r.id}`, {
        id: `rect:${r.id}`,
        worldPos: rectAnchor,
        el: rectMarker,
        marker: { kind: 'rect', annotationId: r.id, glyph: 'R', collapsed: r.collapsed === true, degrade: rectDegrade },
      });
      rectMarker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.detail > 1) return;
        annotation.activateAnnotation('rect', r.id);
      });
      rectMarker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        ctx.store.setRectAnnotationsCollapsed([r.id], toggleTextAnnotationCollapsed(r.collapsed));
        annotation.activateAnnotation('rect', r.id);
      });

      if (shouldRenderTextAnnotationCard(r.collapsed)) {
        const draft = annotation.getInlineTextAnnotationDraft('rect', r.id, r);
        const label = makeInlineAnnotationCardEl(overlay, '矩形批注', draft.title, draft.description);
        if (r.severity) label.dataset.severity = r.severity;
        const labelWorldPos = r.leaderEndWorldPos ? new Vector3(...r.leaderEndWorldPos) : visual.labelWorldPos;
        ctx.overlays.labels.set(`rect:${r.id}`, { id: `rect:${r.id}`, worldPos: labelWorldPos, el: label });
        const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
        const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
        const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;
        label.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('rect', r.id);
        });
        label.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          annotation.focusInlineAnnotationEditor('rect', r.id);
        });
        label.addEventListener('focusout', () => {
          queueMicrotask(() => {
            const activeElement = label.ownerDocument?.activeElement;
            if (activeElement && label.contains(activeElement)) return;
            annotation.commitInlineAnnotationDraft('rect', r.id);
          });
        });
        dragHandle?.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          annotation.commitInlineAnnotationDraft('rect', r.id);
          dragHandle.style.cursor = 'grabbing';
          annotation.beginInlineOverlayAnnotationDrag('rect', r.id, ev, labelWorldPos, rectAnchor);
          try {
            dragHandle.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }
        });
        dragHandle?.addEventListener('pointermove', (ev) => {
          if (ctx.inlineOverlayAnnotationDrag.value.annotationId !== r.id || ctx.inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
          annotation.continueInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointerup', (ev) => {
          if (ctx.inlineOverlayAnnotationDrag.value.annotationId !== r.id || ctx.inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
          dragHandle.style.cursor = 'grab';
          annotation.endInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointercancel', (ev) => {
          if (ctx.inlineOverlayAnnotationDrag.value.annotationId !== r.id || ctx.inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
          dragHandle.style.cursor = 'grab';
          annotation.endInlineOverlayAnnotationDrag(ev);
        });
        titleInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('rect', r.id);
        });
        titleInput?.addEventListener('input', () => {
          annotation.setInlineAnnotationDraft('rect', r.id, {
            title: titleInput.value,
            description: descriptionInput?.value ?? draft.description,
          });
        });
        descriptionInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('rect', r.id);
        });
        descriptionInput?.addEventListener('input', () => {
          annotation.setInlineAnnotationDraft('rect', r.id, {
            title: titleInput?.value ?? draft.title,
            description: descriptionInput.value,
          });
        });

        if (ctx.store.pendingRectAnnotationEditId.value === r.id) {
          queueMicrotask(() => annotation.focusInlineAnnotationEditor('rect', r.id));
        }
      }
    }
  }

  /** OBB 批注：线框 + 小针 +（展开时）引线与内联文字框。原 syncFromStore 的 OBB 段。 */
  function syncObbAnnotations(frame: OverlaySyncFrame): void {
    const { overlay, resolution, degradeOf } = frame;
    // ---------------- OBB annotations ----------------
    for (const o of ctx.store.obbAnnotations.value) {
      if (!o.visible) continue;
      const visual = createObbAnnotationVisual(o, resolution);
      if (!visual) continue;
      // box + pin 始终加入；leader 随 collapsed 控制（与文字 / 云线 / 矩形一致）。
      ctx.toolsGroup.add(visual.box, visual.pin);
      if (shouldRenderTextAnnotationCard(o.collapsed)) {
        ctx.toolsGroup.add(visual.leader.root);
      }

      const anchorWorldPos = resolveObbAnnotationAnchorWorldPos(o);
      const obbDegrade = degradeOf('obb', o.id);
      const obbEntry: ObbOverlayEl = {
        id: `obb:${o.id}`,
        worldPos: anchorWorldPos,
        labelWorldPos: visual.labelWorldPos.clone(),
        leader: visual.leader,
        box: visual.box,
        pin: visual.pin,
        lineColor: visual.lineColor,
        boxDashSize: visual.boxDashSize,
        pinDashSize: visual.pinDashSize,
        degrade: null,
      };
      // ADR-0050：成员 missing 时线框 / 小针 / 引线灰虚线（与云线 / 矩形同一套）
      applyBoxOverlayDegrade(obbEntry, 'obb', obbDegrade);
      ctx.overlays.obbShapes.set(obbEntry.id, obbEntry);

      // 新增 DOM marker：与 cloud / rect 一致，提供「双击图钉收起 / 展开」入口。
      const obbMarker = makeTextAnnotationMarkerEl(overlay, 'O', o.collapsed === true, { degrade: obbDegrade, badge: true });
      ctx.overlays.markers.set(`obb:${o.id}`, {
        id: `obb:${o.id}`,
        worldPos: anchorWorldPos,
        el: obbMarker,
        marker: { kind: 'obb', annotationId: o.id, glyph: 'O', collapsed: o.collapsed === true, degrade: obbDegrade },
      });
      obbMarker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.detail > 1) return;
        annotation.activateAnnotation('obb', o.id);
      });
      obbMarker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        ctx.store.setObbAnnotationsCollapsed([o.id], toggleTextAnnotationCollapsed(o.collapsed));
        annotation.activateAnnotation('obb', o.id);
      });

      if (shouldRenderTextAnnotationCard(o.collapsed)) {
        const draft = annotation.getInlineTextAnnotationDraft('obb', o.id, o);
        const label = makeInlineAnnotationCardEl(overlay, 'OBB 批注', draft.title, draft.description);
        if (o.severity) label.dataset.severity = o.severity;
        ctx.overlays.labels.set(`obb:${o.id}`, { id: `obb:${o.id}`, worldPos: visual.labelWorldPos.clone(), el: label });
        const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
        const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
        const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

        label.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('obb', o.id);
        });
        label.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          annotation.focusInlineAnnotationEditor('obb', o.id);
        });
        label.addEventListener('focusout', () => {
          queueMicrotask(() => {
            const activeElement = label.ownerDocument?.activeElement;
            if (activeElement && label.contains(activeElement)) return;
            annotation.commitInlineAnnotationDraft('obb', o.id);
          });
        });
        dragHandle?.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          annotation.commitInlineAnnotationDraft('obb', o.id);
          dragHandle.style.cursor = 'grabbing';
          annotation.beginInlineOverlayAnnotationDrag('obb', o.id, ev, visual.labelWorldPos.clone(), anchorWorldPos);
          try {
            dragHandle.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }
        });
        dragHandle?.addEventListener('pointermove', (ev) => {
          if (ctx.inlineOverlayAnnotationDrag.value.annotationId !== o.id || ctx.inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
          annotation.continueInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointerup', (ev) => {
          if (ctx.inlineOverlayAnnotationDrag.value.annotationId !== o.id || ctx.inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
          dragHandle.style.cursor = 'grab';
          annotation.endInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointercancel', (ev) => {
          if (ctx.inlineOverlayAnnotationDrag.value.annotationId !== o.id || ctx.inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
          dragHandle.style.cursor = 'grab';
          annotation.endInlineOverlayAnnotationDrag(ev);
        });
        titleInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('obb', o.id);
        });
        titleInput?.addEventListener('input', () => {
          annotation.setInlineAnnotationDraft('obb', o.id, {
            title: titleInput.value,
            description: descriptionInput?.value ?? draft.description,
          });
        });
        descriptionInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('obb', o.id);
        });
        descriptionInput?.addEventListener('input', () => {
          annotation.setInlineAnnotationDraft('obb', o.id, {
            title: titleInput?.value ?? draft.title,
            description: descriptionInput.value,
          });
        });

        if (ctx.store.pendingObbEditId.value === o.id) {
          queueMicrotask(() => annotation.focusInlineAnnotationEditor('obb', o.id));
        }
      }
    }
  }

  /** ADR-0050：rect / obb 的线框 / 小针 / 引线按解析表就地换材质；回传是否有变化。原 applyBindingDegrade 的 rect / obb 段。 */
  function applyDegrades(degrades: ReadonlyMap<string, AnnotationDegrade>): boolean {
    let changed = false;
    for (const [kind, shapes] of [['rect', ctx.overlays.rectShapes], ['obb', ctx.overlays.obbShapes]] as const) {
      for (const entry of shapes.values()) {
        const degrade = degrades.get(buildRecordDegradeKey(kind, entry.id.slice(kind.length + 1))) ?? null;
        if (sameDegrade(entry.degrade, degrade)) continue;
        changed = true;
        applyBoxOverlayDegrade(entry, kind, degrade);
      }
    }
    return changed;
  }

  return { syncRectAnnotations, syncObbAnnotations, applyDegrades };
}
