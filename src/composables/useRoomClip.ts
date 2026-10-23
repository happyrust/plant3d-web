/**
 * 房间视图 · 房间体与直段截断控制器（1:1 对齐 `plant-ui` ADR-0028 / ADR-0029 / `room_clip.rs` / `main.rs`）：
 *
 * 1. 进入房间视图（`enterRoomView`）：
 *    - 世代号 `epoch` 防串房；先复原上一间房改写过的直段、清空叠加层；
 *    - 按需通过 `showModels` 加载房间的在册边界面板（`panelRefnos`）与房间成员（`memberRefnos`）；
 *    - 从 `DTXLayer` 提取在册面板网格构建 `RoomSolid` 与半透明房间体图层（`RoomClipOverlay`）；
 *    - 若任一在册面板缺模型，遵循「宁可不截，也不按半个房间截」置为 `unavailable` 告警；
 *    - 将相机对准房间体世界包围盒（`bounds`）；
 * 2. 双模式隔离与直段截断：
 *    - **截断直段 = 开（默认）**：
 *      - 精确成员隔离：`keep = (memberRefnos \ panelRefnos) ∪ tubeCarriers`（排掉同分支在房间外的弯头/阀门，保留房内与穿墙管件）；
 *      - 在册面板在常规 `DTXLayer` 中隐藏（避免实体灰墙与半透明房间体叠画重影）；
 *      - 对 `tubeCarriers`（`BRAN` / `HANG`）名下的 `TUBI` 直段按每帧 256 根预算分帧执行 `planTubeClip`：
 *        - `whole`：保持原矩阵；
 *        - `hidden`：隐藏房间外的直段；
 *        - `cut`：首段 `pieces[0]` 原位改写 `DTXLayer` 矩阵，`pieces[1..]` 加补片，每个内部截点加 2 mm `#D946EF` 洋红断口薄饼；
 *    - **截断直段 = 关**：
 *      - 立即复原所有被截断/隐藏的直段矩阵与可见态，清空洋红断口与补片；
 *      - 隔离集切换为整根分支隔离：`keep = (memberRefnos ∪ tubeCarriers ∪ companions) \ panelRefnos`。
 * 3. 退出房间视图（`exitRoomView`）：
 *    - 复原直段、撤除半透明房间体与断口、恢复在册面板可见性、解除 X-Ray 隔离。
 */
import { computed, ref, shallowRef } from 'vue';

import { BufferAttribute, BufferGeometry, Color, Matrix4 } from 'three';

import type { DTXLayer } from '@/utils/three/dtx/DTXLayer';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

import { genModelV1TreeChildren } from '@/api/genModelV1Api';
import { sceneCompanionsOf } from '@/composables/deliveryUnitScene';
import {
  isDtxTubeSegmentHidden,
  resolveDtxObjectIdsByRefnos,
  resolveDtxTubiObjectsForCarriers,
} from '@/composables/useDbnoInstancesDtxLoader';
import { useSceneGraphOps } from '@/composables/useSceneGraph';
import { resolveSceneWorldTransform } from '@/composables/useSpatialQuery';
import { showModelByRefnosWithAck, useViewerContext, type ShowModelByRefnosResult } from '@/composables/useViewerContext';
import { emitToast } from '@/ribbon/toastBus';
import { panelTriMesh, type AabbMm, type PanelTriMesh } from '@/room-clip/predicate';
import {
  buildCapMatrix,
  buildPieceMatrix,
  collectInternalCutPoints,
  detectPrism,
  planTubeClip,
  type Prism,
} from '@/room-clip/prism';
import { RoomClipOverlay, type RoomPanelMeshInput } from '@/room-clip/RoomClipOverlay';
import { RoomSolid } from '@/room-clip/roomSolid';

export const ROOM_VIEW_TRUNCATE_STORAGE_KEY = 'plant3d.roomView.truncateTubes';

/** 每帧最多截断多少根直段（对齐 `plant-ui` `TUBES_PER_FRAME = 256`）。 */
export const TUBES_PER_FRAME = 256;

export type RoomClipPhase =
  | { kind: 'idle' }
  | { kind: 'loading'; done: number; total: number }
  | { kind: 'computing'; done: number; total: number }
  | { kind: 'ready'; cut: number; hidden: number; whole: number; skipped: number }
  | { kind: 'unavailable'; reason: string };

