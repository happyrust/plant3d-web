/**
 * pick_refno 拾取：高亮会话（refno 级 + 直段对象级）与重叠构件的候选轮换。
 * 自有状态（高亮表 / 锚点 / 预览线框）留在这里；候选列表与下标是返回给面板的，在 ctx 上（所有者是本控制器）。
 * 从 useDtxTools.ts 搬出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 4 步），实现未改；新增的只有
 * handlePointerUp（原 onCanvasPointerUp 的 pick_refno 分支）、installWatchers（原闭包里的 toolMode / pickedRefnos watch）、
 * rebuildCandidatePreview（原 syncFromStore 里的两行）。
 */
import { watch } from 'vue';

import { Box3, LineBasicMaterial, LineSegments, Vector3 } from 'three';

import { getCanvasPos } from '../geometry';
import { type PickRefnoCandidate, type PickRefnoRayHit, buildPickRefnoCandidates, buildPickTubeCandidates, isSamePickAnchor, isSamePickCandidateSequence, isTubeKeyLike, isTubePickFilter, nextPickCandidateIndex } from '../pickCandidates';
import { buildWireBoxGeometryFromBox3, disposeObject3d } from '../visuals';

import type { DtxToolsContext } from '../context';

import { emitToast } from '@/ribbon/toastBus';

export type PickCandidateHooks = {
  ensureToolsGroupAttached: () => void;
  pickSurfaceRayHits: (canvas: HTMLCanvasElement, e: PointerEvent) => PickRefnoRayHit[];
};

