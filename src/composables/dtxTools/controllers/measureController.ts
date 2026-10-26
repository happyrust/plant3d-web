/**
 * 测量控制器：点–面、对象–对象、管–管、管–结构四种测量的状态、候选、提交与状态文字。
 * 自有状态（候选 / busy / status）留在这里；跨控制器的走 ctx；还留在 useDtxTools 闭包里的拾取 / 拖框收尾经 hooks 进来。
 * 从 useDtxTools.ts 搬出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 3 步），实现未改；唯一新增的是
 * handlePointerUp：原 onCanvasPointerUp 里四条测量模式分支原样搬进来，由分发器先问它。
 */
import { computed, ref } from 'vue';

import { BufferAttribute, Vector3 } from 'three';

import { nowId, parseRefnoFromDtxObjectId, vec3ToTuple } from '../geometry';
import { isTubePickFilter } from '../pickCandidates';
import { type ObjectMeasureCandidate, PIPE_STRUCTURE_BACKEND_MAX_CANDIDATES, PIPE_STRUCTURE_DEFAULT_NOUNS, PIPE_STRUCTURE_FRONTEND_TOP_CANDIDATES, PIPE_STRUCTURE_SOURCE_SAMPLE_LIMIT, type PipeMeasureResult, type PipeMeasureSeed, type PipeToPipeBranCandidate, type PipeWallDistanceCandidate, buildObjectMeasurePairKey, choosePipeMeasureBetterSeed, collectOrderedPipeReferencePointSeeds, computeApproxNearestBetweenObjects, fromSeed, normalizeRefnoKey, parseDbnumFromRefno, resolveLoadedVisibleObjectCandidateByRefno, vec3ByMatrix } from '../pipeMeasureMath';

import type { DtxToolsContext } from '../context';
import type { MeasurementPoint, Vec3 } from '@/composables/useToolStore';
import type { DTXLayer } from '@/utils/three/dtx';

import { genModelV1SpatialCenterline, genModelV1SpatialNearestClearance } from '@/api/genModelV1Api';
import { commitBranParallelSpacing } from '@/clearance/adapters/branSpacingRecords';
import { parseServerWarning } from '@/clearance/services/clearanceService';
import { DEFAULT_PARALLEL_ANGLE_TOLERANCE_DEG, buildStraightRuns, findParallelRunPairs } from '@/composables/branParallelSpacing';
import { findOwnerBranRefnoAcrossAllDbnos, getDtxRefnoTransform, resolveDtxObjectIdsByRefno } from '@/composables/useDbnoInstancesDtxLoader';
import { commitDtxObjectToObjectClearance, commitDtxPointToObjectMeasurement } from '@/measurement/adapters/dtxDistanceRecords';
import { formatLengthMeters } from '@/utils/unitFormat';

export type MeasureControllerHooks = {
  pickSurfacePoint: (canvas: HTMLCanvasElement, e: PointerEvent) => { entityId: string; worldPos: Vector3; objectId: string } | null;
  clearPendingCloudAnchor: () => void;
  hideMarquee: () => void;
};

