import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase';
import { computeDimensionOffsetDirInLocal } from '../utils/computeDimensionOffsetDirInLocal';
import { worldPerPixelAt } from '../utils/solvespaceLike';

import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials';

export type XeokitDistanceMeasurementParams = {
  origin: THREE.Vector3;
  target: THREE.Vector3;
  displayTransform?: THREE.Matrix4;
  approximate?: boolean;
  showAxes?: boolean;
  visible?: boolean;
  originVisible?: boolean;
  targetVisible?: boolean;
  wireVisible?: boolean;
  axisVisible?: boolean;
  xAxisVisible?: boolean;
  yAxisVisible?: boolean;
  zAxisVisible?: boolean;
  labelVisible?: boolean;
  labelPrefix?: string;
};

const markerGeometry = new THREE.SphereGeometry(0.08, 16, 16);
const MAIN_LINE_WIDTH_PX = 2.6;
const AXIS_LINE_WIDTH_PX = 2.2;

type LabelTheme = {
  background: string;
  border: string;
  color: string;
};

function createLabelElement(kind: 'main' | 'axis', theme: LabelTheme): HTMLDivElement {
  const el = document.createElement('div');
  el.style.pointerEvents = 'none';
  el.style.whiteSpace = 'nowrap';
  el.style.fontSize = kind === 'main' ? '11px' : '10px';
  el.style.fontWeight = kind === 'main' ? '700' : '600';
  el.style.padding = kind === 'main' ? '2px 7px' : '2px 5px';
  el.style.borderRadius = '6px';
  el.style.border = `1px solid ${theme.border}`;
  el.style.background = theme.background;
  el.style.boxShadow = '0 4px 12px rgba(15, 23, 42, 0.18)';
  el.style.color = theme.color;
  return el;
}

function formatLength(value: number): string {
  return `${value.toFixed(2)} m`;
}

export class XeokitDistanceMeasurement extends AnnotationBase {
  private params: Required<XeokitDistanceMeasurementParams>;
  private materialSet: AnnotationMaterialSet;
  private xMaterialSet: AnnotationMaterialSet;
  private yMaterialSet: AnnotationMaterialSet;
  private zMaterialSet: AnnotationMaterialSet;
  private readonly mainGeometry = new LineGeometry();
  private readonly xGeometry = new LineGeometry();
  private readonly yGeometry = new LineGeometry();
  private readonly zGeometry = new LineGeometry();
  private readonly mainLine: Line2;
  private readonly xLine: Line2;
  private readonly yLine: Line2;
  private readonly zLine: Line2;
  private readonly originMarker: THREE.Mesh;
  private readonly targetMarker: THREE.Mesh;
  private readonly lineMaterialCache = new Map<string, LineMaterial>();
  private readonly mainLabelEl = createLabelElement('main', {
    background: '#06b6d4',
    border: '#0891b2',
    color: '#ffffff',
  });
  private readonly xLabelEl = createLabelElement('axis', {
    background: '#dc2626',
    border: '#b91c1c',
    color: '#ffffff',
  });
  private readonly yLabelEl = createLabelElement('axis', {
    background: '#16a34a',
    border: '#15803d',
    color: '#ffffff',
  });
  private readonly zLabelEl = createLabelElement('axis', {
    background: '#0ea5e9',
    border: '#0284c7',
    color: '#ffffff',
  });
  private readonly mainLabel: CSS2DObject;
  private readonly xLabel: CSS2DObject;
  private readonly yLabel: CSS2DObject;
  private readonly zLabel: CSS2DObject;
  private readonly worldScale = new THREE.Vector3();
  private readonly tempLocalA = new THREE.Vector3();
  private readonly tempLocalB = new THREE.Vector3();
  private readonly tempLocalC = new THREE.Vector3();
  private readonly tempLocalD = new THREE.Vector3();
  private readonly tempLocalE = new THREE.Vector3();
  private readonly tempLocalF = new THREE.Vector3();
  private readonly tempLocalG = new THREE.Vector3();
  private readonly tempWorldA = new THREE.Vector3();
  private readonly tempWorldB = new THREE.Vector3();
  private readonly tempWorldC = new THREE.Vector3();
  private readonly tempWorldD = new THREE.Vector3();
  private readonly tempWorldE = new THREE.Vector3();
  private readonly tempWorldF = new THREE.Vector3();
  private readonly tempWorldG = new THREE.Vector3();
  private readonly offsetDirLocal = new THREE.Vector3();
  private readonly sideDirLocal = new THREE.Vector3();
  private readonly wppTmp = {
    ndc: new THREE.Vector3(),
    ndc2: new THREE.Vector3(),
    p0: new THREE.Vector3(),
    p1: new THREE.Vector3(),
    p2: new THREE.Vector3(),
  };

