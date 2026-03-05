import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";

import { AnnotationBase, type AnnotationOptions } from "../core/AnnotationBase";
import {
  SolveSpaceBillboardVectorText,
  type SolveSpaceLabelRenderStyle,
} from "../text/SolveSpaceBillboardVectorText";
import {
  alignToPixelGrid,
  lineTrimmedAgainstBoxT,
  worldPerPixelAt,
} from "../utils/solvespaceLike";

import type {
  AnnotationMaterials,
  AnnotationMaterialSet,
} from "../core/AnnotationMaterials";

export type LinearDimension3DParams = {
  /** 起点 */
  start: THREE.Vector3;
  /** 终点 */
  end: THREE.Vector3;
  /** 标注线偏移距离（世界单位） */
  offset?: number;
  /** 文本在尺寸线上的位置（0..1，默认 0.5） */
  labelT?: number;
  /** SolveSpace 风格：文字自由拖拽偏移（世界坐标，相对于 labelT 基准位置）。设置后优先于 labelT 定位。 */
  labelOffsetWorld?: THREE.Vector3 | null;
  /** 参考尺寸（灰色虚线样式，仅显示不参与约束） */
  isReference?: boolean;
  /** 自定义文本（默认自动计算距离） */
  text?: string;
  /** 偏移方向（默认自动计算垂直方向） */
  direction?: THREE.Vector3;
  /** 单位后缀 */
  unit?: string;
  /** 小数位数 */
  decimals?: number;
  /** 字体 URL（默认使用内置 Roboto Mono woff） */
  fontUrl?: string;
  /** 箭头样式：filled = 实心三角, open = V 形线段, tick = 斜杠刻度（默认 filled） */
  arrowStyle?: "filled" | "open" | "tick";
  /** 箭头长度 px（默认 10） */
  arrowSizePx?: number;
  /** 箭头半角 °（默认 20） */
  arrowAngleDeg?: number;
  /** 界线超出 px（默认 10） */
  extensionOvershootPx?: number;
  /** 文字渲染风格（solvespace/rebarviz） */
  labelRenderStyle?: SolveSpaceLabelRenderStyle;
};

const SNAP_TS = [0, 0.25, 0.5, 0.75, 1] as const;
const snapMarkerGeometry = new THREE.CircleGeometry(0.12, 24);

export class LinearDimension3D extends AnnotationBase {
  private params: Required<
    Omit<
      LinearDimension3DParams,
      | "direction"
      | "fontUrl"
      | "labelOffsetWorld"
      | "isReference"
      | "labelRenderStyle"
    >
  > & {
    direction?: THREE.Vector3;
    fontUrl?: string;
    labelOffsetWorld?: THREE.Vector3 | null;
    isReference?: boolean;
    labelRenderStyle?: SolveSpaceLabelRenderStyle;
  };
  private materialSet: AnnotationMaterialSet;
  private hoveredMaterialSet: AnnotationMaterialSet;
  private selectedMaterialSet: AnnotationMaterialSet;

  // 子组件
  private dimensionLineA: Line2;
  private dimensionLineB: Line2;
  private dimensionLineOutside: Line2;
  private extensionLine1: Line2;
  private extensionLine2: Line2;
  private arrow1: THREE.Mesh;
  private arrow2: THREE.Mesh;
  private arrowOpen1: Line2;
  private arrowOpen2: Line2;
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
  private lastDistance = 0;
  private lastDisplayText = "";

  // 参考尺寸虚线材质（仅本实例使用；避免污染共享 LineMaterial）
  private dashedLineMatNormal: any | null = null;
  private dashedLineMatHovered: any | null = null;
  private dashedLineMatSelected: any | null = null;

  // 几何体（需要动态更新）
  private dimLineGeometryA: LineGeometry;
  private dimLineGeometryB: LineGeometry;
  private dimLineGeometryOutside: LineGeometry;
  private ext1Geometry: LineGeometry;
  private ext2Geometry: LineGeometry;
  private arrowGeometry1: THREE.BufferGeometry;
  private arrowGeometry2: THREE.BufferGeometry;
  private arrowOpenGeometry1: LineGeometry;
  private arrowOpenGeometry2: LineGeometry;

  // 缓存计算结果
  private readonly dimStart = new THREE.Vector3();
  private readonly dimEnd = new THREE.Vector3();
  private readonly offsetDir = new THREE.Vector3();
  private readonly tempVec = new THREE.Vector3();
  private readonly tempVec2 = new THREE.Vector3();
  private readonly tempWorldA = new THREE.Vector3();
  private readonly tempWorldB = new THREE.Vector3();
  private readonly tempLocalA = new THREE.Vector3();
  private readonly tempLocalB = new THREE.Vector3();
  private readonly wppTmp = {
    ndc: new THREE.Vector3(),
    ndc2: new THREE.Vector3(),
    p0: new THREE.Vector3(),
    p1: new THREE.Vector3(),
    p2: new THREE.Vector3(),
  };
  private readonly camRight = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private readonly camForward = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly refWorld = new THREE.Vector3();
  private readonly startWorld = new THREE.Vector3();
  private readonly endWorld = new THREE.Vector3();
  private readonly aeWorld = new THREE.Vector3();
  private readonly beWorld = new THREE.Vector3();
  private readonly dlWorld = new THREE.Vector3();
  private readonly dimDirUnitWorld = new THREE.Vector3();
  private readonly outDirWorld = new THREE.Vector3();
  private readonly tmpWorldC = new THREE.Vector3();
  private readonly tmpWorldD = new THREE.Vector3();
  private readonly tmpWorldE = new THREE.Vector3();
  private readonly tmpWorldF = new THREE.Vector3();
  private readonly tmpWorldG = new THREE.Vector3();
  private readonly worldScale = new THREE.Vector3();

