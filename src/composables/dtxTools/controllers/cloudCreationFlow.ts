/**
 * 拖框创建流程：云线创建状态机（闸门 / 锚点 / 分级回退 / 自动截图回执）、marquee 拖框（云线、OBB、矩形、构件 / 直段框选）、
 * 框选命中几何与共享范围体（方案 §7 / §8）。闸门信号 cloudGateBlock 是自有状态（返回给浮动工具条）；锚点 / 拖框态 / 预览线在 ctx 上。
 * 从 useDtxTools.ts 搬出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 6 步），实现未改；拖框 DOM 经 hooks 回到 overlayHost，
 * 表面拾点经 hooks.pickSurfacePoint，画完自动选中经 hooks.activateAnnotation 回到 annotationInteraction。
 * 自动化钩子 window.__plant3dDtxE2E（plant3d_automation_review=1）也在这里注册，和原来一样在装配时执行。
 */
import { nextTick, ref } from 'vue';

import { Box3, BufferAttribute, BufferGeometry, Frustum, Line, LineBasicMaterial, Matrix4, Plane, Vector3 } from 'three';

import { computeAabbObbFromBox3, createCloudAnnotationRecordFromAnchorAndMarquee, createRectAnnotationRecordFromObb, topCenterFromBox3 } from '../annotationRecords';
import { buildCloudSourceStamp, buildMembersRegionV1, captureCreationViewSnapshot, createDefaultCloudLabelLayoutV1 } from '../cloudRegion';
import { getCanvasPos, nowId, overlayToWorld, vec3ToTuple, worldToOverlayPoint } from '../geometry';
import { isTubePickFilter, resolveBoxPickRefnos } from '../pickCandidates';

import type { DtxToolsContext } from '../context';
import type { AnnotationOverlayKind, PendingCloudAnchor } from '../types';

import { reviewAttachmentDelete } from '@/api/reviewApi';
import { attachAnnotationScreenshotByRoute } from '@/composables/annotationReceiptRoute';
import { useAnnotationDraftSession } from '@/composables/useAnnotationDraftSession';
import { isCloudRenderFlagEnabled } from '@/composables/useCloudRenderFlags';
import { findNounByRefnoAcrossAllDbnos, listDtxTubeObjects } from '@/composables/useDbnoInstancesDtxLoader';
import { useScreenshot } from '@/composables/useScreenshot';
import { type CloudAnnotationRecord, type ObbAnnotationRecord, buildCloudBindings } from '@/composables/useToolStore';
import { type ObbSnapshot, type RegionV1, createRegionCloudPresentationV1 } from '@/review/domain/cloudRegion';
import { emitToast } from '@/ribbon/toastBus';

