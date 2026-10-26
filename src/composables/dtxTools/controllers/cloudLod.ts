/**
 * P4 LOD（方案 §9.3）与 pin 档图钉的屏幕聚合：按预算 / 滞回规划每条云线的档位，悬停临时升档，聚合徽标 + 成员弹出列表 + 相机飞到一组云线。
 * 帧间状态在 ctx.cloudLod（所有者是本控制器）；各档的应用（轮廓 / 文字框的挂卸）仍在 overlaySync 的渲染循环里。
 * 从 useDtxTools.ts 搬出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 7 步），实现未改；重排经 hooks.updateOverlayPositions，选中成员经 hooks.activateAnnotation。
 */
import { Vector3 } from 'three';

import { aabbFromPoints, clamp, escapeAnnotationLabelText } from '../geometry';
import { ensureDiv } from '../overlayDom';

import type { DtxToolsContext } from '../context';
import type { AnnotationOverlayKind } from '../types';
import type { CloudAnnotationRecord, Vec3 } from '@/composables/useToolStore';

import { isCloudRenderFlagEnabled } from '@/composables/useCloudRenderFlags';
import { DEFAULT_PIN_CLUSTER_OPTIONS, type PinCluster, type PinClusterItem, clusterPins } from '@/review/domain/annotationProjection/cluster';
import { type CloudLodCandidate, DEFAULT_CLOUD_LOD_OPTIONS, cloudLodPriority, planCloudLod } from '@/review/domain/annotationProjection/lod';

export type CloudLodHooks = {
  updateOverlayPositions: () => void;
  activateAnnotation: (kind: AnnotationOverlayKind, id: string) => void;
};