  constructor(materials: AnnotationMaterials, params: XeokitDistanceMeasurementParams, options?: AnnotationOptions) {
    super(materials, {
      depthTest: false,
      ...options,
    });
    this.params = {
      displayTransform: new THREE.Matrix4(),
      approximate: false,
      showAxes: true,
      visible: true,
      originVisible: true,
      targetVisible: true,
      wireVisible: true,
      axisVisible: true,
      xAxisVisible: true,
      yAxisVisible: true,
      zAxisVisible: true,
      labelVisible: true,
      labelPrefix: '',
      ...params,
    };
    this.params.visible = this.params.visible ?? true;
    this.params.originVisible = this.params.originVisible ?? true;
    this.params.targetVisible = this.params.targetVisible ?? true;
    this.params.wireVisible = this.params.wireVisible ?? true;
    this.params.axisVisible = this.params.axisVisible ?? true;
    this.params.xAxisVisible = this.params.xAxisVisible ?? true;
    this.params.yAxisVisible = this.params.yAxisVisible ?? true;
    this.params.zAxisVisible = this.params.zAxisVisible ?? true;
    this.params.labelVisible = this.params.labelVisible ?? true;
    this.params.labelPrefix = this.params.labelPrefix ?? '';
    this.materialSet = this.resolveMaterialSet(materials.blue);
    this.xMaterialSet = this.resolveMaterialSet(materials.orange);
    this.yMaterialSet = this.resolveMaterialSet(materials.green);
    this.zMaterialSet = this.resolveMaterialSet(materials.blue);

    this.mainLine = new Line2(this.mainGeometry, this.getLineMaterial('main-normal', this.materialSet.fatLine, MAIN_LINE_WIDTH_PX));
    this.xLine = new Line2(this.xGeometry, this.getLineMaterial('x-normal', this.xMaterialSet.fatLine, AXIS_LINE_WIDTH_PX));
    this.yLine = new Line2(this.yGeometry, this.getLineMaterial('y-normal', this.yMaterialSet.fatLine, AXIS_LINE_WIDTH_PX));
    this.zLine = new Line2(this.zGeometry, this.getLineMaterial('z-normal', this.zMaterialSet.fatLine, AXIS_LINE_WIDTH_PX));

    this.originMarker = new THREE.Mesh(markerGeometry, this.materialSet.mesh);
    this.targetMarker = new THREE.Mesh(markerGeometry, this.materialSet.mesh);

    this.mainLabel = new CSS2DObject(this.mainLabelEl);
    this.xLabel = new CSS2DObject(this.xLabelEl);
    this.yLabel = new CSS2DObject(this.yLabelEl);
    this.zLabel = new CSS2DObject(this.zLabelEl);

    for (const obj of [this.mainLine, this.xLine, this.yLine, this.zLine, this.originMarker, this.targetMarker]) {
      obj.userData.pickable = true;
    }
    for (const label of [this.mainLabel, this.xLabel, this.yLabel, this.zLabel]) {
      label.userData.noPick = true;
    }

    this.add(
      this.mainLine,
      this.xLine,
      this.yLine,
      this.zLine,
      this.originMarker,
      this.targetMarker,
      this.mainLabel,
      this.xLabel,
      this.yLabel,
      this.zLabel,
    );

    this.rebuild();
    this.applyVisualState();
  }

  setParams(params: Partial<XeokitDistanceMeasurementParams>): void {
    this.params = { ...this.params, ...params };
    this.rebuild();
    this.applyVisualState();
  }

  override update(camera: THREE.Camera): void {
    super.update(camera);
    this.updateLabelLayout(camera);
    this.updateLineStyle();
    this.mainLabel.quaternion.copy(camera.quaternion);
    this.xLabel.quaternion.copy(camera.quaternion);
    this.yLabel.quaternion.copy(camera.quaternion);
    this.zLabel.quaternion.copy(camera.quaternion);
  }