  constructor(
    materials: AnnotationMaterials,
    params: LinearDimension3DParams,
    options?: AnnotationOptions,
  ) {
    super(materials, options);

    this.params = {
      start: params.start.clone(),
      end: params.end.clone(),
      offset: params.offset ?? 0.5,
      labelT: params.labelT ?? 0.5,
      labelOffsetWorld: params.labelOffsetWorld?.clone() ?? null,
      isReference: params.isReference ?? false,
      text: params.text ?? "",
      direction: params.direction?.clone(),
      unit: params.unit ?? "",
      decimals: params.decimals ?? 1,
      fontUrl: params.fontUrl,
      arrowStyle: params.arrowStyle ?? "filled",
      arrowSizePx: params.arrowSizePx ?? 10,
      arrowAngleDeg: params.arrowAngleDeg ?? 20,
      extensionOvershootPx: params.extensionOvershootPx ?? 10,
      labelRenderStyle: params.labelRenderStyle,
    };
    // 尺寸标注默认使用深紫色（由 DimensionStyleStore 驱动）
    this.materialSet = this.resolveMaterialSet(materials.ssDimensionDefault);
    // Hover/Selected 使用固定 SolveSpace 色，但也要尊重 depthTest 选项。
    this.hoveredMaterialSet = this.resolveMaterialSet(materials.ssHovered);
    this.selectedMaterialSet = this.resolveMaterialSet(materials.ssSelected);

    // 创建几何体
    this.dimLineGeometryA = new LineGeometry();
    this.dimLineGeometryB = new LineGeometry();
    this.dimLineGeometryOutside = new LineGeometry();
    this.ext1Geometry = new LineGeometry();
    this.ext2Geometry = new LineGeometry();
    this.arrowGeometry1 = new THREE.BufferGeometry();
    this.arrowGeometry2 = new THREE.BufferGeometry();
    this.arrowOpenGeometry1 = new LineGeometry();
    this.arrowOpenGeometry2 = new LineGeometry();

    // 创建尺寸线（Line2 支持可配置线宽）
    this.dimensionLineA = new Line2(
      this.dimLineGeometryA,
      this.materialSet.fatLine,
    );
    this.dimensionLineB = new Line2(
      this.dimLineGeometryB,
      this.materialSet.fatLine,
    );
    this.dimensionLineOutside = new Line2(
      this.dimLineGeometryOutside,
      this.materialSet.fatLine,
    );
    for (const l of [
      this.dimensionLineA,
      this.dimensionLineB,
      this.dimensionLineOutside,
    ]) {
      l.userData.dragRole = "offset";
      l.frustumCulled = false;
      this.add(l);
    }

    // 创建尺寸界线（Line2）
    this.extensionLine1 = new Line2(
      this.ext1Geometry,
      this.materialSet.fatLine,
    );
    this.extensionLine2 = new Line2(
      this.ext2Geometry,
      this.materialSet.fatLine,
    );
    this.extensionLine1.userData.dragRole = "offset";
    this.extensionLine2.userData.dragRole = "offset";
    this.extensionLine1.frustumCulled = false;
    this.extensionLine2.frustumCulled = false;
    this.add(this.extensionLine1, this.extensionLine2);

    // 创建箭头（实心三角 Mesh）
    this.arrow1 = new THREE.Mesh(this.arrowGeometry1, this.materialSet.mesh);
    this.arrow2 = new THREE.Mesh(this.arrowGeometry2, this.materialSet.mesh);
    this.arrow1.userData.dragRole = "offset";
    this.arrow2.userData.dragRole = "offset";
    this.arrow1.frustumCulled = false;
    this.arrow2.frustumCulled = false;
    this.add(this.arrow1, this.arrow2);

    // 创建箭头（开口 V 形线段）
    this.arrowOpen1 = new Line2(this.arrowOpenGeometry1, this.materialSet.fatLine);
    this.arrowOpen2 = new Line2(this.arrowOpenGeometry2, this.materialSet.fatLine);
    this.arrowOpen1.userData.dragRole = "offset";
    this.arrowOpen2.userData.dragRole = "offset";
    this.arrowOpen1.frustumCulled = false;
    this.arrowOpen2.frustumCulled = false;
    this.arrowOpen1.visible = false;
    this.arrowOpen2.visible = false;
    this.add(this.arrowOpen1, this.arrowOpen2);

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

    // 创建 SolveSpace 矢量文字标签（billboard）
    this.textLabel = new SolveSpaceBillboardVectorText({
      text: "",
      materialNormal: this.materialSet.line,
      materialHovered: this.hoveredMaterialSet.line,
      materialSelected: this.selectedMaterialSet.line,
      renderStyle: this.params.labelRenderStyle,
    });
    this.textLabel.object3d.userData.dragRole = "label";
    this.textLabel.syncPickProxyUserData();
    this.add(this.textLabel.object3d);

    // 吸附提示线（拖拽文字时临时显示；不参与拾取；使用普通 Line 避免 LineMaterial 分辨率维护）
    this.snapGuidePositions = new Float32Array(6);
    this.snapGuideGeometry = new THREE.BufferGeometry();
    this.snapGuideGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.snapGuidePositions, 3),
    );
    const guideColor =
      (
        (this.materialSet.lineHover as any)?.color as THREE.Color | undefined
      )?.getHex?.() ?? 0xffffff;
    this.snapGuideMaterial = new THREE.LineBasicMaterial({
      color: guideColor,
      transparent: true,
      opacity: 0.55,
      depthTest: true,
      depthWrite: false,
    });
    this.snapGuideLine = new THREE.Line(
      this.snapGuideGeometry,
      this.snapGuideMaterial,
    );
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
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
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

  /**
   * 设置吸附提示线目标点（世界坐标）。
   * - worldPos=null：清理并隐藏
   */
  setLabelSnapGuideTarget(worldPos: THREE.Vector3 | null): void {
    if (!worldPos) {
      this.snapGuideLine.visible = false;
      return;
    }

    // 确保 world matrices 可用
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

    const attr = this.snapGuideGeometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.snapGuideGeometry.computeBoundingSphere();
    this.snapGuideLine.visible = true;
  }

  /** 获取当前显示文本（优先 textOverride，否则为自动计算） */
  getDisplayText(): string {
    return this.lastDisplayText;
  }

  /** 获取当前测量距离（start-end 的长度） */
  getDistance(): number {
    return this.lastDistance;
  }

  /** 获取文字标签的世界坐标 */
  getLabelWorldPos(): THREE.Vector3 {
    return this.textLabel.object3d.getWorldPosition(new THREE.Vector3());
  }

  /** 获取吸附点的世界坐标（用于拖拽提示线/外部辅助） */
  getSnapMarkerWorldPos(index: number): THREE.Vector3 | null {
    const m = this.snapMarkers[index];
    if (!m) return null;
    return m.getWorldPosition(new THREE.Vector3());
  }

  /** 设置吸附点标记显示与激活态（拖拽时用） */
  setLabelSnapMarkersState(
    visible: boolean,
    activeIndex: number | null,
    nearIndex: number | null,
  ): void {
    this.snapMarkersVisible = visible;
    this.snapActiveIndex = visible ? activeIndex : null;
    this.snapNearIndex = visible ? nearIndex : null;
    this.snapGroup.visible = visible;
    this.applySnapMarkerMaterials();
  }

  /** 仅控制文字显隐（不影响线/箭头） */
  setLabelVisible(visible: boolean): void {
    this.textLabel.setVisible(visible);
  }

  /** 设置文字渲染风格（solvespace/rebarviz） */
  setLabelRenderStyle(style: SolveSpaceLabelRenderStyle): void {
    this.params.labelRenderStyle = style;
    this.textLabel.setRenderStyle(style);
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
        if (near !== null && (i === near || i === near - 1 || i === near + 1))
          show = true;
      }
      this.snapMarkers[i]!.visible = show;
    }
  }

  /** 获取当前参数 */
  getParams(): LinearDimension3DParams {
    return {
      start: this.params.start.clone(),
      end: this.params.end.clone(),
      offset: this.params.offset,
      labelT: this.params.labelT,
      labelOffsetWorld: this.params.labelOffsetWorld?.clone() ?? null,
      isReference: this.params.isReference,
      text: this.params.text || undefined,
      direction: this.params.direction?.clone(),
      unit: this.params.unit,
      decimals: this.params.decimals,
      fontUrl: this.params.fontUrl,
      arrowStyle: this.params.arrowStyle,
      arrowSizePx: this.params.arrowSizePx,
      arrowAngleDeg: this.params.arrowAngleDeg,
      extensionOvershootPx: this.params.extensionOvershootPx,
      labelRenderStyle: this.params.labelRenderStyle,
    };
  }

  /** 获取 label 默认位置（无 labelOffsetWorld 时的基准，即 labelT 插值点） */
  getDefaultLabelWorldPos(): THREE.Vector3 {
    const t = Math.max(0, Math.min(1, Number(this.params.labelT) || 0.5));
    return this.dimStart.clone().lerp(this.dimEnd, t);
  }

  /** 更新参数并重建几何 */
  setParams(params: Partial<LinearDimension3DParams>): void {
    if (params.start) this.params.start.copy(params.start);
    if (params.end) this.params.end.copy(params.end);
    if (params.offset !== undefined) this.params.offset = params.offset;
    if (params.labelT !== undefined) this.params.labelT = params.labelT;
    if ("labelOffsetWorld" in params) {
      this.params.labelOffsetWorld = params.labelOffsetWorld?.clone() ?? null;
    }
    if (params.isReference !== undefined)
      this.params.isReference = params.isReference;
    if (params.text !== undefined) this.params.text = params.text;
    if (params.direction) this.params.direction = params.direction.clone();
    if (params.unit !== undefined) this.params.unit = params.unit;
    if (params.decimals !== undefined) this.params.decimals = params.decimals;
    if (params.fontUrl !== undefined) this.params.fontUrl = params.fontUrl;
    if (params.arrowStyle !== undefined) this.params.arrowStyle = params.arrowStyle;
    if (params.arrowSizePx !== undefined)
      this.params.arrowSizePx = params.arrowSizePx;
    if (params.arrowAngleDeg !== undefined)
      this.params.arrowAngleDeg = params.arrowAngleDeg;
    if (params.extensionOvershootPx !== undefined) {
      this.params.extensionOvershootPx = params.extensionOvershootPx;
    }
    if (params.labelRenderStyle !== undefined) {
      this.params.labelRenderStyle = params.labelRenderStyle;
      this.textLabel.setRenderStyle(params.labelRenderStyle);
    }
    this.rebuild();
    this.applyMaterials();
  }

  /** 设置材质颜色集 */
  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    // setMaterialSet 可能在构造后被调用（例如切换标注模式）；需要再次走 resolveMaterialSet
    // 才能保持 depthTest=false 时的“置顶渲染”语义。
    this.materialSet = this.resolveMaterialSet(materialSet);
    this.textLabel.setMaterials({
      normal: this.materialSet.line,
      hovered: this.hoveredMaterialSet.line,
      selected: this.selectedMaterialSet.line,
    });
    this.applyMaterials();
  }

  /** 调整当前尺寸线/开口箭头线宽（像素） */
  setLineWidthPx(lineWidthPx: number): void {
    const w = Math.max(1, Number(lineWidthPx) || 1);
    for (const set of [
      this.materialSet,
      this.hoveredMaterialSet,
      this.selectedMaterialSet,
    ]) {
      set.fatLine.linewidth = w;
      set.fatLineHover.linewidth = w;
    }
    this.applyMaterials();
  }

  private applyMaterials(): void {
    // SolveSpace 风格：selected > hovered > normal
    const state = this.interactionState;
    let fatLineMat: any;
    let meshMat: any;
    if (state === "selected") {
      fatLineMat = this.selectedMaterialSet.fatLine;
      meshMat = this.selectedMaterialSet.mesh;
    } else if (state === "hovered") {
      fatLineMat = this.hoveredMaterialSet.fatLine;
      meshMat = this.hoveredMaterialSet.mesh;
    } else {
      fatLineMat = this._highlighted
        ? this.materialSet.fatLineHover
        : this.materialSet.fatLine;
      meshMat = this._highlighted
        ? this.materialSet.meshHover
        : this.materialSet.mesh;
    }

    const lineMat = this.params.isReference
      ? this.getDashedLineMaterial(state, fatLineMat)
      : fatLineMat;

    this.dimensionLineA.material = lineMat;
    this.dimensionLineB.material = lineMat;
    this.dimensionLineOutside.material = lineMat;
    this.extensionLine1.material = lineMat;
    this.extensionLine2.material = lineMat;
    // 实心箭头使用 mesh 材质；开口箭头使用实线材质（不跟随 reference 虚线）
    this.arrow1.material = meshMat;
    this.arrow2.material = meshMat;
    this.arrowOpen1.material = fatLineMat;
    this.arrowOpen2.material = fatLineMat;
  }

  private getDashedLineMaterial(
    state: "normal" | "hovered" | "selected",
    solid: any,
  ): any {
    let cached: any | null;
    if (state === "selected") cached = this.dashedLineMatSelected;
    else if (state === "hovered") cached = this.dashedLineMatHovered;
    else cached = this.dashedLineMatNormal;

    // Re-create if missing or if source material changed (e.g. setMaterialSet)
    const src = (cached as any)?.__src as any | undefined;
    if (!cached || src !== solid) {
      cached = solid.clone();
      (cached as any).__src = solid;
      cached.dashed = true;
      // dash sizes are updated per-frame in _updateSolveSpaceGeometry (need wpp)

      if (state === "selected") this.dashedLineMatSelected = cached;
      else if (state === "hovered") this.dashedLineMatHovered = cached;
      else this.dashedLineMatNormal = cached;
    }
    return cached;
  }

  private setLineGeometryFromWorld(
    geom: LineGeometry,
    aWorld: THREE.Vector3,
    bWorld: THREE.Vector3,
    camera: THREE.Camera,
    viewportWidthPx: number,
    viewportHeightPx: number,
  ): void {
    alignToPixelGrid(
      camera,
      aWorld,
      viewportWidthPx,
      viewportHeightPx,
      this.tempWorldA,
    );
    alignToPixelGrid(
      camera,
      bWorld,
      viewportWidthPx,
      viewportHeightPx,
      this.tempWorldB,
    );

    const aLocal = this.worldToLocal(this.tempLocalA.copy(this.tempWorldA));
    const bLocal = this.worldToLocal(this.tempLocalB.copy(this.tempWorldB));
    geom.setPositions([
      aLocal.x,
      aLocal.y,
      aLocal.z,
      bLocal.x,
      bLocal.y,
      bLocal.z,
    ]);
  }

  /**
   * SolveSpace 风格几何更新（每帧，依赖 camera）。
   *
   * 对齐点：
   * - 所有线段端点做 AlignToPixelGrid（对应 SolveSpace Constraint::DoLine）
   *
   * 样式：
   * - 箭头：支持实心三角（filled）/V 形两线段（open）
   * - 尺寸线：遇 label box 留白切分（DoLineTrimmedAgainstBox）
   * - 界线：超出箭头端点 10px
   */
  private _updateSolveSpaceGeometry(camera: THREE.Camera): void {
    const viewport = (camera as any)?.userData?.annotationViewport as
      | { width?: number; height?: number }
      | undefined;
    const vw = Math.max(
      1,
      Math.floor(Number(viewport?.width) || Number(window?.innerWidth) || 1),
    );
    const vh = Math.max(
      1,
      Math.floor(Number(viewport?.height) || Number(window?.innerHeight) || 1),
    );

    // Ensure world matrices are up to date for local<->world transforms
    this.updateWorldMatrix(true, true);

    // Camera display axes (SolveSpace: projRight/projUp)
    this.camRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    this.camUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    this.camForward
      .set(0, 0, -1)
      .applyQuaternion(camera.quaternion)
      .normalize();

    // Label: align to pixel grid + compute world-per-pixel scale
    this.textLabel.object3d.getWorldPosition(this.tmpWorldF);
    alignToPixelGrid(camera, this.tmpWorldF, vw, vh, this.refWorld);
    const wpp = worldPerPixelAt(camera, this.refWorld, vw, vh, this.wppTmp);
    if (!Number.isFinite(wpp) || wpp <= 0) return;

    // `worldPerPixelAt` 返回的是世界坐标尺度；若父级存在全局缩放（例如 mm->m=0.001），
    // 需要换算为本地尺度，否则文字会被额外缩小，出现“线可见但字极小不可见”。
    let localWpp = wpp;
    try {
      this.getWorldScale(this.worldScale);
      const s =
        (Math.abs(this.worldScale.x) +
          Math.abs(this.worldScale.y) +
          Math.abs(this.worldScale.z)) /
        3;
      if (Number.isFinite(s) && s > 1e-9) {
        localWpp = wpp / s;
      }
    } catch {
      // ignore
    }
    this.textLabel.setWorldPerPixel(localWpp);
    this.textLabel.object3d.position.copy(
      this.worldToLocal(this.tmpWorldG.copy(this.refWorld)),
    );

    // Key points in world space (keep in stable vectors to avoid aliasing)
    const startW = this.localToWorld(this.startWorld.copy(this.params.start));
    const endW = this.localToWorld(this.endWorld.copy(this.params.end));
    const aeW = this.localToWorld(this.aeWorld.copy(this.dimStart));
    const beW = this.localToWorld(this.beWorld.copy(this.dimEnd));

    // Dimension line direction
    const dlW = this.dlWorld.copy(beW).sub(aeW);
    const dlLen = dlW.length();
    if (dlLen < 1e-9) {
      this.dimensionLineA.visible = false;
      this.dimensionLineB.visible = false;
      this.dimensionLineOutside.visible = false;
      this.arrow1.visible = false;
      this.arrow2.visible = false;
      this.arrowOpen1.visible = false;
      this.arrowOpen2.visible = false;
      return;
    }
    const dirUnit = this.dimDirUnitWorld.copy(dlW).divideScalar(dlLen);

    // Extension line direction (SolveSpace: out)
    const outDirW = this.outDirWorld.copy(aeW).sub(startW);
    if (outDirW.lengthSq() < 1e-12) {
      outDirW.copy(this.camUp);
    } else {
      outDirW.normalize();
    }

    // Extension lines overshoot (configurable)
    const ext = this.params.extensionOvershootPx * wpp;
    this.setLineGeometryFromWorld(
      this.ext1Geometry,
      startW,
      this.tmpWorldF.copy(aeW).addScaledVector(outDirW, ext),
      camera,
      vw,
      vh,
    );
    this.setLineGeometryFromWorld(
      this.ext2Geometry,
      endW,
      this.tmpWorldF.copy(beW).addScaledVector(outDirW, ext),
      camera,
      vw,
      vh,
    );

    // Label box size in world units (SolveSpace: +8px padding).
    // 若字体尚未加载，extents 可能为 0；此时不做留白切分，避免出现错误 gap。
    const extPx = this.textLabel.getExtentsPx();
    const hasLabelBox = extPx.width > 0 && extPx.height > 0;
    const swidth = hasLabelBox ? (extPx.width + 8) * wpp : 0;
    const sheight = hasLabelBox ? (extPx.height + 8) * wpp : 0;

    const trim = hasLabelBox
      ? lineTrimmedAgainstBoxT(
          this.refWorld,
          aeW,
          beW,
          this.camRight,
          this.camUp,
          swidth,
          sheight,
          true,
        )
      : ({ within: 0, segmentsT: [[0, 1]] } as const);

    // Main trimmed segments (0..2)
    const segs = trim.segmentsT;
    const toWorldAt = (t: number, out: THREE.Vector3) =>
      out.copy(aeW).addScaledVector(dlW, t);

    if (segs.length >= 1) {
      const [t0, t1] = segs[0]!;
      this.dimensionLineA.visible = true;
      this.setLineGeometryFromWorld(
        this.dimLineGeometryA,
        toWorldAt(t0, this.tmpWorldF),
        toWorldAt(t1, this.tmpWorldG),
        camera,
        vw,
        vh,
      );
    } else {
      this.dimensionLineA.visible = false;
    }

    if (segs.length >= 2) {
      const [t0, t1] = segs[1]!;
      this.dimensionLineB.visible = true;
      this.setLineGeometryFromWorld(
        this.dimLineGeometryB,
        toWorldAt(t0, this.tmpWorldF),
        toWorldAt(t1, this.tmpWorldG),
        camera,
        vw,
        vh,
      );
    } else {
      this.dimensionLineB.visible = false;
    }

    // Outside extension segment when label is outside the line (SolveSpace DoLineWithArrows)
    if (trim.within !== 0) {
      const segLen = 18 * wpp;
      const segVec = this.tmpWorldF.copy(dirUnit).multiplyScalar(segLen);
      const sW = trim.within < 0 ? aeW : beW;
      const eW =
        trim.within < 0
          ? this.tmpWorldG.copy(aeW).sub(segVec)
          : this.tmpWorldG.copy(beW).add(segVec);
      this.dimensionLineOutside.visible = true;
      this.setLineGeometryFromWorld(
        this.dimLineGeometryOutside,
        sW,
        eW,
        camera,
        vw,
        vh,
      );
    } else {
      this.dimensionLineOutside.visible = false;
    }

    // Arrow heads: configurable size and angle
    const theta = (this.params.arrowAngleDeg * Math.PI) / 180;
    const arrowLen = this.params.arrowSizePx * wpp;
    const legLen = arrowLen / Math.cos(theta);

    // Arrow Reversing Logic: if distance is too small to fit arrows + label
    const minSpaceForArrows = 2 * legLen + swidth;
    const isArrowReversed = dlLen < minSpaceForArrows;

    // Plane normal for arrow rotation (SolveSpace: n = (a-b) x (a-ref))
    const nW = this.tmpWorldC
      .copy(startW)
      .sub(endW)
      .cross(this.tmpWorldD.copy(startW).sub(this.refWorld));
    if (nW.lengthSq() < 1e-12) {
      nW.copy(this.camForward);
    } else {
      nW.normalize();
    }

    const arrowDir = this.tempWorldB.copy(dirUnit);
    // If inside label box, reverse arrow to point outward from box.
    // If space too small, reverse arrow completely so it sits *outside* the extension lines.
    if (trim.within !== 0 || isArrowReversed) {
      arrowDir.multiplyScalar(-1);
    }

    // Build arrow geometries in local space (filled triangle mesh)
    const setArrowFilled = (
      geom: THREE.BufferGeometry,
      tip: THREE.Vector3,
      dir: THREE.Vector3,
    ) => {
      const e1 = this.tmpWorldE
        .copy(dir)
        .applyAxisAngle(nW, +theta)
        .setLength(legLen)
        .add(tip);
      const e2 = this.tmpWorldF
        .copy(dir)
        .applyAxisAngle(nW, -theta)
        .setLength(legLen)
        .add(tip);

      // Align each endpoint like SolveSpace DoLine() does
      alignToPixelGrid(camera, tip, vw, vh, this.tempWorldA);
      const pLocal = this.worldToLocal(this.tempLocalA.copy(this.tempWorldA));

      alignToPixelGrid(camera, e1, vw, vh, this.tempWorldA);
      const e1Local = this.worldToLocal(this.tempLocalB.copy(this.tempWorldA));

      alignToPixelGrid(camera, e2, vw, vh, this.tempWorldA);
      const e2Local = this.worldToLocal(this.tmpWorldG.copy(this.tempWorldA));

      // Filled triangle: 3 vertices + index
      geom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [
            pLocal.x,
            pLocal.y,
            pLocal.z,
            e1Local.x,
            e1Local.y,
            e1Local.z,
            e2Local.x,
            e2Local.y,
            e2Local.z,
          ],
          3,
        ),
      );
      geom.setIndex([0, 1, 2]);
    };

    // Build open arrow geometries in local space (two legs: tip->e1, tip->e2)
    const setArrowOpen = (
      geom: LineGeometry,
      tip: THREE.Vector3,
      dir: THREE.Vector3,
    ) => {
      const e1 = this.tmpWorldE
        .copy(dir)
        .applyAxisAngle(nW, +theta)
        .setLength(legLen)
        .add(tip);
      const e2 = this.tmpWorldF
        .copy(dir)
        .applyAxisAngle(nW, -theta)
        .setLength(legLen)
        .add(tip);

      alignToPixelGrid(camera, tip, vw, vh, this.tempWorldA);
      const pLocal = this.worldToLocal(this.tempLocalA.copy(this.tempWorldA));

      alignToPixelGrid(camera, e1, vw, vh, this.tempWorldA);
      const e1Local = this.worldToLocal(this.tempLocalB.copy(this.tempWorldA));

      alignToPixelGrid(camera, e2, vw, vh, this.tempWorldA);
      const e2Local = this.worldToLocal(this.tmpWorldG.copy(this.tempWorldA));

      geom.setPositions([
        e1Local.x,
        e1Local.y,
        e1Local.z,
        pLocal.x,
        pLocal.y,
        pLocal.z,
        e2Local.x,
        e2Local.y,
        e2Local.z,
      ]);
    };

    // Build tick arrow geometries in local space (single slash segment)
    const setArrowTick = (
      geom: LineGeometry,
      tip: THREE.Vector3,
      dir: THREE.Vector3,
    ) => {
      const tickTheta = (62 * Math.PI) / 180;
      const halfTickLen = Math.max(4 * wpp, arrowLen * 0.55);
      const tDir = this.tmpWorldE
        .copy(dir)
        .applyAxisAngle(nW, tickTheta)
        .setLength(halfTickLen);
      const a = this.tmpWorldF.copy(tip).add(tDir);
      const b = this.tmpWorldG.copy(tip).sub(tDir);

      alignToPixelGrid(camera, a, vw, vh, this.tempWorldA);
      const aLocal = this.worldToLocal(this.tempLocalA.copy(this.tempWorldA));

      alignToPixelGrid(camera, b, vw, vh, this.tempWorldA);
      const bLocal = this.worldToLocal(this.tempLocalB.copy(this.tempWorldA));

      geom.setPositions([aLocal.x, aLocal.y, aLocal.z, bLocal.x, bLocal.y, bLocal.z]);
    };

    // Calculate actual tip positions
    // If reversed, the arrows are moved *outside* the dimension boundaries.
    const tip1 = this.tmpWorldC.copy(aeW);
    const tip2 = this.tmpWorldD.copy(beW);

    if (isArrowReversed) {
      tip1.addScaledVector(dirUnit, -legLen);
      tip2.addScaledVector(dirUnit, legLen);

      // Also need to extend the outer lines to meet these new arrow positions
      const segLen = Math.max(18 * wpp, legLen + 5 * wpp); // ensure line extends past the reversed arrow
      const segVec = this.tmpWorldE.copy(dirUnit).multiplyScalar(segLen);

      // Redraw outside lines since the standard trim logic doesn't know about arrow reversing
      const eW1 = this.tmpWorldF.copy(aeW).sub(segVec);
      const eW2 = this.tmpWorldG.copy(beW).add(segVec);

      this.dimensionLineOutside.visible = true;
      // Overwrite geometry for reversed arrows (both sides)
      this.setLineGeometryFromWorld(
        this.dimLineGeometryOutside,
        eW1,
        eW2,
        camera,
        vw,
        vh,
      );
    }

    if (this.params.arrowStyle === "open") {
      setArrowOpen(this.arrowOpenGeometry1, tip1, arrowDir);
      setArrowOpen(
        this.arrowOpenGeometry2,
        tip2,
        this.tmpWorldE.copy(arrowDir).multiplyScalar(-1),
      );
      this.arrowOpen1.visible = true;
      this.arrowOpen2.visible = true;
      this.arrow1.visible = false;
      this.arrow2.visible = false;
    } else if (this.params.arrowStyle === "tick") {
      setArrowTick(this.arrowOpenGeometry1, tip1, dirUnit);
      setArrowTick(this.arrowOpenGeometry2, tip2, dirUnit);
      this.arrowOpen1.visible = true;
      this.arrowOpen2.visible = true;
      this.arrow1.visible = false;
      this.arrow2.visible = false;
    } else {
      setArrowFilled(this.arrowGeometry1, tip1, arrowDir);
      setArrowFilled(
        this.arrowGeometry2,
        tip2,
        this.tmpWorldE.copy(arrowDir).multiplyScalar(-1),
      );
      this.arrow1.visible = true;
      this.arrow2.visible = true;
      this.arrowOpen1.visible = false;
      this.arrowOpen2.visible = false;
    }

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
      try {
        this.dimensionLineA.computeLineDistances();
      } catch {
        /* ignore */
      }
      try {
        this.dimensionLineB.computeLineDistances();
      } catch {
        /* ignore */
      }
      try {
        this.dimensionLineOutside.computeLineDistances();
      } catch {
        /* ignore */
      }
      try {
        this.extensionLine1.computeLineDistances();
      } catch {
        /* ignore */
      }
      try {
        this.extensionLine2.computeLineDistances();
      } catch {
        /* ignore */
      }
    }
  }

  /** 重建几何体 */
  private rebuild(): void {
    const { start, end, offset } = this.params;
    const distance = start.distanceTo(end);
    this.lastDistance = distance;

    // 计算偏移方向
    if (this.params.direction) {
      this.offsetDir.copy(this.params.direction).normalize();
    } else {
      this.tempVec.copy(end).sub(start).normalize();
      this.offsetDir.set(-this.tempVec.y, this.tempVec.x, 0);
      if (this.offsetDir.lengthSq() < 0.0001) {
        this.offsetDir.set(1, 0, 0);
      }
      this.offsetDir.normalize();
    }

    // 尺寸线端点（局部坐标）
    this.dimStart.copy(start).addScaledVector(this.offsetDir, offset);
    this.dimEnd.copy(end).addScaledVector(this.offsetDir, offset);

    // 先放一个占位几何；真正 SolveSpace 像素对齐/留白/箭头在每帧 update(camera) 中更新
    this.dimLineGeometryA.setPositions([
      this.dimStart.x,
      this.dimStart.y,
      this.dimStart.z,
      this.dimEnd.x,
      this.dimEnd.y,
      this.dimEnd.z,
    ]);
    this.dimensionLineA.visible = true;
    this.dimLineGeometryB.setPositions([0, 0, 0, 0, 0, 0]);
    this.dimensionLineB.visible = false;
    this.dimLineGeometryOutside.setPositions([0, 0, 0, 0, 0, 0]);
    this.dimensionLineOutside.visible = false;

    // 占位界线（无像素 overshoot，后续在 update(camera) 里按配置的 extensionOvershootPx 更新）
    this.ext1Geometry.setPositions([
      start.x,
      start.y,
      start.z,
      this.dimStart.x,
      this.dimStart.y,
      this.dimStart.z,
    ]);
    this.ext2Geometry.setPositions([
      end.x,
      end.y,
      end.z,
      this.dimEnd.x,
      this.dimEnd.y,
      this.dimEnd.z,
    ]);

    // 占位箭头（隐藏），后续在 update(camera) 中生成实心三角
    this.arrowGeometry1.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3),
    );
    this.arrowGeometry1.setIndex([0, 1, 2]);
    this.arrowGeometry2.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3),
    );
    this.arrowGeometry2.setIndex([0, 1, 2]);
    this.arrowOpenGeometry1.setPositions([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    this.arrowOpenGeometry2.setPositions([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    this.arrow1.visible = false;
    this.arrow2.visible = false;
    this.arrowOpen1.visible = false;
    this.arrowOpen2.visible = false;

    // 更新文本
    let displayText =
      this.params.text ||
      `${distance.toFixed(this.params.decimals)}${this.params.unit}`;
    // SolveSpace: reference label suffix " REF"
    if (this.params.isReference && !displayText.endsWith(" REF")) {
      displayText = `${displayText} REF`;
    }
    this.lastDisplayText = displayText;
    this.textLabel.setText(displayText);

    // 文本位置：优先使用 labelOffsetWorld（SolveSpace 自由拖拽），否则用 labelT 插值
    const t = Math.max(0, Math.min(1, Number(this.params.labelT) || 0.5));
    const baseLabelPos = this.tempVec.copy(this.dimStart).lerp(this.dimEnd, t);
    if (this.params.labelOffsetWorld) {
      this.textLabel.object3d.position
        .copy(baseLabelPos)
        .add(this.params.labelOffsetWorld);
    } else {
      this.textLabel.object3d.position.copy(baseLabelPos);
    }

    // 吸附点位置
    for (let i = 0; i < this.snapMarkers.length; i++) {
      const mt = SNAP_TS[i] ?? 0.5;
      this.snapMarkers[i]!.position.copy(this.dimStart).lerp(this.dimEnd, mt);
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
    this.dimLineGeometryA.dispose();
    this.dimLineGeometryB.dispose();
    this.dimLineGeometryOutside.dispose();
    this.ext1Geometry.dispose();
    this.ext2Geometry.dispose();
    this.arrowGeometry1.dispose();
    this.arrowGeometry2.dispose();
    this.arrowOpenGeometry1.dispose();
    this.arrowOpenGeometry2.dispose();
    this.textLabel.dispose();
    this.snapGuideGeometry.dispose();
    this.snapGuideMaterial.dispose();
    this.snapMarkerMat.dispose();
    this.snapMarkerMatActive.dispose();
    try {
      this.dashedLineMatNormal?.dispose?.();
    } catch {
      /* ignore */
    }
    try {
      this.dashedLineMatHovered?.dispose?.();
    } catch {
      /* ignore */
    }
    try {
      this.dashedLineMatSelected?.dispose?.();
    } catch {
      /* ignore */
    }
    super.dispose();
  }
}