export interface EnterRoomViewOptions {
  roomRefno: string;
  roomNum: string;
  roomName?: string | null;
  panelRefnos: string[];
  memberRefnos: string[];
  tubeCarriers: string[];
  /** 可选注入：查看器引用（默认 `useViewerContext().viewerRef.value`） */
  viewer?: DtxCompatViewer | null;
  /** 可选注入：按需加载模型的函数（测试注桩用） */
  loadModels?: (refnos: string[]) => Promise<ShowModelByRefnosResult>;
  /** 可选注入：整分支伴随构件解析函数（默认 `sceneCompanionsOf`） */
  companionsOf?: (refnos: Iterable<string>, unitRefnos: Iterable<string>) => string[];
  /** 是否在面板就绪后飞向房间体包围盒（默认 `true`） */
  flyToRoom?: boolean;
}

interface SavedTubeState {
  objectId: string;
  originalMatrix: Matrix4;
  originalVisible: boolean;
}

interface ActiveRoomContext {
  epoch: number;
  roomRefno: string;
  roomNum: string;
  roomName: string | null;
  panelRefnos: string[];
  memberRefnos: string[];
  tubeCarriers: string[];
  volumeFailed: boolean;
  unavailableReason: string | null;
  solid: RoomSolid | null;
  companionsOf: (refnos: Iterable<string>, unitRefnos: Iterable<string>) => string[];
}

function readPersistedTruncateSetting(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return true;
    const raw = window.localStorage.getItem(ROOM_VIEW_TRUNCATE_STORAGE_KEY);
    if (raw === 'false' || raw === '0') return false;
    if (raw === 'true' || raw === '1') return true;
    return true;
  } catch {
    return true;
  }
}

function writePersistedTruncateSetting(on: boolean): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(ROOM_VIEW_TRUNCATE_STORAGE_KEY, on ? 'true' : 'false');
    }
  } catch {
    // ignore storage errors
  }
}

function normalizeRefno(refno: string): string {
  return String(refno ?? '').trim().replace(/^=/, '').replace('/', '_');
}