  protected override onScaleFactorChanged(factor: number): void {
    const markerScale = Math.max(0.06, factor * 0.3);
    this.originMarker.scale.setScalar(markerScale);
    this.targetMarker.scale.setScalar(markerScale);
  }

  protected override onHighlightChanged(_highlighted: boolean): void {
    this.applyVisualState();
  }

  override dispose(): void {
    this.mainGeometry.dispose();
    this.xGeometry.dispose();
    this.yGeometry.dispose();
    this.zGeometry.dispose();
    for (const material of this.lineMaterialCache.values()) {
      material.dispose();
    }
    this.lineMaterialCache.clear();
    this.mainLabelEl.remove();
    this.xLabelEl.remove();
    this.yLabelEl.remove();
    this.zLabelEl.remove();
    super.dispose();
  }

  private rebuild(): void {
    const origin = this.params.origin;
    const target = this.params.target;
    const cornerX = new THREE.Vector3(target.x, origin.y, origin.z);
    const cornerXY = new THREE.Vector3(target.x, target.y, origin.z);
    const displayOrigin = origin.clone().applyMatrix4(this.params.displayTransform);
    const displayTarget = target.clone().applyMatrix4(this.params.displayTransform);
    const displayDelta = displayTarget.clone().sub(displayOrigin);
    const distance = displayOrigin.distanceTo(displayTarget);

    this.setLineGeometry(this.mainGeometry, origin, target);
    this.setLineGeometry(this.xGeometry, origin, cornerX);
    this.setLineGeometry(this.yGeometry, cornerX, cornerXY);
    this.setLineGeometry(this.zGeometry, cornerXY, target);

    this.originMarker.position.copy(origin);
    this.targetMarker.position.copy(target);

    const prefix = this.params.labelPrefix ? `${this.params.labelPrefix} ` : '';
    const approxPrefix = this.params.approximate ? '~ ' : '';
    this.mainLabelEl.textContent = `${prefix}${approxPrefix}${formatLength(distance)}`;
    this.xLabelEl.textContent = `X ${approxPrefix}${formatLength(Math.abs(displayDelta.x))}`;
    this.yLabelEl.textContent = `Y ${approxPrefix}${formatLength(Math.abs(displayDelta.y))}`;
    this.zLabelEl.textContent = `Z ${approxPrefix}${formatLength(Math.abs(displayDelta.z))}`;

    this.mainLabel.position.copy(origin.clone().lerp(target, 0.5).add(new THREE.Vector3(0, 0.14, 0)));
    this.xLabel.position.copy(origin.clone().lerp(cornerX, 0.5).add(new THREE.Vector3(0, 0.08, 0)));
    this.yLabel.position.copy(cornerX.clone().lerp(cornerXY, 0.5).add(new THREE.Vector3(0, 0.08, 0)));
    this.zLabel.position.copy(cornerXY.clone().lerp(target, 0.5).add(new THREE.Vector3(0, 0.08, 0)));

    const showRoot = this.params.visible;
    const showWire = showRoot && this.params.wireVisible;
    const showAxes = showRoot && this.params.showAxes && this.params.axisVisible;
    const showLabels = showRoot && this.params.labelVisible;

    this.visible = showRoot;
    this.mainLine.visible = showWire;
    this.originMarker.visible = showRoot && this.params.originVisible;
    this.targetMarker.visible = showRoot && this.params.targetVisible;
    this.mainLabel.visible = showWire && showLabels;
    this.xLine.visible = showAxes && this.params.xAxisVisible;
    this.yLine.visible = showAxes && this.params.yAxisVisible;
    this.zLine.visible = showAxes && this.params.zAxisVisible;
    this.xLabel.visible = showLabels && this.params.xAxisVisible;
    this.yLabel.visible = showLabels && this.params.yAxisVisible;
    this.zLabel.visible = showLabels && this.params.zAxisVisible;
  }

  private setLineGeometry(geometry: LineGeometry, start: THREE.Vector3, end: THREE.Vector3): void {
    geometry.setPositions([
      start.x,
      start.y,
      start.z,
      end.x,
      end.y,
      end.z,
    ]);
  }