export function createCloudLodController(ctx: DtxToolsContext, hooks: CloudLodHooks) {
  const lodProjectScratch = new Vector3();

  function setHoveredCloudAnnotation(id: string | null): void {
    if (ctx.cloudLod.hoveredId === id) return;
    ctx.cloudLod.hoveredId = id;
    // 只有 LOD 真在生效（上次计划超预算）时悬停才改变呈现；否则不为一次 hover 白跑一帧
    if (ctx.cloudLod.planSummary.overBudget) {
      hooks.updateOverlayPositions();
      ctx.requestRender?.();
    }
  }

  /**
   * P4 LOD 计划（方案 §9.3）：云线 > 预算时，按锚点到视口中心的距离排优先级，激活 / 拖动 / 悬停 / 待编辑固定高档，
   * 交给纯函数 `planCloudLod`（预算 64、滞回 16）。输入指纹没变就不重算；≤ 预算或开关关 → 全部 `full`。
   * 结果写在每条 `cloud.render.lodLevel`，由渲染循环按「计划 ≠ 已应用」切档。返回 true = 本帧重算了计划。
   */
  function planCloudLodForFrame(camera: any, frameKey: string): boolean {
    const lodOn = isCloudRenderFlagEnabled('cloudAdaptiveLod');
    if (!lodOn || ctx.overlays.cloudShapes.size <= DEFAULT_CLOUD_LOD_OPTIONS.budget) {
      if (ctx.cloudLod.planKey !== 'all-full') {
        ctx.cloudLod.planKey = 'all-full';
        ctx.cloudLod.planSummary = { overBudget: false, fullCount: ctx.overlays.cloudShapes.size, pinCount: 0 };
        for (const cloud of ctx.overlays.cloudShapes.values()) {
          cloud.render.lodLevel = 'full';
          cloud.render.lodPinnedHigh = false;
        }
        ctx.cloudLod.levels.clear();
        return true;
      }
      return false;
    }
    const drag = ctx.inlineOverlayAnnotationDrag.value;
    const dragId = drag.annotationKind === 'cloud' ? drag.annotationId : null;
    const activeId = ctx.store.activeCloudAnnotationId.value;
    const pendingEditId = ctx.store.pendingCloudAnnotationEditId.value;
    const key = `${frameKey}|${ctx.cloudLod.setVersion}|${activeId ?? ''}|${dragId ?? ''}|${ctx.cloudLod.hoveredId ?? ''}|${pendingEditId ?? ''}`;
    if (key === ctx.cloudLod.planKey) return false;
    ctx.cloudLod.planKey = key;
    ctx.cloudRenderStats.lodPlans += 1;

    const candidates: CloudLodCandidate[] = [];
    for (const cloud of ctx.overlays.cloudShapes.values()) {
      const recordId = cloud.record.id;
      const v = lodProjectScratch.copy(cloud.worldPos).applyMatrix4(camera.matrixWorldInverse);
      // three 相机看向视空间 -z：z ≥ 0 = 锚点在相机背后，投影坐标会翻转，不能拿它当屏内
      const behind = v.z >= 0;
      v.applyMatrix4(camera.projectionMatrix);
      const priority = cloudLodPriority(v.x, v.y, behind);
      const pinnedHigh = recordId === activeId
        || recordId === dragId
        || recordId === ctx.cloudLod.hoveredId
        || recordId === pendingEditId
        || cloud.render.labelDragTopLeft !== null;
      cloud.render.lodPriority = priority;
      cloud.render.lodPinnedHigh = pinnedHigh;
      candidates.push({ id: cloud.id, priority, pinnedHigh, previous: ctx.cloudLod.levels.get(cloud.id) ?? null });
    }
    const plan = planCloudLod(candidates, DEFAULT_CLOUD_LOD_OPTIONS);
    ctx.cloudLod.planSummary = { overBudget: plan.overBudget, fullCount: plan.fullCount, pinCount: plan.pinCount };
    // 记忆只留还在场的条目，删掉的记录不占着旧等级
    for (const id of ctx.cloudLod.levels.keys()) if (!ctx.overlays.cloudShapes.has(id)) ctx.cloudLod.levels.delete(id);
    for (const cloud of ctx.overlays.cloudShapes.values()) {
      const level = plan.levels.get(cloud.id) ?? 'full';
      cloud.render.lodLevel = level;
      ctx.cloudLod.levels.set(cloud.id, level);
    }
    return true;
  }

  // ---------------- P4 LOD 第二步：pin 档图钉的屏幕聚合 ----------------

  function cloudTitleForList(record: CloudAnnotationRecord): string {
    const title = (record.title ?? '').trim();
    return title || `云线批注 ${record.id}`;
  }

  /** 聚合徽标（带计数的圆标），一簇一枚，按种子 id 复用 */
  function ensureClusterBadgeEl(seedId: string): HTMLDivElement {
    const existing = ctx.cloudLod.clusterBadges.get(seedId);
    if (existing) return existing;
    const overlay = ctx.overlayContainerRef.value!;
    const el = ensureDiv(
      overlay,
      'dtx-anno-cluster',
      [
        'position:absolute',
        'left:0',
        'top:0',
        'transform:translate(-50%,-50%)',
        'min-width:26px',
        'height:26px',
        'padding:0 7px',
        'box-sizing:border-box',
        'border-radius:13px',
        'background:#1f2937',
        'color:#fff',
        'border:2px solid #fff',
        'box-shadow:0 2px 6px rgba(15,23,42,0.35)',
        'font-family:\'Roboto Mono\',\'Consolas\',monospace',
        'font-size:12px',
        'font-weight:700',
        'line-height:22px',
        'text-align:center',
        'pointer-events:auto',
        'user-select:none',
        'cursor:pointer',
        'z-index:921',
      ].join(';'),
    );
    el.dataset.clusterSeed = seedId;
    el.setAttribute('role', 'button');
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (ctx.cloudLod.clusterPopover?.seedId === seedId) closeClusterPopover();
      else openClusterPopover(seedId);
    });
    el.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      const cluster = ctx.cloudLod.clusterCurrent.find((c) => c.seedId === seedId);
      if (cluster) flyToCloudAnnotations(cluster.memberIds.map((id) => id.replace(/^cloud:/, '')));
    });
    ctx.cloudLod.clusterBadges.set(seedId, el);
    return el;
  }

  /** 相机飞到这些云线记录的合并范围（锚点 ∪ 创建时目标快照 AABB） */
  function flyToCloudAnnotations(recordIds: readonly string[]): boolean {
    const viewer = ctx.compatViewerRef.value;
    if (!viewer) return false;
    const points: Vec3[] = [];
    for (const id of recordIds) {
      const rec = ctx.store.cloudAnnotations.value.find((c) => c.id === id);
      if (!rec) continue;
      points.push(rec.anchorWorldPos);
      if (rec.selectionBbox) {
        points.push(rec.selectionBbox.min, rec.selectionBbox.max);
      }
    }
    const aabb = aabbFromPoints(points);
    if (!aabb) return false;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
    return true;
  }

  function closeClusterPopover(): void {
    const popover = ctx.cloudLod.clusterPopover;
    if (!popover) return;
    ctx.cloudLod.clusterPopover = null;
    const doc = popover.el.ownerDocument;
    doc.removeEventListener('pointerdown', popover.onDocPointerDown, true);
    doc.removeEventListener('keydown', popover.onKeyDown, true);
    try { popover.el.remove(); } catch { /* ignore */ }
  }

  /** 弹出成员列表：点一行 = 选中那条（激活即升 full 档）；「放大」= 相机飞到全部成员 */
  function openClusterPopover(seedId: string): void {
    const overlay = ctx.overlayContainerRef.value;
    const cluster = ctx.cloudLod.clusterCurrent.find((c) => c.seedId === seedId);
    if (!overlay || !cluster) return;
    closeClusterPopover();
    const el = ensureDiv(
      overlay,
      'dtx-anno-cluster-popover',
      [
        'position:absolute',
        'left:0',
        'top:0',
        'min-width:200px',
        'max-width:280px',
        'max-height:260px',
        'overflow:auto',
        'box-sizing:border-box',
        'padding:8px',
        'border-radius:8px',
        'background:#fff',
        'color:#111827',
        'border:1px solid #cbd5e1',
        'box-shadow:0 8px 24px rgba(15,23,42,0.22)',
        'font-family:system-ui,-apple-system,\'Segoe UI\',sans-serif',
        'font-size:12px',
        'line-height:18px',
        'pointer-events:auto',
        'user-select:none',
        'z-index:922',
      ].join(';'),
    );
    el.dataset.clusterSeed = seedId;
    const onDocPointerDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (target && (el.contains(target) || ctx.cloudLod.clusterBadges.get(seedId)?.contains(target))) return;
      closeClusterPopover();
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeClusterPopover();
    };
    el.ownerDocument.addEventListener('pointerdown', onDocPointerDown, true);
    el.ownerDocument.addEventListener('keydown', onKeyDown, true);
    ctx.cloudLod.clusterPopover = { seedId, el, onDocPointerDown, onKeyDown };
    renderClusterPopover(cluster);
  }

  function renderClusterPopover(cluster: PinCluster): void {
    const popover = ctx.cloudLod.clusterPopover;
    const overlay = ctx.overlayContainerRef.value;
    if (!popover || !overlay || popover.seedId !== cluster.seedId) return;
    const recordIds = cluster.memberIds.map((id) => id.replace(/^cloud:/, ''));
    const records = recordIds
      .map((id) => ctx.store.cloudAnnotations.value.find((c) => c.id === id))
      .filter((rec): rec is CloudAnnotationRecord => !!rec);
    const rows = records
      .map((rec) => `<div data-role="cluster-member" data-annotation-id="${escapeAnnotationLabelText(rec.id)}" style="padding:4px 6px;border-radius:4px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="单击选中这条云线批注">${escapeAnnotationLabelText(cloudTitleForList(rec))}</div>`)
      .join('');
    popover.el.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">',
      `<span style="font-weight:600">${records.length} 条云线批注</span>`,
      '<button type="button" data-role="cluster-zoom" style="border:1px solid #94a3b8;border-radius:4px;background:#f8fafc;color:#111827;font-size:12px;line-height:18px;padding:0 8px;cursor:pointer">放大到这些</button>',
      '</div>',
      `<div data-role="cluster-members">${rows}</div>`,
    ].join('');
    popover.el.querySelector('[data-role="cluster-zoom"]')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      flyToCloudAnnotations(recordIds);
      closeClusterPopover();
    });
    for (const row of popover.el.querySelectorAll<HTMLElement>('[data-role="cluster-member"]')) {
      row.addEventListener('pointerenter', () => { row.style.background = '#e2e8f0'; });
      row.addEventListener('pointerleave', () => { row.style.background = ''; });
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = row.dataset.annotationId;
        if (!id) return;
        closeClusterPopover();
        // 选中即「当前问题」：LOD 固定高档，轮廓 + 文字框补回来（ctx.store 变化经 watch 重建）
        hooks.activateAnnotation('cloud', id);
      });
    }
    positionClusterPopover(cluster);
  }

  function positionClusterPopover(cluster: PinCluster): void {
    const popover = ctx.cloudLod.clusterPopover;
    const overlay = ctx.overlayContainerRef.value;
    if (!popover || !overlay || popover.seedId !== cluster.seedId) return;
    const overlayRect = overlay.getBoundingClientRect();
    const width = popover.el.offsetWidth || 220;
    const height = popover.el.offsetHeight || 120;
    // 徽标右下方；越界就贴到视口内
    const x = clamp(cluster.x + 16, 4, Math.max(4, overlayRect.width - width - 4));
    const y = clamp(cluster.y + 16, 4, Math.max(4, overlayRect.height - height - 4));
    popover.el.style.left = `${x}px`;
    popover.el.style.top = `${y}px`;
  }

  /** 只拆 DOM（overlay 重建 / LOD 退出超预算时）；成员 → 种子的记忆留着，簇身份跨重建稳定 */
  function clearPinClusterDom(): void {
    closeClusterPopover();
    for (const el of ctx.cloudLod.clusterBadges.values()) {
      try { el.remove(); } catch { /* ignore */ }
    }
    ctx.cloudLod.clusterBadges.clear();
    for (const id of ctx.cloudLod.clusterHiddenMarkerIds) {
      const marker = ctx.overlays.markers.get(id);
      if (marker) marker.el.style.display = '';
    }
    ctx.cloudLod.clusterHiddenMarkerIds.clear();
    ctx.cloudLod.clusterCurrent = [];
  }

  /**
   * 按本帧 pin 档图钉的屏幕位置重算聚合并落到 DOM：合进徽标的图钉藏起、徽标定位 + 计数 + 成员标题提示；
   * 弹出列表若还对着一个在场的簇就刷新，否则关掉。只在 LOD 计划重算的那一帧调（相机 / 集合 / 交互态变了）。
   */
  function applyPinClusters(items: readonly PinClusterItem[]): void {
    const result = clusterPins(items, ctx.cloudLod.clusterSeedOf, DEFAULT_PIN_CLUSTER_OPTIONS);
    ctx.cloudLod.clusterSeedOf = result.seedOf;
    ctx.cloudLod.clusterCurrent = result.clusters;

    // 图钉显隐：新合进来的藏、散出去的放回
    const nextHidden = new Set(result.seedOf.keys());
    for (const id of ctx.cloudLod.clusterHiddenMarkerIds) {
      if (!nextHidden.has(id)) ctx.overlays.markers.get(id)?.el.style.setProperty('display', '');
    }
    for (const id of nextHidden) {
      if (!ctx.cloudLod.clusterHiddenMarkerIds.has(id)) ctx.overlays.markers.get(id)?.el.style.setProperty('display', 'none');
    }
    ctx.cloudLod.clusterHiddenMarkerIds.clear();
    for (const id of nextHidden) ctx.cloudLod.clusterHiddenMarkerIds.add(id);

    // 徽标：一簇一枚，按种子复用；不在场的拆掉
    const liveSeeds = new Set<string>();
    for (const cluster of result.clusters) {
      liveSeeds.add(cluster.seedId);
      const el = ensureClusterBadgeEl(cluster.seedId);
      el.textContent = String(cluster.memberIds.length);
      el.dataset.count = String(cluster.memberIds.length);
      el.style.left = `${cluster.x}px`;
      el.style.top = `${cluster.y}px`;
      const titles: string[] = [];
      for (const id of cluster.memberIds) {
        const rec = ctx.overlays.cloudShapes.get(id)?.record;
        if (rec) titles.push(cloudTitleForList(rec));
        if (titles.length >= 8) break;
      }
      const more = cluster.memberIds.length - titles.length;
      el.title = `${cluster.memberIds.length} 条云线批注（单击列出成员，双击放大）\n${titles.join('\n')}${more > 0 ? `\n…还有 ${more} 条` : ''}`;
    }
    for (const [seedId, el] of ctx.cloudLod.clusterBadges.entries()) {
      if (liveSeeds.has(seedId)) continue;
      try { el.remove(); } catch { /* ignore */ }
      ctx.cloudLod.clusterBadges.delete(seedId);
    }

    if (ctx.cloudLod.clusterPopover) {
      const cluster = result.clusters.find((c) => c.seedId === ctx.cloudLod.clusterPopover!.seedId);
      if (cluster) renderClusterPopover(cluster);
      else closeClusterPopover();
    }
  }

  return {
    applyPinClusters,
    clearPinClusterDom,
    closeClusterPopover,
    flyToCloudAnnotations,
    openClusterPopover,
    planCloudLodForFrame,
    setHoveredCloudAnnotation,
  };
}