export function createMeasureController(ctx: DtxToolsContext, hooks: MeasureControllerHooks) {
  const pointToObjectStart = ref<MeasurementPoint | null>(null);
  const objectToObjectSourceCandidate = ref<ObjectMeasureCandidate | null>(null);
  const objectToObjectTargetCandidate = ref<ObjectMeasureCandidate | null>(null);
  const objectToObjectBusy = ref(false);
  const objectToObjectStatus = ref('');
  const lastAppliedObjectMeasurePairKey = ref<string | null>(null);
  const pipeMeasureBusy = ref(false);
  const pipeMeasureStatus = ref<string>('');
  const pipeToPipeSourceCandidate = ref<PipeToPipeBranCandidate | null>(null);

  function setPipeMeasureStatus(message: string): void {
    pipeMeasureStatus.value = message;
  }

  function setObjectMeasureStatus(message: string): void {
    objectToObjectStatus.value = message;
  }

  function clearPipeToPipeCandidate(options?: { clearStatus?: boolean }): void {
    pipeToPipeSourceCandidate.value = null;
    if (options?.clearStatus) {
      pipeMeasureStatus.value = '';
    }
  }

  function pipeToPipeSourceStatus(candidate: PipeToPipeBranCandidate): string {
    const picked = candidate.pickedRefno !== candidate.branRefno ? `（点选 ${candidate.pickedRefno}）` : '';
    return `管-管间距：已选第一条 BRAN ${candidate.branRefno}${picked}，请点第二条 BRAN 上的管件`;
  }

  function applyPipeToPipeSourceCandidate(candidate: PipeToPipeBranCandidate): void {
    pipeToPipeSourceCandidate.value = candidate;
    setPipeMeasureStatus(pipeToPipeSourceStatus(candidate));
  }

  function clearObjectMeasureCandidates(options?: { clearStatus?: boolean; clearLastPairKey?: boolean }): void {
    objectToObjectSourceCandidate.value = null;
    objectToObjectTargetCandidate.value = null;
    objectToObjectBusy.value = false;
    if (options?.clearStatus) {
      objectToObjectStatus.value = '';
    }
    if (options?.clearLastPairKey) {
      lastAppliedObjectMeasurePairKey.value = null;
    }
  }

  function applyObjectMeasureSourceCandidate(candidate: ObjectMeasureCandidate | null): void {
    objectToObjectSourceCandidate.value = candidate;
    objectToObjectTargetCandidate.value = null;
    if (!candidate) return;
    setObjectMeasureStatus(`构件最近点测量：已选第一个构件 ${candidate.refno}，请选择第二个构件`);
  }

  function createObjectMeasureCandidateFromHit(hit: {
    entityId: string
    worldPos: Vector3
    objectId: string
  }): ObjectMeasureCandidate | null {
    const refno = normalizeRefnoKey(hit.entityId || parseRefnoFromDtxObjectId(hit.objectId) || '');
    if (!refno || !hit.objectId) return null;
    return {
      refno,
      objectId: hit.objectId,
      entityId: hit.entityId || refno,
      hitPoint: vec3ToTuple(hit.worldPos),
    };
  }

  function commitObjectToObjectMeasurement(
    source: ObjectMeasureCandidate,
    target: ObjectMeasureCandidate,
  ): boolean {
    const layer = ctx.dtxLayerRef.value;
    if (!layer) {
      setObjectMeasureStatus('DTX 图层未就绪');
      return false;
    }
    if (source.objectId === target.objectId || source.refno === target.refno) {
      objectToObjectTargetCandidate.value = null;
      setObjectMeasureStatus('请选择另一个构件');
      return false;
    }

    objectToObjectBusy.value = true;
    setObjectMeasureStatus('构件最近点测量：正在计算…');

    try {
      const approx = computeApproxNearestBetweenObjects(layer, {
        sourceObjectId: source.objectId,
        targetObjectId: target.objectId,
        sourceHitPoint: source.hitPoint ?? null,
        targetHitPoint: target.hitPoint ?? null,
      });
      if (!approx) {
        objectToObjectTargetCandidate.value = null;
        setObjectMeasureStatus('未能计算两个构件之间的最近点');
        return false;
      }

      // #58：构件最近点归 ClearanceStore（sampled-object / approximate-sampled，
      // 种子点采样的估算，永不标精确或外表面净距）；端点/距离换算成 design-world 米。
      // 无效输入 → TypeError（类型化失败），不落半成品记录，状态如实报失败。
      try {
        commitDtxObjectToObjectClearance({
          sourceRefno: source.refno,
          targetRefno: target.refno,
          sourcePointScene: approx.sourcePoint,
          targetPointScene: approx.targetPoint,
          dtxLayerRef: ctx.dtxLayerRef,
          sourceAnnotation: ctx.store.activeAnnotationContext.value,
          computedAt: new Date(),
          upsertRecord: ctx.clearanceStore.upsertRecord,
        });
      } catch (error) {
        objectToObjectTargetCandidate.value = null;
        setObjectMeasureStatus(
          `构件最近点记录失败：${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
      lastAppliedObjectMeasurePairKey.value = buildObjectMeasurePairKey(source.refno, target.refno);
      clearObjectMeasureCandidates();
      setObjectMeasureStatus(
        `已生成构件最近点测量：${source.refno} ↔ ${target.refno}，距离 ${formatLengthMeters(approx.distance, ctx.unitSettings.displayUnit.value, ctx.unitSettings.precision.value)}`,
      );
      ctx.requestRender?.();
      return true;
    } finally {
      objectToObjectBusy.value = false;
    }
  }

  function handleTreeObjectMeasureSelection(selectedRefnos: string[]): void {
    if (ctx.store.toolMode.value !== 'measure_object_to_object') return;

    const normalized = selectedRefnos
      .map((refno) => normalizeRefnoKey(refno))
      .filter(Boolean);
    if (normalized.length === 0) {
      clearObjectMeasureCandidates({ clearStatus: true });
      return;
    }
    if (normalized.length > 2) {
      clearObjectMeasureCandidates();
      setObjectMeasureStatus('该模式仅支持两个构件');
      return;
    }

    const layer = ctx.dtxLayerRef.value;
    if (!layer) {
      clearObjectMeasureCandidates();
      setObjectMeasureStatus('DTX 图层未就绪');
      return;
    }

    const resolvedCandidates = normalized.map((refno) => resolveLoadedVisibleObjectCandidateByRefno(layer, refno));
    if (normalized.length === 1) {
      const only = resolvedCandidates[0];
      if (!only) {
        clearObjectMeasureCandidates();
        setObjectMeasureStatus('请先显示该构件后再测量');
        return;
      }
      applyObjectMeasureSourceCandidate(only);
      return;
    }

    const [sourceCandidate, targetCandidate] = resolvedCandidates;
    if (!sourceCandidate || !targetCandidate) {
      clearObjectMeasureCandidates();
      setObjectMeasureStatus('请先显示这两个构件后再测量');
      return;
    }

    const pairKey = buildObjectMeasurePairKey(sourceCandidate.refno, targetCandidate.refno);
    objectToObjectSourceCandidate.value = sourceCandidate;
    objectToObjectTargetCandidate.value = targetCandidate;
    if (lastAppliedObjectMeasurePairKey.value === pairKey) {
      setObjectMeasureStatus(`构件最近点测量：已选 ${sourceCandidate.refno} 与 ${targetCandidate.refno}`);
      return;
    }

    void commitObjectToObjectMeasurement(sourceCandidate, targetCandidate);
  }

  /** 点到的构件 → 它所属的 BRAN（DTX 缓存的 owner；点到 BRAN 自己的隐式直管时就是它自己）。解不出回 null。 */
  function resolvePipeToPipeBranCandidate(hit: {
    entityId: string
    worldPos: Vector3
    objectId: string
  }): PipeToPipeBranCandidate | null {
    const pickedRefno = normalizeRefnoKey(hit.entityId || parseRefnoFromDtxObjectId(hit.objectId) || '');
    if (!pickedRefno || !hit.objectId) return null;
    const branRefno = findOwnerBranRefnoAcrossAllDbnos(pickedRefno);
    if (!branRefno) return null;
    return { branRefno: normalizeRefnoKey(branRefno), pickedRefno, objectId: hit.objectId };
  }

  function collectPipeReferencePointsWorld(params: {
    sourceRefno: string
    sourceObjectId: string
    dbnum: number
    layer: DTXLayer
    globalMatrix: any
  }): Vector3[] {
    const { sourceRefno, sourceObjectId, dbnum, layer, globalMatrix } = params;
    const refnoTransform = getDtxRefnoTransform(dbnum, sourceRefno);
    let refnoPosition: Vec3 | null = null;
    if (Array.isArray(refnoTransform) && refnoTransform.length === 16) {
      const tx = refnoTransform[12];
      const ty = refnoTransform[13];
      const tz = refnoTransform[14];
      if (Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(tz)) {
        refnoPosition = vec3ByMatrix([tx, ty, tz], globalMatrix);
      }
    }

    let aabbCenter: Vec3 | null = null;
    const sourceAabb = layer.getObjectBoundingBox(sourceObjectId);
    if (sourceAabb) {
      const center = sourceAabb.getCenter(new Vector3());
      aabbCenter = [center.x, center.y, center.z];
    }

    const seeds = collectOrderedPipeReferencePointSeeds({
      sourceRefno,
      segments: [],
      refnoPosition,
      aabbCenter,
    });
    return seeds.map((seed) => new Vector3(seed[0], seed[1], seed[2]));
  }

  function collectSourceSamplePointsWorld(
    layer: DTXLayer,
    sourceObjectId: string,
    limit: number,
  ): Vector3[] {
    const data = layer.getObjectGeometryData(sourceObjectId);
    if (!data) return [];
    const geometry = data.geometry;
    const matrix = data.matrix;
    const posAttr = geometry.getAttribute('position') as BufferAttribute | undefined;
    const indexAttr = geometry.getIndex() as BufferAttribute | null;
    if (!posAttr || posAttr.count <= 0) return [];

    const out: Vector3[] = [];
    const maxCount = Math.max(1, Math.floor(limit));

    const pushPoint = (point: Vector3) => {
      if (out.length >= maxCount) return;
      out.push(point.clone());
    };

    const vertexBudget = Math.max(1, Math.floor(maxCount * 0.7));
    const vertexStep = Math.max(1, Math.floor(posAttr.count / vertexBudget));
    const tempVertex = new Vector3();
    for (let i = 0; i < posAttr.count && out.length < vertexBudget; i += vertexStep) {
      tempVertex.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
      pushPoint(tempVertex);
    }

    const remaining = maxCount - out.length;
    if (remaining <= 0) return out;

    const tempA = new Vector3();
    const tempB = new Vector3();
    const tempC = new Vector3();
    const triCount = indexAttr
      ? Math.floor(indexAttr.count / 3)
      : Math.floor(posAttr.count / 3);
    if (triCount <= 0) return out;
    const triStep = Math.max(1, Math.floor(triCount / Math.max(1, remaining)));

    for (let triIndex = 0; triIndex < triCount && out.length < maxCount; triIndex += triStep) {
      const base = triIndex * 3;
      const ia = indexAttr ? indexAttr.getX(base) : base;
      const ib = indexAttr ? indexAttr.getX(base + 1) : base + 1;
      const ic = indexAttr ? indexAttr.getX(base + 2) : base + 2;
      if (ia >= posAttr.count || ib >= posAttr.count || ic >= posAttr.count) continue;

      tempA.fromBufferAttribute(posAttr, ia).applyMatrix4(matrix);
      tempB.fromBufferAttribute(posAttr, ib).applyMatrix4(matrix);
      tempC.fromBufferAttribute(posAttr, ic).applyMatrix4(matrix);

      const midAB = tempA.clone().add(tempB).multiplyScalar(0.5);
      const midBC = tempB.clone().add(tempC).multiplyScalar(0.5);
      const midCA = tempC.clone().add(tempA).multiplyScalar(0.5);
      pushPoint(midAB);
      if (out.length >= maxCount) break;
      pushPoint(midBC);
      if (out.length >= maxCount) break;
      pushPoint(midCA);
    }

    return out;
  }

  function resolveTargetObjectPairs(
    dbnum: number,
    candidates: PipeWallDistanceCandidate[],
  ): { targetRefno: string; targetObjectId: string }[] {
    const out: { targetRefno: string; targetObjectId: string }[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const targetRefno = normalizeRefnoKey(candidate.refno);
      const objectIds = resolveDtxObjectIdsByRefno(dbnum, targetRefno);
      for (const objectId of objectIds) {
        if (!objectId || seen.has(objectId)) continue;
        seen.add(objectId);
        out.push({ targetRefno, targetObjectId: objectId });
      }
    }
    return out;
  }

  function findBestPipeMeasureResult(
    layer: DTXLayer,
    sourcePoints: Vector3[],
    targetPairs: { targetRefno: string; targetObjectId: string }[],
  ): PipeMeasureResult | null {
    let best: { seed: PipeMeasureSeed; targetRefno: string; targetObjectId: string } | null = null;

    for (const sourcePoint of sourcePoints) {
      const sourceTuple = vec3ToTuple(sourcePoint);
      for (const targetPair of targetPairs) {
        const closest = layer.closestPointToObject(targetPair.targetObjectId, sourcePoint);
        if (!closest) continue;
        const nextSeed: PipeMeasureSeed = {
          distance: closest.distance,
          sourcePoint: sourceTuple,
          targetPoint: vec3ToTuple(closest.point),
        };
        const winnerSeed = choosePipeMeasureBetterSeed(best?.seed || null, nextSeed);
        if (winnerSeed === nextSeed) {
          best = {
            seed: nextSeed,
            targetObjectId: targetPair.targetObjectId,
            targetRefno: targetPair.targetRefno,
          };
        }
      }
    }

    if (!best) return null;
    return fromSeed(best.seed, best.targetObjectId, best.targetRefno);
  }

  /** 中心距在状态栏里的写法：中心线给的是 mm，`formatLengthMeters` 吃米。 */
  function formatMillimetres(mm: number): string {
    return formatLengthMeters(mm / 1000, ctx.unitSettings.displayUnit.value, ctx.unitSettings.precision.value);
  }

  /**
   * 「管-管间距」的后半程（plan 2026-09-16 §3.3 ④，#63 改落 ClearanceStore）：两条 BRAN 的真实中心线
   * （`GET /api/v1/spatial/centerline`）→ 连续共线的段合成直段（ELBO / BEND 不算）→ 直段两两配平行对
   * （夹角 ≤ 0.5°、沿轴投影有重叠）→ 每对一条 `ClearanceRecord`（`parallel-centerline` / `exact-centerline`，
   * inputs 是直段首段 refno，BRAN refno 在 provenance operand），同一对 BRAN 再测整组替换。
   * 没有平行直段也要走一遍（把上一次同一对的记录清掉），只是状态栏直说。尺寸只经显式转换，不在这条路径建。
   */
  async function completePipeToPipeSpacing(
    source: PipeToPipeBranCandidate,
    target: PipeToPipeBranCandidate,
  ): Promise<boolean> {
    const pair = `${source.branRefno} ↔ ${target.branRefno}`;
    setPipeMeasureStatus(`管-管间距：正在取 ${pair} 两条 BRAN 的中心线…`);
    const [sourceLine, targetLine] = await Promise.all([
      genModelV1SpatialCenterline(source.branRefno),
      genModelV1SpatialCenterline(target.branRefno),
    ]);
    const sourceRuns = buildStraightRuns(sourceLine);
    const targetRuns = buildStraightRuns(targetLine);
    const pairs = findParallelRunPairs(sourceRuns, targetRuns);
    clearPipeToPipeCandidate();

    const distances = pairs.map((item) => formatMillimetres(item.axisDistanceMm));
    const distanceText = distances.length > 4 ? `${distances.slice(0, 4).join(' / ')} …` : distances.join(' / ');
    const runsText = `${sourceRuns.length} / ${targetRuns.length} 条直段`;

    try {
      commitBranParallelSpacing({
        sourceBranRefno: source.branRefno,
        targetBranRefno: target.branRefno,
        pairs,
        sourceSesno: sourceLine.source_version?.sesno ?? null,
        targetSesno: targetLine.source_version?.sesno ?? null,
        warnings: [...(sourceLine.warnings ?? []), ...(targetLine.warnings ?? [])].map(parseServerWarning),
        sourceAnnotation: ctx.store.activeAnnotationContext.value,
        computedAt: new Date(),
        records: ctx.clearanceStore.records.value,
        upsertRecord: ctx.clearanceStore.upsertRecord,
        removeRecord: ctx.clearanceStore.removeRecord,
      });
    } catch (error) {
      setPipeMeasureStatus(`管-管间距：${pair} 中心距记录生成失败：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }

    setPipeMeasureStatus(pairs.length > 0
      ? `管-管间距：${pair} 找到 ${pairs.length} 对平行直段（${runsText}），中心距 ${distanceText}，已生成 ${pairs.length} 条中心距记录`
      : `管-管间距：${pair} 没有平行的直段（${runsText}，夹角容差 ${DEFAULT_PARALLEL_ANGLE_TOLERANCE_DEG}°），上一次这一对的中心距记录已清掉`);
    ctx.requestRender?.();
    return pairs.length > 0;
  }

  /**
   * 三维里点选管件算出的一条管-墙/柱估算净距（scene 世界坐标的最近点对）→ `ClearanceRecord`（#63）：
   * `sampled-object` / `approximate-sampled`，端点经全局矩阵逆换算成 design-world 米，
   * 与构件最近点（#58）走同一个适配器。尺寸只经显式转换，不在这条路径建；
   * 失败抛 TypeError（类型化失败），不落半成品记录。
   */
  function commitInteractiveClearance(params: {
    kindLabel: string
    sourceRefno: string
    targetRefno: string
    targetNoun: string
    sourcePoint: Vector3
    targetPoint: Vector3
  }): void {
    const distance = params.sourcePoint.distanceTo(params.targetPoint);
    const distanceText = formatLengthMeters(distance, ctx.unitSettings.displayUnit.value, ctx.unitSettings.precision.value);
    const pair = `${params.sourceRefno} ↔ ${params.targetRefno}${params.targetNoun ? `（${params.targetNoun}）` : ''}`;

    try {
      commitDtxObjectToObjectClearance({
        sourceRefno: params.sourceRefno,
        targetRefno: params.targetRefno,
        sourcePointScene: [params.sourcePoint.x, params.sourcePoint.y, params.sourcePoint.z],
        targetPointScene: [params.targetPoint.x, params.targetPoint.y, params.targetPoint.z],
        dtxLayerRef: ctx.dtxLayerRef,
        targetNoun: params.targetNoun,
        warnings: [{
          code: 'mesh_sampling',
          message: '源侧参考点/网格采样 + 目标表面最近点，估算距离非外表面净距',
        }],
        sourceAnnotation: ctx.store.activeAnnotationContext.value,
        computedAt: new Date(),
        upsertRecord: ctx.clearanceStore.upsertRecord,
      });
    } catch (error) {
      setPipeMeasureStatus(`${params.kindLabel}：${pair} 净距记录生成失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    setPipeMeasureStatus(
      `${params.kindLabel}：${pair} 估算最近距离 ${distanceText}（网格采样），已生成净距记录`,
    );
    ctx.requestRender?.();
  }

  /**
   * 「管-管间距」：点两根管，各自解到所属 BRAN，量两条 BRAN 平行直段的中心距（plan 2026-09-16 §3.3 ④）。
   * 用户 2026-09-16 的口径：「两个排管的距离测量是指两条 BRAN 的直段之间，如果有平行的部分就可以标注它们的间距」——
   * 不再是两个网格采样出的最近点对。
   */
  async function runPipeToPipeMeasurement(canvas: HTMLCanvasElement, e: PointerEvent): Promise<void> {
    if (pipeMeasureBusy.value) {
      setPipeMeasureStatus('正在计算上一条间距，请稍候…');
      return;
    }

    const hit = hooks.pickSurfacePoint(canvas, e);
    if (!hit) {
      setPipeMeasureStatus('管-管间距：未拾取到有效管道对象');
      return;
    }

    pipeMeasureBusy.value = true;
    try {
      const candidate = resolvePipeToPipeBranCandidate(hit);
      if (!candidate) {
        const picked = normalizeRefnoKey(hit.entityId || parseRefnoFromDtxObjectId(hit.objectId) || '') || hit.objectId;
        setPipeMeasureStatus(`管-管间距：${picked} 不属于任何 BRAN——只能量两条 BRAN 之间的平行直段，请点管件或直管`);
        return;
      }

      const source = pipeToPipeSourceCandidate.value;
      if (!source) {
        applyPipeToPipeSourceCandidate(candidate);
        return;
      }
      if (source.branRefno === candidate.branRefno) {
        setPipeMeasureStatus(`管-管间距：${candidate.pickedRefno} 与第一根同属 BRAN ${source.branRefno}，请点另一条 BRAN 上的管件`);
        return;
      }

      await completePipeToPipeSpacing(source, candidate);
    } catch (error) {
      setPipeMeasureStatus(`管-管间距计算失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pipeMeasureBusy.value = false;
    }
  }

  async function runPipeToStructureMeasurement(canvas: HTMLCanvasElement, e: PointerEvent): Promise<void> {
    if (pipeMeasureBusy.value) {
      setPipeMeasureStatus('正在计算上一条净距，请稍候…');
      return;
    }

    const hit = hooks.pickSurfacePoint(canvas, e);
    if (!hit) {
      setPipeMeasureStatus('未拾取到有效管道对象');
      return;
    }

    const layer = ctx.dtxLayerRef.value;
    if (!layer) {
      setPipeMeasureStatus('DTX 图层未就绪');
      return;
    }

    const sourceRefno = normalizeRefnoKey(hit.entityId);
    const dbnum = parseDbnumFromRefno(sourceRefno);
    if (!dbnum) {
      setPipeMeasureStatus(`无法解析 dbnum：${sourceRefno}`);
      return;
    }

    const loadedSourceObjectIds = resolveDtxObjectIdsByRefno(dbnum, sourceRefno);
    const sourceObjectId = hit.objectId || loadedSourceObjectIds[0];
    if (!sourceObjectId) {
      setPipeMeasureStatus(`源管道未加载几何：${sourceRefno}`);
      return;
    }

    pipeMeasureBusy.value = true;
    try {
      setPipeMeasureStatus('正在查询墙/柱候选…');
      // 候选来自 gen-model `/api/v1/spatial/nearest-clearance`：沿所属 BRAN 中心线按类型找半径内最近的墙 / 柱
      // （旧后端 `/api/space/wall-distance` 2026-09-20 随 legacy 退役）。拾中的是管件时先找它所属的 BRAN。
      const sourceBranRefno = findOwnerBranRefnoAcrossAllDbnos(sourceRefno) ?? sourceRefno;
      const response = await genModelV1SpatialNearestClearance({
        sourceRefno: sourceBranRefno,
        sourceMode: 'bran_centerline',
        targetNouns: PIPE_STRUCTURE_DEFAULT_NOUNS,
        groupBy: 'noun',
        maxPerGroup: PIPE_STRUCTURE_BACKEND_MAX_CANDIDATES,
        scope: 'all_loaded',
      });
      // 失败走 HTTP 错误信封（`GenModelV1ApiError`，由外层 catch 报状态），200 里 success 恒为 true
      const candidates: PipeWallDistanceCandidate[] = (response.nearest_by_group ?? [])
        .flatMap((group) => group.candidates ?? [])
        .filter((candidate) => PIPE_STRUCTURE_DEFAULT_NOUNS.includes(String(candidate.noun || '').toUpperCase()))
        .sort((a, b) => a.distance_mm - b.distance_mm)
        .slice(0, PIPE_STRUCTURE_FRONTEND_TOP_CANDIDATES)
        .map((candidate) => ({ refno: candidate.refno, noun: candidate.noun, distance_mm: candidate.distance_mm }));
      if (candidates.length === 0) {
        setPipeMeasureStatus('未找到可用墙/柱候选');
        return;
      }

      const targetPairs = resolveTargetObjectPairs(dbnum, candidates);
      if (targetPairs.length === 0) {
        setPipeMeasureStatus('候选对象未加载到当前场景');
        return;
      }

      setPipeMeasureStatus('正在收集参考点…');
      const globalMatrix = layer.getGlobalModelMatrix();
      const referencePoints = collectPipeReferencePointsWorld({
        sourceRefno,
        sourceObjectId,
        dbnum,
        layer,
        globalMatrix,
      });
      if (referencePoints.length === 0) {
        setPipeMeasureStatus('参考点收集失败');
        return;
      }

      setPipeMeasureStatus('阶段A：参考点最近距离计算…');
      let best = findBestPipeMeasureResult(layer, referencePoints, targetPairs);

      const samplePoints = collectSourceSamplePointsWorld(
        layer,
        sourceObjectId,
        PIPE_STRUCTURE_SOURCE_SAMPLE_LIMIT,
      );
      if (samplePoints.length > 0) {
        setPipeMeasureStatus('阶段B：采样点精化…');
        const refined = findBestPipeMeasureResult(layer, samplePoints, targetPairs);
        if (refined && (!best || refined.distance < best.distance)) {
          best = refined;
        }
      }

      if (!best) {
        setPipeMeasureStatus('最近点计算失败');
        return;
      }

      const bestTargetRefno = best.targetRefno;
      commitInteractiveClearance({
        kindLabel: '管-墙/柱净距',
        sourceRefno,
        targetRefno: bestTargetRefno,
        targetNoun: candidates.find((candidate) => normalizeRefnoKey(candidate.refno) === bestTargetRefno)?.noun ?? '',
        sourcePoint: best.sourcePoint,
        targetPoint: best.targetPoint,
      });
    } catch (error) {
      setPipeMeasureStatus(`计算失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pipeMeasureBusy.value = false;
    }
  }

  const statusText = computed(() => {
    const mode = ctx.store.toolMode.value;
    if (mode === 'none') return '未启用工具';
    if (!ctx.dtxViewerRef.value) return '三维查看器未初始化';
    if (!ctx.dtxLayerRef.value) return 'DTX 图层未初始化';
    if (!ctx.selectionRef.value) return '拾取控制器未就绪';
    if (!ctx.ready.value) return '等待模型加载完成…';

    if (mode === 'measure_point_to_object') {
      return pointToObjectStart.value ? '点到面测量：请点击选择目标对象（自动计算最近距离）' : '点到面测量：请点击选择起始点';
    }
    if (mode === 'measure_object_to_object') {
      if (objectToObjectBusy.value) {
        return objectToObjectStatus.value || '构件最近点测量：正在计算…';
      }
      if (objectToObjectStatus.value) {
        return objectToObjectStatus.value;
      }
      if (objectToObjectSourceCandidate.value) {
        return `构件最近点测量：已选第一个构件 ${objectToObjectSourceCandidate.value.refno}，请选择第二个构件`;
      }
      return '构件最近点测量：请选择第一个构件（可点三维或在模型树选中）';
    }
    if (mode === 'measure_pipe_to_structure') {
      if (pipeMeasureBusy.value) {
        return pipeMeasureStatus.value || '管-墙/柱净距测量：正在计算…';
      }
      return pipeMeasureStatus.value
        || '管-墙/柱净距测量：点击管道，估算到最近墙/柱的距离，生成净距记录（网格采样）';
    }
    if (mode === 'measure_pipe_to_pipe') {
      if (pipeMeasureBusy.value) {
        return pipeMeasureStatus.value || '管-管间距：正在计算…';
      }
      if (pipeMeasureStatus.value) {
        return pipeMeasureStatus.value;
      }
      return pipeToPipeSourceCandidate.value
        ? pipeToPipeSourceStatus(pipeToPipeSourceCandidate.value)
        : '管-管间距：点第一根管道（量两条 BRAN 平行直段之间的中心距，一对平行直段一条中心距记录）';
    }
    if (mode === 'pick_query_center') {
      return '请点击模型拾取查询中心点';
    }
    if (mode === 'pick_refno') {
      const filter = ctx.store.pickRefnoFilter.value;
      const count = ctx.store.pickedRefnos.value.length;
      const filterText = filter.length > 0 ? ` (类型: ${filter.join(', ')})` : '';
      const total = ctx.pickCandidates.value.length;
      const cycleText = total > 1
        ? ` — 光标处 ${ctx.pickCandidateIndex.value + 1}/${total} 个重叠${isTubePickFilter(filter) ? '直段' : '构件'}，Tab 切换`
        : '';
      return isTubePickFilter(filter)
        ? `直段拾取：点击直管选择直段 [已选 ${count}]${cycleText} — Enter 确认 / ESC 取消`
        : `拾取模式${filterText}：点击选择构件 [已选 ${count}]${cycleText} — Enter 确认 / ESC 取消`;
    }
    if (mode === 'pick_refno_box') {
      const filter = ctx.store.pickRefnoFilter.value;
      const count = ctx.store.pickedRefnos.value.length;
      const filterText = filter.length > 0 ? ` (类型: ${filter.join(', ')})` : '';
      return isTubePickFilter(filter)
        ? `直段框选：拖拽矩形框选直管 [已选 ${count}] — 松开鼠标即确认 / ESC 取消`
        : `框选模式${filterText}：拖拽矩形框选构件 [已选 ${count}] — 松开鼠标即确认 / ESC 取消`;
    }
    if (mode === 'annotation_cloud') {
      const targetCount = ctx.store.cloudTargetRefnos.value.length;
      if (targetCount === 0) return '云线批注：请先选择目标元素';
      return ctx.pendingCloudAnchor.value
        ? `云线批注：已选 ${targetCount} 个目标元素，锚点已就绪，请拖拽绘制云线轮廓`
        : `云线批注：已选 ${targetCount} 个目标元素，请点击模型选择锚点`;
    }
    if (mode === 'annotation_rect') {
      return '矩形批注：点击对象生成 OBB 包围框批注';
    }
    return '批注：点击模型表面创建';
  });

  const objectToObjectUiState = computed(() => {
    return {
      sourceRefno: objectToObjectSourceCandidate.value?.refno ?? null,
      targetRefno: objectToObjectTargetCandidate.value?.refno ?? null,
      busy: objectToObjectBusy.value,
      canReset: !!objectToObjectSourceCandidate.value || !!objectToObjectTargetCandidate.value,
      statusText: statusText.value,
    };
  });

  function resetProgress() {
    pointToObjectStart.value = null;
    clearObjectMeasureCandidates({ clearStatus: true, clearLastPairKey: true });
    clearPipeToPipeCandidate({ clearStatus: true });
    pipeMeasureBusy.value = false;
    pipeMeasureStatus.value = '';
  }

  function cancelMeasurementInteraction(): void {
    const mode = ctx.store.toolMode.value;
    if (mode === 'pick_query_center' || mode === 'pick_refno') {
      ctx.store.setToolMode('none');
      return;
    }
    if (mode === 'measure_object_to_object') {
      clearObjectMeasureCandidates({ clearStatus: true, clearLastPairKey: true });
      return;
    }
    resetProgress();
    hooks.clearPendingCloudAnchor();
    hooks.hideMarquee();
  }

  /** 四种测量模式的单击收口（原在 onCanvasPointerUp 里）；返回是否由测量模式接下。 */
  function handlePointerUp(canvas: HTMLCanvasElement, e: PointerEvent, mode: string): boolean {
    if (mode === 'measure_pipe_to_structure') {
      void runPipeToStructureMeasurement(canvas, e);
      return true;
    }

    if (mode === 'measure_pipe_to_pipe') {
      void runPipeToPipeMeasurement(canvas, e);
      return true;
    }

    if (mode === 'measure_point_to_object') {
      const hit = hooks.pickSurfacePoint(canvas, e);
      if (!hit) return true;

      if (!pointToObjectStart.value) {
        pointToObjectStart.value = { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) };
        return true;
      }

      const layer = ctx.dtxLayerRef.value;
      if (!layer) return true;
      const start = new Vector3(...pointToObjectStart.value.worldPos);
      const closest = layer.closestPointToObject(hit.objectId, start);
      if (!closest) return true;

      // #58：点到面仍是 Measurement，但端点补 designWorldPos、provenance 写全，
      // 经适配器走统一写入命令——流程里不再有裸 ctx.store.addMeasurement。
      commitDtxPointToObjectMeasurement({
        id: nowId('pto'),
        origin: pointToObjectStart.value,
        target: { entityId: hit.entityId, worldPos: vec3ToTuple(closest.point) },
        dtxLayerRef: ctx.dtxLayerRef,
        sourceAnnotation: ctx.store.activeAnnotationContext.value,
        createdAt: Date.now(),
        addMeasurement: (record) => ctx.store.addMeasurement(record),
      });
      pointToObjectStart.value = null;
      return true;
    }

    if (mode === 'measure_object_to_object') {
      const hit = hooks.pickSurfacePoint(canvas, e);
      if (!hit) {
        setObjectMeasureStatus('未拾取到有效构件');
        return true;
      }

      const candidate = createObjectMeasureCandidateFromHit(hit);
      if (!candidate) {
        setObjectMeasureStatus('未拾取到有效构件');
        return true;
      }

      if (!objectToObjectSourceCandidate.value) {
        applyObjectMeasureSourceCandidate(candidate);
        return true;
      }

      objectToObjectTargetCandidate.value = candidate;
      void commitObjectToObjectMeasurement(objectToObjectSourceCandidate.value, candidate);
      return true;
    }
    return false;
  }

  return {
    statusText,
    objectToObjectUiState,
    handleTreeObjectMeasureSelection,
    resetProgress,
    cancelMeasurementInteraction,
    handlePointerUp,
  };
}