function uniqueNormalized(refnos: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refnos) {
    const key = normalizeRefno(r);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

const roomPanelsFallbackCache = new Map<string, string[]>();

/**
 * 解析房间的在册边界面板 `panel_refnos`：
 * 1. 优先直接采用 `GET /api/v1/spatial/rooms` 下发的 `panel_refnos`；
 * 2. 若连接的旧版后端尚未下发 `panel_refnos`（但 `panel_count > 0`），通过 `/api/v1/tree/children` 展开房间节点下的 `PANE` 节点并缓存。
 */
export async function resolveRoomPanelRefnosWithFallback(
  roomRefno: string,
  option?: { panel_count?: number; panelCount?: number; panel_refnos?: string[]; panelRefnos?: string[] } | null,
): Promise<string[]> {
  const direct = option?.panel_refnos ?? option?.panelRefnos;
  if (Array.isArray(direct) && direct.length > 0) {
    return uniqueNormalized(direct);
  }
  const count = option?.panel_count ?? option?.panelCount ?? 0;
  if (count <= 0) return [];
  const key = normalizeRefno(roomRefno);
  if (!key) return [];
  const cached = roomPanelsFallbackCache.get(key);
  if (cached) return cached;

  try {
    const panels: string[] = [];
    const seen = new Set<string>();
    const lv1 = await genModelV1TreeChildren(key);
    for (const node of lv1.nodes ?? []) {
      const noun = String(node.noun ?? '').trim().toUpperCase();
      const ref = normalizeRefno(node.refno);
      if (!ref) continue;
      if (noun === 'PANE' || noun === 'GWALL' || noun === 'CFLOOR') {
        if (!seen.has(ref)) {
          seen.add(ref);
          panels.push(ref);
        }
      } else if (noun === 'SBFR' || noun === 'FRMW') {
        const nameUpper = String(node.name ?? '').toUpperCase();
        if (nameUpper.endsWith('-INVO')) continue;
        const lv2 = await genModelV1TreeChildren(ref);
        for (const sub of lv2.nodes ?? []) {
          const subNoun = String(sub.noun ?? '').trim().toUpperCase();
          const subRef = normalizeRefno(sub.refno);
          if (subRef && (subNoun === 'PANE' || subNoun === 'GWALL' || subNoun === 'CFLOOR') && !seen.has(subRef)) {
            seen.add(subRef);
            panels.push(subRef);
          }
        }
      }
    }
    if (panels.length > 0) {
      roomPanelsFallbackCache.set(key, panels);
    }
    return panels;
  } catch {
    return [];
  }
}

// ---- 全局单例响应式状态（HUD 横幅、房间树、关联房间浮窗共用同一份真相） ----
const active = ref(false);
const roomRefno = ref<string | null>(null);
const roomNum = ref<string>('');
const roomName = ref<string | null>(null);
const memberCount = ref<number>(0);
const panelCount = ref<number>(0);
const truncateEnabled = ref<boolean>(readPersistedTruncateSetting());
const phase = shallowRef<RoomClipPhase>({ kind: 'idle' });

let currentEpoch = 0;
let activeCtx: ActiveRoomContext | null = null;
let activeViewer: DtxCompatViewer | null = null;
let computeRafId: number | null = null;

/** 当前已被改写矩阵或隐藏的直段备份表（objectId -> 原始矩阵与可见性）。 */
const savedTubes = new Map<string, SavedTubeState>();
/** 已在本轮房间视图中截断处理过的直段 objectId。 */
const processedTubeObjectIds = new Set<string>();
/** 被我们在本轮房间视图里隐藏的在册面板 refno（退房或兜底时恢复可见）。 */
const hiddenPanelRefnos = new Set<string>();
/** geoHash -> Prism 檢測结果缓存（`'non-prism'` 表示非沿 Z 棱柱）。 */
const prismCache = new Map<string, Prism | 'non-prism'>();
/** geoHash -> BufferGeometry 缓存（供房间体 X-Ray 与洋红断口复用）。 */
const geometryCache = new Map<string, BufferGeometry>();

const overlay = new RoomClipOverlay();

function resolveViewer(explicit?: DtxCompatViewer | null): DtxCompatViewer | null {
  if (explicit !== undefined) return explicit;
  if (activeViewer) return activeViewer;
  return useViewerContext().viewerRef.value;
}

function resolveDtxLayer(viewer: DtxCompatViewer | null): DTXLayer | null {
  if (!viewer) return null;
  return (viewer as unknown as { __dtxLayer?: DTXLayer }).__dtxLayer ?? null;
}

function cancelComputeLoop(): void {
  if (computeRafId !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(computeRafId);
    computeRafId = null;
  }
}

/** 从 `DTXLayer` 构建或取缓存的 `BufferGeometry`（局部坐标系）。 */
function getOrCreateBufferGeometry(dtxLayer: DTXLayer, geoHash: string): BufferGeometry | null {
  const cached = geometryCache.get(geoHash);
  if (cached) return cached;
  const slice = dtxLayer.getGeometryRawSlice(geoHash);
  if (!slice || slice.positions.length < 9 || slice.indices.length < 3) return null;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(slice.positions.slice(), 3));
  geo.setIndex(new BufferAttribute(slice.indices.slice(), 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geometryCache.set(geoHash, geo);
  return geo;
}

/** 检测 `geoHash` 是否为沿局部 Z 轴的棱柱（带缓存）。 */
function getOrDetectPrism(dtxLayer: DTXLayer, geoHash: string): Prism | null {
  const cached = prismCache.get(geoHash);
  if (cached !== undefined) {
    return cached === 'non-prism' ? null : cached;
  }
  const slice = dtxLayer.getGeometryRawSlice(geoHash);
  if (!slice) return null;
  const detected = detectPrism(slice.positions);
  prismCache.set(geoHash, detected ?? 'non-prism');
  return detected;
}

/** 整批复原所有被截断改写或隐藏的直段对象，并清空洋红断口与多段补片。 */
export function restoreClippedTubes(viewer = resolveViewer()): void {
  cancelComputeLoop();
  overlay.clearCapsAndPieces();
  processedTubeObjectIds.clear();

  const dtxLayer = resolveDtxLayer(viewer);
  if (dtxLayer && savedTubes.size > 0) {
    for (const saved of savedTubes.values()) {
      dtxLayer.setObjectMatrix(saved.objectId, saved.originalMatrix);
      // 若用户在截断期间又用「逐段眼睛」手动藏了某段，尊重用户的手动隐藏
      const tubeKey = resolveDtxTubiObjectsForCarriers(activeCtx?.tubeCarriers ?? []).find(
        (item) => item.objectId === saved.objectId,
      )?.tubeKey;
      const manuallyHidden = tubeKey ? isDtxTubeSegmentHidden(tubeKey) : false;
      dtxLayer.setObjectVisible(saved.objectId, manuallyHidden ? false : saved.originalVisible);
    }
  }
  savedTubes.clear();
  viewer?.requestRender?.();
}

/** 恢复因半透明房间体而隐藏的常规实体面板。 */
function restoreHiddenPanels(viewer = resolveViewer()): void {
  if (!viewer || hiddenPanelRefnos.size === 0) {
    hiddenPanelRefnos.clear();
    return;
  }
  const toRestore = Array.from(hiddenPanelRefnos);
  hiddenPanelRefnos.clear();
  viewer.scene.setObjectsVisible(toRestore, true);
}

/**
 * 计算房间视图的隔离目标集（对齐 `plant-ui` `room_view_isolate`）：
 * - `truncate = true`（且房间体可用）：`(memberRefnos \ panelRefnos) ∪ tubeCarriers`（排掉房外管件）；
 * - `truncate = false` 或 `volumeFailed = true`：`(memberRefnos ∪ tubeCarriers ∪ companions) \ panelRefnos`（若 `volumeFailed` 则保留 `panelRefnos`）。
 */
export function buildRoomIsolateRefnos(
  ctx: Pick<ActiveRoomContext, 'panelRefnos' | 'memberRefnos' | 'tubeCarriers' | 'companionsOf'>,
  truncate: boolean,
  withPanels: boolean,
): string[] {
  const panelSet = new Set(ctx.panelRefnos);
  const wanted = (refno: string) => withPanels || !panelSet.has(refno);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (refno: string) => {
    const key = normalizeRefno(refno);
    if (!key || !wanted(key) || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };

  if (withPanels) {
    for (const p of ctx.panelRefnos) push(p);
  }
  for (const m of ctx.memberRefnos) push(m);
  for (const c of ctx.tubeCarriers) push(c);

  if (!truncate) {
    const companions = ctx.companionsOf(ctx.memberRefnos, ctx.tubeCarriers);
    for (const comp of companions) push(comp);
  }
  return out;
}

/** 应用当前房间视图的隔离与面板显隐。 */
function applyRoomIsolation(ctx: ActiveRoomContext, viewer: DtxCompatViewer, truncate: boolean): void {
  const withPanels = ctx.volumeFailed;
  const keep = buildRoomIsolateRefnos(ctx, truncate && !ctx.volumeFailed, withPanels);
  const sceneGraph = useSceneGraphOps({ value: viewer });
  sceneGraph.isolate(keep);

  // 房间体正常画成半透明时，把常规实体面板藏掉（防止米色/灰色实体墙叠在半透明蓝墙上重影）
  if (!withPanels && ctx.panelRefnos.length > 0) {
    viewer.scene.setObjectsVisible(ctx.panelRefnos, false);
    for (const p of ctx.panelRefnos) hiddenPanelRefnos.add(p);
  } else if (withPanels && hiddenPanelRefnos.size > 0) {
    restoreHiddenPanels(viewer);
  }
}

/**
 * 从 `DTXLayer` 提取在册面板的世界三角网并构建 `RoomSolid` 与 `RoomClipOverlay` 半透明房间体。
 */
function buildRoomVolumeFromDtx(
  dtxLayer: DTXLayer,
  panelRefnos: string[],
): {
  solid: RoomSolid | null;
  panelMeshes: RoomPanelMeshInput[];
  missingCount: number;
} {
  const refnoToObjIds = resolveDtxObjectIdsByRefnos(panelRefnos);
  const triMeshes: PanelTriMesh[] = [];
  const panelMeshes: RoomPanelMeshInput[] = [];
  let missingCount = 0;

  for (const panelRefno of panelRefnos) {
    const objIds = refnoToObjIds.get(panelRefno) ?? [];
    let panelHasMesh = false;
    for (const objectId of objIds) {
      const obj = dtxLayer.getObject(objectId);
      if (!obj) continue;
      const matrixMm = dtxLayer.getObjectMatrix(objectId, new Matrix4());
      const rawSlice = dtxLayer.getGeometryRawSlice(obj.geoHash);
      if (!matrixMm || !rawSlice) continue;

      const triMesh = panelTriMesh(rawSlice.positions, rawSlice.indices, matrixMm.elements);
      if (triMesh) {
        triMeshes.push(triMesh);
        panelHasMesh = true;
      }
      const bufferGeo = getOrCreateBufferGeometry(dtxLayer, obj.geoHash);
      if (bufferGeo) {
        panelMeshes.push({
          panelRefno,
          geometry: bufferGeo,
          matrixMm,
        });
      }
    }
    if (!panelHasMesh) {
      missingCount++;
    }
  }

  return {
    solid: RoomSolid.fromPanels(triMeshes),
    panelMeshes,
    missingCount,
  };
}

/**
 * 启动或继续分帧直段截断（每帧最多 `TUBES_PER_FRAME = 256` 根）。
 */
function startTubeClippingPass(ctx: ActiveRoomContext, viewer: DtxCompatViewer): void {
  cancelComputeLoop();

  if (ctx.volumeFailed || ctx.unavailableReason || !ctx.solid) {
    phase.value = {
      kind: 'unavailable',
      reason: ctx.unavailableReason || '房间体不可用',
    };
    return;
  }

  if (!truncateEnabled.value) {
    restoreClippedTubes(viewer);
    phase.value = { kind: 'ready', cut: 0, hidden: 0, whole: 0, skipped: 0 };
    return;
  }

  const dtxLayer = resolveDtxLayer(viewer);
  if (!dtxLayer) {
    phase.value = { kind: 'ready', cut: 0, hidden: 0, whole: 0, skipped: 0 };
    return;
  }

  // 先复原上一轮改写过的直段，再干净重算本轮
  restoreClippedTubes(viewer);

  const dtxViewer = (viewer as unknown as { __dtxViewer?: { scene?: import('three').Scene } }).__dtxViewer;
  if (dtxViewer?.scene) {
    overlay.attach(dtxViewer.scene, dtxLayer.getGlobalModelMatrix());
  }

  const candidates = resolveDtxTubiObjectsForCarriers(ctx.tubeCarriers);
  const total = candidates.length;
  if (total === 0) {
    phase.value = { kind: 'ready', cut: 0, hidden: 0, whole: 0, skipped: 0 };
    return;
  }

  let cursor = 0;
  let cut = 0;
  let hidden = 0;
  let whole = 0;
  let skipped = 0;
  const epoch = ctx.epoch;
  const solid = ctx.solid;

  const processBatch = () => {
    if (!activeCtx || activeCtx.epoch !== epoch || !truncateEnabled.value) {
      computeRafId = null;
      return;
    }

    const end = Math.min(cursor + TUBES_PER_FRAME, total);
    for (; cursor < end; cursor++) {
      const item = candidates[cursor]!;
      const { objectId, carrierRefno, tubeKey } = item;
      processedTubeObjectIds.add(objectId);

      const obj = dtxLayer.getObject(objectId);
      if (!obj) {
        skipped++;
        continue;
      }

      const prism = getOrDetectPrism(dtxLayer, obj.geoHash);
      if (!prism) {
        skipped++;
        continue;
      }

      const origMatrix = dtxLayer.getObjectMatrix(objectId, new Matrix4());
      if (!origMatrix) {
        skipped++;
        continue;
      }

      const plan = planTubeClip(solid, origMatrix, prism);
      switch (plan.kind) {
        case 'whole':
          whole++;
          break;
        case 'hidden': {
          if (!savedTubes.has(objectId)) {
            savedTubes.set(objectId, {
              objectId,
              originalMatrix: origMatrix.clone(),
              originalVisible: dtxLayer.isObjectVisible(objectId),
            });
          }
          dtxLayer.setObjectVisible(objectId, false);
          hidden++;
          break;
        }
        case 'cut': {
          if (!savedTubes.has(objectId)) {
            savedTubes.set(objectId, {
              objectId,
              originalMatrix: origMatrix.clone(),
              originalVisible: dtxLayer.isObjectVisible(objectId),
            });
          }
          const manuallyHidden = tubeKey ? isDtxTubeSegmentHidden(tubeKey) : false;
          const firstPiece = plan.pieces[0]!;
          const firstMatrix = buildPieceMatrix(origMatrix, prism, firstPiece);
          dtxLayer.setObjectMatrix(objectId, firstMatrix);
          dtxLayer.setObjectVisible(objectId, !manuallyHidden);

          const bufferGeo = getOrCreateBufferGeometry(dtxLayer, obj.geoHash);
          if (bufferGeo && !manuallyHidden) {
            // 凹房间 / L 形房间二次进房的附加管段（pieces[1..]）
            const colorHex = (obj.hasColorOverride ? obj.colorOverride : obj.color)?.getHex?.() ?? 0x94a3b8;
            for (let pIdx = 1; pIdx < plan.pieces.length; pIdx++) {
              const extraMat = buildPieceMatrix(origMatrix, prism, plan.pieces[pIdx]!);
              overlay.addExtraPiece(bufferGeo, extraMat, colorHex, carrierRefno);
            }
            // 每个内部截点贴一枚 2 mm #D946EF 洋红断口薄饼
            for (const cutT of collectInternalCutPoints(plan.pieces)) {
              const capMat = buildCapMatrix(origMatrix, prism, plan.lengthMm, cutT);
              overlay.addSectionCap(bufferGeo, capMat, carrierRefno);
            }
          }
          cut++;
          break;
        }
        case 'skipped':
          skipped++;
          break;
      }
    }

    viewer.requestRender?.();

    if (cursor < total) {
      phase.value = { kind: 'computing', done: cursor, total };
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        computeRafId = window.requestAnimationFrame(processBatch);
      } else {
        processBatch();
      }
    } else {
      computeRafId = null;
      phase.value = { kind: 'ready', cut, hidden, whole, skipped };
    }
  };

  phase.value = { kind: 'computing', done: 0, total };
  processBatch();
}

/** 飞向世界毫米包围盒。 */
function flyToBoundsMm(viewer: DtxCompatViewer, bounds: AabbMm): void {
  const aabb6: [number, number, number, number, number, number] = [
    bounds.min[0],
    bounds.min[1],
    bounds.min[2],
    bounds.max[0],
    bounds.max[1],
    bounds.max[2],
  ];
  if (!aabb6.every((v) => Number.isFinite(v))) return;
  const sceneAabb = resolveSceneWorldTransform(
    viewer as unknown as Parameters<typeof resolveSceneWorldTransform>[0],
  ).aabbToScene(aabb6);
  viewer.cameraFlight?.flyTo?.({ aabb: sceneAabb, duration: 0.8, fit: true });
}

/**
 * 进入房间视图（含半透明房间体、相机对准房间体、双模式隔离与直段截断）。
 */
export async function enterRoomView(options: EnterRoomViewOptions): Promise<void> {
  const viewer = resolveViewer(options.viewer);
  activeViewer = viewer;

  const normalizedRoom = normalizeRefno(options.roomRefno);
  const panelRefnos = uniqueNormalized(options.panelRefnos);
  const memberRefnos = uniqueNormalized(options.memberRefnos);
  const tubeCarriers = uniqueNormalized(options.tubeCarriers);
  const companionsOf = options.companionsOf ?? sceneCompanionsOf;

  // 先撤上一间房的直段改写与叠加层
  restoreClippedTubes(viewer);
  overlay.clearAll();
  restoreHiddenPanels(viewer);

  const epoch = ++currentEpoch;
  active.value = true;
  roomRefno.value = normalizedRoom;
  roomNum.value = options.roomNum || normalizedRoom;
  roomName.value = options.roomName ?? null;
  memberCount.value = memberRefnos.length;
  panelCount.value = panelRefnos.length;

  const ctx: ActiveRoomContext = {
    epoch,
    roomRefno: normalizedRoom,
    roomNum: options.roomNum || normalizedRoom,
    roomName: options.roomName ?? null,
    panelRefnos,
    memberRefnos,
    tubeCarriers,
    volumeFailed: false,
    unavailableReason: null,
    solid: null,
    companionsOf,
  };
  activeCtx = ctx;

  if (!viewer) {
    phase.value = { kind: 'unavailable', reason: '三维视口尚未就绪' };
    return;
  }

  const dtxLayer = resolveDtxLayer(viewer);
  // 若没有 DTXLayer（例如轻量桩 viewer 测试），仍然先执行隔离并置状态
  if (!dtxLayer) {
    if (panelRefnos.length === 0) {
      ctx.volumeFailed = true;
      ctx.unavailableReason = '房间没有在册面板';
      applyRoomIsolation(ctx, viewer, false);
      phase.value = { kind: 'unavailable', reason: ctx.unavailableReason };
    } else {
      applyRoomIsolation(ctx, viewer, truncateEnabled.value);
      phase.value = { kind: 'ready', cut: 0, hidden: 0, whole: 0, skipped: 0 };
    }
    return;
  }

  // 1. 先按当前开关做首拍隔离
  applyRoomIsolation(ctx, viewer, truncateEnabled.value);

  if (panelRefnos.length === 0) {
    ctx.volumeFailed = true;
    ctx.unavailableReason = '房间没有在册面板';
    applyRoomIsolation(ctx, viewer, false);
    phase.value = { kind: 'unavailable', reason: ctx.unavailableReason };
    return;
  }

  // 2. 检查哪些面板或成员模型尚未装入 DTX，按需后台加载
  const loadModels =
    options.loadModels ??
    ((refnos: string[]) =>
      showModelByRefnosWithAck({
        refnos,
        flyTo: false,
        timeoutMs: 120_000,
        ensureViewerReady: true,
      }));

  const existingPanelMap = resolveDtxObjectIdsByRefnos(panelRefnos);
  const missingPanels = panelRefnos.filter((r) => !existingPanelMap.has(r));
  const existingCarrierMap = resolveDtxObjectIdsByRefnos(tubeCarriers);
  const missingCarriers = tubeCarriers.filter((r) => !existingCarrierMap.has(r));
  const toLoad = uniqueNormalized([...missingPanels, ...missingCarriers, ...memberRefnos.filter((r) => !viewer.scene.objects[r])]);

  if (toLoad.length > 0) {
    phase.value = { kind: 'loading', done: 0, total: toLoad.length };
    try {
      await loadModels(toLoad);
    } catch (error) {
      console.warn('[room-clip] 加载房间面板/成员模型异常:', error);
    }
    if (!activeCtx || activeCtx.epoch !== epoch) return;
  }

  // 3. 构建 RoomSolid 与半透明房间体
  const { solid, panelMeshes, missingCount } = buildRoomVolumeFromDtx(dtxLayer, panelRefnos);
  if (!solid || panelMeshes.length === 0) {
    ctx.volumeFailed = true;
    ctx.unavailableReason = '在册面板都还没有模型';
    overlay.clearAll();
    applyRoomIsolation(ctx, viewer, false);
    phase.value = { kind: 'unavailable', reason: ctx.unavailableReason };
    return;
  }

  const dtxViewer = (viewer as unknown as { __dtxViewer?: { scene?: import('three').Scene } }).__dtxViewer;
  if (dtxViewer?.scene) {
    overlay.attach(dtxViewer.scene, dtxLayer.getGlobalModelMatrix());
  }
  overlay.setRoomVolumePanels(panelMeshes);

  if (options.flyToRoom !== false) {
    flyToBoundsMm(viewer, solid.bounds);
  }

  if (missingCount > 0) {
    // 缺面板就不截：宁可不截，也不按半个房间截；半透明照样画，看得见缺在哪（对齐 plant-ui R5）
    ctx.unavailableReason = `${missingCount} 块在册面板没有模型，房间体不全`;
    ctx.solid = null;
    applyRoomIsolation(ctx, viewer, false);
    phase.value = { kind: 'unavailable', reason: ctx.unavailableReason };
    viewer.requestRender?.();
    return;
  }

  ctx.solid = solid;
  ctx.volumeFailed = false;
  ctx.unavailableReason = null;
  applyRoomIsolation(ctx, viewer, truncateEnabled.value);
  startTubeClippingPass(ctx, viewer);
}

/**
 * 拨动「截断直段」开关：持久化到 `localStorage`，正在进行的房间视图立即切换隔离口径并截断/复原。
 */
export function setRoomTubeTruncation(on: boolean): void {
  truncateEnabled.value = on;
  writePersistedTruncateSetting(on);

  const ctx = activeCtx;
  const viewer = resolveViewer();
  if (!active.value || !ctx || !viewer) return;

  applyRoomIsolation(ctx, viewer, on);
  if (ctx.volumeFailed || ctx.unavailableReason) {
    phase.value = {
      kind: 'unavailable',
      reason: ctx.unavailableReason || '房间体不可用',
    };
  } else if (on) {
    startTubeClippingPass(ctx, viewer);
    emitToast({
      message: '直段截断已开：直段只画房间体内的那一截，房间外的管件不显示',
      level: 'info',
    });
  } else {
    restoreClippedTubes(viewer);
    phase.value = { kind: 'ready', cut: 0, hidden: 0, whole: 0, skipped: 0 };
    emitToast({
      message: '直段截断已关：整根分支显示',
      level: 'info',
    });
  }
}

export function toggleRoomTubeTruncation(): void {
  setRoomTubeTruncation(!truncateEnabled.value);
}

/**
 * 退出房间视图：整批复原直段矩阵与可见性、撤除半透明房间体与断口、恢复面板与解除 X-Ray 隔离。
 */
export function exitRoomView(options?: { keepIsolation?: boolean }): void {
  currentEpoch++;
  const viewer = resolveViewer();
  restoreClippedTubes(viewer);
  overlay.clearAll();
  restoreHiddenPanels(viewer);

  active.value = false;
  activeCtx = null;
  roomRefno.value = null;
  roomNum.value = '';
  roomName.value = null;
  memberCount.value = 0;
  panelCount.value = 0;
  phase.value = { kind: 'idle' };

  if (!options?.keepIsolation && viewer) {
    useSceneGraphOps({ value: viewer }).clearIsolation();
  }
  viewer?.requestRender?.();
}

/**
 * 场景有新实例增量加载完成时由 `ViewerPanel.__dtxAfterInstancesLoaded` 调入：
 * 1. 同步 `DTXLayer` 全局矩阵到 `RoomClipOverlay`；
 * 2. 若当前处于房间视图，重新保持面板隐藏并补截新到位的直管。
 */
export function notifyRoomClipInstancesLoaded(loadedRefnos?: string[]): void {
  const ctx = activeCtx;
  const viewer = resolveViewer();
  if (!active.value || !ctx || !viewer) return;

  const dtxLayer = resolveDtxLayer(viewer);
  if (!dtxLayer) return;

  overlay.syncGlobalMatrix(dtxLayer.getGlobalModelMatrix());

  if (!ctx.volumeFailed && ctx.panelRefnos.length > 0) {
    viewer.scene.setObjectsVisible(ctx.panelRefnos, false);
    for (const p of ctx.panelRefnos) hiddenPanelRefnos.add(p);
  }

  // 若此前因为面板未加载完而 unavailable，或有新载体直管刚到位，重跑一次
  const loadedSet = new Set((loadedRefnos ?? []).map(normalizeRefno));
  const panelJustLoaded = ctx.panelRefnos.some((p) => loadedSet.has(p));
  const carrierJustLoaded = ctx.tubeCarriers.some((c) => loadedSet.has(c));

  if (panelJustLoaded || (!ctx.solid && !ctx.volumeFailed)) {
    const { solid, panelMeshes, missingCount } = buildRoomVolumeFromDtx(dtxLayer, ctx.panelRefnos);
    if (solid && panelMeshes.length > 0) {
      const dtxViewer = (viewer as unknown as { __dtxViewer?: { scene?: import('three').Scene } }).__dtxViewer;
      if (dtxViewer?.scene) {
        overlay.attach(dtxViewer.scene, dtxLayer.getGlobalModelMatrix());
      }
      overlay.setRoomVolumePanels(panelMeshes);
      if (missingCount === 0) {
        ctx.solid = solid;
        ctx.volumeFailed = false;
        ctx.unavailableReason = null;
        applyRoomIsolation(ctx, viewer, truncateEnabled.value);
        startTubeClippingPass(ctx, viewer);
        return;
      }
    }
  }

  if (carrierJustLoaded && ctx.solid && truncateEnabled.value) {
    applyRoomIsolation(ctx, viewer, true);
    startTubeClippingPass(ctx, viewer);
  }
}

/** 截断结果摘要文案（与 `plant-ui` `truncation_summary` 同构）。 */
export const truncationSummaryText = computed(() => {
  const p = phase.value;
  if (p.kind !== 'ready') return '';
  const tail = p.skipped > 0 ? ` · 未能截断 ${p.skipped} 段` : '';
  return `截断 ${p.cut} 段 · 房间外 ${p.hidden} 段不画 · 整段在内 ${p.whole} 段${tail}`;
});

export function useRoomClip() {
  return {
    active,
    roomRefno,
    roomNum,
    roomName,
    memberCount,
    panelCount,
    truncateEnabled,
    phase,
    truncationSummaryText,
    enterRoomView,
    setRoomTubeTruncation,
    toggleRoomTubeTruncation,
    exitRoomView,
    restoreClippedTubes,
    notifyRoomClipInstancesLoaded,
  };
}