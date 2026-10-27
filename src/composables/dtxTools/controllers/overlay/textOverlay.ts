/**
 * 文字批注的 overlay：syncFromStore 的文字段与视口降级的文字引线段。从 overlaySync.ts 按种类拆出（拆分计划第 8 步 b），语句未改。
 */
import { Vector3 } from 'three';

import { getDefaultTextAnnotationLabelWorldPos, shouldRenderTextAnnotationCard } from '../../annotationRecords';
import { buildAnnotationLeaderStyle, createTextAnnotationLeader } from '../../leaderVisual';
import { makeTextAnnotationCardEl, makeTextAnnotationMarkerEl } from '../../overlayDom';
import { asVec3 } from '../../pipeMeasureMath';

import type { OverlaySyncFrame } from './frame';
import type { DtxToolsContext } from '../../context';
import type { createAnnotationInteraction } from '../annotationInteraction';
import type { AnnotationDegrade } from '@/review/domain/bindingResolve';

import { applyLeaderDegrade, sameDegrade } from '@/composables/annotationDegradeViewport';
import { buildRecordDegradeKey } from '@/composables/useAnnotationBindingResolve';

export type TextOverlayDeps = { annotation: ReturnType<typeof createAnnotationInteraction> };

export function createTextOverlay(ctx: DtxToolsContext, deps: TextOverlayDeps) {
  const { annotation } = deps;

  /** 文字批注：图钉 +（展开时）引线与文字卡，事件接到 annotationInteraction。原 syncFromStore 的 Text 段。 */
  function syncTextAnnotations(frame: OverlaySyncFrame): void {
    const { overlay, resolution, degradeOf } = frame;
    // ---------------- Text annotations ----------------
    for (const a of ctx.store.annotations.value) {
      if (!a.visible) continue;

      const worldPos = asVec3(a.worldPos);
      if (!worldPos) continue;
      const labelPos = asVec3(a.labelWorldPos) ?? getDefaultTextAnnotationLabelWorldPos(worldPos);
      const wp = new Vector3(...worldPos);
      const labelWorldPos = new Vector3(...labelPos);
      const degrade = degradeOf('text', a.id);
      const glyph = a.glyph || 'A';
      const marker = makeTextAnnotationMarkerEl(overlay, glyph, a.collapsed === true, { degrade, badge: true });
      if (a.severity) marker.dataset.severity = a.severity;
      ctx.overlays.markers.set(`anno:${a.id}`, {
        id: `anno:${a.id}`,
        worldPos: wp,
        el: marker,
        marker: { kind: 'text', annotationId: a.id, glyph, collapsed: a.collapsed === true, degrade },
      });
      marker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.detail > 1) return;
        annotation.scheduleTextAnnotationMarkerSingleClick(a.id);
      });
      marker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        annotation.handleTextAnnotationMarkerDoubleClick(a.id);
      });

      if (shouldRenderTextAnnotationCard(a.collapsed)) {
        const leader = createTextAnnotationLeader(wp, labelWorldPos, resolution);
        applyLeaderDegrade(leader, buildAnnotationLeaderStyle('text').color, degrade);
        ctx.toolsGroup.add(leader.root);
        ctx.overlays.textLeaders.set(`anno:${a.id}`, leader);

        const draft = annotation.getInlineTextAnnotationDraft('text', a.id, a);
        const label = makeTextAnnotationCardEl(overlay, draft.title, draft.description);
        if (a.severity) label.dataset.severity = a.severity;
        ctx.overlays.labels.set(`anno:${a.id}`, { id: `anno:${a.id}`, worldPos: labelWorldPos, el: label });

        const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
        const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
        const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

        label.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('text', a.id);
        });
        label.addEventListener('focusout', () => {
          queueMicrotask(() => {
            const activeElement = label.ownerDocument?.activeElement;
            if (activeElement && label.contains(activeElement)) return;
            annotation.commitInlineAnnotationDraft('text', a.id);
          });
        });

        dragHandle?.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          annotation.commitInlineAnnotationDraft('text', a.id);
          dragHandle.style.cursor = 'grabbing';
          annotation.beginTextAnnotationDrag(a.id, ev, labelWorldPos, wp);
          try {
            dragHandle.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }
        });
        dragHandle?.addEventListener('pointermove', (ev) => {
          if (ctx.textAnnotationDrag.value.annotationId !== a.id) return;
          annotation.continueTextAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointerup', (ev) => {
          if (ctx.textAnnotationDrag.value.annotationId !== a.id) return;
          dragHandle.style.cursor = 'grab';
          annotation.endTextAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointercancel', (ev) => {
          if (ctx.textAnnotationDrag.value.annotationId !== a.id) return;
          dragHandle.style.cursor = 'grab';
          annotation.endTextAnnotationDrag(ev);
        });

        titleInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('text', a.id);
        });
        titleInput?.addEventListener('input', () => {
          annotation.setInlineAnnotationDraft('text', a.id, {
            title: titleInput.value,
            description: descriptionInput?.value ?? draft.description,
          });
        });

        descriptionInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('text', a.id);
        });
        descriptionInput?.addEventListener('input', () => {
          annotation.setInlineAnnotationDraft('text', a.id, {
            title: titleInput?.value ?? draft.title,
            description: descriptionInput.value,
          });
        });

        if (ctx.store.pendingTextAnnotationEditId.value === a.id) {
          queueMicrotask(() => annotation.focusInlineAnnotationEditor('text', a.id));
        }
      }
    }
  }

  /** ADR-0050：文字批注引线按解析表就地换材质；回传是否有变化。原 applyBindingDegrade 的 textLeaders 段。 */
  function applyDegrades(degrades: ReadonlyMap<string, AnnotationDegrade>): boolean {
    let changed = false;
    for (const [key, leader] of ctx.overlays.textLeaders) {
      const degrade = degrades.get(buildRecordDegradeKey('text', key.slice('anno:'.length))) ?? null;
      if (sameDegrade(leader.degrade, degrade)) continue;
      changed = true;
      applyLeaderDegrade(leader, buildAnnotationLeaderStyle('text').color, degrade);
    }
    return changed;
  }

  return { syncTextAnnotations, applyDegrades };
}