  private updateLabelLayout(camera: THREE.Camera): void {
    const origin = this.params.origin;
    const target = this.params.target;
    const cornerX = this.tempLocalA.set(target.x, origin.y, origin.z);
    const cornerXY = this.tempLocalB.set(target.x, target.y, origin.z);
    const displayOrigin = this.tempWorldA.copy(origin).applyMatrix4(this.params.displayTransform);
    const displayTarget = this.tempWorldB.copy(target).applyMatrix4(this.params.displayTransform);
    const displayDelta = displayTarget.sub(displayOrigin);
    const hasX = Math.abs(displayDelta.x) > 1e-6;
    const hasY = Math.abs(displayDelta.y) > 1e-6;
    const hasZ = Math.abs(displayDelta.z) > 1e-6;

    const offsetDir =
      computeDimensionOffsetDirInLocal(origin, target, camera, this.matrixWorld) ??
      this.offsetDirLocal.set(0, 1, 0);
    this.offsetDirLocal.copy(offsetDir).normalize();
    this.sideDirLocal
      .copy(target)
      .sub(origin)
      .cross(this.offsetDirLocal)
      .normalize();
    if (!Number.isFinite(this.sideDirLocal.lengthSq()) || this.sideDirLocal.lengthSq() < 1e-9) {
      this.sideDirLocal.set(1, 0, 0);
    }

    const lineMidLocal = this.tempLocalC.copy(origin).lerp(target, 0.5);
    const lineMidWorld = this.localToWorld(this.tempWorldA.copy(lineMidLocal));
    const viewport = (camera as any)?.userData?.annotationViewport as
      | { width?: number; height?: number }
      | undefined;
    const vw = Math.max(1, Math.floor(Number(viewport?.width) || 1000));
    const vh = Math.max(1, Math.floor(Number(viewport?.height) || 1000));
    const wpp = worldPerPixelAt(camera, lineMidWorld, vw, vh, this.wppTmp);
    if (!Number.isFinite(wpp) || wpp <= 0) return;

    let localWpp = wpp;
    try {
      this.getWorldScale(this.worldScale);
      const scale =
        (Math.abs(this.worldScale.x) + Math.abs(this.worldScale.y) + Math.abs(this.worldScale.z)) / 3;
      if (Number.isFinite(scale) && scale > 1e-9) {
        localWpp = wpp / scale;
      }
    } catch {
      // ignore
    }

    const mainOffset = localWpp * 18;
    const axisOffset = localWpp * 12;
    const slotOffset = localWpp * 16;
    const xDir = this.tempLocalD.copy(cornerX).sub(origin).normalize();
    const zDir = this.tempLocalE.copy(target).sub(cornerXY).normalize();
    if (!Number.isFinite(xDir.lengthSq()) || xDir.lengthSq() < 1e-9) xDir.copy(this.sideDirLocal);
    if (!Number.isFinite(zDir.lengthSq()) || zDir.lengthSq() < 1e-9) zDir.copy(this.sideDirLocal).negate();

    const xAnchor = hasX
      ? this.tempLocalF.copy(origin).lerp(cornerX, 0.5)
      : this.tempLocalF.copy(origin);
    const yAnchor = hasY
      ? this.tempLocalG.copy(cornerX).lerp(cornerXY, 0.5)
      : this.tempLocalG.copy(cornerX);
    const zAnchor = hasZ
      ? this.tempLocalE.copy(cornerXY).lerp(target, 0.5)
      : this.tempLocalE.copy(cornerXY);

    this.mainLabel.position.copy(lineMidLocal).addScaledVector(this.offsetDirLocal, mainOffset);
    this.xLabel.position
      .copy(xAnchor)
      .addScaledVector(this.offsetDirLocal, axisOffset)
      .addScaledVector(this.sideDirLocal, slotOffset)
      .addScaledVector(xDir, hasX ? localWpp * 6 : 0);
    this.yLabel.position
      .copy(yAnchor)
      .addScaledVector(this.offsetDirLocal, axisOffset * 1.05)
      .addScaledVector(this.sideDirLocal, -slotOffset * 0.85);
    this.zLabel.position
      .copy(zAnchor)
      .addScaledVector(this.offsetDirLocal, axisOffset)
      .addScaledVector(this.sideDirLocal, slotOffset * 0.3)
      .addScaledVector(zDir, hasZ ? -localWpp * 6 : 0);

    const baseShowRoot = this.params.visible;
    const baseShowLabels = baseShowRoot && this.params.labelVisible && this.params.wireVisible;
    const baseShowAxes = baseShowRoot && this.params.showAxes && this.params.axisVisible;

    this.mainLabel.visible = baseShowLabels;
    this.xLine.visible = baseShowAxes && this.params.xAxisVisible && hasX;
    this.yLine.visible = baseShowAxes && this.params.yAxisVisible && hasY;
    this.zLine.visible = baseShowAxes && this.params.zAxisVisible && hasZ;
    this.xLabel.visible = baseShowLabels && this.params.xAxisVisible;
    this.yLabel.visible = baseShowLabels && this.params.yAxisVisible;
    this.zLabel.visible = baseShowLabels && this.params.zAxisVisible;
  }

