import * as THREE from 'three';

import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase';
import { SolveSpaceBillboardVectorText } from '../text/SolveSpaceBillboardVectorText';
import { alignToPixelGrid, lineTrimmedAgainstBoxT, worldPerPixelAt } from '../utils/solvespaceLike';

import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials';

export type AngleDimension3DParams = {
  /** 角度顶点 */
  vertex: THREE.Vector3
  /** 第一条边上的点 */
  point1: THREE.Vector3
  /** 第二条边上的点 */
  point2: THREE.Vector3
  /** 圆弧半径（世界单位） */
  arcRadius?: number
  /** 文本在圆弧上的位置（0..1，默认 0.5） */
  labelT?: number
  /** SolveSpace 风格：文字自由拖拽偏移（世界坐标，相对于 labelT 基准位置） */
  labelOffsetWorld?: THREE.Vector3 | null
  /** 参考尺寸（灰色半透明样式，仅显示不参与约束） */
  isReference?: boolean
  /** 显示补角（360-angle 模式） */
  supplementary?: boolean
  /** 自定义文本（默认自动计算角度） */
  text?: string
  /** 单位（默认 °） */
  unit?: string
  /** 小数位数 */
  decimals?: number
  /** 圆弧分段数 */
  arcSegments?: number
  /** 字体 URL（默认使用内置 Roboto Mono woff） */
  fontUrl?: string
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const SNAP_TS = [0, 0.25, 0.5, 0.75, 1] as const;
const snapMarkerGeometry = new THREE.CircleGeometry(0.12, 24);

export class AngleDimension3D extends AnnotationBase {
  private params: Required<Omit<AngleDimension3DParams, 'text' | 'fontUrl' | 'labelOffsetWorld' | 'isReference' | 'supplementary'>> & {
    text?: string
    fontUrl?: string
    labelOffsetWorld?: THREE.Vector3 | null
    isReference?: boolean
    supplementary?: boolean
  };
  private materialSet: AnnotationMaterialSet;

  private ray1: THREE.Line;
  private ray2: THREE.Line;
  private arcLine: THREE.LineSegments;
  private arrow1: THREE.Mesh;
  private arrow2: THREE.Mesh;
  private ray1Geometry: THREE.BufferGeometry;
  private ray2Geometry: THREE.BufferGeometry;
  private arcGeometry: THREE.BufferGeometry;
  private arrowGeometry1: THREE.BufferGeometry;
  private arrowGeometry2: THREE.BufferGeometry;
  private textLabel: SolveSpaceBillboardVectorText;
  private snapGuideLine: THREE.Line;
  private snapGuideGeometry: THREE.BufferGeometry;
  private snapGuidePositions: Float32Array;
  private snapGuideMaterial: THREE.LineBasicMaterial;
  private snapGroup: THREE.Group;
  private snapMarkers: THREE.Mesh[] = [];
  private snapMarkerMat: THREE.MeshBasicMaterial;
  private snapMarkerMatActive: THREE.MeshBasicMaterial;
  private snapMarkersVisible = false;
  private snapActiveIndex: number | null = null;
  private snapNearIndex: number | null = null;
  private snapScaleBase = 1;
  private lastAngleDeg = 0;
  private lastDisplayText = '';

  private dashedLineMatNormal: any | null = null;
  private dashedLineMatHovered: any | null = null;
  private dashedLineMatSelected: any | null = null;

  private readonly camRight = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private readonly camForward = new THREE.Vector3();
  private readonly refWorld = new THREE.Vector3();
  private readonly wppTmp = {
    ndc: new THREE.Vector3(),
    ndc2: new THREE.Vector3(),
    p0: new THREE.Vector3(),
    p1: new THREE.Vector3(),
    p2: new THREE.Vector3(),
  };

  private readonly tempU = new THREE.Vector3();
  private readonly tempV = new THREE.Vector3();
  private readonly tempW = new THREE.Vector3();
  private readonly tempWorldA = new THREE.Vector3();
  private readonly tempWorldB = new THREE.Vector3();
  private readonly tempLocalA = new THREE.Vector3();
  private readonly tempLocalB = new THREE.Vector3();
  private readonly tmpWorldC = new THREE.Vector3();
  private readonly tmpWorldD = new THREE.Vector3();
  private readonly tmpWorldE = new THREE.Vector3();
  private readonly tmpWorldF = new THREE.Vector3();
  private readonly tmpWorldG = new THREE.Vector3();
  private readonly tmpWorldH = new THREE.Vector3();
  private readonly tmpWorldI = new THREE.Vector3();

  constructor(
    materials: AnnotationMaterials,
    params: AngleDimension3DParams,
    options?: AnnotationOptions
  ) {
    super(materials, options);

    this.params = {
      vertex: params.vertex.clone(),
      point1: params.point1.clone(),
      point2: params.point2.clone(),
      arcRadius: params.arcRadius ?? 1,
      labelT: params.labelT ?? 0.5,
      labelOffsetWorld: params.labelOffsetWorld?.clone() ?? null,
      isReference: params.isReference ?? false,
      supplementary: params.supplementary ?? false,
      text: params.text,
      unit: params.unit ?? '°',
      decimals: params.decimals ?? 1,
      arcSegments: params.arcSegments ?? 32,
      fontUrl: params.fontUrl,
    };
    // 尺寸标注默认使用深紫色（由 DimensionStyleStore 驱动）
    this.materialSet = this.resolveMaterialSet(materials.ssDimensionDefault);

    this.ray1Geometry = new THREE.BufferGeometry();
    this.ray2Geometry = new THREE.BufferGeometry();
    this.arcGeometry = new THREE.BufferGeometry();
    this.arrowGeometry1 = new THREE.BufferGeometry();
    this.arrowGeometry2 = new THREE.BufferGeometry();

    this.ray1 = new THREE.Line(this.ray1Geometry, this.materialSet.line);
    this.ray2 = new THREE.Line(this.ray2Geometry, this.materialSet.line);
    this.arcLine = new THREE.LineSegments(this.arcGeometry, this.materialSet.line);
    this.arrow1 = new THREE.Mesh(this.arrowGeometry1, this.materialSet.mesh);
    this.arrow2 = new THREE.Mesh(this.arrowGeometry2, this.materialSet.mesh);
    this.arcLine.frustumCulled = false;
    this.arrow1.frustumCulled = false;
    this.arrow2.frustumCulled = false;
    this.ray1.userData.dragRole = 'offset';
    this.ray2.userData.dragRole = 'offset';
    this.arcLine.userData.dragRole = 'offset';
    this.arrow1.userData.dragRole = 'offset';
    this.arrow2.userData.dragRole = 'offset';
    this.add(this.ray1, this.ray2, this.arcLine, this.arrow1, this.arrow2);

    // 吸附点标记（仅拖拽文字时临时显示）
    this.snapMarkerMat = this.materialSet.mesh.clone();
    this.snapMarkerMat.opacity = 0.25;
    this.snapMarkerMat.transparent = true;
    this.snapMarkerMat.depthWrite = false;
    this.snapMarkerMat.side = THREE.DoubleSide;
    this.snapMarkerMatActive = this.materialSet.meshHover.clone();
    this.snapMarkerMatActive.opacity = 0.95;
    this.snapMarkerMatActive.transparent = true;
    this.snapMarkerMatActive.depthWrite = false;
    this.snapMarkerMatActive.side = THREE.DoubleSide;

    this.snapGroup = new THREE.Group();
    this.snapGroup.visible = false;
    this.snapGroup.userData.noPick = true;
    for (let i = 0; i < SNAP_TS.length; i++) {
      const m = new THREE.Mesh(snapMarkerGeometry, this.snapMarkerMat);
      m.userData.noPick = true;
      m.renderOrder = 905;
      this.snapGroup.add(m);
      this.snapMarkers.push(m);
    }
    this.add(this.snapGroup);

    this.textLabel = new SolveSpaceBillboardVectorText({
      text: '',
      materialNormal: this.materialSet.line,
      materialHovered: this.materials.ssHovered.line,
      materialSelected: this.materials.ssSelected.line,
    });
    this.textLabel.object3d.userData.dragRole = 'label';
    this.textLabel.syncPickProxyUserData();
    this.add(this.textLabel.object3d);

    // 吸附提示线（拖拽文字时临时显示；不参与拾取）
    this.snapGuidePositions = new Float32Array(6);
    this.snapGuideGeometry = new THREE.BufferGeometry();
    this.snapGuideGeometry.setAttribute('position', new THREE.BufferAttribute(this.snapGuidePositions, 3));
    const guideColor =
      ((this.materialSet.lineHover as any)?.color as THREE.Color | undefined)?.getHex?.() ?? 0xffffff;
    this.snapGuideMaterial = new THREE.LineBasicMaterial({
      color: guideColor,
      transparent: true,
      opacity: 0.55,
      depthTest: true,
      depthWrite: false,
    });
    this.snapGuideLine = new THREE.Line(this.snapGuideGeometry, this.snapGuideMaterial);
    this.snapGuideLine.visible = false;
    this.snapGuideLine.userData.noPick = true;
    this.snapGuideLine.renderOrder = 904;
    this.add(this.snapGuideLine);

    this.rebuild();
    this.applyMaterials();
  }

  override update(camera: THREE.Camera): void {
    super.update(camera);
    this._updateSolveSpaceGeometry(camera);
    this.textLabel.update(camera);

    // snap markers face camera + pulse (仅拖拽显示时)
    if (this.snapMarkersVisible) {
      for (const m of this.snapMarkers) {
        m.quaternion.copy(camera.quaternion);
      }
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const pulse = 1 + 0.12 * Math.sin(now * 0.008);
      const s = this.snapScaleBase * pulse;
      for (const m of this.snapMarkers) {
        m.scale.setScalar(s);
      }
    }
  }

  /** 设置文字吸附提示（拖拽时用） */
  setLabelSnapActive(active: boolean): void {
    // SolveSpaceBillboardVectorText 不做 SDF 描边强化；保持 API 兼容即可。
    void active;
  }

  /** 吸附提示线显隐（拖拽文字时用） */
  setLabelSnapGuideVisible(visible: boolean): void {
    this.snapGuideLine.visible = visible;
  }

  /** 设置吸附提示线目标点（世界坐标）；worldPos=null 则清理并隐藏 */
  setLabelSnapGuideTarget(worldPos: THREE.Vector3 | null): void {
    if (!worldPos) {
      this.snapGuideLine.visible = false;
      return;
    }

    this.updateWorldMatrix(true, true);
    const fromWorld = this.textLabel.object3d.getWorldPosition(this.tempWorldA);
    const toWorld = this.tempWorldB.copy(worldPos);

    const fromLocal = this.worldToLocal(this.tempLocalA.copy(fromWorld));
    const toLocal = this.worldToLocal(this.tempLocalB.copy(toWorld));

    this.snapGuidePositions[0] = fromLocal.x;
    this.snapGuidePositions[1] = fromLocal.y;
    this.snapGuidePositions[2] = fromLocal.z;
    this.snapGuidePositions[3] = toLocal.x;
    this.snapGuidePositions[4] = toLocal.y;
    this.snapGuidePositions[5] = toLocal.z;

    const attr = this.snapGuideGeometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.snapGuideGeometry.computeBoundingSphere();
    this.snapGuideLine.visible = true;
  }

  getDisplayText(): string {
    return this.lastDisplayText;
  }

  getAngleDegreesCached(): number {
    return this.lastAngleDeg;
  }

  getLabelWorldPos(): THREE.Vector3 {
    return this.textLabel.object3d.getWorldPosition(new THREE.Vector3());
  }

  getSnapMarkerWorldPos(index: number): THREE.Vector3 | null {
    const m = this.snapMarkers[index];
    if (!m) return null;
    return m.getWorldPosition(new THREE.Vector3());
  }

  /** 设置吸附点标记显示与激活态（拖拽时用） */
  setLabelSnapMarkersState(visible: boolean, activeIndex: number | null, nearIndex: number | null): void {
    this.snapMarkersVisible = visible;
    this.snapActiveIndex = visible ? activeIndex : null;
    this.snapNearIndex = visible ? nearIndex : null;
    this.snapGroup.visible = visible;
    this.applySnapMarkerMaterials();
  }

  private applySnapMarkerMaterials(): void {
    for (let i = 0; i < this.snapMarkers.length; i++) {
      this.snapMarkers[i]!.material =
        this.snapMarkersVisible && this.snapActiveIndex === i
          ? this.snapMarkerMatActive
          : this.snapMarkerMat;

      // 仅显示邻近点（nearIndex 的相邻点 + activeIndex）
      let show = false;
      if (this.snapMarkersVisible) {
        const near = this.snapNearIndex;
        const active = this.snapActiveIndex;
        if (active !== null && i === active) show = true;
        if (near !== null && (i === near || i === near - 1 || i === near + 1)) show = true;
      }
      this.snapMarkers[i]!.visible = show;
    }
  }

  /** 仅控制文字显隐（不影响圆弧/射线） */
  setLabelVisible(visible: boolean): void {
    this.textLabel.setVisible(visible);
  }

  /** 计算角度（度） */
  getAngleDegrees(): number {
    return (this.getAngleRadians() * 180) / Math.PI;
  }

  /** 计算角度（弧度） */
  getAngleRadians(): number {
    const { vertex, point1, point2 } = this.params;
    const u = this.tempU.copy(point1).sub(vertex);
    const v = this.tempV.copy(point2).sub(vertex);
    if (u.lengthSq() < 1e-9 || v.lengthSq() < 1e-9) return 0;
    u.normalize();
    v.normalize();
    return Math.acos(clamp(u.dot(v), -1, 1));
  }

  getParams(): AngleDimension3DParams {
    return {
      vertex: this.params.vertex.clone(),
      point1: this.params.point1.clone(),
      point2: this.params.point2.clone(),
      arcRadius: this.params.arcRadius,
      labelT: this.params.labelT,
      labelOffsetWorld: this.params.labelOffsetWorld?.clone() ?? null,
      isReference: this.params.isReference,
      supplementary: this.params.supplementary,
      text: this.params.text,
      unit: this.params.unit,
      decimals: this.params.decimals,
      arcSegments: this.params.arcSegments,
      fontUrl: this.params.fontUrl,
    };
  }

  /** 获取 label 默认位置（无 labelOffsetWorld 时的基准，即 labelT 插值点） */
  getDefaultLabelWorldPos(): THREE.Vector3 {
    // 复用当前文字位置逻辑但不含 offset
    const { vertex, arcRadius } = this.params;
    const u = this.tempU.copy(this.params.point1).sub(vertex);
    const w = this.tempW.copy(this.params.point2).sub(vertex);
    if (u.lengthSq() < 1e-9 || w.lengthSq() < 1e-9) return vertex.clone();
    u.normalize();
    w.normalize();
    const dot = clamp(u.dot(w), -1, 1);
    const theta = this.params.supplementary ? (2 * Math.PI - Math.acos(dot)) : Math.acos(dot);
    const v = this.tempV.copy(w).addScaledVector(u, -clamp(u.dot(w), -1, 1));
    if (v.lengthSq() < 1e-9) return vertex.clone().addScaledVector(u, arcRadius);
    v.normalize();
    const t = Math.max(0, Math.min(1, Number(this.params.labelT) || 0.5));
    const a = theta * t;
    return new THREE.Vector3()
      .copy(u).multiplyScalar(Math.cos(a))
      .addScaledVector(v, Math.sin(a))
      .multiplyScalar(arcRadius)
      .add(vertex);
  }

  setParams(params: Partial<AngleDimension3DParams>): void {
    if (params.vertex) this.params.vertex.copy(params.vertex);
    if (params.point1) this.params.point1.copy(params.point1);
    if (params.point2) this.params.point2.copy(params.point2);
    if (params.arcRadius !== undefined) this.params.arcRadius = params.arcRadius;
    if (params.labelT !== undefined) this.params.labelT = params.labelT;
    if ('labelOffsetWorld' in params) {
      this.params.labelOffsetWorld = params.labelOffsetWorld?.clone() ?? null;
    }
    if (params.isReference !== undefined) this.params.isReference = params.isReference;
    if (params.supplementary !== undefined) this.params.supplementary = params.supplementary;
    if (params.text !== undefined) this.params.text = params.text;
    if (params.unit !== undefined) this.params.unit = params.unit;
    if (params.decimals !== undefined) this.params.decimals = params.decimals;
    if (params.arcSegments !== undefined) this.params.arcSegments = params.arcSegments;
    if (params.fontUrl !== undefined) this.params.fontUrl = params.fontUrl;
    this.rebuild();
    this.applyMaterials();
  }

  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet;
    this.textLabel.setMaterials({ normal: this.materialSet.line });
    this.applyMaterials();
  }

  private applyMaterials(): void {
    // SolveSpace 风格：selected > hovered > normal
    const state = this.interactionState;
    let solidLineMat: any;
    let meshMat: any;
    if (state === 'selected') {
      solidLineMat = this.materials.ssSelected.line;
      meshMat = this.materials.ssSelected.mesh;
    } else if (state === 'hovered') {
      solidLineMat = this.materials.ssHovered.line;
      meshMat = this.materials.ssHovered.mesh;
    } else {
      solidLineMat = this._highlighted ? this.materialSet.lineHover : this.materialSet.line;
      meshMat = this._highlighted ? this.materialSet.meshHover : this.materialSet.mesh;
    }

    // Reference dims: dashed lines; arrowheads stay solid.
    const lineMat = this.params.isReference ? this.getDashedLineMaterial(state, solidLineMat) : solidLineMat;
    this.ray1.material = lineMat;
    this.ray2.material = lineMat;
    this.arcLine.material = lineMat;
    // 箭头使用 mesh 材质（实心三角）
    this.arrow1.material = meshMat;
    this.arrow2.material = meshMat;
  }

  private getDashedLineMaterial(state: 'normal' | 'hovered' | 'selected', solid: any): any {
    let cached: any | null;
    if (state === 'selected') cached = this.dashedLineMatSelected;
    else if (state === 'hovered') cached = this.dashedLineMatHovered;
    else cached = this.dashedLineMatNormal;

    // Re-create if missing or if source material changed (e.g. setMaterialSet)
    const src = (cached as any)?.__src as any | undefined;
    if (!cached || src !== solid) {
      cached = solid.clone()
      ;(cached as any).__src = solid;
      cached.dashed = true;
      // dash sizes are updated per-frame in _updateSolveSpaceGeometry (need wpp)

      if (state === 'selected') this.dashedLineMatSelected = cached;
      else if (state === 'hovered') this.dashedLineMatHovered = cached;
      else this.dashedLineMatNormal = cached;
    }
    return cached;
  }

  private setLineGeometryFromWorld(
    geom: THREE.BufferGeometry,
    aWorld: THREE.Vector3,
    bWorld: THREE.Vector3,
    camera: THREE.Camera,
    viewportWidthPx: number,
    viewportHeightPx: number
  ): void {
    alignToPixelGrid(camera, aWorld, viewportWidthPx, viewportHeightPx, this.tempWorldA);
    alignToPixelGrid(camera, bWorld, viewportWidthPx, viewportHeightPx, this.tempWorldB);

    const aLocal = this.worldToLocal(this.tempLocalA.copy(this.tempWorldA));
    const bLocal = this.worldToLocal(this.tempLocalB.copy(this.tempWorldB));
    geom.setAttribute('position', new THREE.Float32BufferAttribute([
      aLocal.x, aLocal.y, aLocal.z,
      bLocal.x, bLocal.y, bLocal.z,
    ], 3));
  }

  /**
   * SolveSpace 风格几何更新（每帧，依赖 camera）。
   *
   * - 文本：矢量字（LFF），像素网格对齐
   * - 圆弧：折线段（LineSegments2），对 label box 做留白切分
   * - 箭头：V 形两线段（13px, 18° half-angle）
   * - 参考尺寸：虚线（dashSize/gapSize 以像素换算）
   */
  private _updateSolveSpaceGeometry(camera: THREE.Camera): void {
    const dpr = Math.max(1, Number((window as any)?.devicePixelRatio) || 1);
    const vw = Math.max(1, Math.floor((window?.innerWidth ?? 1) * dpr));
    const vh = Math.max(1, Math.floor((window?.innerHeight ?? 1) * dpr));

    // Ensure world matrices are up to date for local<->world transforms
    this.updateWorldMatrix(true, true);

    // Camera display axes (SolveSpace: projRight/projUp)
    this.camRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    this.camUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    this.camForward.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

    const { vertex, point1, point2, arcRadius } = this.params;

    // Rays: pixel grid aligned
    const vtxW = this.localToWorld(this.tmpWorldC.copy(vertex));
    const p1W = this.localToWorld(this.tmpWorldD.copy(point1));
    const p2W = this.localToWorld(this.tmpWorldE.copy(point2));
    this.setLineGeometryFromWorld(this.ray1Geometry, vtxW, p1W, camera, vw, vh);
    this.setLineGeometryFromWorld(this.ray2Geometry, vtxW, p2W, camera, vw, vh);
    this.ray1.visible = true;
    this.ray2.visible = true;

    // Arc basis in world
    const uW = this.tmpWorldF.copy(p1W).sub(vtxW);
    const wW = this.tmpWorldG.copy(p2W).sub(vtxW);
    if (uW.lengthSq() < 1e-12 || wW.lengthSq() < 1e-12) {
      this.arcLine.visible = false;
      this.arrow1.visible = false;
      this.arrow2.visible = false;
      return;
    }
    uW.normalize();
    wW.normalize();

    const dot = clamp(uW.dot(wW), -1, 1);
    const minorTheta = Math.acos(dot);
    const theta = this.params.supplementary ? (2 * Math.PI - minorTheta) : minorTheta;
    if (!Number.isFinite(theta) || theta < 1e-9) {
      this.arcLine.visible = false;
      this.arrow1.visible = false;
      this.arrow2.visible = false;
      return;
    }

    // v = normalize( w - u*dot )
    const vW = this.tempV.copy(wW).addScaledVector(uW, -dot);
    if (vW.lengthSq() < 1e-12) {
      this.arcLine.visible = false;
      this.arrow1.visible = false;
      this.arrow2.visible = false;
      return;
    }
    vW.normalize();

    // Label: align to pixel grid + compute world-per-pixel scale
    // (text position itself is set in rebuild(); here we only snap & scale)
    this.textLabel.object3d.getWorldPosition(this.tmpWorldF);
    alignToPixelGrid(camera, this.tmpWorldF, vw, vh, this.refWorld);
    const wpp = worldPerPixelAt(camera, this.refWorld, vw, vh, this.wppTmp);
    if (!Number.isFinite(wpp) || wpp <= 0) return;

    this.textLabel.setWorldPerPixel(wpp);
    this.textLabel.object3d.position.copy(this.worldToLocal(this.tmpWorldG.copy(this.refWorld)));

    // Label box size in world units (SolveSpace: +8px padding)
    const extPx = this.textLabel.getExtentsPx();
    const hasLabelBox = extPx.width > 0 && extPx.height > 0;
    const swidth = hasLabelBox ? (extPx.width + 8) * wpp : 0;
    const sheight = hasLabelBox ? (extPx.height + 8) * wpp : 0;

    // Arc polyline -> line segments (trimmed against label box)
    const segCount = Math.max(4, Math.floor(Number(this.params.arcSegments) || 32));
    const arcPositions: number[] = [];
    const pA = this.tmpWorldC;
    const pB = this.tmpWorldD;
    const dp = this.tmpWorldE;

    const arcAt = (a: number, out: THREE.Vector3) => {
      // p = vtx + (u*cos(a) + v*sin(a)) * R
      return out
        .copy(uW).multiplyScalar(Math.cos(a))
        .addScaledVector(vW, Math.sin(a))
        .multiplyScalar(arcRadius)
        .add(vtxW);
    };

    for (let i = 0; i < segCount; i++) {
      const t0 = i / segCount;
      const t1 = (i + 1) / segCount;
      const a0 = theta * t0;
      const a1 = theta * t1;
      arcAt(a0, pA);
      arcAt(a1, pB);

      const trims = hasLabelBox
        ? lineTrimmedAgainstBoxT(this.refWorld, pA, pB, this.camRight, this.camUp, swidth, sheight, false)
        : ({ within: 0, segmentsT: [[0, 1]] } as const);

      dp.copy(pB).sub(pA);
      for (const [s0, s1] of trims.segmentsT) {
        if (s1 - s0 <= 1e-9) continue;
        const aW = this.tmpWorldF.copy(pA).addScaledVector(dp, s0);
        const bW = this.tmpWorldG.copy(pA).addScaledVector(dp, s1);

        alignToPixelGrid(camera, aW, vw, vh, this.tempWorldA);
        const aLocal = this.worldToLocal(this.tempLocalA.copy(this.tempWorldA));

        alignToPixelGrid(camera, bW, vw, vh, this.tempWorldB);
        const bLocal = this.worldToLocal(this.tempLocalB.copy(this.tempWorldB));

        arcPositions.push(
          aLocal.x, aLocal.y, aLocal.z,
          bLocal.x, bLocal.y, bLocal.z
        );
      }
    }

    if (arcPositions.length >= 6) {
      this.arcGeometry.setAttribute('position', new THREE.Float32BufferAttribute(arcPositions, 3));
      this.arcLine.visible = true;
    } else {
      this.arcGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      this.arcLine.visible = false;
    }

    // Arrow heads: configurable size and angle
    const thetaA = 20 * Math.PI / 180;
    const arrowLen = 10 * wpp;
    const legLen = arrowLen / Math.cos(thetaA);

    const arcStartW = this.tmpWorldC.copy(vtxW).addScaledVector(uW, arcRadius);
    const arcEndW = this.tmpWorldD.copy(vtxW).addScaledVector(wW, arcRadius);

    // Plane normal for arrow rotation (similar to linear dim)
    const nW = this.tmpWorldE.copy(arcStartW).sub(arcEndW).cross(this.tmpWorldH.copy(arcStartW).sub(this.refWorld));
    if (nW.lengthSq() < 1e-12) {
      nW.copy(this.camForward);
    } else {
      nW.normalize();
    }

    // Tangents into arc interior
    const arrowDirStart = this.tmpWorldF.copy(vW).normalize(); // at a=0, d/da = v
    const arrowDirEnd = this.tmpWorldG
      .copy(uW).multiplyScalar(-Math.sin(theta))
      .addScaledVector(vW, Math.cos(theta))
      .multiplyScalar(-1)
      .normalize();

    const setArrow = (geom: THREE.BufferGeometry, tip: THREE.Vector3, dir: THREE.Vector3) => {
      const e1 = this.tmpWorldH.copy(dir).applyAxisAngle(nW, +thetaA).setLength(legLen).add(tip);
      const e2 = this.tmpWorldI.copy(dir).applyAxisAngle(nW, -thetaA).setLength(legLen).add(tip);

      // Align endpoints like SolveSpace DoLine() does
      alignToPixelGrid(camera, tip, vw, vh, this.tempWorldA);
      const pLocal = this.worldToLocal(this.tempLocalA.copy(this.tempWorldA));

      alignToPixelGrid(camera, e1, vw, vh, this.tempWorldA);
      const e1Local = this.worldToLocal(this.tempLocalB.copy(this.tempWorldA));

      alignToPixelGrid(camera, e2, vw, vh, this.tempWorldA);
      const e2Local = this.worldToLocal(this.tmpWorldH.copy(this.tempWorldA));

      // Filled triangle: 3 vertices + index
      geom.setAttribute('position', new THREE.Float32BufferAttribute([
        pLocal.x, pLocal.y, pLocal.z,
        e1Local.x, e1Local.y, e1Local.z,
        e2Local.x, e2Local.y, e2Local.z,
      ], 3));
      geom.setIndex([0, 1, 2]);
    };

    setArrow(this.arrowGeometry1, arcStartW, arrowDirStart);
    setArrow(this.arrowGeometry2, arcEndW, arrowDirEnd);
    this.arrow1.visible = true;
    this.arrow2.visible = true;

    // Reference dims: dashed/stippled lines (SolveSpace-like)
    if (this.params.isReference) {
      const updateDash = (m: any | null) => {
        if (!m) return;
        // dash size in world units to match pixels
        m.dashed = true;
        m.dashScale = 1;
        m.dashSize = 4 * wpp;
        m.gapSize = 4 * wpp;
      };
      updateDash(this.dashedLineMatNormal);
      updateDash(this.dashedLineMatHovered);
      updateDash(this.dashedLineMatSelected);

      // geometry distances are needed for dashed rendering
      try { this.ray1.computeLineDistances(); } catch { /* ignore */ }
      try { this.ray2.computeLineDistances(); } catch { /* ignore */ }
      try { (this.arcLine as any).computeLineDistances?.(); } catch { /* ignore */ }
    }
  }

  private rebuild(): void {
    const { vertex, point1, point2, arcRadius, arcSegments } = this.params;

    // rays (placeholder; precise pixel-aligned version is updated per-frame in update(camera))
    this.ray1Geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      vertex.x, vertex.y, vertex.z,
      point1.x, point1.y, point1.z,
    ], 3));
    this.ray2Geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      vertex.x, vertex.y, vertex.z,
      point2.x, point2.y, point2.z,
    ], 3));

    // compute basis
    const u = this.tempU.copy(point1).sub(vertex);
    const w = this.tempW.copy(point2).sub(vertex);
    if (u.lengthSq() < 1e-9 || w.lengthSq() < 1e-9) {
      this.arcGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      this.arcLine.visible = false;
      this.arrowGeometry1.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
      this.arrowGeometry1.setIndex([0, 1, 2]);
      this.arrowGeometry2.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
      this.arrowGeometry2.setIndex([0, 1, 2]);
      this.arrow1.visible = false;
      this.arrow2.visible = false;

      let display = this.params.text ?? `0${this.params.unit}`;
      this.lastAngleDeg = 0;
      // SolveSpace: reference label suffix " REF"
      if (this.params.isReference && !display.endsWith(' REF')) {
        display = `${display} REF`;
      }
      this.lastDisplayText = display;
      this.textLabel.setText(display);
      this.textLabel.object3d.position.copy(vertex);
      for (const m of this.snapMarkers) {
        m.position.copy(vertex);
      }
      this.applySnapMarkerMaterials();
      return;
    }
    u.normalize();
    w.normalize();

    const dot = clamp(u.dot(w), -1, 1);
    const minorTheta = Math.acos(dot);
    const theta = this.params.supplementary ? (2 * Math.PI - minorTheta) : minorTheta;
    const deg = (theta * 180) / Math.PI;
    this.lastAngleDeg = deg;

    // v = normalize( w - u*dot )
    const v = this.tempV.copy(w).addScaledVector(u, -dot);
    if (v.lengthSq() < 1e-9) {
      // 共线：不画弧
      this.arcGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      this.arcLine.visible = false;
      this.arrowGeometry1.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
      this.arrowGeometry1.setIndex([0, 1, 2]);
      this.arrowGeometry2.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
      this.arrowGeometry2.setIndex([0, 1, 2]);
      this.arrow1.visible = false;
      this.arrow2.visible = false;

      let display = this.params.text ?? `${deg.toFixed(this.params.decimals)}${this.params.unit}`;
      if (this.params.isReference && !display.endsWith(' REF')) {
        display = `${display} REF`;
      }
      this.lastDisplayText = display;
      this.textLabel.setText(display);
      this.textLabel.object3d.position.copy(vertex).addScaledVector(u, arcRadius);
      for (const m of this.snapMarkers) {
        m.position.copy(vertex).addScaledVector(u, arcRadius);
      }
      this.applySnapMarkerMaterials();
      return;
    }
    v.normalize();

    // arc segments placeholder (trim/gap + pixel grid alignment are updated per-frame in update(camera))
    const segCount = Math.max(4, Math.floor(Number(arcSegments) || 32));
    const positions: number[] = [];
    for (let i = 0; i < segCount; i++) {
      const t0 = i / segCount;
      const t1 = (i + 1) / segCount;
      const a0 = theta * t0;
      const a1 = theta * t1;

      const p0 = this.tmpWorldC
        .copy(u).multiplyScalar(Math.cos(a0))
        .addScaledVector(v, Math.sin(a0))
        .multiplyScalar(arcRadius)
        .add(vertex);
      const p1 = this.tmpWorldD
        .copy(u).multiplyScalar(Math.cos(a1))
        .addScaledVector(v, Math.sin(a1))
        .multiplyScalar(arcRadius)
        .add(vertex);
      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    }
    if (positions.length >= 6) {
      this.arcGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      this.arcLine.visible = true;
    } else {
      this.arcGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      this.arcLine.visible = false;
    }

    // placeholder arrows (generated per-frame)
    this.arrowGeometry1.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    this.arrowGeometry1.setIndex([0, 1, 2]);
    this.arrowGeometry2.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    this.arrowGeometry2.setIndex([0, 1, 2]);
    this.arrow1.visible = false;
    this.arrow2.visible = false;

    let display = this.params.text ?? `${deg.toFixed(this.params.decimals)}${this.params.unit}`;
    // SolveSpace: reference label suffix " REF"
    if (this.params.isReference && !display.endsWith(' REF')) {
      display = `${display} REF`;
    }
    this.lastDisplayText = display;
    this.textLabel.setText(display);

    // label at arc t（基准位置），然后叠加 labelOffsetWorld
    const t = Math.max(0, Math.min(1, Number(this.params.labelT) || 0.5));
    const a = theta * t;
    const baseLabelPos = this.tmpWorldE
      .copy(u).multiplyScalar(Math.cos(a))
      .addScaledVector(v, Math.sin(a))
      .multiplyScalar(arcRadius)
      .add(vertex);
    if (this.params.labelOffsetWorld) {
      this.textLabel.object3d.position.copy(baseLabelPos).add(this.params.labelOffsetWorld);
    } else {
      this.textLabel.object3d.position.copy(baseLabelPos);
    }

    // snap marker positions
    for (let i = 0; i < this.snapMarkers.length; i++) {
      const mt = SNAP_TS[i] ?? 0.5;
      const ma = theta * mt;
      this.snapMarkers[i]!.position
        .copy(u).multiplyScalar(Math.cos(ma))
        .addScaledVector(v, Math.sin(ma))
        .multiplyScalar(arcRadius)
        .add(vertex);
    }
    this.applySnapMarkerMaterials();
  }

  protected override onScaleFactorChanged(factor: number): void {
    this.snapScaleBase = factor;
  }

  override setBackgroundColor(color: THREE.ColorRepresentation): void {
    this.textLabel.setBackgroundColor(color);
  }

  protected onHighlightChanged(highlighted: boolean): void {
    this.applyMaterials();
    this.textLabel.setInteractionState(this.interactionState);
  }

  override dispose(): void {
    this.ray1Geometry.dispose();
    this.ray2Geometry.dispose();
    this.arcGeometry.dispose();
    this.arrowGeometry1.dispose();
    this.arrowGeometry2.dispose();
    this.textLabel.dispose();
    this.snapGuideGeometry.dispose();
    this.snapGuideMaterial.dispose();
    this.snapMarkerMat.dispose();
    this.snapMarkerMatActive.dispose();
    try { this.dashedLineMatNormal?.dispose?.(); } catch { /* ignore */ }
    try { this.dashedLineMatHovered?.dispose?.(); } catch { /* ignore */ }
    try { this.dashedLineMatSelected?.dispose?.(); } catch { /* ignore */ }
    super.dispose();
  }
}