export type CloudCreationFlowHooks = {
  pickSurfacePoint: (canvas: HTMLCanvasElement, e: PointerEvent) => { entityId: string; worldPos: Vector3; objectId: string } | null;
  hideMarquee: () => void;
  updateMarqueeStyle: (mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box', dx: number) => void;
  updateMarqueeRect: (start: { x: number; y: number }, end: { x: number; y: number }) => void;
  activateAnnotation: (kind: AnnotationOverlayKind, id: string) => void;
};

export function createCloudCreationFlow(ctx: DtxToolsContext, hooks: CloudCreationFlowHooks) {
  const { captureAndUpload } = useScreenshot();
  // U0：异步回执（自动截图）出发前盖 scope 戳，回来时按戳决定落到当前内存还是出发时那个 scope 的容器
  const draftSession = useAnnotationDraftSession();

  /** 共享范围体（方案 §7 / §8）：成员 refno → 已加载对象的真实放置盒；拿不到几何回 null（不用子集冒充） */
  function resolveMemberRegionBoxes(refno: string): ObbSnapshot[] | null {
    const layer = ctx.dtxLayerRef.value;
    if (!layer) return null;
    const region = buildMembersRegionV1({
      memberRefnos: [refno],
      layer,
      getMemberAabb: (r) => ctx.compatViewerRef.value?.scene.getAABB([r]) ?? null,
      source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: null, coordinateFrameId: null },
    });
    return region && region.kind === 'obb-union' ? [...region.boxes] : null;
  }
  // 重绑 member 时 ctx.store 用它给 `origin:'members'` 范围体补盒（原子更新绑定 + 范围 + 兼容字段）
  ctx.store.setAnnotationRegionMemberBoxResolver(resolveMemberRegionBoxes);

  /** rect / obb 新建（开关 `annotationSharedRegion`）：目标集合 → `regionV1(obb-union, origin:'members')`；范围不完整回 null 不写 */
  function buildSharedRegionForMembers(memberRefnos: readonly string[]): RegionV1 | null {
    if (!isCloudRenderFlagEnabled('annotationSharedRegion')) return null;
    const layer = ctx.dtxLayerRef.value;
    if (!layer) return null;
    return buildMembersRegionV1({
      memberRefnos,
      layer,
      getMemberAabb: (refno) => ctx.compatViewerRef.value?.scene.getAABB([refno]) ?? null,
      source: buildCloudSourceStamp(memberRefnos, layer),
    });
  }

  function clearPendingCloudAnchor() {
    ctx.pendingCloudAnchor.value = null;
  }

  /**
   * 云线绘制闸门：目标元素集合为空时，既不允许 pick 锚点也不允许拖框。
   *
   * 刻意集中在工具层——进入 `annotation_cloud` 的入口有四处（批注面板、
   * 视口浮动工具条、校审工作台、校审面板），逐个面板校验必然漏网。
   */
  function canDrawCloudAnnotation(): boolean {
    return ctx.store.cloudTargetRefnos.value.length > 0;
  }

  /**
   * 闸门拦截的外发信号：浮动工具条据此把对应步骤闪红。
   * 闸门本身只能 return，没有反馈用户就只会反复拖框而不知道缺了哪一步。
   */
  const cloudGateBlock = ref<{ step: 'target' | 'anchor'; at: number } | null>(null);
  let lastCloudGateToastAt = 0;

  const CLOUD_GATE_MESSAGE: Record<'target' | 'anchor', string> = {
    target: '请先关联至少一个目标元素，再绘制云线',
    anchor: '请先在模型上点击一处锚点，再拖拽绘制云线轮廓',
  };

  function notifyCloudGateBlocked(step: 'target' | 'anchor') {
    const now = Date.now();
    cloudGateBlock.value = { step, at: now };
    // 拖框会连续触发 pointerdown，节流避免同一句提示刷屏。
    if (now - lastCloudGateToastAt < 1500) return;
    lastCloudGateToastAt = now;
    emitToast({ message: CLOUD_GATE_MESSAGE[step], level: 'warning' });
  }

  /** 云线创建的统一回退入口：清掉锚点、拖框预览与目标集合。 */
  function cancelCloudCreation() {
    clearPendingCloudAnchor();
    hooks.hideMarquee();
    ctx.store.clearCloudTargetRefnos();
  }

  /** 退出云线工具但保留目标集合，再次进入可直接复用（方案 §2.1）。 */
  function suspendCloudCreation() {
    clearPendingCloudAnchor();
    hooks.hideMarquee();
  }

  /** 拖框被中途打断时归还相机控制与指针捕获，否则退出后视角就转不动了。 */
  function releaseMarqueeCapture() {
    const viewer = ctx.dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = true;
    const pointerId = ctx.marqueeState.value.pointerId;
    const canvas = viewer?.canvas;
    if (canvas && pointerId !== null) {
      try { canvas.releasePointerCapture(pointerId); } catch { /* ignore */ }
    }
  }

  /**
   * 云线创建的分级回退：一次 Esc 只退一步（拖框预览 → 锚点 → 退出工具）。
   *
   * 目标集合是整个流程里最贵的一步——可能逐个点了十几个构件——不能因为
   * 想重拖一次轮廓就被连坐清空；退出工具时也保留，方案 §2.1 要求「再次进入可复用」。
   * 返回 true 表示这次 Esc 已被云线状态机消费，调用方不应再退出工具模式。
   */
  function rollbackCloudCreationStep(): boolean {
    if (ctx.store.toolMode.value !== 'annotation_cloud') return false;
    if (ctx.marqueeState.value.active) {
      releaseMarqueeCapture();
      hooks.hideMarquee();
      return true;
    }
    if (ctx.pendingCloudAnchor.value) {
      clearPendingCloudAnchor();
      return true;
    }
    return false;
  }

  async function captureCreatedCloudScreenshot(rec: CloudAnnotationRecord) {
    const taskId = ctx.reviewStore.currentTask.value?.id;
    if (!taskId) return null;

    // 出发前盖戳：上传期间用户可能切到别的任务
    const scopeStamp = draftSession.currentStamp();
    await nextTick();
    const attachment = await captureAndUpload(taskId, {
      kind: 'auto_cloud_finish',
      sourceAnnotationId: rec.id,
      description: rec.title,
    });
    const route = draftSession.routeDataReceipt(scopeStamp);
    if (!attachment) {
      // 提示是瞬态的：人已经在别的任务里就不打扰
      if (route.kind !== 'other-scope') {
        emitToast({ message: '云线已创建，但自动截图失败，可在批注面板重拍', level: 'warning' });
      }
      return null;
    }

    const screenshot = {
      url: attachment.url,
      attachmentId: attachment.id,
      name: attachment.name,
      capturedAt: attachment.capturedAt,
      mimeType: attachment.mimeType,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
      uploadedAt: attachment.uploadedAt,
    };
    // 按落点挂：还在出发时的任务就写内存；迟到的截图只能归属它出发时的任务——写进那个 scope 的本机容器，
    // 不碰当前任务的内存（方案 §3.6）。两条路都找不到这条云线就删掉刚上传的附件，别留孤儿。
    const attached = attachAnnotationScreenshotByRoute(ctx.store, route, 'cloud', rec.id, screenshot);
    if (!attached) {
      void reviewAttachmentDelete(attachment.id).catch((error) => {
        console.warn('[annotation] Failed to clean orphan cloud screenshot:', error);
      });
      return null;
    }
    return attachment;
  }

  try {
    if (localStorage.getItem('plant3d_automation_review') === '1') {
      (window as unknown as {
        __plant3dDtxE2E?: {
          addCloudAnnotationWithScreenshot: () => Promise<{
            annotationId: string;
            attachmentId: string;
            url: string;
            mimeType?: string;
            size?: number;
            width?: number;
            height?: number;
          }>;
        };
      }).__plant3dDtxE2E = {
        addCloudAnnotationWithScreenshot: async () => {
          const createdAt = Date.now();
          const rec: CloudAnnotationRecord = {
            id: `cloud-e2e-${createdAt}`,
            objectIds: ['24381_145018'],
            refnos: ['24381_145018'],
            anchorWorldPos: [0, 0, 0],
            visible: true,
            title: '云线批注（仿 PMS 自动化）',
            description: '',
            createdAt,
          };
          ctx.store.addCloudAnnotation(rec);
          const attachment = await captureCreatedCloudScreenshot(rec);
          if (!attachment) throw new Error('云线自动截图上传未返回附件');
          const screenshot = ctx.store.cloudAnnotations.value.find((item) => item.id === rec.id)?.screenshot;
          if (!screenshot?.attachmentId || !screenshot.url) {
            throw new Error('云线自动截图未写回批注');
          }
          return {
            annotationId: rec.id,
            attachmentId: screenshot.attachmentId,
            url: screenshot.url,
            mimeType: screenshot.mimeType,
            size: screenshot.size,
            width: screenshot.width,
            height: screenshot.height,
          };
        },
      };
    }
  } catch {
    // 自动化钩子不可用时不影响正式云线工具。
  }

  function setPendingCloudAnchor(anchor: PendingCloudAnchor) {
    ctx.pendingCloudAnchor.value = {
      worldPos: [...anchor.worldPos],
      refno: anchor.refno,
      entityId: anchor.entityId,
    };
  }

  function computeRectPlaneBasis(camera: any, normal: Vector3): { u: Vector3; v: Vector3 } {
    const camUp = camera.up ? (camera.up as Vector3) : new Vector3(0, 0, 1);
    const u = new Vector3().crossVectors(normal, camUp);
    if (u.lengthSq() < 1e-8) {
      u.set(1, 0, 0);
    } else {
      u.normalize();
    }
    const v = new Vector3().crossVectors(u, normal).normalize();
    return { u, v };
  }

  function intersectPlaneFromPointer(canvas: HTMLCanvasElement, e: PointerEvent, plane: Plane): Vector3 | null {
    const viewer = ctx.dtxViewerRef.value;
    if (!viewer) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const ndc = new Vector3(x, y, 0.5);
    ndc.unproject(viewer.camera);
    const dir = ndc.sub(viewer.camera.position).normalize();
    const rayOrigin = viewer.camera.position.clone();
    const hit = new Vector3();
    // Plane.intersectLine expects Line3; use analytic ray-plane intersection
    const denom = plane.normal.dot(dir);
    if (Math.abs(denom) < 1e-8) return null;
    const t = -(rayOrigin.dot(plane.normal) + plane.constant) / denom;
    if (!Number.isFinite(t)) return null;
    hit.copy(dir).multiplyScalar(t).add(rayOrigin);
    return hit;
  }

  function updateRectPreview(worldCorners: Vector3[]) {
    if (worldCorners.length !== 4) return;
    const pts = [...worldCorners, worldCorners[0]!];
    const arr: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      arr.push(p.x, p.y, p.z);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
    const mat = new LineBasicMaterial({ color: 0x111827 })
      ; (mat as any).depthTest = false;
    const line = new Line(g, mat);
    line.renderOrder = 950;

    if (ctx.rectPreviewLine.value) {
      try {
        ctx.toolsGroup.remove(ctx.rectPreviewLine.value);
        ctx.rectPreviewLine.value.geometry.dispose()
        ; (ctx.rectPreviewLine.value.material as any)?.dispose?.();
      } catch { /* ignore */ }
    }
    ctx.rectPreviewLine.value = line;
    ctx.toolsGroup.add(line);
  }

  /**
   * 框选命中计算。逐条目投影八个角点，规模等于已加载构件数，因此这里对热点很敏感：
   * - 视口矩形只读一次，`worldToOverlay` 每次调用都会 getBoundingClientRect，
   *   放在角点循环里就是每个构件 16 次强制重排；
   * - 先用视锥剔除掉屏幕外的构件，绝大多数条目连投影都不用做。
   * `fillBox` 把条目的世界盒写进 `box`，没有盒回 false。
   */
  function collectInScreenRect<T>(
    canvas: HTMLCanvasElement,
    rect: { x1: number; y1: number; x2: number; y2: number },
    containMode: boolean,
    items: readonly T[],
    fillBox: (item: T, box: Box3) => boolean,
  ): T[] {
    const overlay = ctx.overlayContainerRef.value;
    const dtxViewer = ctx.dtxViewerRef.value;
    if (!overlay || !dtxViewer || items.length === 0) return [];

    const camera = dtxViewer.camera;
    camera.updateMatrixWorld();
    const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new Frustum().setFromProjectionMatrix(viewProjection);

    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const offsetX = canvasRect.left - overlayRect.left;
    const offsetY = canvasRect.top - overlayRect.top;

    const box = new Box3();
    const corner = new Vector3();
    const sel: T[] = [];

    for (const item of items) {
      if (!fillBox(item, box)) continue;
      if (!frustum.intersectsBox(box)) continue;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let anyVisible = false;
      for (let i = 0; i < 8; i++) {
        corner.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).applyMatrix4(viewProjection);
        if (corner.z < -1 || corner.z > 1) continue;
        anyVisible = true;
        const x = (corner.x * 0.5 + 0.5) * canvasRect.width + offsetX;
        const y = (-corner.y * 0.5 + 0.5) * canvasRect.height + offsetY;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (!anyVisible) continue;

      const intersects = !(maxX < rect.x1 || minX > rect.x2 || maxY < rect.y1 || minY > rect.y2);
      const contained = minX >= rect.x1 && maxX <= rect.x2 && minY >= rect.y1 && maxY <= rect.y2;

      if (containMode ? contained : intersects) {
        sel.push(item);
      }
    }

    return sel;
  }

  function collectRefnosInScreenRect(canvas: HTMLCanvasElement, rect: { x1: number; y1: number; x2: number; y2: number }, mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box', dx: number): string[] {
    const viewer = ctx.compatViewerRef.value;
    if (!viewer) return [];
    const containMode = (mode === 'annotation_obb' || mode === 'pick_refno_box') && dx < 0;
    return collectInScreenRect(canvas, rect, containMode, viewer.scene.getLoadedRefnos(), (refno, box) => {
      const aabb = viewer.scene.getAABB([refno]);
      if (!aabb) return false;
      box.min.set(aabb[0], aabb[1], aabb[2]);
      box.max.set(aabb[3], aabb[4], aabb[5]);
      return true;
    });
  }

  /** 按直段框选：框里可见的直管对象 → 直段身份键（向左拖完全包含、向右拖相交即选，与构件框选同一口径）。 */
  function collectTubeKeysInScreenRect(canvas: HTMLCanvasElement, rect: { x1: number; y1: number; x2: number; y2: number }, dx: number): string[] {
    const layer = ctx.dtxLayerRef.value;
    if (!layer) return [];
    const tubes = listDtxTubeObjects().filter(({ objectId }) => layer.hasObject(objectId) && layer.isObjectVisible(objectId));
    return collectInScreenRect(canvas, rect, dx < 0, tubes, ({ objectId }, box) => {
      const bounds = layer.getObjectBoundingBoxInto(objectId, box);
      return !!bounds && !bounds.isEmpty();
    }).map(({ key }) => key);
  }

  function beginMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box') {
    if (!ctx.ready.value) return;
    if (e.button !== 0) return;
    if (mode === 'annotation_cloud' && !canDrawCloudAnnotation()) {
      notifyCloudGateBlocked('target');
      return;
    }
    if (mode === 'annotation_cloud' && !ctx.pendingCloudAnchor.value) {
      notifyCloudGateBlocked('anchor');
      return;
    }
    const start = getCanvasPos(canvas, e);
    ctx.marqueeState.value = {
      active: true,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startCanvas: { x: start.x, y: start.y },
      currentCanvas: { x: start.x, y: start.y },
    };
    hooks.updateMarqueeStyle(mode, 0);
    hooks.updateMarqueeRect(ctx.marqueeState.value.startCanvas!, ctx.marqueeState.value.currentCanvas!);

    const viewer = ctx.dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = false;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function moveMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box') {
    if (!ctx.marqueeState.value.active) return;
    if (ctx.marqueeState.value.pointerId !== e.pointerId) return;
    const cur = getCanvasPos(canvas, e);
    ctx.marqueeState.value.currentCanvas = { x: cur.x, y: cur.y };
    const start = ctx.marqueeState.value.startCanvas!;
    const dx = (cur.x - start.x);
    hooks.updateMarqueeStyle(mode, dx);
    hooks.updateMarqueeRect(start, ctx.marqueeState.value.currentCanvas);
  }

  function endMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box') {
    if (!ctx.marqueeState.value.active) return;
    if (ctx.marqueeState.value.pointerId !== e.pointerId) return;

    const start = ctx.marqueeState.value.startCanvas;
    const end = ctx.marqueeState.value.currentCanvas;
    if (!start || !end) {
      hooks.hideMarquee();
      return;
    }

    const viewer = ctx.dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = true;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    const rect = {
      x1: Math.min(start.x, end.x),
      y1: Math.min(start.y, end.y),
      x2: Math.max(start.x, end.x),
      y2: Math.max(start.y, end.y),
    };
    if (rect.x2 - rect.x1 < 6 || rect.y2 - rect.y1 < 6) {
      hooks.hideMarquee();
      if (mode === 'annotation_cloud') {
        const hit = hooks.pickSurfacePoint(canvas, e);
        if (hit) {
          setPendingCloudAnchor({
            worldPos: vec3ToTuple(hit.worldPos),
            refno: hit.entityId,
            entityId: hit.entityId,
          });
        }
      }
      return;
    }
    const dx = end.x - start.x;

    if (!ctx.compatViewerRef.value || !ctx.overlayContainerRef.value || !ctx.dtxViewerRef.value) {
      hooks.hideMarquee();
      emitToast({ message: '三维视图尚未就绪，无法完成框选', level: 'warning' });
      if (mode === 'pick_refno_box') ctx.store.cancelPickRefno();
      return;
    }

    // 云线的关联来自目标元素集合，框内构件与它无关；而这个函数要遍历全部已加载构件
    // 逐个取 AABB 再投影 8 个角，大模型上白算一遍就是松手时一次可感的卡顿。
    const tubeBoxPick = mode === 'pick_refno_box' && isTubePickFilter(ctx.store.pickRefnoFilter.value);
    let selectedRefnos: string[] = [];
    if (mode !== 'annotation_cloud') {
      try {
        selectedRefnos = tubeBoxPick
          ? collectTubeKeysInScreenRect(canvas, rect, dx)
          : collectRefnosInScreenRect(canvas, rect, mode, dx);
      } catch (err) {
        // 抛出会跳过下面的 hideMarquee，把选择框永久留在屏幕上，
        // 且拾取会话卡在 pick_refno_box 无法退出。
        console.error('[dtx-tools] 框选构件失败', err);
        hooks.hideMarquee();
        emitToast({ message: '框选失败：计算框内构件时出错，请缩小范围后重试', level: 'error' });
        if (mode === 'pick_refno_box') ctx.store.cancelPickRefno();
        return;
      }
    }
    hooks.hideMarquee();

    if (tubeBoxPick) {
      if (selectedRefnos.length === 0) {
        emitToast({ message: '框选范围内没有可选的直段（直管 TUBI），请扩大框选范围或先加载模型。', level: 'warning' });
      }
      for (const key of selectedRefnos) ctx.store.addPickedRefno(key);
      ctx.store.confirmPickRefno();
      return;
    }
    if (mode === 'pick_refno_box') {
      const filterUpper = ctx.store.pickRefnoFilter.value;
      const resolution = resolveBoxPickRefnos(selectedRefnos, filterUpper, findNounByRefnoAcrossAllDbnos);
      if (resolution.kind === 'noun_unavailable') {
        emitToast({ message: '构件类型信息尚未加载完成，请稍后重试框选', level: 'warning' });
        ctx.store.cancelPickRefno();
        return;
      }
      if (resolution.refnos.length === 0) {
        emitToast({
          message: '框选范围内未检测到已加载构件，请扩大框选范围或先加载模型。',
          level: 'warning',
        });
      }
      for (const refno of resolution.refnos) ctx.store.addPickedRefno(refno);
      ctx.store.confirmPickRefno();
      return;
    }

    const compat = ctx.compatViewerRef.value;
    if (!compat) return;

    if (mode === 'annotation_cloud') {
      // 关联来自目标元素集合；拖框只决定屏幕轮廓，bbox3d 亦用目标集合合并 AABB。
      const targetRefnos = [...ctx.store.cloudTargetRefnos.value];
      if (targetRefnos.length === 0) return;
      const viewer = ctx.dtxViewerRef.value;
      const overlay = ctx.overlayContainerRef.value;
      const anchorState = ctx.pendingCloudAnchor.value;
      if (!viewer || !overlay || !anchorState) return;
      const targetAabb = compat.scene.getAABB(targetRefnos);
      if (!targetAabb) {
        if (ctx.annotationStyleStore.cloudDrawMode.value === 'bbox3d') {
          emitToast({ message: '目标元素尚未加载，无法绘制三维包围盒云线', level: 'warning' });
          return;
        }
        // screen2d 允许先建：贴合所需的 AABB 由 resolveCloudTargetBbox 在目标加载后补上，
        // 但此刻只能按拖框尺寸出图，不说清楚用户会以为云线画歪了。
        emitToast({
          message: '目标元素尚未加载，云线暂按拖框尺寸显示，加载后会自动贴合目标',
          level: 'warning',
        });
      }
      const n = ctx.store.cloudAnnotations.value.length + 1;
      const anchor = new Vector3(...anchorState.worldPos);
      const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, anchor);
      const createdAt = Date.now();
      const rec = createCloudAnnotationRecordFromAnchorAndMarquee({
        id: nowId('cloud'),
        objectIds: targetRefnos,
        refnos: targetRefnos,
        anchorWorldPos: anchorState.worldPos,
        anchorRefno: anchorState.refno,
        anchorScreen,
        rect,
        title: `云线批注 ${n}`,
        description: '',
        createdAt,
        selectionBbox: targetAabb
          ? {
            min: [targetAabb[0], targetAabb[1], targetAabb[2]],
            max: [targetAabb[3], targetAabb[4], targetAabb[5]],
          }
          : undefined,
        bindings: buildCloudBindings({
          memberRefnos: targetRefnos,
          anchorRefno: anchorState.refno,
          createdAt,
          nounOf: (refno) => findNounByRefnoAcrossAllDbnos(refno) ?? undefined,
        }),
        projectOverlayToWorld: (x, y, ndcZ) => vec3ToTuple(
          overlayToWorld(viewer.camera, canvas, overlay, x, y, ndcZ),
        ),
        // P1：新建即写像素意图布局（右上角 + 18 px）；开关关着就只写旧字段
        labelLayoutV1: isCloudRenderFlagEnabled('cloudLabelLayoutV1') ? createDefaultCloudLabelLayoutV1() : undefined,
      });
      // P2：范围体 + 创建视点（方案 §6.2 / §11 P2）。范围不完整（成员未加载 / 超预算）时**不写**新版记录，
      // 漏斗按 selectionBbox 补 legacy-snapshot + legacy-v0；创建视点是独立证据，只要开关开就记。
      if (isCloudRenderFlagEnabled('cloudProjectedEnvelope')) {
        const layer = ctx.dtxLayerRef.value;
        const source = buildCloudSourceStamp(targetRefnos, layer);
        const regionV1 = layer
          ? buildMembersRegionV1({
            memberRefnos: targetRefnos,
            layer,
            getMemberAabb: (refno) => compat.scene.getAABB([refno]) ?? null,
            source,
          })
          : null;
        const canvasRect = canvas.getBoundingClientRect();
        rec.viewpointV1 = {
          creation: captureCreationViewSnapshot({
            camera: viewer.camera,
            controlsTarget: viewer.controls?.target instanceof Vector3 ? viewer.controls.target : null,
            anchorWorldPos: anchor,
            viewportCss: {
              width: canvasRect.width || canvas.clientWidth || 1,
              height: canvasRect.height || canvas.clientHeight || 1,
            },
            capturedAt: createdAt,
            modelSnapshotId: source.modelSnapshotId,
          }),
        };
        if (regionV1) {
          rec.regionV1 = regionV1;
          rec.presentationV1 = createRegionCloudPresentationV1();
        }
      }
      ctx.store.addCloudAnnotation(rec);
      clearPendingCloudAnchor();
      ctx.store.clearCloudTargetRefnos();
      // 画完自动选中新云线：主工具条「错误类型」立即可用、「打开批注单」能定位到这条、右侧证据卡有明确焦点，
      // 否则用户画完得不到任何“选中”反馈，容易误以为没成功而重复绘制。
      hooks.activateAnnotation('cloud', rec.id);
      void captureCreatedCloudScreenshot(rec);
      return;
    }

    if (selectedRefnos.length === 0) return;

    // 计算 combined bbox
    const aabb = compat.scene.getAABB(selectedRefnos);
    if (!aabb) return;
    const box = new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5]));

    const obb = computeAabbObbFromBox3(box);
    if (mode === 'annotation_obb') {
      const n = ctx.store.obbAnnotations.value.length + 1;
      const anchorWorldPos = topCenterFromBox3(box);
      const halfSize = new Vector3(...obb.halfSize);
      const boxRadius = Math.max(halfSize.length(), 0.1);
      const labelWorldPos = anchorWorldPos.clone().add(new Vector3(boxRadius * 0.65, boxRadius * 0.65, boxRadius * 0.45));
      // P3 共享范围体：`obb` 旧字段（合并 AABB）照旧双写；范围完整时另写每成员真实放置盒
      const sharedRegion = buildSharedRegionForMembers(selectedRefnos);
      const rec: ObbAnnotationRecord = {
        id: nowId('obb'),
        objectIds: selectedRefnos,
        obb,
        labelWorldPos: vec3ToTuple(labelWorldPos),
        anchor: { kind: 'top_center' },
        visible: true,
        title: `OBB 批注 ${n}`,
        description: '',
        createdAt: Date.now(),
        refnos: selectedRefnos,
        ...(sharedRegion ? { regionV1: sharedRegion } : {}),
      };
      ctx.store.addObbAnnotation(rec);
      return;
    }

    const n = ctx.store.rectAnnotations.value.length + 1;
    const rec = createRectAnnotationRecordFromObb({
      objectIds: selectedRefnos,
      refnos: selectedRefnos,
      obb,
      title: `矩形批注 ${n}`,
      regionV1: buildSharedRegionForMembers(selectedRefnos) ?? undefined,
    });
    ctx.store.addRectAnnotation(rec);
  }

  return {
    beginMarquee,
    buildSharedRegionForMembers,
    canDrawCloudAnnotation,
    cancelCloudCreation,
    clearPendingCloudAnchor,
    endMarquee,
    moveMarquee,
    notifyCloudGateBlocked,
    rollbackCloudCreationStep,
    setPendingCloudAnchor,
    suspendCloudCreation,
    cloudGateBlock,
  };
}