  private updateLineStyle(): void {
    const { width, height } = this.materials.getResolution();
    for (const [line, lineWidth] of [
      [this.mainLine, MAIN_LINE_WIDTH_PX],
      [this.xLine, AXIS_LINE_WIDTH_PX],
      [this.yLine, AXIS_LINE_WIDTH_PX],
      [this.zLine, AXIS_LINE_WIDTH_PX],
    ] as const) {
      const material = line.material as LineMaterial;
      material.resolution.set(width, height);
      material.dashed = false;
      material.scale = 1;
      material.dashSize = 0;
      material.gapSize = 0;
      material.linewidth = lineWidth;
    }
  }

  private getLineMaterial(key: string, solid: LineMaterial, lineWidth: number): LineMaterial {
    const cached = this.lineMaterialCache.get(key);
    const src = (cached as any)?.__src as LineMaterial | undefined;
    if (cached && src === solid) {
      cached.linewidth = lineWidth;
      cached.dashed = false;
      return cached;
    }
    if (cached) {
      cached.dispose();
      this.lineMaterialCache.delete(key);
    }

    const material = solid.clone();
    (material as any).__src = solid;
    material.dashed = false;
    material.linewidth = lineWidth;
    material.scale = 1;
    material.dashSize = 0;
    material.gapSize = 0;
    material.resolution.copy(solid.resolution);
    this.lineMaterialCache.set(key, material);
    return material;
  }

  private applyVisualState(): void {
    const state = this.interactionState;
    const mainLineMat =
      state === 'selected'
        ? this.getLineMaterial('main-selected', this.materials.ssSelected.fatLine, MAIN_LINE_WIDTH_PX)
        : state === 'hovered'
          ? this.getLineMaterial('main-hovered', this.materials.ssHovered.fatLine, MAIN_LINE_WIDTH_PX)
          : this.getLineMaterial('main-normal', this.materialSet.fatLine, MAIN_LINE_WIDTH_PX);
    const axisLineMat =
      state === 'selected'
        ? this.getLineMaterial('axis-selected', this.materials.ssSelected.fatLine, AXIS_LINE_WIDTH_PX)
        : state === 'hovered'
          ? this.getLineMaterial('axis-hovered', this.materials.ssHovered.fatLine, AXIS_LINE_WIDTH_PX)
          : null;
    const meshMat =
      state === 'selected'
        ? this.materials.ssSelected.mesh
        : state === 'hovered'
          ? this.materials.ssHovered.mesh
          : this.materialSet.mesh;

    this.mainLine.material = mainLineMat;
    this.xLine.material = axisLineMat ?? this.getLineMaterial('x-normal', this.xMaterialSet.fatLine, AXIS_LINE_WIDTH_PX);
    this.yLine.material = axisLineMat ?? this.getLineMaterial('y-normal', this.yMaterialSet.fatLine, AXIS_LINE_WIDTH_PX);
    this.zLine.material = axisLineMat ?? this.getLineMaterial('z-normal', this.zMaterialSet.fatLine, AXIS_LINE_WIDTH_PX);
    this.originMarker.material = meshMat;
    this.targetMarker.material = meshMat;

    const textColor = '#ffffff';
    const highlightBorder = state === 'selected'
      ? 'rgba(239, 68, 68, 0.9)'
      : state === 'hovered'
        ? 'rgba(234, 179, 8, 0.9)'
        : '';
    const labelBorders = ['#0891b2', '#b91c1c', '#15803d', '#0284c7'];
    [this.mainLabelEl, this.xLabelEl, this.yLabelEl, this.zLabelEl].forEach((el, index) => {
      el.style.color = textColor;
      el.style.borderColor = highlightBorder || labelBorders[index] || '#0f172a';
    });
  }
}