export function createPickCandidateController(ctx: DtxToolsContext, hooks: PickCandidateHooks) {
  const pickedHighlightByBran = new Map<string, string>();
  const pickedHighlightPinned = new Set<string>(); // 已在外部选中的对象，不应被拾取会话取消选中
  let lastAppliedPickHighlights: string[] = [];
  /** 按直段拾取的高亮（直段身份键，对象级选中） */
  let lastAppliedPickTubeHighlights: string[] = [];
  let pickCandidateAnchor: { x: number; y: number } | null = null;
  let pickCandidatePreview: LineSegments | null = null;

  /** 直段高亮只落在那一段直管对象上（对象级），不走 refno 级选中。 */
  function applyPickTubeHighlights(keys: string[]): void {
    const viewer = ctx.compatViewerRef.value;
    if (!viewer) return;
    const stale = lastAppliedPickTubeHighlights.filter((key) => !keys.includes(key));
    if (stale.length > 0) viewer.scene.setTubeSegmentsSelected(stale, false);
    if (keys.length > 0) viewer.scene.setTubeSegmentsSelected(keys, true);
    lastAppliedPickTubeHighlights = keys;
  }

  function applyPickHighlights(): void {
    const viewer = ctx.compatViewerRef.value;
    if (!viewer) return;

    const highlights = Array.from(new Set(pickedHighlightByBran.values())).filter(Boolean);
    applyPickTubeHighlights(highlights.filter(isTubeKeyLike));
    const next = highlights.filter((id) => !isTubeKeyLike(id));

    if (lastAppliedPickHighlights.length > 0) {
      const toDeselect = lastAppliedPickHighlights.filter((id) => !pickedHighlightPinned.has(id));
      if (toDeselect.length > 0) {
        viewer.scene.setObjectsSelected(toDeselect, false);
      }
    }
    if (next.length > 0) {
      // 若对象在进入/拾取前已被外部选中，则“取消拾取/删除候选”不应取消其高亮
      const selectedNow = new Set<string>(viewer.scene.selectedObjectIds);
      for (const id of next) {
        if (selectedNow.has(id) && !lastAppliedPickHighlights.includes(id)) {
          pickedHighlightPinned.add(id);
        }
      }
      viewer.scene.setObjectsSelected(next, true);
    }
    lastAppliedPickHighlights = next;
  }

  function clearPickHighlights(): void {
    const viewer = ctx.compatViewerRef.value;
    if (viewer && lastAppliedPickHighlights.length > 0) {
      const toDeselect = lastAppliedPickHighlights.filter((id) => !pickedHighlightPinned.has(id));
      if (toDeselect.length > 0) {
        viewer.scene.setObjectsSelected(toDeselect, false);
      }
    }
    applyPickTubeHighlights([]);
    pickedHighlightByBran.clear();
    pickedHighlightPinned.clear();
    lastAppliedPickHighlights = [];
  }

  function clearPickCandidatePreview(): void {
    if (!pickCandidatePreview) return;
    try { ctx.toolsGroup.remove(pickCandidatePreview); } catch { /* ignore */ }
    disposeObject3d(pickCandidatePreview);
    pickCandidatePreview = null;
  }

  function resetPickCandidateSession(): void {
    clearPickCandidatePreview();
    ctx.pickCandidates.value = [];
    ctx.pickCandidateIndex.value = 0;
    pickCandidateAnchor = null;
  }

  /**
   * 用独立线框标出「当前轮换到的候选」。
   *
   * 不复用 `setObjectsSelected`：那是全局选中通道，候选与普通选中长得一样就分不出
   * 轮换到了哪一个。只有存在重叠候选时才画，单一候选靠选中高亮已经足够。
   */
  function renderPickCandidatePreview(): void {
    clearPickCandidatePreview();
    if (ctx.pickCandidates.value.length <= 1) return;

    const candidate = ctx.pickCandidates.value[ctx.pickCandidateIndex.value];
    const viewer = ctx.compatViewerRef.value;
    if (!candidate || !viewer) return;

    const aabb = isTubeKeyLike(candidate.refno)
      ? viewer.scene.getTubeSegmentAABB(candidate.refno)
      : viewer.scene.getAABB([candidate.refno]);
    if (!aabb) return;

    const geometry = buildWireBoxGeometryFromBox3(
      new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5])),
    );
    const line = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: 0x22d3ee, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    line.renderOrder = 903;
    line.frustumCulled = false;

    hooks.ensureToolsGroupAttached();
    ctx.toolsGroup.add(line);
    pickCandidatePreview = line;
  }

  /** 把候选写入拾取结果；`previous` 非空表示这是一次轮换，替换而不是追加。 */
  function applyPickCandidate(candidate: PickRefnoCandidate, previous: PickRefnoCandidate | null): void {
    if (previous && previous.refno !== candidate.refno) {
      ctx.store.removePickedRefno(previous.refno);
      pickedHighlightByBran.delete(previous.refno);
    }
    ctx.store.addPickedRefno(candidate.refno);

    const viewer = ctx.compatViewerRef.value;
    if (viewer) {
      // 优先高亮 refno 本体；BRAN 之类无自身几何的元素回退到命中的子构件；直段键只高亮那一段直管。
      const highlightId = isTubeKeyLike(candidate.refno) || viewer.scene.getAABB([candidate.refno]) ? candidate.refno : candidate.hitRefno;
      pickedHighlightByBran.set(candidate.refno, highlightId);
      applyPickHighlights();
    }

    renderPickCandidatePreview();
  }

  /** 在光标处的重叠构件之间轮换；返回是否真的换了一个候选。 */
  function cyclePickCandidate(step = 1): boolean {
    if (ctx.store.toolMode.value !== 'pick_refno') return false;
    const total = ctx.pickCandidates.value.length;
    if (total <= 1) return false;

    const previous = ctx.pickCandidates.value[ctx.pickCandidateIndex.value] ?? null;
    ctx.pickCandidateIndex.value = nextPickCandidateIndex(ctx.pickCandidateIndex.value, total, step);
    const candidate = ctx.pickCandidates.value[ctx.pickCandidateIndex.value];
    if (!candidate) return false;

    applyPickCandidate(candidate, previous);
    ctx.requestRender?.();
    return true;
  }

  /** syncFromStore 的 clearGroup 连同候选预览一起销毁了，重建以免轮换线框在批注同步时凭空消失。 */
  function rebuildCandidatePreview(): void {
    pickCandidatePreview = null;
    renderPickCandidatePreview();
  }

  /** pick_refno 模式的单击（原在 onCanvasPointerUp 里）；返回是否由拾取模式接下。 */
  function handlePointerUp(canvas: HTMLCanvasElement, e: PointerEvent, mode: string): boolean {
    if (mode === 'pick_refno') {
      const pos = getCanvasPos(canvas, e);
      const filter = ctx.store.pickRefnoFilter.value;
      const hits = hooks.pickSurfaceRayHits(canvas, e);
      const candidates = isTubePickFilter(filter) ? buildPickTubeCandidates(hits) : buildPickRefnoCandidates(hits, filter);
      if (isTubePickFilter(filter) && hits.length > 0 && candidates.length === 0) {
        emitToast({ message: '这里没有可选的直段：请点直管（TUBI）。服务端没给直段身份时只能按整根管道选。', level: 'warning' });
      }

      // 原地再点一次 = 在光标下的重叠构件之间轮换，而不是重新拾取同一个。
      if (
        isSamePickAnchor(pickCandidateAnchor, pos) &&
        isSamePickCandidateSequence(ctx.pickCandidates.value, candidates)
      ) {
        if (cyclePickCandidate(1)) return true;
      }

      pickCandidateAnchor = { x: pos.x, y: pos.y };
      ctx.pickCandidates.value = candidates;
      ctx.pickCandidateIndex.value = 0;

      const nearest = candidates[0];
      if (!nearest) {
        clearPickCandidatePreview();
        return true;
      }
      applyPickCandidate(nearest, null);
      return true;
    }
    return false;
  }

  /** 工具模式 / pickedRefnos 变化时同步高亮与候选会话（原闭包里的 watch，按所有者搬到这里）。 */
  function installWatchers(): void {
    watch(
      () => ({
        mode: ctx.store.toolMode.value,
        picked: ctx.store.pickedRefnos.value,
      }),
      (next, prev) => {
        const mode = next.mode;
        const picked = next.picked ?? [];

        if (mode === 'pick_refno') {
          // 进入拾取模式：重置会话状态（不清除外部高亮）
          if (prev?.mode !== 'pick_refno') {
            pickedHighlightByBran.clear();
            pickedHighlightPinned.clear();
            lastAppliedPickHighlights = [];
          }

          // pickedRefnos 为空：视为取消/重置，撤销本会话高亮
          if (!picked || picked.length === 0) {
            clearPickHighlights();
            resetPickCandidateSession();
            return;
          }

          // 同步删除的候选
          const pickedSet = new Set<string>(picked);
          for (const k of Array.from(pickedHighlightByBran.keys())) {
            if (!pickedSet.has(k)) {
              pickedHighlightByBran.delete(k);
            }
          }
          applyPickHighlights();
          return;
        }

        // 退出拾取模式：确认场景保持当前高亮；仅清理会话内状态，避免后续误同步。
        // 直段高亮是对象级选中、不进 refno 状态表，留下来就没有入口能清，退出时一并撤掉。
        if (prev?.mode === 'pick_refno') {
          applyPickTubeHighlights([]);
          pickedHighlightByBran.clear();
          lastAppliedPickHighlights = [];
          resetPickCandidateSession();
        }
      },
      { deep: true }
    );
  }

  return {
    applyPickHighlights,
    clearPickHighlights,
    resetPickCandidateSession,
    renderPickCandidatePreview,
    rebuildCandidatePreview,
    cyclePickCandidate,
    handlePointerUp,
    installWatchers,
  };
}
